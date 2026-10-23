// Per-page head tags for the first HTML response: title, description,
// canonical, Open Graph and Twitter. Link-preview bots and most crawlers read
// only this HTML (they don't run the app), so team and event pages get their
// own values from the database here. The app's own document.title stays as
// the in-app fallback.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { get } from "./db.js";
import { CURRENT_SEASON, PREDICT_SEASONS, SEASON_NUMBERS, isLegacy, seasonInfo } from "./data/seasons.js";
import { defaultRankingsSeason, rankings, snapshotWeeks } from "./api/rankings.js";
import { isWeek, parsePlaces, placeKey } from "../src/shared/rankings.js";
import { regionLabel } from "../src/shared/regions.js";
import { eventTypeLabel } from "../src/shared/labels.js";
import { canonicalOrigin, canonicalUrl } from "./seo.js";
import { FAQ, faqJsonLd, faqText } from "../src/shared/faq.js";
import { teamKnown } from "./api/teams.js";
import { pageModule } from "../src/shared/routes.js";
import { normalMatchKey } from "../src/shared/matchReport.js";
import { allianceText, shareHeadline, shareImagePath, sharePagePath, tierWords, type ShareCardQuery } from "../src/shared/share.js";
import { latestRankings, rankingsWeek } from "./powerRankings/store.js";
import { staticRankingsHtml } from "./powerRankings/static.js";
import { isWeekId, weekLabel, type PowerRankingsResponse } from "../src/shared/powerRankings.js";

/** The site's name, the same everywhere a search engine reads one: every <title>, og:site_name, the
 *  WebSite and Organization data. "FTC Control Scout" is its alternate name (in the structured data). */
export const SITE = "Control Scout";
export const SITE_ALT = "FTC Control Scout";
const HOME_TITLE = "Control Scout — free FTC scouting & predictions";
const HOME_DESC = "Search any FTC team, event or match. OPR breakdowns, event-by-event trends, match predictions with a public track record, advancement odds for any team at any event — free, no login.";
// Added in turn to a short description until it reaches 120 characters.
const TAILS = [" Free FTC scouting and predictions, no login.", " OPR breakdowns, match predictions and advancement odds for every FTC team and event."];

export interface PageMeta {
  title: string;
  description: string;
  type: "website" | "profile" | "article";
  /** The page's canonical path when it differs from the requested one (e.g. an event code's case). */
  path?: string;
  /** Personal pages (your own data, nothing to index). */
  noindex?: boolean;
  /** schema.org structured data (JSON-LD), in the first HTML with the rest of the head. */
  jsonLd?: Record<string, unknown>[];
  /** No such page (an unknown route, team or event): served with HTTP 404, noindex, no canonical. */
  notFound?: boolean;
  /** A shared matchup: its card is the link preview image, and og:url is the matchup's own address. */
  share?: { query: ShareCardQuery; alt: string };
  /** The page's content as static, already-safe HTML for the first paint (server/bootShell.ts), for pages
   *  whose words are the point (power rankings): crawlers and previews read it without running the app. */
  bodyHtml?: string;
}


const NOT_FOUND: PageMeta = {
  title: "Page not found", description: "This page doesn't exist on Control Scout. Search for any FTC team, event or match instead.",
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

/** Control Point, the sister app that shares Control Scout's accounts and engine, and the GitHub home of both. */
export const SAME_AS = ["https://tryctrlpoint.org", "https://github.com/Control-Point-FTC"];

/** Home page: the site (its name, and a search engines can send a query to) and who runs it. */
function homeJsonLd(): Record<string, unknown>[] {
  const o = canonicalOrigin();
  const org = { "@type": "Organization", "@id": `${o}/#organization`, name: SITE, alternateName: SITE_ALT, url: `${o}/`, logo: `${o}/logo-512.png`, sameAs: SAME_AS };
  return [
    { "@context": "https://schema.org", ...org },
    {
      "@context": "https://schema.org", "@type": "WebSite", "@id": `${o}/#website`, name: SITE, alternateName: SITE_ALT, url: `${o}/`, description: HOME_DESC,
      publisher: { "@id": `${o}/#organization` }, inLanguage: "en",
      // The home page's search box opens with ?q= filled in (src/pages/Home.tsx).
      potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${o}/?q={search_term_string}` }, "query-input": "required name=search_term_string" },
    },
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
  "/methodology": { title: "How the predictions work", description: "How Control Scout computes OPR, rates robots and predicts matches, with a public record of how often the predictions come true." },
  "/predict/how-it-works": { title: "How the predictions work", description: "How Control Scout computes OPR, rates robots and predicts matches, with a public record of how often the predictions come true." },
  "/download": { title: "Download FTC data", description: "Download full FTC seasons as SQLite files: every event, team, match, score breakdown, ranking and award. Offline predictions are saved automatically." },
  "/privacy": { title: "Privacy policy", description: "How Control Scout handles your data: no account needed, only essential sign-in cookies, no ads or third-party trackers, anonymous stats only if you allow them." },
  "/terms": { title: "Terms of use", description: "The terms for using Control Scout: free, predictions are estimates, FTC data can be wrong, rate limits instead of scraping, and your scouting notes stay yours." },
  "/faq": { title: "FAQ: your questions answered", description: "Answers about Control Scout: where the FTC data comes from, how predictions and confidence work, scouting with your team, offline use at venues, accounts and privacy." },
  "/contact": { title: "Contact", description: "Contact the Control Scout team: report a bug, ask for a data correction, suggest a feature or ask a question about your data or the site." },
  "/my-team": { title: "My team", description: "Your team's dashboard on Control Scout.", noindex: true },
  "/my-teams": { title: "My teams", description: "The FTC teams you're on or manage, with their stats.", noindex: true },
  "/shortlist": { title: "Shortlist", description: "Your shortlisted FTC teams on Control Scout.", noindex: true },
  "/scout": { title: "Scout", description: "Your scouting notes on Control Scout.", noindex: true },
  "/settings": { title: "Settings", description: "Control Scout settings.", noindex: true },
};

const fmt1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const place = (...parts: (string | null | undefined)[]) => parts.filter((x) => x && String(x).trim()).join(", ");
const dateLong = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

async function teamMeta(n: number): Promise<PageMeta> {
  if (n < 1 || n > 999_999) return NOT_FOUND;
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
  if (season < 2000 || season > 2100) return null; // the API's own range (and never a huge number in a query)
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

const POWER_DESC = "The weekly top 25 FTC teams, each with a short written take and live rating, OPR and record.";

/** The top of a week's list, for a description: "#1 4215 Hypnotic Robotics, #2 …". */
const topLine = (r: PowerRankingsResponse, n: number) =>
  (r.week?.entries ?? []).slice(0, n).map((e) => `#${e.rank} ${e.team}${e.name ? ` ${e.name}` : ""}`).join(", ");

/** Structured data for a week: the article and its ranked list. */
function rankingsJsonLd(r: PowerRankingsResponse, path: string): Record<string, unknown>[] {
  const w = r.week!;
  const o = canonicalOrigin();
  const url = canonicalUrl(`/power-rankings/${w.week}`);
  const list = {
    "@context": "https://schema.org", "@type": "ItemList", name: w.title, url: canonicalUrl(path), numberOfItems: w.entries.length, itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: w.entries.map((e) => ({ "@type": "ListItem", position: e.rank, name: `${e.team}${e.name ? ` ${e.name}` : ""}`, url: canonicalUrl(`/teams/${e.team}`) })),
  };
  const article = {
    "@context": "https://schema.org", "@type": "Article", headline: w.title, description: w.introText.slice(0, 300), datePublished: w.published, dateModified: w.published,
    url, mainEntityOfPage: url, image: [`${o}/og-image.png`],
    author: { "@type": "Organization", name: SITE, url: `${o}/` }, publisher: { "@type": "Organization", name: SITE, logo: { "@type": "ImageObject", url: `${o}/logo-512.png` } },
  };
  return [article, list];
}

/** /power-rankings (the latest week and the archive) and /power-rankings/<week>: an unknown week is a 404. */
async function powerRankingsMeta(week: string | null): Promise<PageMeta> {
  if (week === null) {
    const r = await latestRankings();
    const bodyHtml = staticRankingsHtml(r);
    // Nothing published yet: a real page that says so (left out of the sitemap until there's something to read).
    // No noindex: the app keeps no per-page robots tag in step on navigation, so it would follow the visitor to
    // other pages; and this page is the one to index once the first week is out.
    if (!r.week) return { title: "FTC power rankings", description: fitDescription(POWER_DESC), type: "website", path: "/power-rankings", bodyHtml };
    const label = weekLabel(r.week.week);
    return {
      title: "FTC power rankings", type: "website", path: "/power-rankings", bodyHtml, jsonLd: rankingsJsonLd(r, "/power-rankings"),
      description: bestFit([`${POWER_DESC} ${label}: ${topLine(r, 3)}.`, `${POWER_DESC} ${label}: ${topLine(r, 1)}.`, POWER_DESC]),
    };
  }
  const id = week.toLowerCase();
  const r = isWeekId(id) ? await rankingsWeek(id) : null;
  if (!r?.week) return NOT_FOUND;
  const w = r.week;
  const path = `/power-rankings/${id}`;
  return {
    title: `${w.title} (${seasonInfo(w.season).label})`, type: "article", path, bodyHtml: staticRankingsHtml(r), jsonLd: rankingsJsonLd(r, path),
    description: bestFit([`${w.introText} ${topLine(r, 3)}.`, w.introText, `FTC power rankings, ${weekLabel(w.week)}: ${topLine(r, 3)}.`]),
  };
}

/**
 * A match's scouting report (/events/:season/:code/match/:key): titled for a shared link's preview. Not
 * indexed: one per match is thousands of near-identical pages; the event page is the one to find.
 */
async function matchReportMeta(season: number, code: string, key: string): Promise<PageMeta | null> {
  const k = key.match(/^(qual|playoff):(\d{1,3}):(\d{1,4})$/);
  if (!k || season < 2000 || season > 2100) return null;
  const r = await get<{ label: string; event: string }>(
    "SELECT m.label, e.name event FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.season = ? AND m.code = ? AND m.level = ? AND m.series = ? AND m.number = ?",
    [season, code, k[1], Number(k[2]), Number(k[3])]);
  if (!r) return null;
  return {
    title: `${r.label} at ${r.event}: know your match`,
    description: fitDescription(`${r.label} at ${r.event} (${seasonInfo(season).label}): the win prediction and every robot's OPR, rank, trend and flags.`),
    type: "website", path: `/events/${season}/${code}/match/${key}`, noindex: true,
  };
}

/** Two distinct team numbers per alliance from "a,b" (what the Predict Lab and a match lineup hold), else null. */
function pair(v: string | null): number[] | null {
  const t = (v ?? "").split(",");
  if (t.length !== 2 || !t.every((x) => /^\d{1,6}$/.test(x.trim()))) return null;
  const n = t.map((x) => Number(x.trim()));
  return n.every((x) => x >= 1) && n[0] !== n[1] ? n : null;
}


/** A matchup's words for its link preview: the card's headline, the predicted score and the confidence
 *  (and, for a backtest, that it was replayed afterward: never passed off as a call made before the match). */
function matchupDescription(q: { red: number[]; blue: number[]; pRed: number; pBlue?: number; played?: boolean; predicted: [number, number] | null; tier: string; final?: [number, number] | null; backtest?: boolean }): string {
  const fav = (q.pBlue ?? 1 - q.pRed) > q.pRed ? "blue" : "red";
  const order = (x: [number, number]) => (fav === "red" ? x : [x[1], x[0]]).map((n) => Math.round(n)).join("–");
  let d = `${shareHeadline(q)}.`;
  if (q.predicted) d += ` Predicted score ${order(q.predicted)}`;
  if (q.final) d += `${q.predicted ? ";" : ""} final ${order(q.final)}`;
  d += `${q.predicted || q.final ? ", " : " "}${tierWords(q.tier)}.`;
  if (q.backtest) d += " A backtest replay, not a live call.";
  return fitDescription(d);
}

/** /predict?mode=match&season=…&red=a,b&blue=c,d: the matchup's own title, words and card. */
async function matchupMeta(sp: URLSearchParams): Promise<PageMeta | null> {
  const mode = sp.get("mode");
  if (mode != null && mode !== "match") return null;
  if (sp.get("view") === "events") return null;
  const red = pair(sp.get("red")), blue = pair(sp.get("blue"));
  if (!red || !blue || red.some((t) => blue.includes(t))) return null;
  const raw = sp.get("season");
  const season = raw == null || raw === "" ? CURRENT_SEASON : /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  if (!SEASON_NUMBERS.includes(season) || isLegacy(season)) return null;
  const { liveForecaster } = await import("./predict/engine.js");
  const f = await liveForecaster(season);
  const x = f.explain(season, red, blue);
  if (!x) return null;
  const query: ShareCardQuery = { season, red, blue };
  const predicted: [number, number] | null = f.seasonEvents(season).length ? [x.predictedScoreA, x.predictedScoreB] : null;
  return {
    title: `${allianceText(red)} vs ${allianceText(blue)}: match prediction`,
    description: matchupDescription({ red, blue, pRed: x.winProbA, pBlue: x.winProbB, predicted, tier: x.confidence.tier }),
    type: "website", path: "/predict",
    share: { query, alt: `${shareHeadline({ red, blue, pRed: x.winProbA, pBlue: x.winProbB })} (${seasonInfo(season).label}, ${tierWords(x.confidence.tier)})` },
  };
}

/** /events/…?match=qual:1:12: the event's page, with that match's call as its title, words and card. */
async function eventMatchMeta(ev: PageMeta, season: number, code: string, key: string | null): Promise<PageMeta> {
  if (!key || !/^(qual|playoff):\d{1,4}:\d{1,4}$/.test(key) || isLegacy(season)) return ev;
  const { matchViews } = await import("./api/matches.js");
  const m = (await matchViews({ season, code }, { predictUnplayed: true })).find((x) => x.key === key);
  const p = m?.prediction;
  if (!m || !p) return ev;
  const red = m.red.teams.filter((t) => t.onField).map((t) => t.number), blue = m.blue.teams.filter((t) => t.onField).map((t) => t.number);
  const played = !!(m.played && m.red.score && m.blue.score);
  const name = ev.title.replace(/ \(\d{4}–\d{2}\)$/, "");
  const call = { red, blue, pRed: p.pRed, played };
  return {
    ...ev,
    title: `${m.label}: ${allianceText(red)} vs ${allianceText(blue)} · ${ev.title}`,
    description: matchupDescription({ ...call, predicted: p.noScoreBasis ? null : [p.redMean, p.blueMean], tier: p.tier, final: played ? [m.red.score!.total, m.blue.score!.total] : null, backtest: p.kind === "backtest" }),
    share: { query: { season, red, blue, event: code, match: key }, alt: `${shareHeadline(call)} (${m.label}, ${name}; ${tierWords(p.tier)}${p.kind === "backtest" ? ", a backtest replay" : ""})` },
  };
}

/** A query value as one string (a repeated parameter joined with commas, as the API reads it). */
const qstr = (v: unknown): string | null => (typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(",") : null);

/**
 * /rankings?season=&region=&week=&page=: the ranking's own title and description (its #1 team named),
 * a canonical URL that keeps the view's parameters (each region and page is its own list), and the
 * page's teams as a schema.org ItemList. A parameter the API would refuse is left out, never a 404.
 */
async function rankingsMeta(query: Record<string, unknown>): Promise<PageMeta> {
  const seasonRaw = Number(qstr(query.season));
  const explicit = PREDICT_SEASONS.includes(seasonRaw);
  const season = explicit ? seasonRaw : await defaultRankingsSeason();
  const places = parsePlaces(qstr(query.region)) ?? [];
  const weekRaw = qstr(query.week);
  const week = weekRaw && isWeek(weekRaw) && (await snapshotWeeks(season)).includes(weekRaw) ? weekRaw : null;
  const pageRaw = Number(qstr(query.page));
  const page = Number.isInteger(pageRaw) && pageRaw > 1 && pageRaw <= 10_000 ? pageRaw : 1;
  const r = await rankings({ season, week, places, page });
  const label = seasonInfo(season).label;
  const where = places.map((p) => (p.state ? regionLabel(placeKey(p)) : p.country)).join(", ");
  const when = week ? `, week of ${dateLong(week)}` : "";
  const title = `${where ? `FTC rankings: ${where}` : "FTC world rankings"} ${label}${when}${r.page > 1 ? ` (page ${r.page})` : ""}`;
  const top = r.rows[0];
  const lead = `Every rated FTC team${where ? ` from ${where}` : ""} ranked by Control Scout's prediction rating for ${label}${week ? ` as of ${dateLong(week)}` : ""}, with each team's move since last week.`;
  const first = top ? ` #${top.rank.toLocaleString("en-US")}: ${top.team}${top.name ? ` ${top.name}` : ""} (${top.rating.toFixed(1)}).` : "";
  const description = bestFit([`${lead}${first} Filter by country or state.`, `${lead}${first}`, lead]);
  const q = new URLSearchParams();
  if (explicit) q.set("season", String(season));
  if (places.length) q.set("region", places.map(placeKey).join(","));
  if (week) q.set("week", week);
  if (r.page > 1) q.set("page", String(r.page));
  const path = `/rankings${q.size ? `?${q.toString()}` : ""}`;
  const list = r.rows.length ? [{
    "@context": "https://schema.org", "@type": "ItemList", name: title, url: canonicalUrl(path), numberOfItems: r.total,
    itemListElement: r.rows.slice(0, 10).map((t) => ({ "@type": "ListItem", position: t.rank, name: `${t.team}${t.name ? ` ${t.name}` : ""}`, url: canonicalUrl(`/teams/${t.team}`) })),
  }] : undefined;
  return { title, description, type: "website", path, ...(list ? { jsonLd: list } : {}) };
}

/** The head values for a page path: the page's own, the home ones when it has none, or notFound for no such page. */
export async function pageMeta(path: string, query: Record<string, unknown> = {}): Promise<PageMeta> {
  // A shared matchup reads its parameters as text (/predict?…red=…&blue=…, /events/…?match=…).
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) { const x = qstr(v); if (x != null) sp.set(k, x); }
  // Matched decoded, as React Router does (/teams/%34%32%31%35 is team 4215). Segment by segment, so an
  // encoded "/" never adds a segment; a malformed escape stays as written (and then matches no route).
  const decode = (s: string) => { try { const d = decodeURIComponent(s); return d.includes("/") ? s : d; } catch { return s; } };
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  const p = trimmed.split("/").map(decode).join("/");
  try {
    let m: RegExpMatchArray | null;
    // Any number of digits: the value is what counts (/teams/0004215 is team 4215, as in the app; a huge one is out of range).
    if ((m = p.match(/^\/teams\/(\d+)$/i))) return await teamMeta(Number(m[1]));
    // The season by value too (/events/02025/X is 2025, as in the app and the API).
    if ((m = p.match(/^\/events\/(\d+)\/([A-Za-z0-9_-]{1,40})$/i))) {
      // Event codes are case-insensitive in the app (the API uppercases them): same here.
      const ev = await eventMeta(Number(m[1]), m[2].toUpperCase());
      if (!ev) return NOT_FOUND;
      // A shared match: its own call, or the event's values if it can't be read.
      return sp.has("match") ? await eventMatchMeta(ev, Number(m[1]), m[2].toUpperCase(), sp.get("match")).catch(() => ev) : ev;
    }
    // A match's scouting report: the match must exist (a key that can't be one is not found too).
    if ((m = p.match(/^\/events\/(\d+)\/([A-Za-z0-9_-]{1,40})\/match\/([^/]+)$/i))) {
      const key = normalMatchKey(m[3]);
      return (key && (await matchReportMeta(Number(m[1]), m[2].toUpperCase(), key))) || NOT_FOUND;
    }
    // The pit display: the event must exist. Its canonical is the event page (the one to find), so search engines
    // fold it in there. No noindex: the app keeps no per-page robots tag in step on navigation, so it would
    // follow the visitor back to the event page (as powerRankingsMeta notes).
    if ((m = p.match(/^\/events\/(\d+)\/([A-Za-z0-9_-]{1,40})\/display$/i))) {
      const ev = await eventMeta(Number(m[1]), m[2].toUpperCase());
      return ev ? { ...ev, title: `Pit display: ${ev.title}`, path: `/events/${Number(m[1])}/${m[2].toUpperCase()}`, jsonLd: undefined, bodyHtml: undefined } : NOT_FOUND;
    }
    if (/^\/rankings$/i.test(p)) return await rankingsMeta(query);
    if ((m = p.match(/^\/power-rankings(?:\/([^/]+))?$/i))) return await powerRankingsMeta(m[1] ?? null);
  } catch {
    // Database not ready: the generic values, never a 404 (the page may well exist).
    return { title: "", description: HOME_DESC, type: "website" };
  }
  // A team or event address that can't be one (/teams/abc, /teams/1234567, /events/2025/a%20b): the app says not found too.
  if (/^\/teams\/[^/]+$/i.test(p) || /^\/events\/[^/]+\/[^/]+$/i.test(p) || /^\/events\/[^/]+\/[^/]+\/match\/[^/]+$/i.test(p) || /^\/events\/[^/]+\/[^/]+\/display$/i.test(p)) return NOT_FOUND;
  if (p === "/predict" && (sp.has("red") || sp.has("blue"))) {
    // A shared matchup; the Predict page's own values when it isn't one (or ratings aren't ready).
    const mm = await matchupMeta(sp).catch(() => null);
    if (mm) return mm;
  }
  // How it works: the whole page in the first paint, prerendered from the real page component at build time
  // (scripts/prerender.mjs), so crawlers read every section without running JavaScript.
  if (p === "/methodology") {
    const s = STATIC[p], body = methodologyHtml();
    return { title: s.title, description: fitDescription(s.description), type: "website", ...(body ? { bodyHtml: body } : {}) };
  }
  // The FAQ: its questions as FAQPage data, and in full in the first paint (the same text as the page).
  if (p === "/faq") return { title: STATIC["/faq"].title, description: fitDescription(STATIC["/faq"].description), type: "website", jsonLd: [faqJsonLd(canonicalOrigin())], bodyHtml: faqHtml() };
  const s = STATIC[p];
  if (s) return { title: s.title, description: s.noindex ? s.description : fitDescription(s.description), type: "website", ...(s.noindex ? { noindex: true } : {}) };
  // The app's routes (src/shared/routes.ts, as React Router matches them): anything else is its not-found page.
  // The team and event routes were checked against the database above.
  if (pageModule(p) === "NotFound") return NOT_FOUND;
  return { title: "", description: HOME_DESC, type: "website", ...(p === "/" ? { jsonLd: homeJsonLd() } : {}) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The head tags for a page: <title>, description, robots, canonical, Open Graph, Twitter. */
export function headTags(path: string, m: PageMeta): string {
  const title = m.title ? `${m.title} · ${SITE}` : HOME_TITLE;
  const url = canonicalUrl(m.path ?? path);
  // A shared matchup previews as its card, and its link (og:url) is the matchup itself; the canonical stays the page's.
  const image = m.share ? `${canonicalOrigin()}${shareImagePath(m.share.query)}` : `${canonicalOrigin()}/og-image.png`;
  const ogUrl = m.share ? `${canonicalOrigin()}${sharePagePath(m.share.query)}` : url;
  const alt = m.share?.alt ?? SITE;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    // A 404's noindex is marked, so the app removes it on moving to a real page (CanonicalSync in src/lib/meta.tsx).
    ...(m.noindex ? [`<meta name="robots" content="noindex"${m.notFound ? " data-not-found" : ""} />`] : []),
    // A 404 names no canonical URL (there's no page to point at).
    ...(m.notFound ? [] : [`<link rel="canonical" href="${esc(url)}" />`]),
    `<meta property="og:type" content="${m.type}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    ...(m.notFound ? [] : [`<meta property="og:url" content="${esc(ogUrl)}" />`]),
    `<meta property="og:image" content="${esc(image)}" />`,
    ...(m.share ? [`<meta property="og:image:type" content="image/png" />`] : []),
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<meta name="twitter:image:alt" content="${esc(alt)}" />`,
    // JSON-LD: "<" escaped so no value can close the script tag.
    ...(m.jsonLd ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`),
  ];
  return tags.join("\n    ");
}

/** The prerendered How it works page (build/prerender/methodology.html, outside the public dist/, or CS_PRERENDER_DIR), read once; null before a build. */
let methodologyCache: string | null | undefined;
export function methodologyHtml(): string | null {
  if (methodologyCache === undefined) {
    const f = join(process.env.CS_PRERENDER_DIR ?? join(process.cwd(), "build", "prerender"), "methodology.html");
    methodologyCache = existsSync(f) ? readFileSync(f, "utf8") : null;
  }
  return methodologyCache;
}
/** Tests: forget the cached page. */
export function resetMethodologyHtml(): void { methodologyCache = undefined; }

/** The FAQ as static HTML for the first paint (crawlers and link previews read it without the app). */
function faqHtml(): string {
  const h = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return FAQ.map((g) => `<h2>${h(g.title)}</h2>${g.items.map((i) => `<h3>${h(i.q)}</h3>${i.a.map((p) => `<p>${h(faqText(p))}</p>`).join("")}`).join("")}`).join("");
}
