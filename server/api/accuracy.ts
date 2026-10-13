// Track record: how often the predictions came true, and whether their
// stated probabilities mean what they say (calibration).
//
// Live and backtest are always separate blocks — never blended. "Live" counts
// only predictions written down before the match was played.
import { all } from "../db.js";
import { SEASONS } from "../data/seasons.js";
import { ENGINE_VERSION, type ConfidenceTier } from "@control-scout/predict-engine";
import type { AccuracyBlock, TrackRecord } from "../../src/shared/api.js";
import { matchViews } from "./matches.js";
import { dataVersion } from "../predict/engine.js";

/** Live matches needed before the headline switches from backtest to live. */
export const LIVE_THRESHOLD = 300;

interface Row { p: number; y: number; tier: ConfidenceTier; level: string; time: string | null }

const EPS = 1e-6;
const isoWeek = (t: string) => {
  const d = new Date(t.length > 10 ? t.slice(0, 10) + "T00:00:00Z" : t + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

export function block(rows: Row[]): AccuracyBlock | null {
  if (!rows.length) return null;
  const decided = rows.filter((r) => r.y !== 0.5 && r.p !== 0.5);
  const right = (r: Row) => (r.p > 0.5) === (r.y === 1);
  const acc = (xs: Row[]) => { const d = xs.filter((r) => r.y !== 0.5 && r.p !== 0.5); return d.length ? d.filter(right).length / d.length : 0; };
  const brier = (xs: Row[]) => xs.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / Math.max(1, xs.length);
  const logLoss = -rows.reduce((s, r) => { const p = Math.min(1 - EPS, Math.max(EPS, r.p)); return s + r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p); }, 0) / rows.length;
  const reliability = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, predicted: 0, actual: 0 }));
  for (const r of rows) { const b = reliability[Math.min(9, Math.floor(r.p * 10))]; b.n++; b.predicted += r.p; b.actual += r.y; }
  for (const b of reliability) if (b.n) { b.predicted /= b.n; b.actual /= b.n; }
  const tiers = ["provisional", "moderate", "confident"] as const;
  const byTier = Object.fromEntries(tiers.map((t) => { const xs = rows.filter((r) => r.tier === t); return [t, { n: xs.length, accuracy: acc(xs), brier: brier(xs) }]; })) as AccuracyBlock["byTier"];
  const q = rows.filter((r) => r.level === "qual"), pl = rows.filter((r) => r.level === "playoff");
  const weeks = new Map<string, Row[]>();
  for (const r of rows) if (r.time) { const w = isoWeek(r.time); weeks.set(w, [...(weeks.get(w) ?? []), r]); }
  return {
    n: rows.length,
    accuracy: acc(rows),
    brier: brier(rows),
    logLoss,
    baselineBrier: rows.reduce((s, r) => s + (0.5 - r.y) ** 2, 0) / rows.length,
    reliability,
    byTier,
    byLevel: { qual: { n: q.length, accuracy: acc(q) }, playoff: { n: pl.length, accuracy: acc(pl) } },
    weekly: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, xs]) => ({ week, n: xs.length, accuracy: acc(xs) })),
    upsets: decided.filter((r) => !right(r)).length,
  };
}

let cached: { key: string; value: TrackRecord } | null = null;

export async function trackRecord(): Promise<TrackRecord> {
  const live = await all<{ c: number; s: string | null }>("SELECT COUNT(*) c, MAX(scored_at) s FROM predictions WHERE kind = 'live' AND outcome IS NOT NULL");
  const key = `${await dataVersion()}|${live[0]?.c}|${live[0]?.s}`;
  if (cached?.key === key) return cached.value;
  const rows = await all<any>("SELECT kind, season, p_red p, outcome y, tier, level, match_time time FROM predictions WHERE outcome IS NOT NULL");
  const seasons = SEASONS.map((s) => {
    const of = (kind: string) => rows.filter((r) => r.kind === kind && Number(r.season) === s.season).map((r) => ({ p: Number(r.p), y: Number(r.y), tier: r.tier, level: r.level, time: r.time }));
    return { season: s.season, label: `${s.label} ${s.game}`, live: block(of("live")), backtest: block(of("backtest")) };
  }).reverse();
  // Headline: live once it has a real sample, otherwise the latest backtest — always labelled.
  let headline: TrackRecord["headline"] = null;
  const liveBest = seasons.find((s) => s.live && s.live.n >= LIVE_THRESHOLD);
  if (liveBest?.live) headline = { kind: "live", season: liveBest.season, accuracy: liveBest.live.accuracy, n: liveBest.live.n };
  else {
    const bt = seasons.find((s) => s.backtest && s.backtest.n >= 1000);
    if (bt?.backtest) headline = { kind: "backtest", season: bt.season, accuracy: bt.backtest.accuracy, n: bt.backtest.n };
  }
  // The most recent scored live calls (or none yet).
  const recent = await all<any>("SELECT season, code, level, series, number FROM predictions WHERE kind = 'live' AND outcome IS NOT NULL ORDER BY match_time DESC LIMIT 12");
  const recentCalls: TrackRecord["recentCalls"] = [];
  for (const r of recent) {
    const ms = await matchViews({ season: r.season, code: r.code });
    const m = ms.find((x) => x.key === `${r.level}:${r.series}:${r.number}`);
    if (m?.prediction) recentCalls.push(m as TrackRecord["recentCalls"][number]);
  }
  const value: TrackRecord = { seasons, engineVersion: ENGINE_VERSION, liveThreshold: LIVE_THRESHOLD, headline, recentCalls, generatedAt: new Date().toISOString() };
  cached = { key, value };
  return value;
}
