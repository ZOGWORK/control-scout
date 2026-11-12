// sitemap.xml, built from the database (never a fixed list): the content pages whose first HTML carries their
// content, and every team and event page with something on it (server/indexable.ts), at their canonical apex URLs.
// Each URL is checked against the record it names as it is built: one the page would answer 404 or noindex for
// is never listed. Personal pages (noindex) and /api are left out. Past the sitemaps.org
// limits (50,000 URLs / 50 MB) it becomes an index of numbered chunks.
import type { Request, Response } from "express";
import { all } from "./db.js";
import { canonicalUrl } from "./seo.js";
import { publishedWeeks } from "./powerRankings/store.js";
import { eventHasDataSql, isReachableEventCode, teamIndexableSql } from "./indexable.js";
import { eventPath } from "../src/shared/eventCode.js";
import { PRERENDERED_PAGES } from "../src/shared/prerendered.js";
import { isEnabled } from "./flags.js";
import { downloadsOffered } from "./packs/routes.js";
import { leagueHref } from "../src/shared/leagues.js";
import { SEASON_NUMBERS } from "./data/seasons.js";

// The pages whose first HTML is their content (server/seoMeta.ts bodyHtml): the home page, the event list, the world
// rankings, the record tables (their top rows), both How it works pages, the FAQ and the plain content pages
// prerendered at build (src/shared/prerendered.ts); Download (its season files) while it offers any; power rankings
// and league standings below. Never listed: /records and /support (redirects), /supporters and /search (noindex), any
// filter, sort or search variant (a ?query address), and two nav pages left out on their first HTML, read live
// 2026-11-11: /predict (an input form: its first HTML is the heading "Predict an FTC match" and one line, the teams
// are picked in the app) and /compare (a team picker: the heading "Compare FTC teams" and one line; a pair is a view of
// two team pages, and /compare?teams=… is a query address). Both stay crawlable and indexable from their links; list
// one only once its first HTML carries content of its own.
export const STATIC_PAGES = ["/", "/events", "/rankings", "/teams", "/matches", "/how-it-works/search", "/related-searches", "/methodology", "/faq", ...Object.keys(PRERENDERED_PAGES)];
export const CHUNK = 45_000; // under the 50,000-URL limit, and far under 50 MB

const LEAGUE_PART = /^[A-Za-z0-9]{1,16}$/;

interface Entry { loc: string; lastmod?: string }
const day = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined);
/** A power-rankings week's lastmod: its last daily refresh when it had one, else its publish date. */
const lastmodOf = (w: { published: string; generated?: { updated: string | null } }) => w.generated?.updated && w.generated.updated > w.published ? w.generated.updated : w.published;
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Every URL for the sitemap, in a stable order. */
export async function sitemapEntries(): Promise<Entry[]> {
  const today = new Date().toISOString().slice(0, 10);
  const [lastmods, teamRows, events, leagues] = await Promise.all([
    // A team page changes when the team plays: its lastmod is the last day of its latest event that has started (today
    // while one is on), or a later change the source marked on one. Not teams.updated_at: every sync stamps that on
    // every team, so it said nothing about the page. Only events it took part in (a league roster lists teams that never
    // played): the rule of api/teams.ts ATTENDED (on the field in a played match of any level, or the event has no played
    // matches yet, as a remote one), read set-wise: the per-row EXISTS took seconds over every team, this about one.
    // Only a team with a page worth indexing (server/indexable.ts: results, an award, or an event on its page). One
    // with none is only a name and a number (noindex), and joins the sitemap with its first data. No lastmod until it
    // has an event that has started.
    all<{ number: number; lastmod: string | null }>(
      `WITH took AS (
         SELECT x.season, x.code, x.team FROM matches m JOIN match_teams x
           ON x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number
           WHERE m.played = 1 AND x.on_field = 1
         UNION SELECT et.season, et.code, et.team FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
           WHERE e.start <= ? AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.season = et.season AND m.code = et.code AND m.played = 1))
       SELECT t.number, MAX(CASE WHEN e.start <= ? THEN MAX(MIN(COALESCE(e.end, e.start), ?), COALESCE(substr(e.upstream_updated, 1, 10), '')) END) lastmod
       FROM teams t JOIN took k ON k.team = t.number JOIN events e ON e.season = k.season AND e.code = k.code
       GROUP BY t.number`, [today, today, today]),
    // The rule on its own (inside the join above it ran once per event row: seconds, not a fraction of one).
    all<{ number: number }>(`SELECT t.number FROM teams t WHERE ${teamIndexableSql("t.number", "t.name")} ORDER BY t.number`),
    // Only an event with teams or a played match (server/indexable.ts); one with neither is noindex until it has.
    all<{ season: number; code: string; upstream_updated: string | null }>(`SELECT e.season, e.code, e.upstream_updated FROM events e WHERE ${eventHasDataSql("e")} ORDER BY e.season DESC, e.code`),
    // League standings pages (server/api/leagues.ts): a league with standings rows (FIRST's league rankings) that the
    // page can look up (a leagues row, or meets naming it: storedLeague), at the stored region and code. One with no
    // rows is the page's no-data case (noindex), left out like an empty team or event. lastmod: the day its standings
    // were last read from FIRST, when known.
    all<{ season: number; region: string; code: string; ranked_at: string | null }>(
      `SELECT r.season, r.region, r.league code, l.ranked_at FROM (SELECT DISTINCT season, region, league FROM league_rankings) r
       LEFT JOIN leagues l ON l.season = r.season AND l.region = r.region AND l.code = r.league
       WHERE r.season IN (${SEASON_NUMBERS.join(", ")})
         AND (l.code IS NOT NULL OR EXISTS (SELECT 1 FROM events e WHERE e.season = r.season AND e.region = r.region AND e.league = r.league))
       ORDER BY r.season DESC, r.region, r.league`),
  ]);
  const lastmod = new Map(lastmods.map((t) => [t.number, t.lastmod]));
  // Power rankings: the hub and every published week, newest first (none until the first is; never sample weeks).
  const weeks = (await publishedWeeks()).filter((w) => !w.sample).reverse();
  // The rules reference only while the owner has it on (flag rulesReference); off, its page is noindex.
  const rulesOn = await isEnabled("rulesReference").catch(() => false);
  // Download only while it lists season files (offline packs on and built); else it is a heading and a line.
  const downloads = await downloadsOffered().catch(() => false);
  return [
    ...STATIC_PAGES.filter((p) => p !== "/rules" || rulesOn).map((p) => ({ loc: canonicalUrl(p) })),
    ...(downloads ? [{ loc: canonicalUrl("/download") }] : []),
    ...(weeks.length ? [{ loc: canonicalUrl("/power-rankings"), lastmod: lastmodOf(weeks[0]) }] : []),
    ...weeks.map((w) => ({ loc: canonicalUrl(`/power-rankings/${w.week}`), lastmod: lastmodOf(w) })),
    // lastmod: the source's own change marker (late results, awards and advancement move it); none when unknown.
    // Only a code the page can look up, at its canonical address (upper case, encoded: src/shared/eventCode.ts).
    ...events.filter((e) => isReachableEventCode(e.code)).map((e) => ({ loc: canonicalUrl(eventPath(e.season, e.code)), lastmod: day(e.upstream_updated) })),
    ...teamRows.map((t) => ({ loc: canonicalUrl(`/teams/${t.number}`), lastmod: day(lastmod.get(t.number)) })),
    // Only a region and code the page's address can carry (server/seoMeta.ts: letters and digits, up to 16).
    ...leagues.filter((l) => LEAGUE_PART.test(l.region) && LEAGUE_PART.test(l.code)).map((l) => ({ loc: canonicalUrl(leagueHref(l.season, l.region, l.code)), lastmod: day(l.ranked_at) })),
  ];
}

const urlset = (entries: Entry[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries.map((e) => `  <url><loc>${xmlEsc(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`).join("\n") +
  `\n</urlset>\n`;

const index = (chunks: number) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  Array.from({ length: chunks }, (_, i) => `  <sitemap><loc>${xmlEsc(canonicalUrl(`/sitemap-${i + 1}.xml`))}</loc></sitemap>`).join("\n") +
  `\n</sitemapindex>\n`;

/** The sitemap document(s): one urlset, or an index plus chunks when over `chunk` URLs. */
export function buildSitemap(e: Entry[], chunk = CHUNK): { main: string; chunks: string[] } {
  if (e.length <= chunk) return { main: urlset(e), chunks: [] };
  const chunks = Array.from({ length: Math.ceil(e.length / chunk) }, (_, i) => urlset(e.slice(i * chunk, (i + 1) * chunk)));
  return { main: index(chunks.length), chunks };
}

// The finished XML, built at most once an hour (about 30,000 URLs): requests just send it.
let cache: { at: number; built: Promise<{ main: string; chunks: string[] }> } | null = null;
function built() {
  if (!cache || Date.now() - cache.at > 3600_000) {
    const at = Date.now();
    const p = sitemapEntries().then((e) => buildSitemap(e));
    p.catch(() => { if (cache?.at === at) cache = null; }); // a failed build isn't kept
    cache = { at, built: p };
  }
  return cache.built;
}
export const resetSitemapCache = () => { cache = null; };

const sendXml = (res: Response, xml: string) => { res.type("application/xml").setHeader("Cache-Control", "public, max-age=3600"); res.send(xml); };

/** GET /sitemap.xml */
export async function sitemapRoute(_req: Request, res: Response) {
  sendXml(res, (await built()).main);
}

/** GET /sitemap-<n>.xml: chunk n of a split sitemap (404 when there's no such chunk). */
export async function sitemapChunkRoute(req: Request, res: Response) {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) { res.status(404).type("text/plain").send("Not found"); return; }
  const { chunks } = await built();
  if (n > chunks.length) { res.status(404).type("text/plain").send("Not found"); return; }
  sendXml(res, chunks[n - 1]);
}
