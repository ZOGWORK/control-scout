// Sync: FIRST Events API first, FTC Scout as per-event fallback.
//
// Idempotent and resumable: every event is written as one atomic bundle, and
// the plan is recomputed from the database each run, so an interrupted sync
// just continues. Finished seasons are frozen once fully fetched; the
// current season re-checks events around their dates (daily normally,
// often on event days — the scheduler in server/index.ts decides cadence).
import { all, get, kvGet, kvSet, run, writeBatch } from "./db.js";
import { bundleStatements, teamStatements, type EventBundle, type EventRow } from "./data/bundle.js";
import { writeEventBundle } from "./data/resultChanges.js";
import { CURRENT_SEASON, SEASON_NUMBERS, isLegacy, seasonInfo } from "./data/seasons.js";
import { FirstError, firstEventBundle, firstEvents, firstTeams } from "./sources/first.js";
import { bundleFromScout, fetchScoutEvent } from "./sources/ftcScout.js";
import { hasFirst } from "./env.js";
import { syncFtcNj } from "./data/provisional.js";
import { syncRegistrations } from "./data/registrations.js";

/** Event types that never have matches (skip detail fetches). */
export const NO_MATCH_TYPES = new Set(["Kickoff", "Workshop", "DemoExhibition", "VolunteerSignup", "PracticeDay", "InnovationChallenge"]);

export interface SyncLog { (msg: string): void }
export interface SyncReport { season: number; listed: number; detailed: number; failed: { code: string; error: string }[]; fallback: number; teams: number }

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export async function ensureSeasons(): Promise<void> {
  for (const s of SEASON_NUMBERS) {
    await run("INSERT INTO seasons (season, name) VALUES (?, ?) ON CONFLICT(season) DO UPDATE SET name = excluded.name", [s, seasonInfo(s).game]);
  }
}

/** Upsert the season's event list (no detail). */
export async function syncEventList(season: number): Promise<number> {
  const events = await firstEvents(season);
  await writeBatch(events.flatMap((e) => bundleStatements({ event: e, teams: [], detail: null })));
  return events.length;
}

/** Upsert every registered team of the season (refreshed at most weekly). */
export async function syncTeams(season: number, force = false, log: SyncLog = () => {}): Promise<number> {
  const key = `sync:teams:${season}`;
  const last = await kvGet<string>(key);
  if (!force && last && Date.now() - Date.parse(last) < 7 * 864e5) return 0;
  const teams = await firstTeams(season, (p, of) => { if (p % 25 === 0) log(`  teams ${season}: page ${p}/${of}`); });
  await writeBatch([
    ...teamStatements(teams, isLegacy(season)), // old seasons never overwrite today's names
    ...teams.map((t) => ({ sql: "INSERT OR IGNORE INTO team_seasons (season, team) VALUES (?, ?)", args: [season, t.number] })),
  ]);
  await kvSet(key, new Date().toISOString());
  return teams.length;
}

/** Events whose detail (matches, rankings, awards…) should be fetched now. */
export async function planDetail(season: number, opts: { force?: boolean; upgradeScout?: boolean } = {}): Promise<EventRow[]> {
  const rows = await all<any>("SELECT * FROM events WHERE season = ? ORDER BY start, code", [season]);
  const t = today();
  const out: EventRow[] = [];
  for (const r of rows) {
    if (NO_MATCH_TYPES.has(r.type)) continue;
    if (!r.start || r.start > addDays(t, 1)) continue; // not started (allow schedules a day ahead)
    const synced = r.detail_synced_at as string | null;
    const end = (r.end ?? r.start) as string;
    let want = opts.force || !synced;
    // Recently imported from FTC Scout only: upgrade to FIRST (primary).
    if (!want && opts.upgradeScout && r.source === "ftc-scout") want = true;
    // Ongoing or just finished: refresh (results, awards and advancement land late).
    if (!want && end >= addDays(t, -3)) want = true;
    // Finished, but last fetched before its results could be final.
    if (!want && synced && synced.slice(0, 10) <= addDays(end, 2)) want = true;
    if (want) out.push(rowToEvent(r));
  }
  return out;
}

function rowToEvent(r: any): EventRow {
  return {
    season: r.season, code: r.code, name: r.name, type: r.type, divisionCode: r.division_code, region: r.region, league: r.league, venue: r.venue, address: r.address ?? null,
    city: r.city, state: r.state, country: r.country, start: r.start, end: r.end, timezone: r.timezone, remote: !!r.remote, hybrid: !!r.hybrid,
    website: r.website, livestream: r.livestream, source: r.source, upstreamUpdated: r.upstream_updated,
  };
}

/** Fetch + write one event: FIRST, else FTC Scout. */
export async function syncEvent(meta: EventRow, log: SyncLog = () => {}): Promise<"first" | "ftc-scout"> {
  let bundle: EventBundle | null = null;
  let firstError: unknown = null;
  if (hasFirst()) {
    try {
      bundle = await firstEventBundle({ ...meta, source: "first" });
    } catch (e) { firstError = e; }
  }
  if (!bundle) {
    const resp = await fetchScoutEvent(meta.season, meta.code);
    const sb = bundleFromScout(resp, meta.season);
    if (!sb) throw firstError ?? new Error("no data from FIRST or FTC Scout");
    // Keep FIRST's event metadata (names, venue) when we have it.
    bundle = { ...sb, event: { ...sb.event, ...pickDefined(meta), source: "ftc-scout" } };
    if (firstError) log(`  ${meta.season} ${meta.code}: FIRST failed (${(firstError as Error).message.slice(0, 80)}), used FTC Scout`);
  }
  // Records first postings, score revisions and schedule moves in the same transaction (data/resultChanges.ts).
  await writeEventBundle(bundle);
  return bundle.event.source;
}

function pickDefined(e: EventRow): Partial<EventRow> {
  const o: any = {};
  for (const [k, v] of Object.entries(e)) if (v != null && k !== "source" && k !== "upstreamUpdated") o[k] = v;
  return o;
}

/** Run tasks with a fixed number in flight. */
export async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

export interface SyncOptions {
  seasons?: number[];
  force?: boolean;
  /** Re-fetch events that were seeded from FTC Scout so FIRST becomes their source. */
  upgradeScout?: boolean;
  /** Skip the season team list. */
  skipTeams?: boolean;
  concurrency?: number;
  log?: SyncLog;
  /** Stop after this many event fetches (for bounded runs). */
  limit?: number;
}

export async function syncSeason(season: number, o: SyncOptions = {}): Promise<SyncReport> {
  const log = o.log ?? (() => {});
  const report: SyncReport = { season, listed: 0, detailed: 0, failed: [], fallback: 0, teams: 0 };
  const frozen = (await get<{ frozen: number }>("SELECT frozen FROM seasons WHERE season = ?", [season]))?.frozen === 1;
  if (frozen && !o.force && !o.upgradeScout) { log(`${season}: frozen, skipped`); return report; }
  if (hasFirst()) {
    report.listed = await syncEventList(season);
    log(`${season}: ${report.listed} events listed`);
    if (!o.skipTeams) { report.teams = await syncTeams(season, false, log); if (report.teams) log(`${season}: ${report.teams} teams`); }
    // FTC New Jersey's registered teams and event details, shown until FIRST publishes its own (data/provisional.ts).
    // Its own failure never fails the sync.
    if (season === CURRENT_SEASON) {
      try {
        const nj = await syncFtcNj(season, { force: o.force });
        if (nj.skipped) { if (nj.skipped !== "read recently") log(`${season}: FTC NJ skipped (${nj.skipped})`); }
        else log(`${season}: FTC NJ ${nj.matched} events from ${nj.events} listed${nj.unmatched.length ? `, unmatched: ${nj.unmatched.join("; ")}` : ""}`);
      } catch (e) { log(`${season}: FTC NJ failed: ${(e as Error).message.slice(0, 120)}`); }
      // FIRST's registered teams for upcoming events with no team list yet (data/registrations.ts). Never fails the sync.
      try {
        const r = await syncRegistrations(season, { force: o.force, skipTypes: NO_MATCH_TYPES });
        if (!r.skipped) log(`${season}: registrations for ${r.withTeams} of ${r.events} upcoming events (${r.teams} teams)${r.failed.length ? `, ${r.failed.length} failed: ${r.failed.slice(0, 3).join("; ")}` : ""}`);
      } catch (e) { log(`${season}: registrations failed: ${(e as Error).message.slice(0, 120)}`); }
    }
  }
  let plan = await planDetail(season, { force: o.force, upgradeScout: o.upgradeScout });
  if (o.limit != null) plan = plan.slice(0, o.limit);
  log(`${season}: ${plan.length} events to fetch`);
  await pool(plan, o.concurrency ?? 3, async (ev, i) => {
    try {
      const src = await syncEvent(ev, log);
      report.detailed++;
      if (src === "ftc-scout") report.fallback++;
    } catch (e) {
      report.failed.push({ code: ev.code, error: (e as Error).message.slice(0, 200) });
    }
    if ((i + 1) % 50 === 0) log(`${season}: ${i + 1}/${plan.length} fetched (${report.failed.length} failed)`);
  });
  const now = new Date().toISOString();
  await run("UPDATE seasons SET last_sync = ? WHERE season = ?", [now, season]);
  if (!report.failed.length) {
    await run("UPDATE seasons SET last_complete = ? WHERE season = ?", [now, season]);
    // A past season with every event fetched never changes again.
    const lastEnd = (await get<{ e: string | null }>("SELECT MAX(end) e FROM events WHERE season = ?", [season]))?.e;
    if (season < CURRENT_SEASON && lastEnd && lastEnd < addDays(today(), -14) && !(await planDetail(season)).length) {
      await run("UPDATE seasons SET frozen = 1 WHERE season = ?", [season]);
      log(`${season}: complete — frozen`);
    }
  }
  return report;
}

export async function syncAll(o: SyncOptions = {}): Promise<SyncReport[]> {
  await ensureSeasons();
  const seasons = (o.seasons ?? SEASON_NUMBERS).slice().sort((a, b) => b - a); // current season first
  const out: SyncReport[] = [];
  for (const s of seasons) {
    try { out.push(await syncSeason(s, o)); }
    catch (e) {
      const msg = e instanceof FirstError ? e.message : (e as Error).message;
      o.log?.(`${s}: sync failed: ${msg}`);
      out.push({ season: s, listed: 0, detailed: 0, failed: [{ code: "*", error: msg }], fallback: 0, teams: 0 });
    }
  }
  await kvSet("sync:last", { at: new Date().toISOString(), reports: out.map((r) => ({ ...r, failed: r.failed.slice(0, 20), failedCount: r.failed.length })) });
  return out;
}
