// What YouTube says about a video: whether it plays, how long it is, and, for a recorded live broadcast,
// when the broadcast started and ended. With YOUTUBE_API_KEY, from the YouTube Data API (videos.list:
// liveStreamingDetails, contentDetails; 50 videos a request, which a server in a data centre may always
// call). Without one, from the public watch page's player response (playabilityStatus, lengthSeconds,
// liveBroadcastDetails), which YouTube may refuse a data-centre address with a "not a bot" sign-in wall:
// that's an error to try again later, never a removed video. Read once per video and kept
// (server/videos/recordings.ts), so an event's matches can link to their second in it.

export interface WatchPageFacts {
  status: "ok" | "unavailable" | "error";
  /** UTC ISO; null when the video isn't a live broadcast (an upload has no start to line matches up with) or hasn't started. */
  start: string | null;
  end: string | null;
  length: number | null;
  live: boolean;
}

const ERROR: WatchPageFacts = { status: "error", start: null, end: null, length: null, live: false };
const UNAVAILABLE: WatchPageFacts = { ...ERROR, status: "unavailable" };

const iso = (s: string | undefined) => { if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** The facts from a watch page's HTML. A page without a player response (a consent wall, a changed page) is "error", never a guess. */
export function parseWatchPage(html: string): WatchPageFacts {
  const playability = /"playabilityStatus":\{"status":"([A-Z_]+)"/.exec(html)?.[1];
  if (!playability) return ERROR;
  if (playability !== "OK" && playability !== "LIVE_STREAM_OFFLINE") {
    // Gone for good: removed, or made private. Anything else (the "confirm you're not a bot" sign-in wall
    // YouTube shows some servers, an age check, a status not seen before) is tried again later.
    const reason = /"playabilityStatus":\{"status":"[A-Z_]+","reason":"([^"]*)"/.exec(html)?.[1] ?? "";
    const gone = playability === "ERROR" || playability === "UNPLAYABLE" || (playability === "LOGIN_REQUIRED" && /private/i.test(reason));
    return gone ? UNAVAILABLE : ERROR;
  }
  const length = Number(/"lengthSeconds":"(\d+)"/.exec(html)?.[1]);
  const b = /"liveBroadcastDetails":(\{[^{}]*\})/.exec(html)?.[1];
  let details: { isLiveNow?: boolean; startTimestamp?: string; endTimestamp?: string } = {};
  if (b) try { details = JSON.parse(b); } catch { /* left empty: no broadcast times */ }
  // Not started yet: any start YouTube shows is the schedule, never a time to line matches up with.
  const offline = playability === "LIVE_STREAM_OFFLINE";
  return {
    status: "ok",
    start: offline ? null : iso(details.startTimestamp),
    end: iso(details.endTimestamp),
    length: Number.isFinite(length) && length > 0 ? length : null,
    // A scheduled broadcast not started yet (LIVE_STREAM_OFFLINE) counts as live with no start, so it's read again until it runs.
    live: details.isLiveNow === true || offline,
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
    if (!res.ok) return res.status === 404 ? UNAVAILABLE : ERROR;
    return parseWatchPage(await res.text());
  } catch {
    return ERROR;
  }
}

/** "PT4H35M41S" → 16541; "P0D" (a broadcast still live) and anything unreadable → null. */
export function isoDuration(d: string | undefined): number | null {
  const m = d ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d) : null;
  if (!m) return null;
  const s = Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return s > 0 ? s : null;
}

/** One videos.list item → its facts. */
export function apiFacts(item: any): WatchPageFacts {
  const live = item?.liveStreamingDetails as { actualStartTime?: string; actualEndTime?: string; scheduledStartTime?: string } | undefined;
  const started = iso(live?.actualStartTime);
  return {
    status: "ok",
    start: started,
    end: iso(live?.actualEndTime),
    length: isoDuration(item?.contentDetails?.duration),
    // Live now, or scheduled and not started yet (read again until it runs).
    live: !!live && !live.actualEndTime && (!!started || !!live.scheduledStartTime),
  };
}

/**
 * Up to 50 videos from the YouTube Data API. A video missing from the answer is removed or private
 * (unavailable); a failed request leaves every one an error, tried again later. The key never leaves the server.
 */
export async function fetchFromApi(ids: string[], key: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, WatchPageFacts>> {
  const out = new Map<string, WatchPageFacts>(ids.map((id) => [id, ERROR]));
  try {
    const q = new URLSearchParams({ part: "liveStreamingDetails,contentDetails", id: ids.slice(0, 50).join(","), key, maxResults: "50" });
    const res = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${q}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return out;
    const body = await res.json() as { items?: unknown };
    // Only a well-formed answer can say a video is gone: anything else leaves them all to try again.
    if (!Array.isArray(body?.items)) return out;
    const read = new Map<string, WatchPageFacts>(ids.map((id) => [id, UNAVAILABLE]));
    for (const item of body.items) if (item && read.has(String(item.id))) read.set(String(item.id), apiFacts(item));
    return read;
  } catch {
    return out;
  }
}
