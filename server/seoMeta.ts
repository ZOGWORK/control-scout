// Per-page head tags for the first HTML response: title, description,
// canonical, Open Graph and Twitter. Link-preview bots and most crawlers read
// only this HTML (they don't run the app), so team and event pages get their
// own values from the database here. The app's own document.title stays as
// the in-app fallback.
import { get } from "./db.js";
import { seasonInfo } from "./data/seasons.js";
import { eventTypeLabel } from "../src/shared/labels.js";
import { canonicalOrigin, canonicalUrl } from "./seo.js";
import { teamKnown } from "./api/teams.js";

export const SITE = "FTC Control Scout";
const HOME_TITLE = "FTC Control Scout — free FTC scouting & predictions";
const HOME_DESC = "Search any FTC team, event or match. OPR breakdowns, event-by-event trends, match predictions with a public track record, advancement odds for any team at any event — free, no login.";
// Added in turn to a short description until it reaches 120 characters.
const TAILS = [" Free FTC scouting and predictions, no login.", " OPR breakdowns, match predictions and advancement odds for every FTC team and event."];

export interface PageMeta {
  title: string;
  description: string;
  type: "website" | "profile";
  /** The page's canonical path when it differs from the requested one (e.g. an event code's case). */
  path?: string;
  /** Personal pages (your own data, nothing to index). */
  noindex?: boolean;
  /** schema.org structured data (JSON-LD), in the first HTML with the rest of the head. */
  jsonLd?: Record<string, unknown>[];
  /** No such page (an unknown route, team or event): served with HTTP 404, noindex, no canonical. */
  notFound?: boolean;
}

/**
 * The web app's routes (src/main.tsx), lowercase (React Router matches paths regardless of case).
 * The team and event routes (/teams/:number, /events/:season/:code) are checked against the database.
 */
const APP_ROUTES = new Set([
  "/", "/teams", "/matches", "/events", "/predict", "/predict/accuracy", "/compare", "/my-team", "/shortlist",
  "/scout", "/download", "/settings", "/methodology", "/predict/how-it-works",
]);

const NOT_FOUND: PageMeta = {
  title: "Page not found", description: "This page doesn't exist on FTC Control Scout. Search for any FTC team, event or match instead.",
  type: "website", noindex: true, notFound: true,
};

const FTC = { "@type": "SportsOrganization", name: "FIRST Tech Challenge", url: "https://www.firstinspires.org/robotics/ftc" };
const address = (city?: string | null, state?: string | null, country?: string | null) => {
  const a: Record<string, string> = { "@type": "PostalAddress" };
  if (city) a.addressLocality = city;
  if (state) a.addressRegion = state;
  if (country) a.addressCountry = country;
  return Object.keys(a).length > 1 ? a : null;
};

/** Home page: the site and who runs it. */
function homeJsonLd(): Record<string, unknown>[] {
  const o = canonicalOrigin();
  const org = { "@type": "Organization", "@id": `${o}/#organization`, name: SITE, url: `${o}/`, logo: `${o}/logo-512.png` };
  return [
    { "@context": "https://schema.org", ...org },
    { "@context": "https://schema.org", "@type": "WebSite", "@id": `${o}/#website`, name: SITE, url: `${o}/`, description: HOME_DESC, publisher: { "@id": `${o}/#organization` }, inLanguage: "en" },
  ];
}

/** The most detailed version that fits in 160 characters (then fitDescription). */
export function bestFit(candidates: string[]): string {
  return fitDescription(candidates.find((c) => c.replace(/\s+/g, " ").trim().length <= 160) ?? candidates[candidates.length - 1]);
}

/** 120–160 characters: pad a short one with the site line, cut a long one at a word. */
export function fitDescription(s: string): string {
  let d = s.replace(/\s+/g, " ").trim();
  for (const t of TAILS) if (d.length < 120) d = (d + t).trim();
  if (d.length > 160) d = d.slice(0, 159).replace(/\s+\S*$/, "") + "…";
  return d;
}

const STATIC: Record<string, { title: string; description: string; noindex?: boolean }> = {
  "/events": { title: "FTC events", description: "Every FTC event since 2019–20: dates, venues, results, rankings, brackets, and advancement odds from 2023–24 on, for any team at any event." },
  "/teams": { title: "FTC team stats and records", description: "Every FTC team's season and event numbers: OPR by phase, averages, highs, penalties and predicted win chances. Filter by any stat, sort, compare and export." },
  "/matches": { title: "FTC match records", description: "Every played FTC match of the season: alliance scores by phase, winning margins and high scores. Filter by any score, sort any column and export to CSV." },
  "/predict": { title: "Predict an FTC match", description: "Pick any four FTC teams and get win odds, a predicted score and the three biggest reasons why, from the same engine that powers every Control Scout prediction." },
  "/compare": { title: "Compare FTC teams", description: "Put FTC teams side by side: OPR by game phase, prediction ratings, records and event-by-event trends for up to four teams at once." },
  "/methodology": { title: "How Control Scout predictions work", description: "How Control Scout computes OPR (exactly like FTC Scout), rates robots and predicts matches, with a public record of how often the predictions come true." },
  "/predict/how-it-works": { title: "How Control Scout predictions work", description: "How Control Scout computes OPR (exactly like FTC Scout), rates robots and predicts matches, with a public record of how often the predictions come true." },
  "/download": { title: "Download FTC data", description: "Download full FTC seasons as SQLite files: every event, team, match, score breakdown, ranking and award. Offline predictions are saved automatically." },
  "/my-team": { title: "My team", description: "Your team's dashboard on Control Scout.", noindex: true },
  "/shortlist": { title: "Shortlist", description: "Your shortlisted FTC teams on Control Scout.", noindex: true },
  "/scout": { title: "Scout", description: "Your scouting notes on Control Scout.", noindex: true },
  "/settings": { title: "Settings", description: "Control Scout settings.", noindex: true },
};

const fmt1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const place = (...parts: (string | null | undefined)[]) => parts.filter((x) => x && String(x).trim()).join(", ");
const dateLong = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

async function teamMeta(n: number): Promise<PageMeta> {
  if (n < 1) return NOT_FOUND;
  const t = await get<{ name: string | null; city: string | null; state: string | null; country: string | null }>("SELECT name, city, state, country FROM teams WHERE number = ?", [n]);
  // The team API's test (teamProfile): a team we've never seen is a 404 there and here.
  if (!t && !(await teamKnown(n))) return NOT_FOUND;
  const s = await get<{ season: number; opr_np: number | null; rank_np: number | null; ranked_teams: number | null; wins: number; losses: number; ties: number }>(
    "SELECT season, opr_np, rank_np, ranked_teams, wins, losses, ties FROM team_season_stats WHERE team = ? AND matches > 0 ORDER BY season DESC LIMIT 1", [n]);
  const name = t?.name?.trim();
  const title = name ? `Team ${n} — ${name}` : `Team ${n}`;
  const where = place(t?.city, t?.state, t?.country === "USA" ? null : t?.country);
  let d = `FTC team ${n}${name ? ` ${name}` : ""}${where ? ` from ${where}` : ""}.`;
  if (s?.opr_np != null) {
    const top = s.rank_np && s.ranked_teams ? ` (#${s.rank_np.toLocaleString("en-US")} of ${s.ranked_teams.toLocaleString("en-US")})` : "";
    d += ` ${seasonInfo(s.season).label} OPR ${fmt1(s.opr_np)}${top}, record ${s.wins}-${s.losses}-${s.ties}.`;
  }
  d += " Event results, match history and win predictions.";
  const team: Record<string, unknown> = {
    "@context": "https://schema.org", "@type": "SportsTeam", name: name ?? `FTC Team ${n}`, alternateName: `FTC Team ${n}`,
    url: canonicalUrl(`/teams/${n}`), sport: "Robotics (FIRST Tech Challenge)", memberOf: FTC,
  };
  const addr = address(t?.city, t?.state, t?.country);
  if (addr) team.location = { "@type": "Place", address: addr };
  // One URL for the page (/teams/004215 → /teams/4215 everywhere); structured data only for a team we know.
  return { title, description: fitDescription(d), type: "profile", path: `/teams/${n}`, ...(t ? { jsonLd: [team] } : {}) };
}

async function eventMeta(season: number, code: string): Promise<PageMeta | null> {
  const e = await get<{ name: string; type: string | null; venue: string | null; city: string | null; state: string | null; country: string | null; start: string | null; end: string | null; remote: number; hybrid: number }>(
    "SELECT name, type, venue, city, state, country, start, end, remote, hybrid FROM events WHERE season = ? AND code = ?", [season, code]);
  if (!e) return null;
  const teams = (await get<{ n: number }>("SELECT COUNT(*) AS n FROM event_teams WHERE season = ? AND code = ?", [season, code]))?.n ?? 0;
  const when = dateLong(e.start) + (e.end && e.end !== e.start ? `–${dateLong(e.end)}` : "");
  const kind = eventTypeLabel(e.type).toLowerCase();
  const tail = `${teams ? ` ${teams} teams:` : ""} rankings, match results, OPR and advancement odds.`;
  const at = (where: string) => (where ? ` at ${where}` : "");
  // Most detail first; the venue name goes before anything gets cut.
  const description = bestFit([
    `${e.name}, an FTC ${kind}${when ? ` on ${when}` : ""}${at(place(e.venue, e.city, e.state))}.${tail}`,
    `${e.name}, an FTC ${kind}${when ? ` on ${when}` : ""}${place(e.city, e.state) ? ` in ${place(e.city, e.state)}` : ""}.${tail}`,
    `${e.name}, FTC ${kind}${when ? `, ${when}` : ""}.${tail}`,
  ]);
  const ev: Record<string, unknown> = {
    "@context": "https://schema.org", "@type": "SportsEvent", name: e.name, url: canonicalUrl(`/events/${season}/${code}`),
    sport: "Robotics (FIRST Tech Challenge)", organizer: FTC, description,
    // Events have no photos of their own: the site's 1200×630 card (Google's optional Event "image").
    image: [`${canonicalOrigin()}/og-image.png`],
  };
  if (e.start) ev.startDate = e.start;
  if (e.end || e.start) ev.endDate = e.end ?? e.start;
  const addr = address(e.city, e.state, e.country);
  if (e.venue || addr) ev.location = { "@type": "Place", ...(e.venue ? { name: e.venue } : {}), ...(addr ? { address: addr } : {}) };
  ev.eventAttendanceMode = `https://schema.org/${e.remote ? "Online" : e.hybrid ? "Mixed" : "Offline"}EventAttendanceMode`;
  ev.eventStatus = "https://schema.org/EventScheduled";
  return { title: `${e.name} (${seasonInfo(season).label})`, description, type: "website", path: `/events/${season}/${code}`, jsonLd: [ev] };
}

/** The head values for a page path: the page's own, the home ones when it has none, or notFound for no such page. */
export async function pageMeta(path: string): Promise<PageMeta> {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  try {
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^\/teams\/(\d{1,6})$/i))) return await teamMeta(Number(m[1]));
    if ((m = p.match(/^\/events\/(\d{4})\/([A-Za-z0-9_-]{1,40})$/i))) {
      // Event codes are case-insensitive in the app (the API uppercases them): same here.
      return (await eventMeta(Number(m[1]), m[2].toUpperCase())) ?? NOT_FOUND;
    }
  } catch {
    // Database not ready: the generic values, never a 404 (the page may well exist).
    return { title: "", description: HOME_DESC, type: "website" };
  }
  // A team or event address that can't be one (/teams/abc, /teams/1234567, /events/2025/a%20b): the app says not found too.
  if (/^\/teams\/[^/]+$/i.test(p) || /^\/events\/[^/]+\/[^/]+$/i.test(p)) return NOT_FOUND;
  const s = STATIC[p];
  if (s) return { title: s.title, description: s.noindex ? s.description : fitDescription(s.description), type: "website", ...(s.noindex ? { noindex: true } : {}) };
  if (!APP_ROUTES.has(p.toLowerCase())) return NOT_FOUND;
  return { title: "", description: HOME_DESC, type: "website", ...(p === "/" ? { jsonLd: homeJsonLd() } : {}) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The head tags for a page: <title>, description, robots, canonical, Open Graph, Twitter. */
export function headTags(path: string, m: PageMeta): string {
  const title = m.title ? `${m.title} · ${SITE}` : HOME_TITLE;
  const url = canonicalUrl(m.path ?? path);
  const image = `${canonicalOrigin()}/og-image.png`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    ...(m.noindex ? [`<meta name="robots" content="noindex" />`] : []),
    // A 404 names no canonical URL (there's no page to point at).
    ...(m.notFound ? [] : [`<link rel="canonical" href="${esc(url)}" />`]),
    `<meta property="og:type" content="${m.type}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    ...(m.notFound ? [] : [`<meta property="og:url" content="${esc(url)}" />`]),
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="FTC Control Scout" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    // JSON-LD: "<" escaped so no value can close the script tag.
    ...(m.jsonLd ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`),
  ];
  return tags.join("\n    ");
}
