// Is the live prediction ledger working on this host? Read-only: prints the
// current season's live ledger (logged, scored, any call logged at or after
// its match's start — must be 0), the upcoming matches the next stats cycle
// would log, and scheduled matches whose start has passed but aren't played.
// Uses the database from server/env.ts (DATABASE_URL, else .data/scout.db);
// never writes, never migrates.
//
//   npm run live:check
//   npm run live:check -- --limit 30     (rows per list, default 15)
import { existsSync } from "node:fs";
import { env } from "../server/env.js";
import { all, db, get, isRemote } from "../server/db.js";
import { CURRENT_SEASON } from "../server/data/seasons.js";
import { localToUtcMs } from "../server/data/time.js";
import { LIVE_LEAD_MS, liveLoggable, unloggedLiveMatches } from "../server/stats/job.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
const limit = Math.max(1, Number(arg("limit") ?? 15) || 15);
const S = CURRENT_SEASON;

// Opening a missing file would create an empty database: refuse instead.
if (!isRemote(env.databaseUrl)) {
  const path = env.databaseUrl.replace(/^file:/, "");
  if (!existsSync(path)) { console.error(`No database at ${path} (set DATABASE_URL or run from the app directory).`); process.exit(1); }
}

const now = Date.now();
const iso = (ms: number | null) => (ms == null ? "?" : new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"));
const ago = (ms: number) => {
  const m = Math.round(Math.abs(now - ms) / 60_000);
  const s = m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  return ms >= now ? `in ${s}` : `${s} ago`;
};
const label = (r: { code: string; level: string; series: number; number: number }) =>
  `${r.code} ${r.level === "qual" ? "Q" : `P${r.series}-`}${r.number}`;

console.log(`Live prediction ledger, season ${S}  (now ${iso(now)})`);

// --- The ledger -------------------------------------------------------------
const rows = await all<any>(
  `SELECT p.kind, p.code, p.level, p.series, p.number, p.predicted_at, p.match_time, p.outcome, p.scored_at, e.timezone, m.time AS latest_time, m.played
   FROM predictions p
   LEFT JOIN events e ON e.season = p.season AND e.code = p.code
   LEFT JOIN matches m ON m.season = p.season AND m.code = p.code AND m.level = p.level AND m.series = p.series AND m.number = p.number
   WHERE p.season = ? AND p.kind IN ('live', 'late')`,
  [S],
);
const live = rows.filter((r) => r.kind === "live");
const late = rows.filter((r) => r.kind === "late");
const scored = live.filter((r) => r.outcome != null);
// The match start a call must beat: the scheduled time logged with it, and the
// match's current time (FIRST's actual start once played) — whichever is earlier.
const startOf = (r: any) => {
  const ts = [localToUtcMs(r.match_time, r.timezone), localToUtcMs(r.latest_time, r.timezone)].filter((x): x is number => x != null);
  return ts.length ? Math.min(...ts) : null;
};
const notBefore = live.filter((r) => { const s = startOf(r); return s == null || Date.parse(r.predicted_at) >= s; });
const awaiting = live.filter((r) => r.outcome == null && !r.played && (startOf(r) ?? Infinity) <= now);
const max = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
const lastLogged = max(live.map((r) => r.predicted_at)), lastScored = max(live.map((r) => r.scored_at));

console.log("\nLedger (kind = 'live')");
console.log(`  rows                         ${live.length}`);
console.log(`  scored (outcome attached)    ${scored.length}`);
console.log(`  unscored                     ${live.length - scored.length}${awaiting.length ? `  (${awaiting.length} past their start, waiting for results)` : ""}`);
console.log(`  predicted_at >= match start  ${notBefore.length}${notBefore.length ? "  <-- PROBLEM: must be 0" : "  (must be 0)"}`);
console.log(`  moved to 'late'              ${late.length}  (logged after the actual start; excluded from the record)`);
console.log(`  last logged                  ${lastLogged ? `${lastLogged}  (${ago(Date.parse(lastLogged))})` : "never"}`);
console.log(`  last scored                  ${lastScored ? `${lastScored}  (${ago(Date.parse(lastScored))})` : "never"}`);
for (const r of notBefore.slice(0, limit)) console.log(`    ! ${label(r)}  predicted ${r.predicted_at}  start ${iso(startOf(r))}`);

// --- Next cycle ---------------------------------------------------------------
const candidates = await unloggedLiveMatches(S);
const next = candidates.filter((c) => liveLoggable(c, now)).sort((a, b) => a.start! - b.start!);
console.log(`\nWould be logged on the next cycle: ${next.length}  (unplayed, full 2v2 lineup, start more than ${LIVE_LEAD_MS / 1000} s away, not yet logged)`);
for (const c of next.slice(0, limit)) console.log(`  ${label(c).padEnd(16)} ${iso(c.start)}  (${ago(c.start!)}, ${c.timezone})  ${c.red.join("+")} vs ${c.blue.join("+")}`);
if (next.length > limit) console.log(`  … ${next.length - limit} more`);

const future = candidates.filter((c) => c.start != null && c.start > now + LIVE_LEAD_MS && !liveLoggable(c, now));
const unknown = candidates.filter((c) => c.start == null);
if (future.length) console.log(`  not loggable despite a future start (lineup isn't 2v2, e.g. playoffs): ${future.length}`);
if (unknown.length) console.log(`  unplayed with no usable start time or event time zone: ${unknown.length}`);

// --- Stale --------------------------------------------------------------------
const unplayed = await all<any>(
  `SELECT m.code, m.level, m.series, m.number, m.time, e.timezone,
     EXISTS (SELECT 1 FROM predictions p WHERE p.kind = 'live' AND p.season = m.season AND p.code = m.code AND p.level = m.level AND p.series = m.series AND p.number = m.number) AS logged
   FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
   WHERE m.season = ? AND m.played = 0 AND m.time IS NOT NULL`,
  [S],
);
const stale = unplayed.map((m) => ({ ...m, start: localToUtcMs(m.time, m.timezone) }))
  .filter((m) => m.start != null && m.start <= now).sort((a, b) => b.start - a.start);
console.log(`\nStale: start passed, still unplayed: ${stale.length}${stale.length ? "  (results not synced yet, or the match never ran)" : ""}`);
for (const m of stale.slice(0, limit)) console.log(`  ${label(m).padEnd(16)} ${iso(m.start)}  (${ago(m.start)})${m.logged ? "  logged" : ""}`);
if (stale.length > limit) console.log(`  … ${stale.length - limit} more`);

const lastSync = await get<{ v: string }>("SELECT MAX(detail_synced_at) v FROM events WHERE season = ?", [S]);
const stats = await get<{ value: string }>("SELECT value FROM kv WHERE key = 'stats:last'");
console.log(`\nLast event sync ${lastSync?.v ?? "never"}; last stats run ${stats ? JSON.parse(stats.value).at : "never"}.`);
db().close();
