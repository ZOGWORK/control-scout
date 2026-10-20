// Shared pick list order changes this device made that the workspace hasn't confirmed yet, kept in IndexedDB
// so a reload (or a closed tab) doesn't lose them (audit V3: "Retain failed pick-list ordering through reload").
//
// - One record per change: an add, remove, move or copy (notes have their own drafts, picklistDrafts.ts). Keyed by
//   account, workspace, season and the change's op id, so a record is only ever read back for the account that
//   made it, and is sent (sharedPicklist.ts) to the workspace and season it was made in, with its op id: the
//   server applies one id once, however often it arrives (server/scout/picklist.ts).
// - Written when the change is made (state "sending"), updated when it doesn't go through ("kept"), removed once
//   the workspace confirms it or the member discards it.
// - With it, what the member was looking at: the list's order just before the change (base) and its version, so
//   a retry can say what changed meanwhile and ask before sending.
// - Records older than 14 days are dropped unread: a change that sat unsent that long reads wrong.
// - Storage missing, full or blocked: nothing is kept (the change still goes up, and lives for this page only).
// Other tabs hear of every write (BroadcastChannel), so a change one tab confirms or discards goes in all of them.
import type { PickOp } from "../shared/picklist";

export type OrderOp = Exclude<PickOp, { op: "note" }>;

export interface KeptPickOp {
  account: number;
  space: string;
  season: number;
  opId: string;
  op: OrderOp;
  /** When the change was made (ms). */
  at: number;
  /** The list's order (teams) the member saw just before the change: their own earlier changes on their way included. */
  base: number[];
  /** The server's list version then. */
  baseVersion: number;
  /** sending: on its way from the page that made it; kept: didn't go through (or the page closed before the answer). */
  state: "sending" | "kept";
  /** The page that made it (a "sending" record of a page still open isn't another page's to offer). */
  tab: string;
  /** Why it's kept, for the member. */
  message?: string;
  /** Sent, and the answer was lost. */
  uncertain?: boolean;
}

const DB = "control-scout-picklist";
const STORE = "ops";
/** A kept change older than this is dropped unread. */
export const KEPT_OP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Window event (this tab and, via the channel, others): kept changes were written or removed. detail: { account }. */
export const KEPT_OPS_CHANGED = "cs-picklist-ops-changed";

const newTabId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
/** This page's id (records it made while it's open are its own). */
export let TAB_ID = newTabId();
/** Tests: this page is a new one (as after a reload). */
export function newPageForTests() { TAB_ID = newTabId(); }

let opening: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: ["account", "space", "season", "opId"] });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another page upgrading (or the browser clearing site data): let go, open again next time.
        db.onversionchange = () => { db.close(); opening = null; };
        db.onclose = () => { opening = null; };
        resolve(db);
      };
      req.onerror = () => { opening = null; resolve(null); };
      req.onblocked = () => { opening = null; resolve(null); };
    } catch { opening = null; resolve(null); }
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<{ ok: boolean; value?: T }> {
  const db = await open();
  if (!db) return { ok: false };
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve({ ok: true, value: r ? r.result : undefined });
      t.onerror = () => resolve({ ok: false });
      t.onabort = () => resolve({ ok: false });
    } catch { resolve({ ok: false }); }
  });
}

let channel: BroadcastChannel | null | undefined;
function bus(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(DB);
    if (channel) channel.onmessage = (ev) => { const a = (ev.data as { account?: unknown })?.account; if (typeof a === "number") local(a); };
  } catch { channel = null; }
  return channel;
}
const local = (account: number) => { try { window.dispatchEvent(new CustomEvent(KEPT_OPS_CHANGED, { detail: { account } })); } catch { /* no window */ } };
function changed(account: number) {
  local(account);
  try { bus()?.postMessage({ account }); } catch { /* closed */ }
}
// Listen from the start, so another tab's write reaches this one even before this one writes.
if (typeof window !== "undefined") bus();

const isOrderOp = (x: unknown): x is OrderOp => {
  const o = x as OrderOp;
  return !!o && (o.op === "add" || o.op === "remove" || o.op === "move" ? Number.isSafeInteger((o as { team: number }).team) : o.op === "import" && Array.isArray(o.teams));
};
const isKept = (x: unknown): x is KeptPickOp => {
  const r = x as KeptPickOp;
  return !!r && Number.isSafeInteger(r.account) && typeof r.space === "string" && Number.isSafeInteger(r.season) && typeof r.opId === "string"
    && isOrderOp(r.op) && Number.isFinite(r.at) && Array.isArray(r.base) && Number.isSafeInteger(r.baseVersion) && (r.state === "sending" || r.state === "kept");
};

/** Keep (or update) a change. False when this device couldn't. */
export async function putKeptOp(r: KeptPickOp): Promise<boolean> {
  const out = await run("readwrite", (s) => s.put(r));
  if (out.ok) changed(r.account);
  return out.ok;
}

/** Forget a change (confirmed or discarded). */
export async function deleteKeptOp(account: number, space: string, season: number, opId: string): Promise<void> {
  const out = await run("readwrite", (s) => s.delete([account, space, season, opId]));
  if (out.ok) changed(account);
}

/** One account's range of keys: every workspace and season of it, and no other account's. */
const accountRange = (account: number) => IDBKeyRange.bound([account], [account, []]);

/** Every change this account kept, oldest first (expired or unreadable ones are removed). Never another account's. */
export async function keptOps(account: number, now = Date.now()): Promise<KeptPickOp[]> {
  if (typeof IDBKeyRange === "undefined") return [];
  const out = await run<unknown[]>("readonly", (s) => s.getAll(accountRange(account)));
  const rows = out.ok && Array.isArray(out.value) ? out.value : [];
  const good: KeptPickOp[] = [];
  const stale: unknown[] = [];
  for (const r of rows) {
    if (isKept(r) && r.account === account && now - r.at <= KEPT_OP_MAX_AGE_MS) good.push(r);
    else stale.push(r);
  }
  if (stale.length) {
    await run("readwrite", (s) => { for (const r of stale) { const k = r as KeptPickOp; try { s.delete([k.account, k.space, k.season, k.opId]); } catch { /* unreadable key */ } } });
  }
  return good.sort((a, b) => a.at - b.at);
}

/** Tests: forget everything and let go of the database. */
export async function resetKeptOps(): Promise<void> {
  await run("readwrite", (s) => s.clear());
  const db = await open();
  db?.close();
  opening = null;
}
