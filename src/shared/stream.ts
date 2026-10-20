// An event's live stream (the owner sets it in the owner portal; the event page's Watch live section plays
// it): YouTube only, stored as its video id and always played from youtube-nocookie.com. Shared by the
// server (validation on save) and the app (the owner form's own check, the player).

export const STREAM_HELP = "YouTube only for now: a youtube.com/watch?v=…, youtu.be/…, or youtube.com/live/… link to the stream.";

export type StreamParse = { ok: true; videoId: string; embedUrl: string } | { ok: false; error: string };

const ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(["youtube.com", "youtu.be", "youtube-nocookie.com"]);

/** The privacy-enhanced embed address for a video id. */
export const embedUrl = (videoId: string) => `https://www.youtube-nocookie.com/embed/${videoId}`;

/** Its thumbnail, for the click-to-play facade (YouTube's image host; no player script until a click). */
export const thumbnailUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

/**
 * A pasted stream link → its video id and embed address, or why it can't be used. Accepts watch?v=,
 * youtu.be/, /live/<id>, /embed/<id> and /shorts/<id> on youtube.com (www., m. and music. too) and
 * youtube-nocookie.com. A channel's live page (youtube.com/@name/live, /channel/…/live, /c/…/live) names no
 * video and the player here can't play a channel's live slot, so it's refused with what to paste instead.
 */
export function parseStreamUrl(input: string): StreamParse {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Paste a YouTube link." };
  if (raw.length > 300) return { ok: false, error: "That link is too long." };
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { ok: false, error: `That isn't a link. ${STREAM_HELP}` }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: `That isn't a web link. ${STREAM_HELP}` };
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  if (!YT_HOSTS.has(host)) return { ok: false, error: `Only YouTube streams can be shown for now. ${STREAM_HELP}` };
  const parts = u.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") id = parts[0] ?? null;
  else if (parts[0] === "watch") id = u.searchParams.get("v");
  else if (["live", "embed", "shorts"].includes(parts[0] ?? "") && parts[1]) id = parts[1];
  else if (parts.at(-1) === "live" && (parts[0]?.startsWith("@") || parts[0] === "channel" || parts[0] === "c" || parts[0] === "user")) {
    return { ok: false, error: "A channel's live page can't be shown here: it names no video. Open the stream on YouTube and paste its own link (youtube.com/watch?v=… or youtu.be/…)." };
  }
  if (!id || !ID.test(id)) return { ok: false, error: `That YouTube link doesn't name a video. ${STREAM_HELP}` };
  return { ok: true, videoId: id, embedUrl: embedUrl(id) };
}
