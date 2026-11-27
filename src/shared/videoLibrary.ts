// A person's own video library (the Videos tab's side panel, pages/VideosPage.tsx): videos saved, the Watch later
// queue, what they watched (History), and notes taken on a video at a moment in it (instead of comments: only the
// person sees them). A signed-in account keeps them on the server (server/api/videoLibrary.ts, migration 117), and a
// linked Control Point account gets each note too; a signed-out device keeps its own (lib/videoLibrary.ts).
//
// An entry carries a copy of the feed card it was saved from (FeedItem), checked here, so a list draws its cards
// without reading every video again. The same check runs on the server and on the device.
import { FEED_KEY, type FeedItem, type FeedKind, type FeedSource } from "./videosFeed";

export const LIBRARY_LISTS = ["saved", "later", "history"] as const;
export type LibraryList = (typeof LIBRARY_LISTS)[number];
export const isLibraryList = (s: unknown): s is LibraryList => LIBRARY_LISTS.includes(s as LibraryList);

/** The library's pages: the feed (home), its lists and the notes. */
export const LIBRARY_VIEWS = ["home", "later", "saved", "history", "notes"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];
export const LIBRARY_LABEL: Record<LibraryView, string> = { home: "Home", later: "Watch later", saved: "Saved", history: "History", notes: "Notes" };
/** The page of each view: /videos, /videos/later … */
export const libraryPath = (v: LibraryView) => (v === "home" ? "/videos" : `/videos/${v}`);
export const libraryViewOf = (path: string): LibraryView => {
  const m = /^\/videos\/(later|saved|history|notes)\/?$/i.exec(path);
  return m ? (m[1].toLowerCase() as LibraryView) : "home";
};

/** History keeps the newest this many; the other lists and notes a generous cap each. */
export const HISTORY_CAP = 500;
export const LIST_CAP = 2000;
export const NOTES_CAP = 5000;
export const NOTE_MAX = 2000;
export const LIBRARY_PAGE = 24;
export const NOTES_PAGE = 60;

export interface LibraryEntry { item: FeedItem; at: string }
export interface LibraryPage { items: LibraryEntry[]; next: string | null }

/** A note: its text, and the second of the video it was taken at (null: about the whole video). */
export interface VideoNote { id: string; key: string; videoId: string; t: number | null; body: string; item: FeedItem; createdAt: string; updatedAt: string }
export interface NotesPage { notes: VideoNote[]; next: string | null }

/** One video's place in the library: which lists hold it, and its notes (oldest moment first). */
export interface LibraryItemState { lists: LibraryList[]; notes: VideoNote[] }

/** The library's counts for the side panel. */
export interface LibraryCounts { saved: number; later: number; history: number; notes: number }

const KINDS: readonly FeedKind[] = ["match", "recording", "stream", "contributor", "creator"];
const SOURCES: readonly FeedSource[] = ["team", "weekend", "creator", "behindTheBot", "record", "close", "upset", "popular", "recent"];
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_IMAGE = /^https:\/\/i\.ytimg\.com\/[A-Za-z0-9_./-]{1,200}$/;
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const nat = (v: unknown, max = 86_400 * 30) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : undefined);
const iso = (v: unknown) => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
/** A path in this app ("/matches/…", "/events/…"): never another site, never a script. */
const appPath = (v: unknown, max = 200) => (typeof v === "string" && v.length <= max && /^\/(?![/\\])[A-Za-z0-9/_.~%?=&:+-]*$/.test(v) ? v : undefined);

/** A feed card as sent to be kept, checked and trimmed to what a card draws; null when it isn't one. */
export function cleanItem(raw: unknown): FeedItem | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (typeof o.key !== "string" || !FEED_KEY.test(o.key)) return null;
  if (typeof o.videoId !== "string" || !VIDEO_ID.test(o.videoId)) return null;
  const title = str(o.title, 300);
  if (!title) return null;
  const kind = KINDS.includes(o.kind as FeedKind) ? (o.kind as FeedKind) : "creator";
  const item: FeedItem = {
    key: o.key, kind, source: SOURCES.includes(o.source as FeedSource) ? (o.source as FeedSource) : "recent",
    videoId: o.videoId, t: nat(o.t) ?? 0, title,
    thumb: typeof o.thumb === "string" && YT_IMAGE.test(o.thumb) ? o.thumb : `https://i.ytimg.com/vi/${o.videoId}/hqdefault.jpg`,
    teams: Array.isArray(o.teams) ? o.teams.filter((n): n is number => Number.isInteger(n) && n > 0 && n <= 999_999).slice(0, 12) : [],
    published: iso(o.published), reason: "",
  };
  const end = nat(o.end);
  if (end != null && end > item.t) item.end = end;
  const match = str(o.match, 12);
  if (match) item.match = match;
  if (o.youtubeOnly === true) item.youtubeOnly = true;
  const href = appPath(o.href);
  if (href) item.href = href;
  const ch = str(o.channel, 80);
  if (ch) item.channel = ch;
  if (typeof o.series === "string" && /^[a-z0-9-]{1,40}$/.test(o.series)) item.series = o.series;
  const duration = nat(o.duration);
  if (duration) item.duration = duration;
  const ev = o.event as Record<string, unknown> | undefined;
  if (ev && typeof ev === "object") {
    const name = str(ev.name, 120), evHref = appPath(ev.href), code = typeof ev.code === "string" && /^[A-Za-z0-9]{1,20}$/.test(ev.code) ? ev.code : undefined;
    if (name && evHref && code && Number.isInteger(ev.season)) item.event = { season: ev.season as number, code, name, href: evHref };
  }
  const st = o.still as Record<string, unknown> | undefined;
  if (st && typeof st === "object" && typeof st.src === "string" && YT_IMAGE.test(st.src)) {
    const [col, row, cols, rows] = [nat(st.col, 100), nat(st.row, 100), nat(st.cols, 100), nat(st.rows, 100)];
    if (col != null && row != null && cols && rows) item.still = { src: st.src, col, row, cols, rows };
  }
  return item;
}

/** A note's text as typed: trimmed, at most NOTE_MAX characters; null when empty. */
export const cleanNoteBody = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\r\n?/g, "\n").trim();
  return s ? s.slice(0, NOTE_MAX) : null;
};
/** A note's moment: a whole second into the video, or null for the whole video. */
export const cleanNoteTime = (v: unknown): number | null | undefined => (v === null ? null : nat(v));

/** A key and a moment as a cursor ("2026-11-26T…~c:abc"), and back. */
export const encodeCursor = (at: string, id: string) => `${at}~${id}`;
export const decodeCursor = (c: unknown): { at: string; id: string } | null => {
  if (typeof c !== "string" || c.length > 200) return null;
  const i = c.indexOf("~");
  if (i < 1) return null;
  const at = c.slice(0, i), id = c.slice(i + 1);
  return iso(at) && id ? { at, id } : null;
};

/** "3:12", "1:02:05": a note's moment as shown. */
export const noteTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
