// What this person watched in the Videos tab, for their feed (server/api/videosFeed.ts). Signed in, each watch goes to
// the account (POST /api/videos/watch). Signed out, it stays on this device only, like recent searches: a capped list
// in localStorage, newest first, sent with each feed request (src/shared/videosFeed.ts encodeHistory) and never stored
// anywhere else.
import { apiFetch } from "./api";
import { FEED_KEY, HISTORY_SENT, HISTORY_STATES, type HistoryState, type WatchReport } from "../shared/videosFeed";

export const VIDEO_HISTORY_KEY = "cs-video-history";
const MAX = 200;
interface Entry { key: string; state: HistoryState; at: number }
let memory: Entry[] | null = null; // storage blocked: this page's own

export function readHistory(): Entry[] {
  if (memory) return memory;
  try {
    const v = JSON.parse(localStorage.getItem(VIDEO_HISTORY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((e): e is Entry => !!e && typeof e.key === "string" && FEED_KEY.test(e.key) && HISTORY_STATES.includes(e.state)).slice(0, MAX) : [];
  } catch { return []; }
}

/** The device's history with this watch in it, newest first: "not interested", a finish or "more like this" is
 *  never taken back by a later start. Past MAX, the oldest starts go first, then finishes, then "more like this";
 *  a "not interested" goes last. */
export function withWatch(list: Entry[], w: WatchReport, now = Date.now()): Entry[] {
  const had = list.find((e) => e.key === w.key)?.state;
  // The watch (finished, started or not opened) and "more like this" are kept apart, then written as one state.
  const watch = w.completed || had?.[0] === "d" ? "d" : w.watchedS > 0 || had?.[0] === "p" ? "p" : "";
  const more = w.more || !!had?.endsWith("m");
  const state: HistoryState = w.hidden || had === "x" ? "x" : (`${watch}${more ? "m" : ""}` || "p") as HistoryState;
  const out = [{ key: w.key, state, at: now }, ...list.filter((e) => e.key !== w.key)];
  for (const drop of ["p", "d", "pm", "dm", "m", "x"] as const) {
    for (let i = out.length - 1; out.length > MAX && i >= 0; i--) if (out[i].state === drop) out.splice(i, 1);
  }
  return out;
}

function writeHistory(list: Entry[]) {
  try { localStorage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(list)); memory = null; } catch { memory = list; }
}

/** What a feed request carries for a signed-out device: "not interested" first, then finished, then started, each
 *  newest first, at most HISTORY_SENT: the ones that drop or sink an item are the last left out. */
export function sentHistory(list = readHistory()): Entry[] {
  const rank: Record<HistoryState, number> = { x: 0, m: 1, dm: 1, pm: 1, d: 2, p: 3 };
  return [...list].sort((a, b) => rank[a.state] - rank[b.state] || b.at - a.at).slice(0, HISTORY_SENT);
}

/** Keep a watch: on the account when signed in (on this device if the server can't take it), else on this device. */
export async function reportWatch(w: WatchReport, signedIn: boolean): Promise<void> {
  // Nothing seen and nothing said (a clip swiped past before it played): no watch to keep. Kept, it would count as
  // started, a view, and lean the feed toward what was skipped.
  if (!(w.watchedS > 0) && !w.completed && !w.hidden && !w.more) return;
  if (signedIn) {
    try { await apiFetch("/api/videos/watch", { method: "POST", json: w }); return; } catch { /* kept here instead */ }
  }
  writeHistory(withWatch(readHistory(), w));
}
