// Track record: how often the predictions came true, and whether their
// stated probabilities mean what they say (calibration).
//
// Live and backtest are always separate blocks — never blended. "Live" counts
// only predictions written down before the match was played.
import { all } from "../db.js";
import { PREDICT_SEASONS, SEASONS } from "../data/seasons.js";
import { ENGINE_VERSION, type ConfidenceTier } from "@control-scout/predict-engine";
import type { AccuracyBlock, ShadowScore, TrackRecord } from "../../src/shared/api.js";
import { matchViews } from "./matches.js";
import { dataVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";

/** Live matches needed before the headline switches from backtest to live. */
export const LIVE_THRESHOLD = 300;

interface Row { p: number; y: number; tier: ConfidenceTier; level: string; time: string | null }

const EPS = 1e-6;
export const isoWeek = (t: string) => {
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

/** The last track record built, and the build under way (one at a time, shared by every caller). */
let cached: { key: string; value: TrackRecord } | null = null;
let building: { key: string; value: Promise<TrackRecord> } | null = null;

/** What the track record depends on: the data version and the scored live calls. */
async function trackRecordKey(): Promise<string> {
  const live = await all<{ c: number; s: string | null }>("SELECT COUNT(*) c, MAX(scored_at) s FROM predictions WHERE kind = 'live' AND outcome IS NOT NULL");
  return `${await dataVersion()}|${live[0]?.c}|${live[0]?.s}`;
}

function build(key: string): Promise<TrackRecord> {
  if (building?.key === key) return building.value;
  const value = computeTrackRecord().then((v) => {
    // A newer build may have started meanwhile: never let an older one overwrite it.
    if (building?.value === value) { cached = { key, value: v }; building = null; }
    return v;
  }, (e) => { if (building?.value === value) building = null; throw e; });
  building = { key, value };
  return value;
}

/**
 * The track record, cached in memory by what it depends on. Building it reads every scored
 * prediction (≈1.5 s cold), so the server builds it at startup and again whenever the data moves
 * on (warmTrackRecord); meanwhile visitors get the previous one, the way pages keep the previous
 * ratings while new ones build. Only the very first build, before any exists, is waited for.
 */
export async function trackRecord(): Promise<TrackRecord> {
  const key = await trackRecordKey();
  if (cached?.key === key) return cached.value;
  const next = build(key);
  if (!cached) return next;
  next.catch(() => {}); // a failed rebuild keeps the previous record (and is retried on the next request or warm-up)
  return cached.value;
}

/** Build the track record now if the data moved on (server start, and polled after syncs), so no visitor waits for it. */
export async function warmTrackRecord(): Promise<void> {
  const key = await trackRecordKey();
  if (cached?.key !== key) await build(key);
}

/** Forget the cached track record (tests). */
export function resetTrackRecord(): void { cached = null; building = null; }
registerCache("Track record", resetTrackRecord);

async function computeTrackRecord(): Promise<TrackRecord> {
  const rows = await all<any>("SELECT kind, season, p_red p, outcome y, tier, level, match_time time, engine_version engine, model_id model, p_red_shadow ps, shadow_model_id sm FROM predictions WHERE outcome IS NOT NULL");
  const seasons = SEASONS.filter((s) => PREDICT_SEASONS.includes(s.season)).map((s) => {
    const of = (kind: string, engine?: string) => rows.filter((r) => r.kind === kind && Number(r.season) === s.season && (engine == null || r.engine === engine))
      .map((r) => ({ p: Number(r.p), y: Number(r.y), tier: r.tier, level: r.level, time: r.time }));
    // Prospective evidence per engine version: each version's own calls only.
    const engines = [...new Set(rows.filter((r) => r.kind === "live" && Number(r.season) === s.season).map((r) => String(r.engine)))].sort();
    const liveByEngine = engines.map((engine) => { const b = block(of("live", engine))!; return { engine, n: b.n, accuracy: b.accuracy, brier: b.brier, logLoss: b.logLoss }; });
    // Paired: the same live calls scored for the served and the shadow model.
    const paired = new Map<string, { y: number; p: number; ps: number }[]>();
    for (const r of rows) {
      if (r.kind !== "live" || Number(r.season) !== s.season || r.ps == null || !r.model || !r.sm) continue;
      const k = `${r.model}|${r.sm}`;
      let xs = paired.get(k);
      if (!xs) { xs = []; paired.set(k, xs); }
      xs.push({ y: Number(r.y), p: Number(r.p), ps: Number(r.ps) });
    }
    const score = (xs: { y: number; p: number }[]): ShadowScore => {
      const d = xs.filter((x) => x.y !== 0.5 && x.p !== 0.5);
      const ll = -xs.reduce((a, x) => { const q = Math.min(1 - EPS, Math.max(EPS, x.p)); return a + x.y * Math.log(q) + (1 - x.y) * Math.log(1 - q); }, 0) / Math.max(1, xs.length);
      return { accuracy: d.length ? d.filter((x) => (x.p > 0.5) === (x.y === 1)).length / d.length : 0, brier: xs.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / Math.max(1, xs.length), logLoss: ll };
    };
    const liveShadow = [...paired].sort(([a], [b]) => a.localeCompare(b)).map(([k, xs]) => {
      const [servedModel, shadowModel] = k.split("|");
      return { servedModel, shadowModel, n: xs.length, served: score(xs), shadow: score(xs.map((x) => ({ y: x.y, p: x.ps }))) };
    });
    return { season: s.season, label: `${s.label} ${s.game}`, live: block(of("live")), backtest: block(of("backtest")), liveByEngine, liveShadow };
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
  return { seasons, engineVersion: ENGINE_VERSION, liveThreshold: LIVE_THRESHOLD, headline, recentCalls, generatedAt: new Date().toISOString() };
}
