// The person's video library on the client (src/shared/videoLibrary.ts): Saved, Watch later, History and notes.
// Signed in, it's the account's (GET/PUT/DELETE /api/videos/library…, /api/videos/notes…, server/api/videoLibrary.ts),
// and a linked Control Point account gets the notes too. Signed out, it stays on this device only (localStorage,
// like recent searches), with the same caps and shapes, so the pages read one way either way.
//
// Every change bumps a version (useLibraryVersion) so the side panel's counts and an open list read again.
import { useSyncExternalStore } from "react";
import { apiFetch } from "./api";
import {
  cleanItem, HISTORY_CAP, LIBRARY_PAGE, LIST_CAP, NOTES_PAGE,
  type LibraryCounts, type LibraryEntry, type LibraryItemState, type LibraryList, type LibraryPage, type NotesPage, type VideoNote,
} from "../shared/videoLibrary";
import type { FeedItem } from "../shared/videosFeed";

export const VIDEO_LIBRARY_KEY = "cs-video-library";
/** A device keeps fewer notes than an account. */
const DEVICE_NOTES = 500;

interface Device { lists: Record<LibraryList, LibraryEntry[]>; notes: VideoNote[] }
const EMPTY = (): Device => ({ lists: { saved: [], later: [], history: [] }, notes: [] });
let memory: Device | null = null; // storage blocked: this page's own

function readDevice(): Device {
  if (memory) return memory;
  try {
    const v = JSON.parse(localStorage.getItem(VIDEO_LIBRARY_KEY) ?? "null") as Partial<Device> | null;
    const d = EMPTY();
    if (!v || typeof v !== "object") return d;
    for (const l of ["saved", "later", "history"] as const) {
      const raw = (v.lists as Record<string, unknown> | undefined)?.[l];
      if (Array.isArray(raw)) d.lists[l] = raw.flatMap((e) => { const item = cleanItem((e as LibraryEntry)?.item); return item && typeof e.at === "string" ? [{ item, at: e.at }] : []; });
    }
    if (Array.isArray(v.notes)) d.notes = v.notes.flatMap((x) => { const item = cleanItem(x?.item); return item && typeof x.id === "string" && typeof x.body === "string" ? [{ ...x, item }] : []; });
    return d;
  } catch { return EMPTY(); }
}
function writeDevice(d: Device) {
  try { localStorage.setItem(VIDEO_LIBRARY_KEY, JSON.stringify(d)); memory = null; } catch { memory = d; }
}

// --- change version ---------------------------------------------------------
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; for (const l of listeners) l(); };
/** A number that changes whenever the library does: read it to know when to read again. */
export const useLibraryVersion = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => version, () => 0);

const now = () => new Date().toISOString();
const page = <T,>(list: T[], start: number, size: number) => ({ slice: list.slice(start, start + size), next: list.length > start + size ? String(start + size) : null });

// --- lists ------------------------------------------------------------------

export async function libraryPage(signedIn: boolean, list: LibraryList, cursor: string | null): Promise<LibraryPage> {
  if (signedIn) return apiFetch<LibraryPage>(`/api/videos/library?list=${list}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  const { slice, next } = page(readDevice().lists[list], Number(cursor ?? 0) || 0, LIBRARY_PAGE);
  return { items: slice, next };
}

export async function libraryCounts(signedIn: boolean): Promise<LibraryCounts> {
  if (signedIn) return apiFetch<LibraryCounts>("/api/videos/library/counts");
  const d = readDevice();
  return { saved: d.lists.saved.length, later: d.lists.later.length, history: d.lists.history.length, notes: d.notes.length };
}

const byMoment = (a: VideoNote, b: VideoNote) => (a.t == null ? 1 : 0) - (b.t == null ? 1 : 0) || (a.t ?? 0) - (b.t ?? 0) || a.createdAt.localeCompare(b.createdAt);

export async function itemState(signedIn: boolean, key: string): Promise<LibraryItemState> {
  if (signedIn) return apiFetch<LibraryItemState>(`/api/videos/library/item?key=${encodeURIComponent(key)}`);
  const d = readDevice();
  return { lists: (["saved", "later"] as const).filter((l) => d.lists[l].some((e) => e.item.key === key)), notes: d.notes.filter((x) => x.key === key).sort(byMoment) };
}

/** Put a video on a list or take it off. */
export async function setInList(signedIn: boolean, list: LibraryList, item: FeedItem, on: boolean): Promise<void> {
  const clean = cleanItem(item);
  if (!clean) return;
  if (signedIn) {
    await apiFetch(on ? `/api/videos/library/${list}` : `/api/videos/library/${list}/${encodeURIComponent(clean.key)}`, on ? { method: "PUT", json: { item: clean } } : { method: "DELETE" });
  } else {
    const d = readDevice();
    const rest = d.lists[list].filter((e) => e.item.key !== clean.key);
    d.lists[list] = on ? [{ item: clean, at: now() }, ...rest].slice(0, list === "history" ? HISTORY_CAP : LIST_CAP) : rest;
    writeDevice(d);
  }
  bump();
}

export async function clearList(signedIn: boolean, list: LibraryList): Promise<void> {
  if (signedIn) await apiFetch(`/api/videos/library/${list}`, { method: "DELETE" });
  else { const d = readDevice(); d.lists[list] = []; writeDevice(d); }
  bump();
}

// --- notes ------------------------------------------------------------------

export async function notesPage(signedIn: boolean, cursor: string | null): Promise<NotesPage> {
  if (signedIn) return apiFetch<NotesPage>(`/api/videos/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  const list = [...readDevice().notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const { slice, next } = page(list, Number(cursor ?? 0) || 0, NOTES_PAGE);
  return { notes: slice, next };
}

export async function addNote(signedIn: boolean, item: FeedItem, t: number | null, body: string): Promise<VideoNote> {
  const clean = cleanItem(item);
  if (!clean) throw new Error("This video can't take notes");
  let note: VideoNote;
  if (signedIn) note = (await apiFetch<{ note: VideoNote }>("/api/videos/notes", { method: "POST", json: { item: clean, t, body } })).note;
  else {
    const d = readDevice();
    if (d.notes.length >= DEVICE_NOTES) throw new Error(`This device keeps ${DEVICE_NOTES} notes: sign in to keep more.`);
    const at = now();
    note = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, key: clean.key, videoId: clean.videoId, t, body, item: clean, createdAt: at, updatedAt: at };
    d.notes.push(note);
    writeDevice(d);
  }
  bump();
  return note;
}

export async function editNote(signedIn: boolean, id: string, body: string): Promise<VideoNote | null> {
  let note: VideoNote | null = null;
  if (signedIn) note = (await apiFetch<{ note: VideoNote }>(`/api/videos/notes/${encodeURIComponent(id)}`, { method: "PATCH", json: { body } })).note;
  else {
    const d = readDevice();
    const x = d.notes.find((n) => n.id === id);
    if (x) { x.body = body; x.updatedAt = now(); note = x; writeDevice(d); }
  }
  bump();
  return note;
}

export async function deleteNote(signedIn: boolean, id: string): Promise<void> {
  if (signedIn) await apiFetch(`/api/videos/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  else { const d = readDevice(); d.notes = d.notes.filter((n) => n.id !== id); writeDevice(d); }
  bump();
}
