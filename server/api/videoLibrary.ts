// A signed-in person's video library (src/shared/videoLibrary.ts): Saved, Watch later and History (video_library),
// and notes taken on a video (video_notes), migration 117. Nothing here is shipped (PRIVATE_TABLES) and it all goes
// with the account (deleteUser).
//
// Lists are the person's alone. Notes are read by the writer and by their team: anyone who shares a Control Point
// workspace with them (workspace_members, Scout's copy of what Control Point says, kept fresh as people sign in;
// identities ties a Scout account to its Control Point one). Worked out on every read, so someone who leaves the team
// stops seeing its notes when Control Point next says so. Only the writer edits or deletes a note.
import { all, get, run } from "../db.js";
import { CP_PROVIDER } from "../auth/controlPoint.js";
import {
  HISTORY_CAP, LIBRARY_PAGE, LIST_CAP, NOTES_CAP, NOTES_PAGE, decodeCursor, encodeCursor,
  type LibraryCounts, type LibraryItemState, type LibraryList, type LibraryPage, type NoteAuthor, type NotesPage, type VideoNote,
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
  const notes = await get<{ n: number }>(`${MATES} SELECT COUNT(*) AS n FROM video_notes n WHERE ${READABLE}`, [userId, userId, userId]);
  const n = (l: string) => Number(rows.find((r) => r.list === l)?.n ?? 0);
  return { saved: n("saved"), later: n("later"), history: n("history"), notes: Number(notes?.n ?? 0) };
}

/** Where one video stands: the lists holding it, the notes the person can read on it (earliest moment first, notes
 *  about the whole video last), and the teams their own notes are shared with. */
export async function itemState(userId: number, key: string): Promise<LibraryItemState> {
  const lists = await all<{ list: LibraryList }>("SELECT list FROM video_library WHERE user_id = ? AND item_key = ? AND list <> 'history'", [userId, key]);
  const notes = await all<NoteRow>(`${MATES} SELECT ${NOTE_SELECT} WHERE ${READABLE} AND n.item_key = ?
    ORDER BY n.t IS NULL, n.t, n.created_at, n.id`, [userId, userId, userId, key]);
  return { lists: lists.map((r) => r.list), notes: notes.flatMap((r) => noteOf(r, userId)), teams: await teamsOf(userId) };
}

/** The Control Point workspaces (teams) a person is in, by name: whom their notes reach. */
export async function teamsOf(userId: number): Promise<string[]> {
  const rows = await all<{ name: string }>(`SELECT DISTINCT m.workspace_name AS name FROM identities i
    JOIN workspace_members m ON m.account_id = CAST(i.subject AS INTEGER)
    WHERE i.provider = ? AND i.user_id = ? ORDER BY m.workspace_name`, [CP_PROVIDER, userId]);
  return rows.map((r) => r.name || "Your team");
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

interface NoteRow { id: number; user_id: number; item_key: string; video_id: string; t: number | null; body: string; item: string; created_at: string; updated_at: string; display_name?: string | null; username?: string | null; team?: string | null }
const NOTE_COLS = "id, user_id, item_key, video_id, t, body, item, created_at, updated_at";
/** A note with its writer's name (never their email) and the team they share with the reader. */
const NOTE_SELECT = `n.id, n.user_id, n.item_key, n.video_id, n.t, n.body, n.item, n.created_at, n.updated_at, u.display_name, u.username, mt.team
  FROM video_notes n JOIN users u ON u.id = n.user_id LEFT JOIN team_mates mt ON mt.user_id = n.user_id`;
/**
 * The reader's teammates: every other account in one of their Control Point workspaces, with one team they share.
 * Takes the reader's id twice (theirs, then to leave them out); READABLE then takes it once more.
 */
const MATES = `WITH my_spaces AS (
    SELECT m.cp_workspace_id AS ws, m.workspace_name AS name FROM identities i
    JOIN workspace_members m ON m.account_id = CAST(i.subject AS INTEGER) WHERE i.provider = '${CP_PROVIDER}' AND i.user_id = ?),
  team_mates AS (
    SELECT i.user_id, MIN(s.name) AS team FROM my_spaces s
    JOIN workspace_members m ON m.cp_workspace_id = s.ws
    JOIN identities i ON i.provider = '${CP_PROVIDER}' AND CAST(i.subject AS INTEGER) = m.account_id
    WHERE i.user_id <> ? GROUP BY i.user_id)`;
/** A note the reader may read: theirs, or a teammate's. */
const READABLE = "(n.user_id = ? OR n.user_id IN (SELECT user_id FROM team_mates))";
const noteOf = (r: NoteRow, reader: number): VideoNote[] => {
  const item = parse(r.item);
  if (!item) return [];
  const mine = Number(r.user_id) === reader;
  const author: NoteAuthor = { mine, name: mine ? "You" : (r.display_name?.trim() || (r.username ? `@${r.username}` : "A teammate")), team: mine ? null : (r.team || null) };
  return [{ id: String(r.id), key: r.item_key, videoId: r.video_id, t: r.t == null ? null : Number(r.t), body: r.body, item, createdAt: r.created_at, updatedAt: r.updated_at, author }];
};

/** Every note the person can read (theirs and their team's), the latest written first, a page at a time. */
export async function listNotes(userId: number, cursor: unknown): Promise<NotesPage> {
  const c = decodeCursor(cursor);
  const cid = c && /^\d{1,15}$/.test(c.id) ? Number(c.id) : null;
  const rows = await all<NoteRow>(`${MATES} SELECT ${NOTE_SELECT} WHERE ${READABLE}${c && cid != null ? " AND (n.updated_at < ? OR (n.updated_at = ? AND n.id < ?))" : ""}
    ORDER BY n.updated_at DESC, n.id DESC LIMIT ?`, [userId, userId, userId, ...(c && cid != null ? [c.at, c.at, cid] : []), NOTES_PAGE + 1]);
  const page = rows.slice(0, NOTES_PAGE);
  const last = page[page.length - 1];
  return { notes: page.flatMap((r) => noteOf(r, userId)), next: rows.length > NOTES_PAGE && last ? encodeCursor(last.updated_at, String(last.id)) : null };
}

export class NoteLimitError extends Error {}

export async function addNote(userId: number, item: FeedItem, t: number | null, body: string, now = Date.now()): Promise<VideoNote> {
  const have = await get<{ n: number }>("SELECT COUNT(*) AS n FROM video_notes WHERE user_id = ?", [userId]);
  if (Number(have?.n ?? 0) >= NOTES_CAP) throw new NoteLimitError(`You have ${NOTES_CAP} notes: delete some to write more.`);
  const at = new Date(now).toISOString();
  const r = await get<NoteRow>(`INSERT INTO video_notes (user_id, item_key, video_id, t, body, item, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING ${NOTE_COLS}`, [userId, item.key, item.videoId, t, body, JSON.stringify(item), at, at]);
  return noteOf(r!, userId)[0];
}

/** Change a note's text (and moment); null when it isn't this person's. */
export async function editNote(userId: number, id: number, body: string, t: number | null | undefined, now = Date.now()): Promise<VideoNote | null> {
  const r = await get<NoteRow>(`UPDATE video_notes SET body = ?, ${t !== undefined ? "t = ?, " : ""}updated_at = ? WHERE id = ? AND user_id = ? RETURNING ${NOTE_COLS}`,
    [body, ...(t !== undefined ? [t] : []), new Date(now).toISOString(), id, userId]);
  return r ? noteOf(r, userId)[0] : null;
}

export async function deleteNote(userId: number, id: number): Promise<boolean> {
  const r = await get<{ id: number }>("DELETE FROM video_notes WHERE id = ? AND user_id = ? RETURNING id", [id, userId]);
  return !!r;
}
