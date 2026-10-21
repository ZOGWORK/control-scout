// Track record: how often the predictions came true, and whether their
// stated probabilities mean what they say (calibration).
//
// Live and backtest are always separate blocks — never blended. "Live" counts
// only predictions written down before the match was played.
import { all, kvGet } from "../db.js";
import { CURRENT_SEASON, PREDICT_SEASONS, SEASONS } from "../data/seasons.js";
import { ENGINE_VERSION, type ConfidenceTier } from "@control-scout/predict-engine";
import type { AccuracyBlock, RangeCoverage, ReplayCoverage, ShadowScore, TrackRecord } from "../../src/shared/api.js";
import { LIVE_THRESHOLD, pickHeadline } from "../../src/shared/ledger.js";
import { matchViews } from "./matches.js";
import { dataVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";

export { LIVE_THRESHOLD };

interface Row { p: number; y: number; tier: ConfidenceTier; level: string; time: string | null; ranges?: StatedRanges | null }
/** A call's stated score ranges (engine 2.2+) and the real scores. */
export interface StatedRanges { level: number; red: [number, number]; blue: [number, number]; redScore: number; blueScore: number }

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
  // Appended in place: copying the week's list on every row made this quadratic (most of the track record's build time).
  for (const r of rows) if (r.time) { const w = isoWeek(r.time); const xs = weeks.get(w); if (xs) xs.push(r); else weeks.set(w, [r]); }
  return {
    n: rows.length,
    decided: decided.length,
    accuracy: acc(rows),
    brier: brier(rows),
    logLoss,
    baselineBrier: rows.reduce((s, r) => s + (0.5 - r.y) ** 2, 0) / rows.length,
    reliability,
    byTier,
    byLevel: { qual: { n: q.length, accuracy: acc(q) }, playoff: { n: pl.length, accuracy: acc(pl) } },
    weekly: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, xs]) => ({ week, n: xs.length, accuracy: acc(xs) })),
    upsets: decided.filter((r) => !right(r)).length,
    ranges: rangeCoverage(rows),
  };
}

/**
 * Score ranges, scored like the win calls: of the alliance scores whose call stated a range, the share that
 * landed inside it (and which way the misses went). An honest 80% range holds about 80%; more means the ranges
 * are wider than they need to be, less means they are overconfident. Null when no call stated a range.
 */
export function rangeCoverage(rows: Row[]): RangeCoverage | null {
  const tiers = ["provisional", "moderate", "confident"] as const;
  const acc = { n: 0, inside: 0, below: 0, above: 0, width: 0 };
  const byTier = Object.fromEntries(tiers.map((t) => [t, { n: 0, inside: 0 }])) as Record<ConfidenceTier, { n: number; inside: number }>;
  let level: number | null = null;
  for (const r of rows) {
    const g = r.ranges;
    if (!g) continue;
    level ??= g.level;
    const t = byTier[r.tier];
    for (const [[lo, hi], y] of [[g.red, g.redScore], [g.blue, g.blueScore]] as const) {
      acc.n++; acc.width += hi - lo;
      if (t) t.n++;
      if (y < lo) acc.below++;
      else if (y > hi) acc.above++;
      else { acc.inside++; if (t) t.inside++; }
    }
  }
  if (!acc.n || level == null) return null;
  return {
    level, n: acc.n, inside: acc.inside, coverage: acc.inside / acc.n, below: acc.below / acc.n, above: acc.above / acc.n, width: acc.width / acc.n,
    byTier: Object.fromEntries(tiers.map((t) => [t, { n: byTier[t].n, coverage: byTier[t].n ? byTier[t].inside / byTier[t].n : 0 }])) as RangeCoverage["byTier"],
  };
}

/** The stated ranges of a ledger row, when it has them, with its real scores. */
export function statedRanges(r: any): StatedRanges | null {
  if (r.red_lo == null || r.red_hi == null || r.blue_lo == null || r.blue_hi == null || r.red_score == null || r.blue_score == null) return null;
  return { level: Number(r.range_level ?? 0.8), red: [Number(r.red_lo), Number(r.red_hi)], blue: [Number(r.blue_lo), Number(r.blue_hi)], redScore: Number(r.red_score), blueScore: Number(r.blue_score) };
}

/** The last track record built, and the build under way (one at a time, shared by every caller). */
let cached: { key: string; value: TrackRecord } | null = null;
let building: { key: string; value: Promise<TrackRecord> } | null = null;

/**
 * What the track record depends on: the data version, when the stats run that wrote the replay finished
 * (data:settled), and the scored live calls. The data version moves at the START of a stats run, before the
 * replay is rewritten: keyed on it alone, the warm-up (every 15 s) cached the old replay under the new
 * version and kept it until the next run, so the replay lagged the scores by a whole cycle.
 */
async function trackRecordKey(): Promise<string> {
  const live = await all<{ c: number; s: string | null }>("SELECT COUNT(*) c, MAX(scored_at) s FROM predictions WHERE kind = 'live' AND outcome IS NOT NULL");
  return `${await dataVersion()}|${(await kvGet<string>("data:settled")) ?? ""}|${live[0]?.c}|${live[0]?.s}`;
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
export function resetTrackRecord(): void { cached = null; building = null; pastCoverage = null; }
registerCache("Track record", resetTrackRecord);

/**
 * Per season: every match with a final score, how many have a replayed call, and why the rest don't. The
 * replay (stats/job.ts backtest) leaves out remote and hybrid events, and predicts 2-on-2 from the robots that
 * actually played, so a match where an alliance had a no-show (or a single robot) is skipped. Anything else
 * missing is "other" (normally: scored since the replay was last rebuilt). The lineup is read only for
 * matches without a replayed call, so this stays a scan of the season's matches.
 */
export async function replayCoverage(seasons: number[]): Promise<Map<number, ReplayCoverage>> {
  const out = new Map<number, ReplayCoverage>();
  if (!seasons.length) return out;
  const rows = await all<{ season: number; scored: number; replayed: number; event_skipped: number; short_handed: number }>(
    `SELECT m.season,
            COUNT(*) scored,
            SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) replayed,
            SUM(CASE WHEN p.id IS NULL AND (COALESCE(e.remote, 0) = 1 OR COALESCE(e.hybrid, 0) = 1) THEN 1 ELSE 0 END) event_skipped,
            SUM(CASE WHEN p.id IS NOT NULL OR COALESCE(e.remote, 0) = 1 OR COALESCE(e.hybrid, 0) = 1 THEN 0
                     WHEN (SELECT COALESCE(SUM(CASE WHEN t.alliance = 'red' AND t.on_field = 1 THEN 1 ELSE 0 END), 0) = 2
                              AND COALESCE(SUM(CASE WHEN t.alliance = 'blue' AND t.on_field = 1 THEN 1 ELSE 0 END), 0) = 2
                           FROM match_teams t
                           WHERE t.season = m.season AND t.code = m.code AND t.level = m.level AND t.series = m.series AND t.number = m.number) THEN 0
                     ELSE 1 END) short_handed
     FROM matches m
     LEFT JOIN events e ON e.season = m.season AND e.code = m.code
     LEFT JOIN predictions p ON p.kind = 'backtest' AND p.season = m.season AND p.code = m.code AND p.level = m.level AND p.series = m.series AND p.number = m.number
     WHERE m.season IN (${seasons.map(() => "?").join(",")}) AND m.played = 1 AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL
     GROUP BY m.season`,
    seasons,
  );
  for (const r of rows) {
    const scored = Number(r.scored), replayed = Number(r.replayed), eventSkipped = Number(r.event_skipped), shortHanded = Number(r.short_handed);
    out.set(Number(r.season), { scored, replayed, eventSkipped, shortHanded, other: Math.max(0, scored - replayed - eventSkipped - shortHanded) });
  }
  return out;
}

/**
 * Past seasons' coverage, kept until a full stats run finishes (stats:last): only that run rewrites their
 * replay or results. Counting them reads ~120k matches (about a second), while the track record is rebuilt
 * every time a live call is scored; the current season is small and counted on every build.
 */
let pastCoverage: { key: string; value: Map<number, ReplayCoverage> } | null = null;

async function seasonCoverage(): Promise<Map<number, ReplayCoverage>> {
  const key = JSON.stringify((await kvGet<unknown>("stats:last")) ?? null);
  const past = PREDICT_SEASONS.filter((s) => s !== CURRENT_SEASON);
  if (pastCoverage?.key !== key) pastCoverage = { key, value: await replayCoverage(past) };
  const current = PREDICT_SEASONS.includes(CURRENT_SEASON) ? await replayCoverage([CURRENT_SEASON]) : new Map<number, ReplayCoverage>();
  return new Map([...pastCoverage.value, ...current]);
}

async function computeTrackRecord(): Promise<TrackRecord> {
  const rows = await all<any>("SELECT kind, season, p_red p, outcome y, tier, level, match_time time, engine_version engine, model_id model, p_red_shadow ps, shadow_model_id sm, red_lo, red_hi, blue_lo, blue_hi, range_level, red_score, blue_score FROM predictions WHERE outcome IS NOT NULL");
  const coverage = await seasonCoverage();
  const seasons = SEASONS.filter((s) => PREDICT_SEASONS.includes(s.season)).map((s) => {
    const of = (kind: string, engine?: string) => rows.filter((r) => r.kind === kind && Number(r.season) === s.season && (engine == null || r.engine === engine))
      .map((r) => ({ p: Number(r.p), y: Number(r.y), tier: r.tier, level: r.level, time: r.time, ranges: statedRanges(r) }));
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
    return { season: s.season, label: `${s.label} ${s.game}`, live: block(of("live")), backtest: block(of("backtest")), replay: coverage.get(s.season), liveByEngine, liveShadow };
  }).reverse();
  // Headline: the one rule every ledger card reads (src/shared/ledger.ts), always labelled with its kind.
  const headline = pickHeadline(seasons);
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
