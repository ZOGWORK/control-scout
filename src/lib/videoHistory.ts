// What this person watched in the Videos tab, for their feed (server/api/videosFeed.ts). Signed in, each watch goes to
// the account (POST /api/videos/watch). Signed out, it stays on this device only, like recent searches: a capped list
// in localStorage, newest first, sent with each feed request (src/shared/videosFeed.ts encodeHistory) and never stored
// anywhere else.
import { apiFetch } from "./api";
import { FEED_KEY, HISTORY_SENT, type HistoryState, type WatchReport } from "../shared/videosFeed";

export const VIDEO_HISTORY_KEY = "cs-video-history";
const MAX = 200;
interface Entry { key: string; state: HistoryState; at: number }
let memory: Entry[] | null = null; // storage blocked: this page's own

export function readHistory(): Entry[] {
  if (memory) return memory;
  try {
    const v = JSON.parse(localStorage.getItem(VIDEO_HISTORY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((e): e is Entry => !!e && typeof e.key === "string" && FEED_KEY.test(e.key) && (e.state === "d" || e.state === "p" || e.state === "x")).slice(0, MAX) : [];
  } catch { return []; }
}

/** The device's history with this watch in it: a finish or "not interested" is never taken back by a later start. */
export function withWatch(list: Entry[], w: WatchReport, now = Date.now()): Entry[] {
  const had = list.find((e) => e.key === w.key)?.state;
  const state: HistoryState = w.hidden || had === "x" ? "x" : w.completed || had === "d" ? "d" : "p";
  return [{ key: w.key, state, at: now }, ...list.filter((e) => e.key !== w.key)].slice(0, MAX);
}

function writeHistory(list: Entry[]) {
  try { localStorage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(list)); memory = null; } catch { memory = list; }
}

/** What a feed request carries for a signed-out device: its newest HISTORY_SENT entries. */
export const sentHistory = () => readHistory().slice(0, HISTORY_SENT);

/** Keep a watch: on the account when signed in (on this device if the server can't take it), else on this device. */
export async function reportWatch(w: WatchReport, signedIn: boolean): Promise<void> {
  if (signedIn) {
    try { await apiFetch("/api/videos/watch", { method: "POST", json: w }); return; } catch { /* kept here instead */ }
  }
  writeHistory(withWatch(readHistory(), w));
}
