// Per-page head tags for the first HTML response: title, description,
// canonical, Open Graph and Twitter. Link-preview bots and most crawlers read
// only this HTML (they don't run the app), so team and event pages get their
// own values from the database here. The app's own document.title stays as
// the in-app fallback.
import { get } from "./db.js";
import { seasonInfo } from "./data/seasons.js";
import { eventTypeLabel } from "../src/shared/labels.js";
import { canonicalOrigin, canonicalUrl } from "./seo.js";

export const SITE = "FTC Control Scout";
const HOME_TITLE = "FTC Control Scout — free FTC scouting & predictions";
const HOME_DESC = "Search any FTC team, event or match. OPR breakdowns, event-by-event trends, match predictions with a public track record, advancement odds for any team at any event — free, no login.";
const TAIL = " Free FTC scouting and predictions, no login.";

export interface PageMeta {
  title: string;
  description: string;
  type: "website" | "profile";
  /** Personal pages (your own data, nothing to index). */
  noindex?: boolean;
}

/** The most detailed version that fits in 160 characters (then fitDescription). */
export function bestFit(candidates: string[]): string {
  return fitDescription(candidates.find((c) => c.replace(/\s+/g, " ").trim().length <= 160) ?? candidates[candidates.length - 1]);
}

/** 120–160 characters: pad a short one with the site line, cut a long one at a word. */
export function fitDescription(s: string): string {
  let d = s.replace(/\s+/g, " ").trim();
  if (d.length < 120) d = (d + TAIL).trim();
  if (d.length > 160) d = d.slice(0, 159).replace(/\s+\S*$/, "") + "…";
  return d;
}

const STATIC: Record<string, { title: string; description: string; noindex?: boolean }> = {
  "/events": { title: "FTC events", description: "Every FTC event this season and the last three: dates, venues, results, rankings, brackets and advancement odds for any team at any event." },
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
  const t = await get<{ name: string | null; city: string | null; state: string | null; country: string | null }>("SELECT name, city, state, country FROM teams WHERE number = ?", [n]);
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
  return { title, description: fitDescription(d), type: "profile" };
}

async function eventMeta(season: number, code: string): Promise<PageMeta | null> {
  const e = await get<{ name: string; type: string | null; venue: string | null; city: string | null; state: string | null; country: string | null; start: string | null; end: string | null }>(
    "SELECT name, type, venue, city, state, country, start, end FROM events WHERE season = ? AND code = ?", [season, code]);
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
  return { title: `${e.name} (${seasonInfo(season).label})`, description, type: "website" };
}

/** The head values for a page path (null: no page-specific values; the home ones are used). */
export async function pageMeta(path: string): Promise<PageMeta> {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  try {
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^\/teams\/(\d{1,6})$/))) return await teamMeta(Number(m[1]));
    if ((m = p.match(/^\/events\/(\d{4})\/([A-Za-z0-9_-]{1,40})$/))) {
      const e = await eventMeta(Number(m[1]), decodeURIComponent(m[2]));
      if (e) return e;
    }
  } catch { /* database not ready: fall through to the generic values */ }
  const s = STATIC[p];
  if (s) return { title: s.title, description: s.noindex ? s.description : fitDescription(s.description), type: "website", ...(s.noindex ? { noindex: true } : {}) };
  return { title: "", description: HOME_DESC, type: "website" };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The head tags for a page: <title>, description, robots, canonical, Open Graph, Twitter. */
export function headTags(path: string, m: PageMeta): string {
  const title = m.title ? `${m.title} · ${SITE}` : HOME_TITLE;
  const url = canonicalUrl(path);
  const image = `${canonicalOrigin()}/og-image.png`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    ...(m.noindex ? [`<meta name="robots" content="noindex" />`] : []),
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${m.type}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="FTC Control Scout" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ];
  return tags.join("\n    ");
}
