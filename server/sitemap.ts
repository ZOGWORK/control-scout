// sitemap.xml, built from the database (never a fixed list): the public
// pages, every team page and every event page, at their canonical apex URLs.
// Personal pages (noindex) and /api are left out. Past the sitemaps.org
// limits (50,000 URLs / 50 MB) it becomes an index of numbered chunks.
import type { Request, Response } from "express";
import { all } from "./db.js";
import { canonicalUrl } from "./seo.js";
import { publishedWeeks } from "./powerRankings/store.js";

const STATIC_PAGES = ["/", "/events", "/rankings", "/predict", "/compare", "/methodology", "/download", "/privacy", "/terms", "/contact", "/faq"];
export const CHUNK = 45_000; // under the 50,000-URL limit, and far under 50 MB

interface Entry { loc: string; lastmod?: string }
const day = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined);
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Every URL for the sitemap, in a stable order. */
export async function sitemapEntries(): Promise<Entry[]> {
  const today = new Date().toISOString().slice(0, 10);
  const [teams, events] = await Promise.all([
    // A team page changes when the team plays: its lastmod is the last day of its latest event that has started (today
    // while one is on), or a later change the source marked on one. Not teams.updated_at: every sync stamps that on
    // every team, so it said nothing about the page. Only events it took part in (a league roster lists teams that never
    // played): the rule of api/teams.ts ATTENDED (on the field in a played match of any level, or the event has no played
    // matches yet, as a remote one), read set-wise: the per-row EXISTS took seconds over every team, this about one.
    all<{ number: number; lastmod: string | null }>(
      `WITH took AS (
         SELECT x.season, x.code, x.team FROM matches m JOIN match_teams x
           ON x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number
           WHERE m.played = 1 AND x.on_field = 1
         UNION SELECT et.season, et.code, et.team FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
           WHERE e.start <= ? AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.season = et.season AND m.code = et.code AND m.played = 1))
       SELECT t.number, MAX(CASE WHEN e.start <= ? THEN MAX(MIN(COALESCE(e.end, e.start), ?), COALESCE(substr(e.upstream_updated, 1, 10), '')) END) lastmod
       FROM teams t LEFT JOIN took k ON k.team = t.number LEFT JOIN events e ON e.season = k.season AND e.code = k.code
       GROUP BY t.number ORDER BY t.number`, [today, today, today]),
    all<{ season: number; code: string; upstream_updated: string | null }>("SELECT season, code, upstream_updated FROM events ORDER BY season DESC, code"),
  ]);
  // Power rankings: the hub and every published week, newest first (none until the first is; never sample weeks).
  const weeks = (await publishedWeeks()).filter((w) => !w.sample).reverse();
  return [
    ...STATIC_PAGES.map((p) => ({ loc: canonicalUrl(p) })),
    ...(weeks.length ? [{ loc: canonicalUrl("/power-rankings"), lastmod: weeks[0].published }] : []),
    ...weeks.map((w) => ({ loc: canonicalUrl(`/power-rankings/${w.week}`), lastmod: w.published })),
    // lastmod: the source's own change marker (late results, awards and advancement move it); none when unknown.
    ...events.map((e) => ({ loc: canonicalUrl(`/events/${e.season}/${encodeURIComponent(e.code)}`), lastmod: day(e.upstream_updated) })),
    ...teams.map((t) => ({ loc: canonicalUrl(`/teams/${t.number}`), lastmod: day(t.lastmod) })),
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
