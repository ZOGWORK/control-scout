// Light pages (docs/lite.md): a text-only, server-rendered twin of the few pages people open at a venue on one
// bar of signal: an event, a team, a match and a workspace's pick list. One address scheme, shared by the server
// (server/lite/), the app (its "Control Scout Lite" footer link and the slow-connection prompt) and the service worker:
//
//   /events/2025/USNJQ1                    ⇄ /lite/events/2025/USNJQ1
//   /events/2025/USNJQ1/match/qual:0:12    ⇄ /lite/events/2025/USNJQ1/match/qual:0:12
//   /teams/18360?season=2024               ⇄ /lite/teams/18360?season=2024
//   /scout?space=7&tab=planning&view=picklist&season=…  ⇄ /lite/picklist?space=7&season=…
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
  return null;
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
  return "/";
}
