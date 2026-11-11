// Checks on a YouTube link a contributor adds, or an applicant sends (docs/contributors.md "YouTube checks"), with
// the same readers the event recordings use (./youtube.ts): the Data API with YOUTUBE_API_KEY, else the public watch
// page. What blocks: not a YouTube video link, or a video YouTube says is private or deleted. What only warns: a video
// over 10 minutes (a full stream, not one match), a check that couldn't be read, a video blocked in some countries.
// A check that can't be read never refuses a link: YouTube changing its page would refuse every good one.
import { env } from "../env.js";
import { fetchFromApi, parseWatchPage, type WatchPageFacts } from "./youtube.js";
import { youtubeId } from "../../src/shared/personal.js";
import { LONG_VIDEO_S } from "../../src/shared/contributors.js";

export type LinkWarning = "long" | "unchecked" | "region";
export interface LinkCheck {
  ok: boolean;
  /** Why it's refused (ok false). */
  error?: string;
  videoId?: string;
  warnings: LinkWarning[];
  /** What was read, kept on the link for the owner console's re-check. */
  facts?: { status: WatchPageFacts["status"]; length: number | null; region?: boolean; at: string };
}

export const LINK_TEXT = {
  notYoutube: "That doesn't look like a YouTube link.",
  gone: "This video is private or deleted.",
  long: "This video is over 10 minutes — it looks like a full stream, not a match clip. Add a timestamp where the match starts, or split it instead.",
  unchecked: "Couldn't check this video — if it's private or deleted, it won't play.",
  region: "Couldn't check this video everywhere — YouTube says it's blocked in some countries, so it may not play for everyone.",
  channel: "That channel doesn't look like a real YouTube channel.",
} as const;

const UA = { "User-Agent": "Mozilla/5.0 (compatible; ControlScout/1.0; +https://controlscout.org)", "Accept-Language": "en", Cookie: "CONSENT=YES+1" };

/** A watch page read, with a country block told apart from a removal (that's a warning: it may play for the viewer). */
async function watchFacts(id: string, fetchImpl: typeof fetch): Promise<WatchPageFacts & { region?: boolean }> {
  try {
    const res = await fetchImpl(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { status: res.status === 404 ? "unavailable" : "error", start: null, end: null, length: null, live: false };
    const html = await res.text();
    const facts = parseWatchPage(html);
    const reason = /"playabilityStatus":\{"status":"[A-Z_]+","reason":"([^"]*)"/.exec(html)?.[1] ?? "";
    if (facts.status === "unavailable" && /country|region/i.test(reason)) return { ...facts, status: "error", region: true };
    return facts;
  } catch {
    return { status: "error", start: null, end: null, length: null, live: false };
  }
}

/** Read one video's facts: the Data API when there's a key, else the watch page. */
export async function readVideoFacts(id: string, fetchImpl: typeof fetch = fetch): Promise<WatchPageFacts & { region?: boolean }> {
  if (env.youtubeApiKey) {
    const f = (await fetchFromApi([id], env.youtubeApiKey, fetchImpl)).get(id);
    if (f && f.status !== "error") return f;
  }
  return watchFacts(id, fetchImpl);
}

/** Check a pasted link. `t`: a start second the contributor gave (a long video with one is a fine match link). */
export async function checkVideoLink(url: string, opts: { t?: number; fetchImpl?: typeof fetch; now?: number } = {}): Promise<LinkCheck> {
  const id = youtubeId(url.trim());
  if (!id) return { ok: false, error: LINK_TEXT.notYoutube, warnings: [] };
  const f = await readVideoFacts(id, opts.fetchImpl ?? fetch);
  const facts = { status: f.status, length: f.length, ...(f.region ? { region: true } : {}), at: new Date(opts.now ?? Date.now()).toISOString() };
  if (f.status === "unavailable") return { ok: false, error: LINK_TEXT.gone, videoId: id, warnings: [], facts };
  const warnings: LinkWarning[] = [];
  if (f.region) warnings.push("region");
  else if (f.status === "error") warnings.push("unchecked");
  if (f.length != null && f.length > LONG_VIDEO_S && !(opts.t && opts.t > 0)) warnings.push("long");
  return { ok: true, videoId: id, warnings, facts };
}

/** A YouTube channel link's address, or null when it isn't one (youtube.com/@name, /channel/UC…, /c/name, /user/name). */
export function channelUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host !== "youtube.com") return null;
  const m = /^\/(@[A-Za-z0-9._-]{3,30}|channel\/UC[A-Za-z0-9_-]{22}|c\/[^/]{1,100}|user\/[^/]{1,100})\/?/.exec(u.pathname);
  return m ? `https://www.youtube.com/${m[1]}` : null;
}

/** Does this channel exist? "unknown" when YouTube couldn't be read (the owner sees that; the form doesn't refuse it). */
export async function channelExists(url: string, fetchImpl: typeof fetch = fetch): Promise<"yes" | "no" | "unknown"> {
  try {
    const res = await fetchImpl(`${url}?hl=en`, { headers: UA, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (res.status === 404) return "no";
    if (!res.ok) return "unknown";
    const html = await res.text();
    if (/"(?:externalId|channelId)":"UC[A-Za-z0-9_-]{22}"/.test(html) || /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\//.test(html)) return "yes";
    // A page with a player-less error and no channel id: YouTube's "This page isn't available".
    return /This page isn.t available|"status":"ERROR"/.test(html) ? "no" : "unknown";
  } catch {
    return "unknown";
  }
}
