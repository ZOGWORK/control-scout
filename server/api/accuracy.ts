// Track record: how often the predictions came true, and whether their
// stated probabilities mean what they say (calibration).
//
// Live and backtest are always separate blocks — never blended. "Live" counts
// only predictions written down before the match was played.
import { all, allInChunks, kvGet } from "../db.js";
import type { InArgs } from "@libsql/client";
import { CURRENT_SEASON, PREDICT_SEASONS, SEASONS, bonusLabels } from "../data/seasons.js";
import { ENGINE_VERSION, type ConfidenceTier } from "@control-scout/predict-engine";
import type { AccuracyBlock, BonusAccuracy, MarginError, RangeCoverage, RangeCoverageNow, ReplayCoverage, ShadowScore, TrackRecord } from "../../src/shared/api.js";
import { LIVE_THRESHOLD, pickHeadline } from "../../src/shared/ledger.js";
import { matchViews } from "./matches.js";
import { dataVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";

export { LIVE_THRESHOLD };

interface Row { p: number; y: number; tier: ConfidenceTier; level: string; time: string | null; ranges?: StatedRanges | null; margin?: CallMargin | null }
/** A call's predicted margin (red's expected score minus blue's) and the real one. */
export interface CallMargin { predicted: number; actual: number }
/** A call's stated score ranges (engine 2.2+) and the real scores. */
export interface StatedRanges { level: number; red: [number, number]; blue: [number, number]; redScore: number; blueScore: number }

const EPS = 1e-6;
export const isoWeek = (t: string) => {
  const d = new Date(t.length > 10 ? t.slice(0, 10) + "T00:00:00Z" : t + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

/** A call that counts toward win-call accuracy: the match wasn't a tie and the call wasn't a coin flip (p exactly 0.5). */
export const decidedCall = (r: { p: number; y: number }) => r.y !== 0.5 && r.p !== 0.5;
/** A decided call that named the winner. The one rule for "right" (track record, the email digest's check-in). */
export const rightCall = (r: { p: number; y: number }) => (r.p > 0.5) === (r.y === 1);

export function block(rows: Row[]): AccuracyBlock | null {
  if (!rows.length) return null;
  const decided = rows.filter(decidedCall);
  const right = rightCall;
  const acc = (xs: Row[]) => { const d = xs.filter(decidedCall); return d.length ? d.filter(right).length / d.length : 0; };
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
    margin: marginError(rows),
  };
}

/**
 * Margin error, scored on the same calls as the win calls: the mean absolute gap between the predicted margin
 * (red's expected score minus blue's) and the real one, in points. Its "no skill" line is always predicting a
 * 0-point margin (the mean absolute real margin). Calls with no predicted score (logged before the season's
 * first rated match) have no margin and are left out. Null when no call in the block has one.
 */
export function marginError(rows: Row[]): MarginError | null {
  const by = { qual: { n: 0, abs: 0 }, playoff: { n: 0, abs: 0 } };
  let n = 0, abs = 0, base = 0;
  for (const r of rows) {
    const g = r.margin;
    if (!g) continue;
    const e = Math.abs(g.predicted - g.actual);
    n++; abs += e; base += Math.abs(g.actual);
    const l = r.level === "playoff" ? by.playoff : by.qual;
    l.n++; l.abs += e;
  }
  if (!n) return null;
  const lvl = (x: { n: number; abs: number }) => ({ n: x.n, mae: x.n ? x.abs / x.n : 0 });
  return { n, mae: abs / n, baselineMae: base / n, byLevel: { qual: lvl(by.qual), playoff: lvl(by.playoff) } };
}

/** A ledger row's predicted and real margin, when it has both (null for a call with no predicted score). */
export function callMargin(r: { no_score_basis?: unknown; red_mean?: unknown; blue_mean?: unknown; red_score?: unknown; blue_score?: unknown }): CallMargin | null {
  if (Number(r.no_score_basis) || r.red_mean == null || r.blue_mean == null || r.red_score == null || r.blue_score == null) return null;
  const predicted = Number(r.red_mean) - Number(r.blue_mean), actual = Number(r.red_score) - Number(r.blue_score);
  return Number.isFinite(predicted) && Number.isFinite(actual) ? { predicted, actual } : null;
}

/** One alliance's bonus RP calls (engine slot order) and what it earned. */
export interface BonusCall { p: [number, number, number]; y: [boolean, boolean, boolean] }

/** Bonus RP calls scored like win calls: Brier per alliance-bonus call, per bonus RP, and reliability. */
export function bonusBlock(calls: BonusCall[], labels: [string, string, string], matches: number): BonusAccuracy | null {
  if (!calls.length) return null;
  const flat = calls.flatMap((c) => c.p.map((p, i) => ({ p, y: c.y[i] ? 1 : 0, i })));
  const brier = (xs: typeof flat) => xs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / Math.max(1, xs.length);
  const baseRate = (xs: typeof flat) => { const r = xs.reduce((s, x) => s + x.y, 0) / Math.max(1, xs.length); return xs.reduce((s, x) => s + (r - x.y) ** 2, 0) / Math.max(1, xs.length); };
  const bySlot = labels.map((label, i) => {
    const xs = flat.filter((x) => x.i === i);
    return { label, n: xs.length, brier: brier(xs), predicted: xs.reduce((s, x) => s + x.p, 0) / xs.length, actual: xs.reduce((s, x) => s + x.y, 0) / xs.length };
  });
  const reliability = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, predicted: 0, actual: 0 }));
  for (const x of flat) { const b = reliability[Math.min(9, Math.floor(x.p * 10))]; b.n++; b.predicted += x.p; b.actual += x.y; }
  for (const b of reliability) if (b.n) { b.predicted /= b.n; b.actual /= b.n; }
  // Base rate per bonus RP (they differ a lot), summed back over every call.
  const baseRateBrier = bySlot.reduce((s, _, i) => { const xs = flat.filter((x) => x.i === i); return s + baseRate(xs) * xs.length; }, 0) / flat.length;
  return { n: flat.length, matches, brier: brier(flat), baseRateBrier, bySlot, reliability };
}

const bonusTriple = (s: unknown): [number, number, number] | null => {
  if (typeof s !== "string") return null;
  try { const v = JSON.parse(s); return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number") ? v as [number, number, number] : null; } catch { return null; }
};
const bonusFlags = (s: unknown): [boolean, boolean, boolean] | null => {
  if (typeof s !== "string") return null;
  try { const v = JSON.parse(s); return v && typeof v === "object" ? [!!v.movement, !!v.goal, !!v.pattern] : null; } catch { return null; }
};

/** Let the event loop go: requests waiting behind a long build are answered in between. */
const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

/** Rows per read of the scored calls (db.ts allInChunks). At 10,000 a part, one part of a season's replay held the
 *  server's one thread 311-352 ms on a copy of the VM's data (2026-11-22: 22 columns a row, made into objects by the
 *  driver); at 2,000 a part holds it a fifth of that. */
const CALL_CHUNK = 2_000;
/** Rows worked through between two yields once read (plainRows, bonusRows). */
const COPY_PART = 4_000;

/** One scored call's bonus RP calls (each alliance's, where its match has recorded bonus RPs), with its event. */
interface BonusRow { pid: number; kind: string; season: number; code: string; calls: BonusCall[] }

/** Every scored bonus RP call's row (calls whose match has recorded bonus RPs only), in id order. `where`: which calls,
 *  as a condition on the prediction (`p`), with its arguments (every live and replayed call by default). */
async function bonusRows(chunk = CALL_CHUNK, where = "p.kind IN ('live', 'backtest')", args: InArgs = []): Promise<BonusRow[]> {
  // In chunks (db.ts allInChunks): one read of every call held the server's one thread for a third of a second.
  const rows = await allInChunks<any>(
    `SELECT p.id pid, p.kind, p.season, p.code, p.bonus_red, p.bonus_blue, m.red_bonus, m.blue_bonus FROM predictions p
       JOIN matches m ON m.season = p.season AND m.code = p.code AND m.level = p.level AND m.series = p.series AND m.number = p.number
      WHERE p.bonus_red IS NOT NULL AND p.outcome IS NOT NULL AND ${where} AND m.played = 1 AND p.id > ?`,
    args, "pid", chunk,
  );
  // Made into calls a part at a time too: a season's 40,000-odd at once, then its calls copied (plainRows), held the
  // thread 244 ms on a copy of the VM's data (2026-11-22).
  const out: BonusRow[] = [];
  for (let i = 0; i < rows.length; i += COPY_PART) {
    if (i) await yieldLoop();
    for (const r of rows.slice(i, i + COPY_PART)) {
      const calls: BonusCall[] = [];
      for (const [p, y] of [[bonusTriple(r.bonus_red), bonusFlags(r.red_bonus)], [bonusTriple(r.bonus_blue), bonusFlags(r.blue_bonus)]] as const) {
        if (p && y) calls.push({ p, y });
      }
      out.push({ pid: Number(r.pid), kind: String(r.kind), season: Number(r.season), code: String(r.code), calls });
    }
  }
  return out;
}

/** Bonus RP calls by kind and season, from their rows (in id order). */
function groupBonus(rows: BonusRow[], out: BonusBySeason = new Map()): BonusBySeason {
  for (const r of rows) {
    const k = `${r.kind}|${r.season}`;
    let e = out.get(k);
    if (!e) { e = { calls: [], matches: 0 }; out.set(k, e); }
    for (const c of r.calls) e.calls.push(c);
    if (r.calls.length) e.matches++;
  }
  return out;
}

/** Every scored bonus RP call, by kind and season. */
async function bonusCalls(chunk = CALL_CHUNK, where?: string, args?: InArgs): Promise<BonusBySeason> {
  return groupBonus(await bonusRows(chunk, where, args));
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

/** The track record last built, without checking or building anything (null before the first build): for page
 *  HTML, which must never wait on the database. The warm-up keeps it current. */
export function trackRecordIfReady(): TrackRecord | null { return cached?.value ?? null; }

/**
 * How the stated score ranges have held, for every surface that shows one (GET /api/predict/ranges and search's
 * prediction cards): the newest season whose live calls stated ranges, its live coverage and its replay's, each with
 * its sample. Read off the cached track record. Null before any live call stated a range, and while
 * the record is still being built.
 */
export async function rangeCoverageNow(): Promise<RangeCoverageNow | null> {
  // An optional footnote: read off the track record already built, never waiting for, starting or rechecking a build
  // (the server warms it at start and every 15 s; a build started here would hold up the answer that asked).
  const t = trackRecordIfReady();
  if (!t) return null;
  const s = [...t.seasons].sort((a, b) => b.season - a.season).find((x) => (x.live?.ranges?.n ?? 0) > 0);
  const g = s?.live?.ranges;
  if (!s || !g) return null;
  const r = s.backtest?.ranges;
  return { season: s.season, label: s.label, level: g.level, live: { n: g.n, coverage: g.coverage }, backtest: r && r.n > 0 ? { n: r.n, coverage: r.coverage } : null };
}

/** Build the track record now if the data moved on (server start, and polled after syncs), so no visitor waits for it. */
export async function warmTrackRecord(): Promise<void> {
  const key = await trackRecordKey();
  if (cached?.key !== key) await build(key);
}

/** Forget the cached track record (tests). */
export function resetTrackRecord(): void { cached = null; building = null; pastCoverage = null; replayed.clear(); seasonBlocks.clear(); }
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
  // By events, COVERAGE_PART at a time, the event loop let go between, the counts added up: a past season's 30,000-odd
  // matches counted in one statement held the server's one thread 130-230 ms on a copy of the VM's data (2026-11-22).
  for (const season of [...new Set(seasons)]) {
    const codes = (await all<{ code: string }>("SELECT DISTINCT code FROM matches WHERE season = ? ORDER BY code", [season])).map((r) => String(r.code));
    const sum = { scored: 0, replayed: 0, eventSkipped: 0, shortHanded: 0 };
    let any = false;
    for (let i = 0; i < codes.length; i += COVERAGE_PART) {
      if (i) await yieldLoop();
      for (const r of await coverageRows(season, codes.slice(i, i + COVERAGE_PART))) {
        any = true;
        sum.scored += Number(r.scored); sum.replayed += Number(r.replayed); sum.eventSkipped += Number(r.event_skipped); sum.shortHanded += Number(r.short_handed);
      }
    }
    if (any) out.set(season, { ...sum, other: Math.max(0, sum.scored - sum.replayed - sum.eventSkipped - sum.shortHanded) });
  }
  return out;
}

/** Events counted in one statement (replayCoverage). */
const COVERAGE_PART = 60;

async function coverageRows(season: number, codes: string[]) {
  return all<{ season: number; scored: number; replayed: number; event_skipped: number; short_handed: number }>(
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
     WHERE m.season = ? AND m.code IN (${codes.map(() => "?").join(",")}) AND m.played = 1 AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL
     GROUP BY m.season`,
    [season, ...codes],
  );
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
  // A season at a time, the event loop let go between: one read of every season held the thread for half a second.
  if (pastCoverage?.key !== key) {
    const value = new Map<number, ReplayCoverage>();
    for (const s of past) { for (const [k, v] of await replayCoverage([s])) value.set(k, v); await yieldLoop(); }
    pastCoverage = { key, value };
  }
  const current = PREDICT_SEASONS.includes(CURRENT_SEASON) ? await replayCoverage([CURRENT_SEASON]) : new Map<number, ReplayCoverage>();
  return new Map([...pastCoverage.value, ...current]);
}

/** What the predictions table holds, in brief, per kind: any write between two reads of it (a call logged or scored, a
 *  season's replay deleted and written again under new ids) changes it. From the (kind, season, scored_at) index alone:
 *  the whole table's scan held the thread 100–170 ms, twice a build. A call is scored by setting its scored_at and then
 *  its outcome; the outcome alone moving between two reads isn't seen here, but the live calls are read in one
 *  statement (never torn), and the track record's key counts the scored live calls, so the next build has it. */
async function callsFingerprint(): Promise<{ print: string; kinds: string[] }> {
  const rows = await all<{ kind: string; n: number; m: number; s: string }>("SELECT kind, COUNT(*) n, COALESCE(MAX(id), 0) m, COALESCE(MAX(scored_at), '') s FROM predictions GROUP BY kind ORDER BY kind");
  return { print: JSON.stringify(rows.map((r) => [r.kind, r.n, r.m, r.s])), kinds: rows.map((r) => String(r.kind)) };
}

/**
 * Every scored call and every bonus call, in chunks (db.ts allInChunks): read at once, the 100,000-odd scored calls
 * held the server's one thread for 1.3–2.5 s after every data move (measured 2026-11-10), every visitor's request
 * waiting behind it. In chunks, a write can land between two of them (a replay rewriting a season would be counted
 * twice, or not at all), so the table is fingerprinted before and after, and read again if it moved; after three
 * tries, each is read in one statement as it was before (consistent, and the thread held that once). `prints`: each
 * season's replay as read (replayedCalls), null when read in one statement.
 */
async function scoredCalls(): Promise<{ rows: any[]; bonus: BonusBySeason; prints: Map<number, string> | null }> {
  for (let i = 0; i < 3; i++) {
    const before = await callsFingerprint();
    const past = await replayedCalls();
    // Every other kind's calls (live, and the few logged too late), read every time: they're what moves between two
    // builds, a few thousand at most. By kind, so the read uses the kind index instead of scanning every call.
    const others = before.kinds.filter((k) => k !== "backtest");
    const rows = [...past.rows, ...(others.length ? await allInChunks<any>(SQL.replace("AND id > ?", `AND kind IN (${others.map(() => "?").join(", ")}) AND id > ?`), others, "id", CALL_CHUNK) : [])];
    const bonus: BonusBySeason = new Map([...past.bonus, ...await bonusCalls(CALL_CHUNK, "p.kind = 'live'")]);
    if ((await callsFingerprint()).print === before.print) { past.keep(); return { rows, bonus, prints: past.prints }; }
  }
  const WHOLE = 1_000_000_000;
  return { rows: await allInChunks<any>(SQL, [], "id", WHOLE), bonus: await bonusCalls(WHOLE), prints: null };
}

const SQL = "SELECT id, kind, season, p_red p, outcome y, tier, level, match_time time, engine_version engine, model_id model, p_red_shadow ps, shadow_model_id sm, red_lo, red_hi, blue_lo, blue_hi, range_level, red_score, blue_score, red_mean, blue_mean, no_score_basis FROM predictions WHERE outcome IS NOT NULL AND id > ?";

type BonusBySeason = Map<string, { calls: BonusCall[]; matches: number }>;

/**
 * Each season's replayed (backtest) calls as last read, kept by what that season's rows are (`print`). They were read
 * again on every build, and the track record is built twice after every live tick with new results (the live
 * follow-up moves data:version as it starts and data:settled as it ends): on the VM (2026-11-22) each build held the
 * one thread for 7–8 s of every live tick, 110,000 replayed calls and 35,000 bonus calls read through the driver, and
 * requests waited 0.3–3.3 s behind it (/api/health included). Measured on a copy of the data: 4.5 s a build, 95% of it
 * with the event loop held. A season's replay changes only when the stats run writes it again, under new ids (the
 * current season every cycle, the rest when the engine changes), so a build reads the other calls and the seasons whose
 * replay moved, nothing else.
 *
 * Its bonus calls also read the matches (the bonus RPs each alliance earned), which a sync can rewrite without the
 * replay moving: they're kept per event (`bonus`), with the event's result_watch rev as read just before them (every
 * write of an event's matches moves it, data/bundle.ts), and an event whose rev moved is read again.
 */
const replayed = new Map<number, { print: string; rows: any[]; bonus: Map<string, { rev: number | null; rows: BonusRow[] }> }>();

/**
 * A season's replayed calls, walked by id within the season's ids (`a` to `m` as listed, which every one of them lies
 * in: a rewrite moves the listed ids, so the print, and the read is retried). The "+" keeps SQLite off the (kind,
 * season) index: by it, each part sorted every call of the season left to read (and joined their matches) before
 * taking its 2,000, so a season's first parts held the server's one thread 150-200 ms each on a copy of the VM's
 * data (2026-11-22), and smaller parts only added work. By id, a part reads its own rows and stops.
 */
const REPLAY_RANGE = (t: string) => `+${t}kind = 'backtest' AND +${t}season = ? AND ${t}id BETWEEN ? AND ?`;

/** Driver rows as plain objects, a part at a time with the event loop let go between (a season's 50,000-odd rows
 *  copied in one go were one more long hold). */
async function plainRows(read: any[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < read.length; i += COPY_PART) {
    if (i) await yieldLoop();
    for (const r of read.slice(i, i + COPY_PART)) out.push({ ...r });
  }
  return out;
}

/** Each event's result_watch rev in a season (null: never watched, so its matches haven't been written since). */
async function eventRevs(season: number): Promise<Map<string, number>> {
  return new Map((await all<{ code: string; rev: number }>("SELECT code, rev FROM result_watch WHERE season = ?", [season])).map((r) => [String(r.code), Number(r.rev)]));
}

/** The replayed calls of every season, from `replayed` where a season's rows (and each event's matches) are as they
 *  were. `keep` stores what was read, once the caller has checked nothing was written meanwhile. `prints`: each
 *  season's replay and its events' revs, for the season blocks' keys. The replay prints come from the kind index. */
async function replayedCalls(): Promise<{ rows: any[]; bonus: BonusBySeason; prints: Map<number, string>; keep: () => void }> {
  const list = await all<any>("SELECT season, COUNT(*) n, MIN(id) a, MAX(id) m, COALESCE(MAX(scored_at), '') s FROM predictions WHERE kind = 'backtest' GROUP BY season ORDER BY season");
  const prints = new Map<number, string>();
  const fresh = new Map<number, { print: string; rows: any[]; bonus: Map<string, { rev: number | null; rows: BonusRow[] }> }>();
  const rows: any[] = [];
  const bonus: BonusBySeason = new Map();
  for (const p of list) {
    const season = Number(p.season), print = JSON.stringify([p.n, p.a, p.m, p.s]);
    const revs = await eventRevs(season);
    let hit = replayed.get(season);
    if (hit?.print !== print) {
      // Kept as plain objects: a driver row also carries every column under its index.
      const read = await allInChunks<any>(SQL.replace("AND id > ?", `AND ${REPLAY_RANGE("")} AND id > ?`), [season, p.a, p.m], "id", CALL_CHUNK);
      // Every watched event, with or without bonus calls yet: one whose matches get their bonus RPs later is read then.
      const byEvent = new Map<string, { rev: number | null; rows: BonusRow[] }>([...revs].map(([code, rev]) => [code, { rev, rows: [] }]));
      for (const r of await bonusRows(CALL_CHUNK, REPLAY_RANGE("p."), [season, p.a, p.m])) {
        let e = byEvent.get(r.code);
        if (!e) { e = { rev: revs.get(r.code) ?? null, rows: [] }; byEvent.set(r.code, e); }
        e.rows.push(r);
      }
      hit = { print, rows: await plainRows(read), bonus: byEvent };
      fresh.set(season, hit);
    } else {
      // The same replay: only the events whose matches were written since are read again.
      const moved = [...new Set([...revs.keys(), ...hit.bonus.keys()])].filter((code) => hit!.bonus.get(code)?.rev !== (revs.get(code) ?? null));
      if (moved.length) {
        const byEvent = new Map(hit.bonus);
        for (const code of moved) byEvent.set(code, { rev: revs.get(code) ?? null, rows: [] });
        for (let i = 0; i < moved.length; i += 200) {
          const part = moved.slice(i, i + 200);
          for (const r of await bonusRows(CALL_CHUNK, `p.kind = 'backtest' AND p.season = ? AND p.code IN (${part.map(() => "?").join(", ")})`, [season, ...part])) byEvent.get(r.code)!.rows.push(r);
        }
        hit = { ...hit, bonus: byEvent };
        fresh.set(season, hit);
      }
    }
    for (const r of hit.rows) rows.push(r);
    // In id order, as one read of the season gives them.
    groupBonus([...hit.bonus.values()].flatMap((e) => e.rows).sort((x, y) => x.pid - y.pid), bonus);
    prints.set(season, JSON.stringify([print, [...hit.bonus].map(([code, e]) => [code, e.rev])]));
  }
  return {
    rows, bonus, prints,
    keep: () => {
      for (const s of [...replayed.keys()]) if (!prints.has(s)) replayed.delete(s);
      for (const [s, v] of fresh) replayed.set(s, v);
    },
  };
}

/** Each season's block of the track record as last built, by everything it's made of: a past season's (a third of a
 *  second of work over its 50,000 replayed calls, the event loop held throughout) is the same build after build until
 *  its replay or its live calls move. */
const seasonBlocks = new Map<number, { key: string; value: TrackRecord["seasons"][number] }>();

async function computeTrackRecord(): Promise<TrackRecord> {
  const { rows, bonus, prints } = await scoredCalls();
  // Grouped once by kind and season: each season's blocks read their own calls, not all of them again.
  const byKindSeason = new Map<string, any[]>();
  for (const r of rows) {
    const k = `${r.kind}|${Number(r.season)}`;
    let xs = byKindSeason.get(k);
    if (!xs) { xs = []; byKindSeason.set(k, xs); }
    xs.push(r);
  }
  const calls = (kind: string, season: number) => byKindSeason.get(`${kind}|${season}`) ?? [];
  const coverage = await seasonCoverage();
  // A season at a time, the event loop let go between (half a second of work over every season's calls).
  const seasons: TrackRecord["seasons"] = [];
  for (const s of SEASONS.filter((x) => PREDICT_SEASONS.includes(x.season))) {
    await yieldLoop();
    // Everything the season's block reads: its replay and its events' revs (by its print, which its replayed bonus
    // calls go with), its live calls and live bonus calls, and its replay coverage. Nothing kept when the calls were
    // read in one statement.
    const key = prints && JSON.stringify([prints.get(s.season) ?? null, calls("live", s.season), bonus.get(`live|${s.season}`) ?? null, coverage.get(s.season) ?? null]);
    const memo = seasonBlocks.get(s.season);
    if (key && memo?.key === key) { seasons.push(memo.value); continue; }
    // Its parts with the event loop let go between: the current season's block, built whole, held it 200-269 ms on a
    // copy of the VM's data (2026-11-22), its 50,000-odd replayed calls scored twice over.
    seasons.push(await (async () => {
    const of = (kind: string, engine?: string) => calls(kind, s.season).filter((r) => engine == null || r.engine === engine)
      .map((r) => ({ p: Number(r.p), y: Number(r.y), tier: r.tier, level: r.level, time: r.time, ranges: statedRanges(r), margin: callMargin(r) }));
    // Prospective evidence per engine version: each version's own calls only.
    const engines = [...new Set(calls("live", s.season).map((r) => String(r.engine)))].sort();
    const live = block(of("live"));
    await yieldLoop();
    const backtest = block(of("backtest"));
    await yieldLoop();
    const liveByEngine = engines.map((engine) => { const b = block(of("live", engine))!; return { engine, n: b.n, decided: b.decided, accuracy: b.accuracy, brier: b.brier, logLoss: b.logLoss }; });
    // Paired: the same live calls scored for the served and the shadow model.
    const paired = new Map<string, { y: number; p: number; ps: number }[]>();
    for (const r of calls("live", s.season)) {
      if (r.ps == null || !r.model || !r.sm) continue;
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
    await yieldLoop();
    const labels = bonusLabels(s.season);
    const bonusOf = (kind: string) => { const e = bonus.get(`${kind}|${s.season}`); return e && labels ? bonusBlock(e.calls, labels, e.matches) : null; };
    return {
      season: s.season, label: `${s.label} ${s.game}`, live, backtest, replay: coverage.get(s.season), liveByEngine, liveShadow,
      ...(labels ? { bonus: { live: bonusOf("live"), backtest: bonusOf("backtest") } } : {}),
    };
    })());
    if (key) seasonBlocks.set(s.season, { key, value: seasons[seasons.length - 1] });
    else seasonBlocks.delete(s.season);
  }
  seasons.reverse();
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
