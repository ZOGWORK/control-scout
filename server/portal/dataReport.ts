// The owner console's Data & sync and Packs & offline reports (/api/owner/data, /api/owner/packs).
//
// Read-only, both of them: every query here is a SELECT, and nothing on these screens rewrites match data.
// A data-quality flag is for triage; the fix for wrong FTC data is a re-sync (the confirm-gated data op),
// never an edit from the console. Each check is bounded: a count plus the first few rows.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { all, kvGet } from "../db.js";
import { CURRENT_SEASON, SEASONS } from "../data/seasons.js";
import { NO_MATCH_TYPES } from "../sync.js";
import { sitemapEntries } from "../sitemap.js";
import { isEnabled } from "../flags.js";
import { packsDir } from "../packs/routes.js";
import type { Manifest } from "../packs/build.js";
import { hasTeamPage } from "../../src/shared/teamPages.js";
import { pageModule } from "../../src/shared/routes.js";
import { DATA_FLAG_EXAMPLES, type DataFlag, type OwnerDataReport, type OwnerPacks, type PackFileRow, type SeasonSync } from "../../src/shared/ownerData.js";

const N = DATA_FLAG_EXAMPLES;
/** An event that ended this many days ago has had time for its results to post. */
const RESULTS_GRACE_DAYS = 2;
const daysAgo = (n: number, now = Date.now()) => new Date(now - n * 864e5).toISOString().slice(0, 10);
const num = (x: unknown) => Number(x ?? 0);

interface SyncLast { at: string; reports?: { season: number; listed: number; detailed: number; failed: { code: string; error: string }[]; fallback: number; teams: number; failedCount?: number }[] }
/** How many events a season's run failed: the full count (the saved list keeps 20), or the list's length in a report saved before the count was. */
const failedCount = (r: { failed: unknown[]; failedCount?: number }) => r.failedCount ?? r.failed.length;

async function seasonSync(last: SyncLast | null): Promise<SeasonSync[]> {
  const [rows, events, matches, teamsAt] = await Promise.all([
    all<{ season: number; frozen: number; last_sync: string | null; last_complete: string | null }>("SELECT season, frozen, last_sync, last_complete FROM seasons"),
    all<{ season: number; n: number; detailed: number; fallback: number }>(
      "SELECT season, COUNT(*) n, SUM(detail_synced_at IS NOT NULL) detailed, SUM(source = 'ftc-scout') fallback FROM events GROUP BY season"),
    all<{ season: number; n: number }>("SELECT season, COUNT(*) n FROM matches WHERE played = 1 GROUP BY season"),
    all<{ key: string; value: string }>("SELECT key, value FROM kv WHERE key LIKE 'sync:teams:%'"),
  ]);
  const by = <T extends { season: number }>(xs: T[]) => new Map(xs.map((x) => [Number(x.season), x]));
  const s = by(rows), e = by(events), m = by(matches);
  const t = new Map(teamsAt.map((r) => { let v: string | null = null; try { v = JSON.parse(r.value); } catch { /* not JSON */ } return [Number(r.key.split(":").pop()), v]; }));
  const reports = new Map((last?.reports ?? []).map((r) => [r.season, r]));
  return [...SEASONS].sort((a, b) => b.season - a.season).map((x): SeasonSync => {
    const row = s.get(x.season), ev = e.get(x.season), rep = reports.get(x.season);
    return {
      season: x.season, label: x.label, game: x.game, current: x.season === CURRENT_SEASON,
      frozen: row?.frozen === 1, lastSync: row?.last_sync ?? null, lastComplete: row?.last_complete ?? null,
      teamsAt: t.get(x.season) ?? null,
      events: num(ev?.n), eventsDetailed: num(ev?.detailed), fallbackEvents: num(ev?.fallback),
      matchesPlayed: num(m.get(x.season)?.n),
      lastRun: rep ? { listed: rep.listed, detailed: rep.detailed, failed: failedCount(rep), fallback: rep.fallback, teams: rep.teams } : null,
    };
  });
}

/** Runs one check; a check that throws is reported as such, and the others still run. */
async function check(id: DataFlag["id"], title: string, description: string, fn: () => Promise<Pick<DataFlag, "count" | "examples">>): Promise<DataFlag> {
  try { return { id, title, description, ...(await fn()), error: null }; }
  catch (e) { return { id, title, description, count: 0, examples: [], error: (e as Error)?.message?.slice(0, 200) ?? "failed" }; }
}

const eventHref = (season: number, code: string) => `/events/${season}/${encodeURIComponent(code)}`;

function syncFailures(last: SyncLast | null): Promise<DataFlag> {
  return check("sync-failures", "Events the last sync couldn't fetch",
    "The last sync run asked for these events and got an error from both sources. The next sync tries them again; a re-sync tries now.",
    async () => {
      const failed = (last?.reports ?? []).flatMap((r) => r.failed.map((f) => ({ season: r.season, ...f })));
      return {
        count: (last?.reports ?? []).reduce((n, r) => n + failedCount(r), 0),
        examples: failed.slice(0, N).map((f) => ({
          label: f.code === "*" ? `${f.season}: the whole season` : `${f.season} ${f.code}`,
          detail: f.error, href: f.code === "*" ? null : eventHref(f.season, f.code),
        })),
      };
    });
}

/** Events that ended (with time for results to post), of a kind that has matches, with no played match stored. */
export function endedNoMatches(now = Date.now()): Promise<DataFlag> {
  const types = [...NO_MATCH_TYPES];
  const where = `COALESCE(e.end, e.start) < ? AND (e.type IS NULL OR e.type NOT IN (${types.map(() => "?").join(", ")}))
    AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1)`;
  const args = [daysAgo(RESULTS_GRACE_DAYS, now), ...types];
  return check("ended-no-matches", "Ended events with no matches",
    `Events that finished over ${RESULTS_GRACE_DAYS} days ago, of a kind that plays matches, with no played match stored. Often a cancelled or remote event; a re-sync fetches any results that have since posted.`,
    async () => {
      const [n, rows] = await Promise.all([
        all<{ n: number }>(`SELECT COUNT(*) n FROM events e WHERE ${where}`, args),
        all<{ season: number; code: string; name: string; type: string | null; end: string | null; start: string | null; teams: number; detail: string | null }>(
          `SELECT e.season, e.code, e.name, e.type, e.end, e.start, e.detail_synced_at detail,
             (SELECT COUNT(*) FROM event_teams et WHERE et.season = e.season AND et.code = e.code) teams
           FROM events e WHERE ${where} ORDER BY COALESCE(e.end, e.start) DESC, e.code LIMIT ${N}`, args),
      ]);
      return {
        count: num(n[0]?.n),
        examples: rows.map((r) => ({
          label: `${r.season} ${r.code}: ${r.name}`,
          detail: [`ended ${r.end ?? r.start}`, r.type, r.teams ? `${r.teams} teams listed` : "no teams listed", r.detail ? null : "detail never fetched"].filter(Boolean).join(" · "),
          href: eventHref(r.season, r.code),
        })),
      };
    });
}

/** A team's season record whose wins, losses and ties don't add up to its match count (the headline on its page). */
export function recordMismatch(): Promise<DataFlag> {
  const where = "wins + losses + ties != matches";
  return check("record-mismatch", "Season records that don't add up",
    "Team season rows whose wins + losses + ties differ from their match count, so the record and the match total on the team page disagree. The next stats run rebuilds these rows from the matches.",
    async () => {
      const [n, rows] = await Promise.all([
        all<{ n: number }>(`SELECT COUNT(*) n FROM team_season_stats WHERE ${where}`),
        all<{ season: number; team: number; matches: number; wins: number; losses: number; ties: number }>(
          `SELECT season, team, matches, wins, losses, ties FROM team_season_stats WHERE ${where} ORDER BY season DESC, ABS(wins + losses + ties - matches) DESC, team LIMIT ${N}`),
      ]);
      return {
        count: num(n[0]?.n),
        examples: rows.map((r) => ({ label: `${r.season} team ${r.team}`, detail: `${r.wins}-${r.losses}-${r.ties} over ${r.matches} matches`, href: `/teams/${r.team}` })),
      };
    });
}

/** A team's season total smaller than the qualification matches its event rows count (the season counts those and playoffs). */
export function seasonBelowEvents(): Promise<DataFlag> {
  const body = `FROM (SELECT season, team, SUM(matches) m FROM team_event_stats GROUP BY season, team) x
    LEFT JOIN team_season_stats s ON s.season = x.season AND s.team = x.team
    WHERE x.m > COALESCE(s.matches, 0)`;
  return check("season-below-events", "Season totals below their events",
    "Teams whose season match count is smaller than the qualification matches on their event rows. A season total counts every one of those plus playoffs, so it can never be smaller; the team's headline numbers lag its events. The next stats run rebuilds both.",
    async () => {
      const [n, rows] = await Promise.all([
        all<{ n: number }>(`SELECT COUNT(*) n ${body}`),
        all<{ season: number; team: number; m: number; matches: number | null }>(
          `SELECT x.season, x.team, x.m, s.matches ${body} ORDER BY x.season DESC, x.m - COALESCE(s.matches, 0) DESC, x.team LIMIT ${N}`),
      ]);
      return {
        count: num(n[0]?.n),
        examples: rows.map((r) => ({
          label: `${r.season} team ${r.team}`,
          detail: r.matches == null ? `no season row; ${r.m} event matches` : `season ${r.matches} matches; events ${r.m}`,
          href: `/teams/${r.team}`,
        })),
      };
    });
}

/** Why a sitemap URL would get the not-found page, by the app's and the server's own route rules (null: it resolves). */
export function sitemapMiss(loc: string): string | null {
  let path: string;
  try { path = new URL(loc).pathname; } catch { return "not a URL"; }
  const p = path.split("/").map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).join("/");
  if (pageModule(p) === "NotFound") return "no page at this path";
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/teams\/([^/]+)$/))) return /^\d+$/.test(m[1]) && hasTeamPage(Number(m[1])) ? null : "not a team number with a page";
  if ((m = p.match(/^\/events\/([^/]+)\/([^/]+)$/))) {
    if (!/^\d+$/.test(m[1]) || Number(m[1]) < 2000 || Number(m[1]) > 2100) return "season out of range";
    return /^[A-Za-z0-9_-]{1,40}$/.test(m[2]) ? null : "event code the event page can't read";
  }
  return null;
}

/** Sitemap URLs that would 404: the sitemap's own entries (server/sitemap.ts), each tested against the routes. */
export function sitemap404(entries?: () => Promise<{ loc: string }[]>): Promise<DataFlag> {
  return check("sitemap-404", "Sitemap URLs that would 404",
    "Addresses in sitemap.xml that the app would answer with its not-found page (a path no route serves, a team number that can't have a page, an event code the event page can't read). Search engines report these as errors.",
    async () => {
      const list = await (entries ?? sitemapEntries)();
      const bad = list.map((e) => ({ loc: e.loc, why: sitemapMiss(e.loc) })).filter((x) => x.why);
      return { count: bad.length, examples: bad.slice(0, N).map((x) => ({ label: x.loc, detail: x.why, href: null })) };
    });
}

/** When the published manifest was built: a build from the command line (npm run packs) doesn't stamp packs:last. */
function manifestBuiltAt(): string | null {
  try { return (JSON.parse(readFileSync(join(packsDir(), "latest.json"), "utf8")) as Manifest).builtAt ?? null; } catch { return null; }
}

/** The whole Data & sync report. */
export async function computeDataReport(now = Date.now()): Promise<OwnerDataReport> {
  const [last, stats, records, packsAt] = await Promise.all([
    kvGet<SyncLast>("sync:last"), kvGet<{ at: string }>("stats:last"), kvGet<{ at: string }>("records:last"), kvGet<string>("packs:last"),
  ]);
  const seasons = await seasonSync(last);
  const flags = await Promise.all([syncFailures(last), endedNoMatches(now), recordMismatch(), seasonBelowEvents(), sitemap404()]);
  return {
    computedAt: new Date(now).toISOString(), currentSeason: CURRENT_SEASON,
    timestamps: { syncAt: last?.at ?? null, statsAt: stats?.at ?? null, recordsAt: records?.at ?? null, packsAt: packsAt ?? manifestBuiltAt() },
    seasons, flags,
  };
}

// The report reads the sitemap's whole URL list (about a second), so it's kept for a few minutes.
const REPORT_TTL_MS = 5 * 60_000;
let cached: { at: number; p: Promise<OwnerDataReport> } | null = null;
export function dataReport(fresh = false): Promise<OwnerDataReport> {
  if (fresh || !cached || Date.now() - cached.at > REPORT_TTL_MS) {
    const at = Date.now();
    const p = computeDataReport(at);
    p.catch(() => { if (cached?.at === at) cached = null; });
    cached = { at, p };
  }
  return cached.p;
}
/** Tests: forget the kept report. */
export const resetDataReport = () => { cached = null; };

/** The offline packs as built on this server: the manifest, and each file it lists with its size and SHA-256. */
export async function packsReport(): Promise<OwnerPacks> {
  const dir = packsDir();
  let m: Manifest | null = null;
  try { m = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")) as Manifest; } catch { /* none built */ }
  const files: PackFileRow[] = m ? [m.lite, ...(m.full ?? [])].filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({
    name: f.name, url: f.url, kind: f.kind, season: f.kind === "full" ? f.seasons[0] ?? null : null, seasons: f.seasons,
    bytes: f.bytes, sha256: f.sha256, onDisk: existsSync(join(dir, f.name)),
  })) : [];
  let versions: string[] = [];
  try {
    versions = [...new Set(readdirSync(dir).map((f) => /^scout-pack-(\d{4}-\d{2}-\d{2})-(\d+)-/.exec(f)).filter((x): x is RegExpExecArray => !!x).map((x) => `${x[1]}.${x[2]}`))]
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch { /* no folder yet */ }
  return {
    unavailable: process.env.CS_PACKS === "off" ? "Offline packs are turned off on this host (CS_PACKS=off)." : null,
    serving: await isEnabled("offlinePacks"),
    manifest: m ? { format: m.format, version: m.version, builtAt: m.builtAt, engineVersion: m.engineVersion, dataAsOf: m.dataAsOf ?? null } : null,
    files, totalBytes: files.reduce((s, f) => s + f.bytes, 0), versionsOnDisk: versions,
    lastBuildAt: (await kvGet<string>("packs:last")) ?? null,
  };
}
