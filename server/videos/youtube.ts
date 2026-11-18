// What YouTube says about a video: whether it plays, how long it is, and, for a recorded live broadcast,
// when the broadcast started and ended. With YOUTUBE_API_KEY, from the YouTube Data API (videos.list:
// liveStreamingDetails, contentDetails; 50 videos a request, which a server in a data centre may always
// call). Without one, from the public watch page's player response (playabilityStatus, lengthSeconds,
// liveBroadcastDetails), which YouTube may refuse a data-centre address with a "not a bot" sign-in wall:
// that's an error to try again later, never a removed video. Read once per video and kept
// (server/videos/recordings.ts), so an event's matches can link to their second in it. The watch page also
// gives the video's chapters (parseChapters), which can confirm the timing of a video cut short (chaptersConfirm).
import type { Chapter } from "../../src/shared/recording.js";

export interface WatchPageFacts {
  status: "ok" | "unavailable" | "error";
  /** UTC ISO; null when the video isn't a live broadcast (an upload has no start to line matches up with) or hasn't started. */
  start: string | null;
  end: string | null;
  length: number | null;
  live: boolean;
  /** Its chapters, from the watch page only (the Data API doesn't give them); undefined: not read. */
  chapters?: Chapter[];
  /** False when its owner turned embedding off: it plays on youtube.com only, never in a player on another site (the
   *  app's player, the frame reader's embed). Undefined: not read. */
  embeddable?: boolean;
}

const ERROR: WatchPageFacts = { status: "error", start: null, end: null, length: null, live: false };
const UNAVAILABLE: WatchPageFacts = { ...ERROR, status: "unavailable" };

const iso = (s: string | undefined) => { if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** A watch page's chapters (the creator's, or YouTube's generated ones), in order; [] when it has none. */
export function parseChapters(html: string): Chapter[] {
  const out: Chapter[] = [];
  const re = /"chapterRenderer":\{"title":\{"simpleText":"((?:[^"\\]|\\.)*)"\},"timeRangeStartMillis":(\d+)/g;
  const seen = new Set<number>();
  for (let m; (m = re.exec(html));) {
    const t = Math.round(Number(m[2]) / 1000);
    let title = m[1];
    try { title = JSON.parse(`"${m[1]}"`); } catch { /* kept as it came */ }
    // The page lists each chapter more than once (the player bar, the description): one per start.
    if (!seen.has(t)) { seen.add(t); out.push([t, title]); }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** The facts from a watch page's HTML. A page without a player response (a consent wall, a changed page) is "error", never a guess. */
export function parseWatchPage(html: string): WatchPageFacts {
  const playability = /"playabilityStatus":\{"status":"([A-Z_]+)"/.exec(html)?.[1];
  if (!playability) return ERROR;
  if (playability !== "OK" && playability !== "LIVE_STREAM_OFFLINE") {
    // Gone for good: removed, or made private. Anything else (the "confirm you're not a bot" sign-in wall
    // YouTube shows some servers, an age check, a status not seen before) is tried again later.
    const reason = /"playabilityStatus":\{"status":"[A-Z_]+","reason":"([^"]*)"/.exec(html)?.[1] ?? "";
    const gone = playability === "ERROR" || playability === "UNPLAYABLE" || (playability === "LOGIN_REQUIRED" && /private/i.test(reason));
    if (gone) return UNAVAILABLE;
    // The sign-in wall still carries the video's chapters (the same list a visitor's page has, checked against one for
    // the Terra Division 2026 recording: 57 of 57): kept, as the server's only way to them (the Data API has none).
    // The walls seen so far leave out the length and broadcast times; one that carries both (a broadcast start, not
    // only an empty block) is read like a visitor's page. Anything less stays the error, so it's read again later.
    if (/"lengthSeconds":"\d+"/.test(html) && /"liveBroadcastDetails":\{[^{}]*"startTimestamp":"[^"]+"/.test(html)) return pageFacts(html, false);
    const chapters = parseChapters(html);
    return chapters.length ? { ...ERROR, chapters } : ERROR;
  }
  return pageFacts(html, playability === "LIVE_STREAM_OFFLINE");
}

/** Whether the page's owner lets it play on other sites. False wherever the page says so; true only from a page that
 *  plays (status OK, or a broadcast not started), never a sign-in wall's: an owner who turns embedding back on is seen
 *  without the API key. Neither: not said, so the stored value stays (saveMeta). */
function embedFlag(html: string): { embeddable?: boolean } {
  if (/"playableInEmbed":false/.test(html)) return { embeddable: false };
  return /"playabilityStatus":\{"status":"(?:OK|LIVE_STREAM_OFFLINE)"[^{}]*"playableInEmbed":true/.test(html) ? { embeddable: true } : {};
}

/** The timing facts and chapters of a page that carries the player response. */
function pageFacts(html: string, offline: boolean): WatchPageFacts {
  const length = Number(/"lengthSeconds":"(\d+)"/.exec(html)?.[1]);
  const b = /"liveBroadcastDetails":(\{[^{}]*\})/.exec(html)?.[1];
  let details: { isLiveNow?: boolean; startTimestamp?: string; endTimestamp?: string } = {};
  if (b) try { details = JSON.parse(b); } catch { /* left empty: no broadcast times */ }
  // Not started yet (offline): any start YouTube shows is the schedule, never a time to line matches up with.
  return {
    status: "ok",
    start: offline ? null : iso(details.startTimestamp),
    end: iso(details.endTimestamp),
    length: Number.isFinite(length) && length > 0 ? length : null,
    // A scheduled broadcast not started yet (LIVE_STREAM_OFFLINE) counts as live with no start, so it's read again until it runs.
    live: details.isLiveNow === true || offline,
    chapters: parseChapters(html),
    ...embedFlag(html),
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

/** What a channel's uploads list gives for a video in place of its title while YouTube hides it there ("Deleted
 *  video", "Private video"): not its title, which YouTube's videos list still gives (NYC FIRST's bjwZWaiMwnc, public,
 *  listed as "Deleted video" on 2026-11-17). Never written over a title, never read as one; the
 *  channel audit and the channel broadcasts both read it here. */
export const isPlaceholderTitle = (t: unknown) => /^(deleted|private) video$/i.test(String(t ?? "").trim());

/** "PT4H35M41S" → 16541; "P0D" (a broadcast still live) and anything unreadable → null. */
export function isoDuration(d: string | undefined): number | null {
  const m = d ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d) : null;
  if (!m) return null;
  const s = Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return s > 0 ? s : null;
}

/** YouTube lists 249 regions, and a copyright block lists (nearly) all of them: 247 and 249 seen. Blocked in this many,
 *  a video plays for no one (the watch page: "Video unavailable"). */
export const BLOCKED_ALL = 240;

/**
 * Whether a video's region rules stop the people who watch it: blocked (nearly) everywhere, or in a country one of its
 * events is in (`homes`, ISO alpha-2: most viewers are in the event's own country), or allowed only elsewhere. A video
 * that plays in its events' countries keeps its clips, however many others block it.
 */
export function blockedForViewers(rule: { blocked?: unknown; allowed?: unknown } | undefined, homes: readonly string[] = []): boolean {
  const blocked = Array.isArray(rule?.blocked) ? rule!.blocked.map(String) : [];
  if (blocked.length >= BLOCKED_ALL) return true;
  if (homes.some((h) => blocked.includes(h))) return true;
  const allowed = Array.isArray(rule?.allowed) ? rule!.allowed.map(String) : null;
  return !!allowed && (!allowed.length || (homes.length > 0 && !homes.some((h) => allowed.includes(h))));
}

/** One videos.list item → its facts. `homes`: the countries of its events (blockedForViewers). */
export function apiFacts(item: any, homes: readonly string[] = []): WatchPageFacts {
  if (blockedForViewers(item?.contentDetails?.regionRestriction, homes)) return UNAVAILABLE;
  const live = item?.liveStreamingDetails as { actualStartTime?: string; actualEndTime?: string; scheduledStartTime?: string } | undefined;
  const started = iso(live?.actualStartTime);
  return {
    status: "ok",
    start: started,
    end: iso(live?.actualEndTime),
    length: isoDuration(item?.contentDetails?.duration),
    // Live now, or scheduled and not started yet (read again until it runs).
    live: !!live && !live.actualEndTime && (!!started || !!live.scheduledStartTime),
    // Asked for with every read (part "status"): false only when YouTube says so.
    embeddable: item?.status?.embeddable !== false,
  };
}

/**
 * Up to 50 videos from the YouTube Data API. A video missing from the answer is removed or private
 * (unavailable); a failed request leaves every one an error, tried again later. The key never leaves the server.
 */
export async function fetchFromApi(ids: string[], key: string, fetchImpl: typeof fetch = fetch, homes?: (id: string) => readonly string[]): Promise<Map<string, WatchPageFacts>> {
  const out = new Map<string, WatchPageFacts>(ids.map((id) => [id, ERROR]));
  try {
    const q = new URLSearchParams({ part: "liveStreamingDetails,contentDetails,status", id: ids.slice(0, 50).join(","), key, maxResults: "50" });
    const res = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${q}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return out;
    const body = await res.json() as { items?: unknown };
    // Only a well-formed answer can say a video is gone: anything else leaves them all to try again.
    if (!Array.isArray(body?.items)) return out;
    const read = new Map<string, WatchPageFacts>(ids.map((id) => [id, UNAVAILABLE]));
    for (const item of body.items) if (item && read.has(String(item.id))) read.set(String(item.id), apiFacts(item, homes?.(String(item.id))));
    return read;
  } catch {
    return out;
  }
}
