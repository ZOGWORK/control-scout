// The embedded YouTube player's position, read through its own message channel: with enablejsapi=1 in the
// embed address, the player answers a "listening" message by sending infoDelivery messages (currentTime, a few
// times a second, and playerState) to the page, and takes commands (seekTo, playVideo) the same way. No YouTube
// script on our pages: just the iframe we already load, and messages from that iframe only.
import { useEffect, useRef, useState, type RefObject } from "react";

export const YT_ORIGIN = "https://www.youtube-nocookie.com";

/** The embed's address with the message channel on (the origin is ours, so the player answers this page only). */
export function bridgedSrc(base: string, params: Record<string, string | number>, origin = typeof location === "undefined" ? "" : location.origin): string {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  q.set("enablejsapi", "1");
  if (origin) q.set("origin", origin);
  return `${base}?${q}`;
}

export interface VideoClock { t: number; playing: boolean }

/** What a message from the player says about the clock (null: not a position update). Pure, for tests. */
export function readDelivery(data: unknown, prev: VideoClock | null): VideoClock | null {
  let d: unknown = data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return null; } }
  const info = (d as { event?: string; info?: { currentTime?: unknown; playerState?: unknown } } | null)?.info;
  if (!info || (d as { event?: string }).event !== "infoDelivery") return null;
  const t = typeof info.currentTime === "number" && Number.isFinite(info.currentTime) ? info.currentTime : prev?.t;
  // playerState 1 is playing; it only comes with a change, so it carries over between deliveries.
  const playing = typeof info.playerState === "number" ? info.playerState === 1 : prev?.playing ?? false;
  return t == null ? null : { t, playing };
}

/**
 * The player's clock while `frame` holds a bridged embed: null until it first reports. `seek` moves the playing
 * video (true when the player is listening; false means reload it at that second instead).
 */
export function useVideoClock(frame: RefObject<HTMLIFrameElement | null>, key: unknown): { clock: VideoClock | null; seek: (t: number) => boolean } {
  const [clock, setClock] = useState<VideoClock | null>(null);
  const live = useRef(false);
  useEffect(() => {
    setClock(null);
    live.current = false;
    const f = frame.current;
    if (!f) return;
    const post = (msg: object) => f.contentWindow?.postMessage(JSON.stringify({ ...msg, id: 1, channel: "widget" }), YT_ORIGIN);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== f.contentWindow) return;
      setClock((prev) => {
        const next = readDelivery(e.data, prev);
        if (!next) return prev;
        live.current = true;
        // Re-render only when the shown second or the state moves.
        return prev && Math.floor(prev.t) === Math.floor(next.t) && prev.playing === next.playing ? prev : next;
      });
    };
    window.addEventListener("message", onMessage);
    // Say we're listening until the player answers (it ignores messages sent before it's ready).
    const hello = () => { if (!live.current) post({ event: "listening" }); };
    f.addEventListener("load", hello);
    const timer = setInterval(hello, 1000);
    hello();
    return () => { window.removeEventListener("message", onMessage); f.removeEventListener("load", hello); clearInterval(timer); };
  }, [frame, key]);
  const seek = (t: number) => {
    const w = frame.current?.contentWindow;
    if (!live.current || !w) return false;
    w.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [t, true], id: 1, channel: "widget" }), YT_ORIGIN);
    w.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [], id: 1, channel: "widget" }), YT_ORIGIN);
    return true;
  };
  return { clock, seek };
}
