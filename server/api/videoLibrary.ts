// A signed-in person's video library (src/shared/videoLibrary.ts): Saved, Watch later and History (video_library),
// and notes taken on a video (video_notes), migration 117. Only the person reads or writes their own rows; nothing
// here is shipped (PRIVATE_TABLES) and it all goes with the account (deleteUser).
//
// A note is also handed to the person's Control Point account when theirs is linked (auth/controlPoint.ts
// pushVideoNote), best effort and after the answer: Scout keeps the note either way, so a solo account loses
// nothing when Control Point is away or doesn't take notes yet.
import { all, get, run } from "../db.js";
import { controlPointEnabled, linkedAccountId, logFailure, pushVideoNote, deleteVideoNoteAt } from "../auth/controlPoint.js";
import {
  HISTORY_CAP, LIBRARY_PAGE, LIST_CAP, NOTES_CAP, NOTES_PAGE, decodeCursor, encodeCursor,
  type LibraryCounts, type LibraryItemState, type LibraryList, type LibraryPage, type NotesPage, type VideoNote,
} from "../../src/shared/videoLibrary.js";
import type { FeedItem } from "../../src/shared/videosFeed.js";

const parse = (s: string): FeedItem | null => { try { return JSON.parse(s) as FeedItem; } catch { return null; } };

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** One list, newest first, a page at a time (keyset on when it was added, then its key). */
export async function listLibrary(userId: number, list: LibraryList, cursor: unknown): Promise<LibraryPage> {
  const c = decodeCursor(cursor);
  const rows = await all<{ item_key: string; item: string; at: string }>(
    `SELECT item_key, item, at FROM video_library WHERE user_id = ? AND list = ?${c ? " AND (at < ? OR (at = ? AND item_key < ?))" : ""}
     ORDER BY at DESC, item_key DESC LIMIT ?`,
    [userId, list, ...(c ? [c.at, c.at, c.id] : []), LIBRARY_PAGE + 1]);
  const page = rows.slice(0, LIBRARY_PAGE);
  const items = page.flatMap((r) => { const item = parse(r.item); return item ? [{ item, at: r.at }] : []; });
  const last = page[page.length - 1];
  return { items, next: rows.length > LIBRARY_PAGE && last ? encodeCursor(last.at, last.item_key) : null };
}

/** Put a video on a list (again: it moves to the top), keeping each list within its cap. */
export async function putLibrary(userId: number, list: LibraryList, item: FeedItem, now = Date.now()): Promise<void> {
  await run(`INSERT INTO video_library (user_id, list, item_key, item, at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, list, item_key) DO UPDATE SET item = excluded.item, at = excluded.at`,
  [userId, list, item.key, JSON.stringify(item), new Date(now).toISOString()]);
  const cap = list === "history" ? HISTORY_CAP : LIST_CAP;
  await run(`DELETE FROM video_library WHERE user_id = ? AND list = ? AND item_key NOT IN
    (SELECT item_key FROM video_library WHERE user_id = ? AND list = ? ORDER BY at DESC, item_key DESC LIMIT ?)`, [userId, list, userId, list, cap]);
}

export async function removeLibrary(userId: number, list: LibraryList, key: string): Promise<void> {
  await run("DELETE FROM video_library WHERE user_id = ? AND list = ? AND item_key = ?", [userId, list, key]);
}

/** Empty a whole list ("Clear history"). */
export async function clearLibrary(userId: number, list: LibraryList): Promise<void> {
  await run("DELETE FROM video_library WHERE user_id = ? AND list = ?", [userId, list]);
}

export async function libraryCounts(userId: number): Promise<LibraryCounts> {
  const rows = await all<{ list: string; n: number }>("SELECT list, COUNT(*) AS n FROM video_library WHERE user_id = ? GROUP BY list", [userId]);
  const notes = await get<{ n: number }>("SELECT COUNT(*) AS n FROM video_notes WHERE user_id = ?", [userId]);
  const n = (l: string) => Number(rows.find((r) => r.list === l)?.n ?? 0);
  return { saved: n("saved"), later: n("later"), history: n("history"), notes: Number(notes?.n ?? 0) };
}

/** Where one video stands: the lists holding it and its notes, earliest moment first (whole-video notes last). */
export async function itemState(userId: number, key: string): Promise<LibraryItemState> {
  const lists = await all<{ list: LibraryList }>("SELECT list FROM video_library WHERE user_id = ? AND item_key = ? AND list <> 'history'", [userId, key]);
  const notes = await all<NoteRow>(`SELECT ${NOTE_COLS} FROM video_notes WHERE user_id = ? AND item_key = ?
    ORDER BY t IS NULL, t, created_at, id`, [userId, key]);
  return { lists: lists.map((r) => r.list), notes: notes.flatMap(noteOf) };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

interface NoteRow { id: number; item_key: string; video_id: string; t: number | null; body: string; item: string; created_at: string; updated_at: string }
const NOTE_COLS = "id, item_key, video_id, t, body, item, created_at, updated_at";
const noteOf = (r: NoteRow): VideoNote[] => {
  const item = parse(r.item);
  return item ? [{ id: String(r.id), key: r.item_key, videoId: r.video_id, t: r.t == null ? null : Number(r.t), body: r.body, item, createdAt: r.created_at, updatedAt: r.updated_at }] : [];
};

/** Every note, the latest written first, a page at a time. */
export async function listNotes(userId: number, cursor: unknown): Promise<NotesPage> {
  const c = decodeCursor(cursor);
  const cid = c && /^\d{1,15}$/.test(c.id) ? Number(c.id) : null;
  const rows = await all<NoteRow>(`SELECT ${NOTE_COLS} FROM video_notes WHERE user_id = ?${c && cid != null ? " AND (updated_at < ? OR (updated_at = ? AND id < ?))" : ""}
    ORDER BY updated_at DESC, id DESC LIMIT ?`, [userId, ...(c && cid != null ? [c.at, c.at, cid] : []), NOTES_PAGE + 1]);
  const page = rows.slice(0, NOTES_PAGE);
  const last = page[page.length - 1];
  return { notes: page.flatMap(noteOf), next: rows.length > NOTES_PAGE && last ? encodeCursor(last.updated_at, String(last.id)) : null };
}

export class NoteLimitError extends Error {}

export async function addNote(userId: number, item: FeedItem, t: number | null, body: string, now = Date.now()): Promise<VideoNote> {
  const have = await get<{ n: number }>("SELECT COUNT(*) AS n FROM video_notes WHERE user_id = ?", [userId]);
  if (Number(have?.n ?? 0) >= NOTES_CAP) throw new NoteLimitError(`You have ${NOTES_CAP} notes: delete some to write more.`);
  const at = new Date(now).toISOString();
  const r = await get<NoteRow>(`INSERT INTO video_notes (user_id, item_key, video_id, t, body, item, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING ${NOTE_COLS}`, [userId, item.key, item.videoId, t, body, JSON.stringify(item), at, at]);
  const note = noteOf(r!)[0];
  mirror(userId, note);
  return note;
}

/** Change a note's text (and moment); null when it isn't this person's. */
export async function editNote(userId: number, id: number, body: string, t: number | null | undefined, now = Date.now()): Promise<VideoNote | null> {
  const r = await get<NoteRow>(`UPDATE video_notes SET body = ?, ${t !== undefined ? "t = ?, " : ""}updated_at = ? WHERE id = ? AND user_id = ? RETURNING ${NOTE_COLS}`,
    [body, ...(t !== undefined ? [t] : []), new Date(now).toISOString(), id, userId]);
  if (!r) return null;
  const note = noteOf(r)[0];
  mirror(userId, note);
  return note;
}

export async function deleteNote(userId: number, id: number): Promise<boolean> {
  const r = await get<{ id: number }>("DELETE FROM video_notes WHERE id = ? AND user_id = ? RETURNING id", [id, userId]);
  if (r) mirrorDelete(userId, id);
  return !!r;
}

// ---------------------------------------------------------------------------
// Control Point: the note on the person's shared account too (best effort, after the answer)
// ---------------------------------------------------------------------------

/** The note as Control Point keeps it: Scout's id, the video, the moment, the text and where to watch it. */
export const cpNote = (n: VideoNote) => ({
  scoutId: n.id, videoId: n.videoId, key: n.key, t: n.t, body: n.body, title: n.item.title,
  watch: `/watch/${n.videoId}${n.t != null ? `?t=${n.t}` : ""}`, createdAt: n.createdAt, updatedAt: n.updatedAt,
});

let pending: Promise<unknown> = Promise.resolve();
/** Tests wait for the hand-off to Control Point; the app never does. */
export const cpSettled = () => pending;

function mirror(userId: number, note: VideoNote) {
  if (!controlPointEnabled()) return;
  pending = (async () => {
    const acc = await linkedAccountId(userId);
    if (acc != null) await pushVideoNote(acc, cpNote(note));
  })().catch((e) => { if ((e as { status?: number })?.status !== 404) logFailure("video note", e); });
}

function mirrorDelete(userId: number, id: number) {
  if (!controlPointEnabled()) return;
  pending = (async () => {
    const acc = await linkedAccountId(userId);
    if (acc != null) await deleteVideoNoteAt(acc, String(id));
  })().catch((e) => { if ((e as { status?: number })?.status !== 404) logFailure("video note delete", e); });
}
