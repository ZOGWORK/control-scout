// Match recordings — stored ONLY on this device (IndexedDB). There is no
// upload path anywhere in the app: Control Scout never hosts video.
const DB = "control-scout-media";
const STORE = "recordings";

export interface Recording {
  id: string;
  /** "season:CODE:level:series:number", or null for an unattached clip. */
  matchRef: string | null;
  label: string;
  blob: Blob;
  mime: string;
  size: number;
  durationMs: number;
  createdAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("This browser can't store recordings (no IndexedDB).")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }).createIndex("matchRef", "matchRef");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open device storage"));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
  });
}

export const CHANGED = "cs-recordings-changed";
const changed = () => window.dispatchEvent(new Event(CHANGED));

export async function saveRecording(r: Omit<Recording, "id" | "createdAt" | "size">): Promise<Recording> {
  const rec: Recording = { ...r, id: crypto.randomUUID(), createdAt: Date.now(), size: r.blob.size };
  await tx("readwrite", (s) => s.put(rec));
  changed();
  return rec;
}

export async function listRecordings(matchRef?: string): Promise<Recording[]> {
  const all = await tx<Recording[]>("readonly", (s) => s.getAll());
  return all.filter((r) => matchRef == null || r.matchRef === matchRef).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteRecording(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  changed();
}

export async function clearRecordings(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
  changed();
}

/** Best recording format this browser supports. */
export function pickMime(): string {
  const prefs = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];
  return prefs.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) ?? "";
}

export const fmtBytes = (b: number) => (b < 1e6 ? `${Math.round(b / 1e3)} KB` : b < 1e9 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e9).toFixed(2)} GB`);
