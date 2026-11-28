// A playing video's watch reports (lib/videoHistory.ts reportWatch): at 5 s in, at half way and at the end, read from
// the youtube-nocookie player's own message channel (lib/ytBridge.ts). The Videos feed learns from them which kinds a
// person finishes or skips. Used by the watch page's player (pages/WatchPage.tsx).
import { useEffect, useRef, type RefObject } from "react";
import { readProgress, YT_ORIGIN, type VideoProgress } from "./ytBridge";
import { reportWatch } from "./videoHistory";
import type { FeedItem, WatchKind } from "../shared/videosFeed";

/** The milestones a watch reports at, from where the player is: 5 s in, half way, the end. Pure, for tests. */
export function milestones(item: Pick<FeedItem, "t" | "end" | "duration">, p: VideoProgress): { watchedS: number; five: boolean; half: boolean; done: boolean } {
  const watchedS = Math.max(0, p.t - item.t);
  const length = item.end != null && item.end > item.t ? item.end - item.t : p.duration ? p.duration - item.t : item.duration ?? null;
  const done = p.ended || (length != null && length > 0 && watchedS >= length - 1);
  return { watchedS: Math.round(watchedS), five: watchedS >= 5, half: length != null && length > 0 && watchedS >= length / 2, done };
}

export interface Watched { key: string; kind: WatchKind; t: number; end?: number | null; duration?: number }

/** Reports `item`'s watch while `frame` plays it; a new key starts afresh. Nothing when `item` is null (a video the
 *  feed doesn't know). `player` names the player in `frame`: a new one (the page loads the video again, at a note's
 *  moment say) is listened to in its turn, its milestones kept from before for the same key. */
export function useWatchReports(frame: RefObject<HTMLIFrameElement | null>, item: Watched | null, signedIn: boolean, player?: string): void {
  const sent = useRef({ key: null as string | null, five: false, half: false, done: false });
  const key = item?.key ?? null;
  useEffect(() => {
    if (sent.current.key !== key) sent.current = { key, five: false, half: false, done: false };
    const f = frame.current;
    if (!item || !f) return;
    const report = (w: { watchedS: number; completed?: boolean }) => { void reportWatch({ key: item.key, kind: item.kind, ...w }, signedIn); };
    let prev: VideoProgress | null = null;
    let live = false;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== f.contentWindow) return;
      const p = readProgress(e.data, prev);
      if (!p) return;
      live = true;
      prev = p;
      const m = milestones({ t: item.t, end: item.end ?? undefined, duration: item.duration }, p);
      const s = sent.current;
      if (m.done && !s.done) { s.done = s.half = s.five = true; report({ watchedS: m.watchedS, completed: true }); }
      else if (m.half && !s.half) { s.half = s.five = true; report({ watchedS: m.watchedS }); }
      else if (m.five && !s.five) { s.five = true; report({ watchedS: m.watchedS }); }
    };
    window.addEventListener("message", onMessage);
    const hello = () => { if (!live) f.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT_ORIGIN); };
    f.addEventListener("load", hello);
    const timer = setInterval(hello, 1000);
    return () => { window.removeEventListener("message", onMessage); f.removeEventListener("load", hello); clearInterval(timer); };
    // The item is fixed per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, signedIn, player]);
}
