// When to offer the light version (docs/lite.md). Conservative: only on a page that has one, only while the
// browser says it's online (with no signal at all the offline pack takes over instead), and only on evidence
// from this page's own requests:
//   - the page's main data (an event, a team, a match, the pick list) still hasn't arrived LITE_SLOW_MS after the
//     visitor got to the page (watchPage), or
//   - LITE_FAILS requests failed to reach the server within LITE_FAIL_WINDOW_MS.
// A request the page itself let go of (it navigated away) isn't a failure. "Not now" holds for the rest of the
// browser session (sessionStorage), so the offer never nags.
import { useSyncExternalStore } from "react";
import { LITE_FAILS, LITE_FAIL_WINDOW_MS, LITE_SLOW_MS } from "../shared/lite";
import { normalMatchKey } from "../shared/matchReport";

/**
 * Is this request the main data of the page at `here` (a path, and its query `search`)? Only those count: a link
 * prefetched on hover, or a panel's side request, says nothing about whether the page being read is crawling. The
 * event's detail, the match (its detail or its report), the team in the season the address names, the pick list of
 * the workspace and season the address names.
 */
export function isPageData(path: string, here = typeof location === "undefined" ? "" : location.pathname,
  search = typeof location === "undefined" ? "" : location.search): boolean {
  const q = path.indexOf("?");
  const req = (q < 0 ? path : path.slice(0, q)).toLowerCase();
  const reqParams = new URLSearchParams(q < 0 ? "" : path.slice(q));
  const params = new URLSearchParams(search);
  const page = here.toLowerCase().replace(/\/+$/, "");
  let m = /^\/events\/(\d{4})\/([^/]+)\/match\/([^/]+)$/.exec(page);
  if (m) {
    const key = normalMatchKey(m[3]);
    return !!key && (req === `/api/events/${m[1]}/${m[2]}/matches/${key}` || req === `/api/events/${m[1]}/${m[2]}/matches/${key}/report`);
  }
  if ((m = /^\/events\/(\d{4})\/([^/]+)$/.exec(page))) return req === `/api/events/${m[1]}/${m[2]}`;
  // A team page asks for the season in its address (none: the newest).
  if ((m = /^\/teams\/(\d+)$/.exec(page))) return req === `/api/teams/${Number(m[1])}` && reqParams.get("season") === params.get("season");
  if (page === "/scout") {
    if (!(m = /^\/api\/scout\/workspaces\/([^/]+)\/picklist$/.exec(req))) return false;
    // The workspace and season the address names (without them, the page's own choice: any).
    const space = params.get("space"), season = params.get("season");
    return (!space || decodeURIComponent(m[1]) === space.toLowerCase()) && (!season || reqParams.get("season") === season);
  }
  return false;
}

const DISMISS_KEY = "cs-lite-dismissed";
let slow = false;
let fails: number[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

function raise() {
  if (slow || !online()) return;
  slow = true;
  emit();
}

/** Page data that has arrived (path and query, as asked for) and when. Only an arrival during this visit counts, or
 *  just before it (a link prefetched on hover, PREFETCH_MS at most): data loaded on an earlier visit says nothing
 *  about whether this one, which may fetch it again, is waiting. */
const arrived = new Map<string, number>();
const PREFETCH_MS = 30_000;
const hasArrived = (here: string, search: string, since: number) =>
  [...arrived].some(([p, at]) => at >= since - PREFETCH_MS && isPageData(p, here, search));

/** The page has this data to show now: a server answer, or (src/lib/api.ts load) data the cache already holds,
 *  fresh or stale, so the page draws it at once while it may revalidate. */
export function noteArrived(path: string) {
  const q = path.indexOf("?");
  const key = q < 0 ? path.toLowerCase() : path.slice(0, q).toLowerCase() + path.slice(q);
  arrived.delete(key);
  arrived.set(key, Date.now());
  if (arrived.size > 200) arrived.delete(arrived.keys().next().value!);
}

/**
 * Watch the page at `here` (src/components/layout/LiteSuggest.tsx, on every navigation): if its data still hasn't
 * arrived after LITE_SLOW_MS and the visitor is still there, offer the light version. The page's request may have
 * started before the visitor got here (a prefetched link) or be shared with another reader; only its arrival counts.
 * A new page starts afresh (an offer made for the last one goes). Returns a stop function.
 */
export function watchPage(here: string, search = ""): () => void {
  if (slow) { slow = false; emit(); }
  const since = Date.now();
  const timer = setTimeout(() => {
    if ((typeof location === "undefined" || (location.pathname === here && location.search === search)) && !hasArrived(here, search, since)) raise();
  }, LITE_SLOW_MS);
  return () => clearTimeout(timer);
}

/**
 * Watch one request (src/lib/api.ts apiFetch). `done(usable)` when it settles: `usable` when the page got its data
 * (a good answer, or saved data), false for an error, an unreadable body, or a "starting up" answer about to be
 * retried. `failed()` when it couldn't reach the server at all (not an answer with an error status, and not one the
 * page aborted).
 */
export function watchRequest(path: string, method = "GET"): { done: (usable?: boolean) => void; failed: () => void } {
  const get = method.toUpperCase() === "GET";
  const at = Date.now();
  let unreachable = false;
  return {
    done: (usable = true) => {
      if (!get || unreachable || !usable) return;
      const q = path.indexOf("?");
      noteArrived(path);
      // This page's data arriving quickly again: the connection recovered, so the offer goes.
      if (slow && isPageData(path) && Date.now() - at < LITE_SLOW_MS / 4) { slow = false; fails = []; emit(); }
    },
    failed: () => {
      unreachable = true;
      if (!online()) return;
      const now = Date.now();
      fails = [...fails.filter((t) => now - t < LITE_FAIL_WINDOW_MS), now];
      if (fails.length >= LITE_FAILS) raise();
    },
  };
}

export function dismissLite() {
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage blocked: this page only */ }
  slow = false;
  fails = [];
  emit();
}
const dismissed = () => { try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } };

/** Whether to offer the light version now (the page decides whether it has one). */
export function useLiteSuggested(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      // Losing the signal altogether hides the offer at once (the offline pack's turn), and getting it back re-reads it.
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => { listeners.delete(l); window.removeEventListener("online", l); window.removeEventListener("offline", l); };
    },
    () => slow && !dismissed() && online(),
    () => false,
  );
}

/** Tests: start over. */
export function resetLiteSuggest() { slow = false; fails = []; arrived.clear(); try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* none */ } emit(); }
