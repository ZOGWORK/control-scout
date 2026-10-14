// sitemap.xml, built from the database (never a fixed list): the public
// pages, every team page and every event page, at their canonical apex URLs.
// Personal pages (noindex) and /api are left out. Past the sitemaps.org
// limits (50,000 URLs / 50 MB) it becomes an index of numbered chunks.
import type { Request, Response } from "express";
import { all } from "./db.js";
import { canonicalUrl } from "./seo.js";

const STATIC_PAGES = ["/", "/events", "/predict", "/compare", "/methodology", "/download"];
export const CHUNK = 45_000; // under the 50,000-URL limit, and far under 50 MB

interface Entry { loc: string; lastmod?: string }
const day = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined);
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Every URL for the sitemap, in a stable order. */
export async function sitemapEntries(): Promise<Entry[]> {
  const [teams, events] = await Promise.all([
    all<{ number: number; updated_at: string | null }>("SELECT number, updated_at FROM teams ORDER BY number"),
    all<{ season: number; code: string; start: string | null; end: string | null }>("SELECT season, code, start, end FROM events ORDER BY season DESC, code"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  // An event's page changes until it's over; after that, from its last day.
  const evDay = (e: { start: string | null; end: string | null }) => { const d = day(e.end) ?? day(e.start); return d && d < today ? d : undefined; };
  return [
    ...STATIC_PAGES.map((p) => ({ loc: canonicalUrl(p) })),
    ...events.map((e) => ({ loc: canonicalUrl(`/events/${e.season}/${encodeURIComponent(e.code)}`), lastmod: evDay(e) })),
    ...teams.map((t) => ({ loc: canonicalUrl(`/teams/${t.number}`), lastmod: day(t.updated_at) })),
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

// Built at most once an hour (about 30,000 rows; cheap, but no need per crawl).
let cache: { at: number; entries: Entry[] } | null = null;
async function entries(): Promise<Entry[]> {
  if (!cache || Date.now() - cache.at > 3600_000) cache = { at: Date.now(), entries: await sitemapEntries() };
  return cache.entries;
}
export const resetSitemapCache = () => { cache = null; };

/** The sitemap document(s): one urlset, or an index plus chunks when over `chunk` URLs. */
export function buildSitemap(e: Entry[], chunk = CHUNK): { main: string; chunks: string[] } {
  if (e.length <= chunk) return { main: urlset(e), chunks: [] };
  const chunks = Array.from({ length: Math.ceil(e.length / chunk) }, (_, i) => urlset(e.slice(i * chunk, (i + 1) * chunk)));
  return { main: index(chunks.length), chunks };
}

const sendXml = (res: Response, xml: string) => { res.type("application/xml").setHeader("Cache-Control", "public, max-age=3600"); res.send(xml); };

/** GET /sitemap.xml */
export async function sitemapRoute(_req: Request, res: Response) {
  sendXml(res, buildSitemap(await entries()).main);
}

/** GET /sitemap-<n>.xml: chunk n of a split sitemap (404 when there's no such chunk). */
export async function sitemapChunkRoute(req: Request, res: Response) {
  const { chunks } = buildSitemap(await entries());
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1 || n > chunks.length) { res.status(404).type("text/plain").send("Not found"); return; }
  sendXml(res, chunks[n - 1]);
}
