// Light pages (docs/lite.md): a text-only, server-rendered twin of the pages people open at a venue on one bar of
// signal. One address scheme, shared by the server (server/lite/), the app (its "Control Scout Lite" footer link and
// the slow-connection prompt) and the service worker (src/sw.template.js keeps a copy, held to this one by a test):
//
//   /                                      ⇄ /lite
//   /search?q=4215&in=2024                 ⇄ /lite/search?q=4215&in=2024
//   /events/2025/USNJQ1                    ⇄ /lite/events/2025/USNJQ1
//   /events/2025/USNJQ1/match/qual:0:12    ⇄ /lite/events/2025/USNJQ1/match/qual:0:12
//   /teams/18360?season=2024               ⇄ /lite/teams/18360?season=2024
//   /predict?mode=match&season=…&red=1,2&blue=3,4   ⇄ /lite/predict?season=…&red=1,2&blue=3,4
//   /compare?teams=1,2&season=…            ⇄ /lite/compare?teams=1,2&season=…
//   /rankings?season=…&region=…&page=2     ⇄ /lite/rankings?season=…&region=…&page=2
//   /scout?space=7&tab=planning&view=picklist&season=…  ⇄ /lite/picklist?space=7&season=…
//   /scout?… (any other view)              ⇄ /lite/scout?… (scouting itself needs the full app: its forms run scripts)
//   /settings                              ⇄ /lite/settings
//
// Any rich page can also be asked for as ?lite=1 (the server redirects to its twin). A light page always links
// back to its full version: light mode is never somewhere a good connection gets stuck.

import { picklistQuery } from "./scoutSections";
import { eventPath, isEventCodeParam } from "./eventCode";

export const LITE_PREFIX = "/lite";

/** After this long without the page's first data (online), the app offers the light version. */
export const LITE_SLOW_MS = 8000;
/** This many failed requests (online, the server unreachable or timing out) within LITE_FAIL_WINDOW_MS offer it too. */
export const LITE_FAILS = 3;
export const LITE_FAIL_WINDOW_MS = 60_000;
/** The static first paint offers it after this long when the app's code still hasn't run (server/bootShell.ts). */
export const LITE_BOOT_S = 10;

// Any event code FIRST uses (src/shared/eventCode.ts): dotted, punctuated or mixed case, encoded in the path or not.
const EVENT = /^\/events\/(\d{4})\/([^/]{1,120})\/?$/;
const MATCH = /^\/events\/(\d{4})\/([^/]{1,120})\/match\/([A-Za-z0-9:]{1,24})\/?$/;
const TEAM = /^\/teams\/(\d{1,6})\/?$/;
const SPACE = /^[A-Za-z0-9_-]{1,64}$/;

/** The event's address (its code in capitals, encoded), or null for a segment that isn't an event code. */
const eventAt = (season: string, raw: string): string | null => {
  let code: string;
  try { code = decodeURIComponent(raw); } catch { return null; }
  return isEventCodeParam(code) ? eventPath(season, code) : null;
};

const seasonQuery = (params: URLSearchParams) => {
  const s = params.get("season");
  return s && /^\d{4}$/.test(s) ? `?season=${s}` : "";
};

// The parameters each page with a query carries across, and what a value may be. A repeated one (a Lite form's two
// team boxes a side: ?red=1&red=2) is one comma list, as the full page reads it.
const SEASON = /^\d{4}$/, TEAMS = /^\d{1,6}(,\d{1,6}){0,3}$/;
const CARRY: Record<string, Record<string, RegExp>> = {
  search: { q: /^[^\u0000-\u001f]{1,200}$/, in: SEASON },
  predict: { season: SEASON, red: TEAMS, blue: TEAMS },
  compare: { teams: TEAMS, season: SEASON },
  rankings: { season: SEASON, region: /^[\p{L}\p{M}\d .'()&:,-]{1,200}$/u, page: /^\d{1,5}$/ },
};
/** "?a=b&…" with the page's own parameters only (in CARRY's order), or "". */
function carried(page: keyof typeof CARRY, params: URLSearchParams, first?: [string, string]): string {
  const q = new URLSearchParams();
  if (first) q.set(first[0], first[1]);
  for (const [k, ok] of Object.entries(CARRY[page])) {
    const v = params.getAll(k).map((x) => x.trim()).filter(Boolean).join(",");
    if (v && ok.test(v)) q.set(k, v);
  }
  const s = q.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  return s ? `?${s}` : "";
}

/** A page's own path without a trailing slash, lower case ("/Search/" is /search). */
const bare = (path: string) => path.replace(/(.)\/+$/, "$1").toLowerCase();

/** The light twin of a rich page (path and its query, "?a=b" or ""), or null when it has none. */
export function liteHref(path: string, search = ""): string | null {
  const params = new URLSearchParams(search);
  let m = MATCH.exec(path), ev: string | null;
  if (m) return (ev = eventAt(m[1], m[2])) ? `${LITE_PREFIX}${ev}/match/${m[3]}` : null;
  if ((m = EVENT.exec(path))) return (ev = eventAt(m[1], m[2])) ? `${LITE_PREFIX}${ev}` : null;
  if ((m = TEAM.exec(path))) return `${LITE_PREFIX}/teams/${Number(m[1])}${seasonQuery(params)}`;
  // The pick list: ?view=picklist, or Pick list & planning with no view (the pick list is its first view).
  if (/^\/scout\/?$/i.test(path) && (params.get("view") === "picklist" || (params.get("tab") === "planning" && !params.get("view")))) {
    const space = params.get("space");
    const q = new URLSearchParams();
    if (space && SPACE.test(space)) q.set("space", space);
    const s = params.get("season");
    if (s && /^\d{4}$/.test(s)) q.set("season", s);
    const qs = q.toString();
    return `${LITE_PREFIX}/picklist${qs ? `?${qs}` : ""}`;
  }
  const page = bare(path);
  if (page === "/") return LITE_PREFIX;
  if (page === "/search" || page === "/compare" || page === "/rankings") return `${LITE_PREFIX}${page}${carried(page.slice(1) as "search", params)}`;
  // Any mode of Predict: Lite has the matchup (a Lite page can't run the other modes' pickers).
  if (page === "/predict") return `${LITE_PREFIX}/predict${carried("predict", params)}`;
  // Scouting's other views: Lite's page says scouting needs the full app, and takes this same view back there.
  if (page === "/scout") { const rest = scoutQuery(params); return `${LITE_PREFIX}/scout${rest}`; }
  if (page === "/settings") return `${LITE_PREFIX}/settings`;
  return null;
}

/** Scouting's own query as it was (only plain keys and values), less Lite's switch. */
function scoutQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of params) if (k !== "lite" && /^[a-z]{1,20}$/i.test(k) && v.length <= 120 && !/[\u0000-\u001f]/.test(v)) q.append(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The Lite page offers itself in the app when the connection is bad: not on scouting's forms, which keep working
 *  offline in the full app (Lite can only point back to them). */
export function liteOffer(path: string, search = ""): string | null {
  const to = liteHref(path, search);
  return to && /^\/lite\/scout(\?|$)/.test(to) ? null : to;
}

/** The rich page a light one stands in for (path and query); "/" for anything else under /lite. */
export function fullHref(path: string, search = ""): string {
  const params = new URLSearchParams(search);
  const rest = path.replace(/^\/lite(?=\/|$)/i, "") || "/";
  let m = MATCH.exec(rest), ev: string | null;
  if (m) return (ev = eventAt(m[1], m[2])) ? `${ev}/match/${m[3]}` : "/";
  if ((m = EVENT.exec(rest))) return (ev = eventAt(m[1], m[2])) ? ev : "/";
  if ((m = TEAM.exec(rest))) return `/teams/${Number(m[1])}${seasonQuery(params)}`;
  if (/^\/picklist\/?$/i.test(rest)) {
    const space = params.get("space");
    const s = params.get("season");
    return `/scout?${picklistQuery(space && SPACE.test(space) ? space : null, s && /^\d{4}$/.test(s) ? s : null).toString()}`;
  }
  const page = bare(rest);
  if (page === "/search" || page === "/compare" || page === "/rankings") return `${page}${carried(page.slice(1) as "search", params)}`;
  // A matchup opens Predict on it; no teams yet, Predict as it opens.
  if (page === "/predict") { const c = carried("predict", params, ["mode", "match"]); return c === "?mode=match" ? "/predict" : `/predict${c}`; }
  if (page === "/scout") return `/scout${scoutQuery(params)}`;
  if (page === "/settings") return "/settings";
  return "/";
}
