// What YouTube's own watch page says about a video: whether it plays, how long it is, and, for a recorded
// live broadcast, when the broadcast started and ended. No API key: the page carries these in its player
// response (playabilityStatus, videoDetails.lengthSeconds, microformat's liveBroadcastDetails). Read once
// per video and kept (server/videos/recordings.ts), so an event's matches can link to their second in it.

export interface WatchPageFacts {
  status: "ok" | "unavailable" | "error";
  /** UTC ISO; null when the video isn't a live broadcast (an upload has no start to line matches up with). */
  start: string | null;
  end: string | null;
  length: number | null;
  live: boolean;
}

const iso = (s: string | undefined) => { if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** The facts from a watch page's HTML. A page without a player response (a consent wall, a changed page) is "error", never a guess. */
export function parseWatchPage(html: string): WatchPageFacts {
  const playability = /"playabilityStatus":\{"status":"([A-Z_]+)"/.exec(html)?.[1];
  if (!playability) return { status: "error", start: null, end: null, length: null, live: false };
  if (playability !== "OK" && playability !== "LIVE_STREAM_OFFLINE") return { status: "unavailable", start: null, end: null, length: null, live: false };
  const length = Number(/"lengthSeconds":"(\d+)"/.exec(html)?.[1]);
  const b = /"liveBroadcastDetails":(\{[^{}]*\})/.exec(html)?.[1];
  let details: { isLiveNow?: boolean; startTimestamp?: string; endTimestamp?: string } = {};
  if (b) try { details = JSON.parse(b); } catch { /* left empty: no broadcast times */ }
  return {
    status: "ok",
    start: iso(details.startTimestamp),
    end: iso(details.endTimestamp),
    length: Number.isFinite(length) && length > 0 ? length : null,
    live: details.isLiveNow === true,
  };
}

/** Fetch and read one video's watch page. Network trouble or a non-200 is "error" (tried again later), not "unavailable". */
export async function fetchWatchPage(videoId: string, fetchImpl: typeof fetch = fetch): Promise<WatchPageFacts> {
  try {
    const res = await fetchImpl(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
      // English and no consent wall: the page is the same public one any visitor gets.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ControlScout/1.0; +https://controlscout.org)", "Accept-Language": "en", Cookie: "CONSENT=YES+1" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { status: res.status === 404 ? "unavailable" : "error", start: null, end: null, length: null, live: false };
    return parseWatchPage(await res.text());
  } catch {
    return { status: "error", start: null, end: null, length: null, live: false };
  }
}
