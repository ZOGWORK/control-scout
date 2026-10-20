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
// - Every record is checked in full when it's read (audit V4-PRIVATE-001): its op, every team in its base order, its
//   op id, time, version and state. One that isn't well-formed (damaged storage, a bad write) is never applied and
//   never guessed at: it comes back as damaged, with only what identifies it, so the member sees it and can discard
//   that one record. It isn't dropped silently, and it doesn't hold up the account's other changes.
// - Storage missing, full or blocked: nothing is kept (the change still goes up, and lives for this page only).
// Other tabs hear of every write (BroadcastChannel), so a change one tab confirms or discards goes in all of them.
import { cleanPickOp, isPickOpId, isTeam, MAX_PICKS, type PickOp } from "../shared/picklist";

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

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const optional = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);
const teamOrNull = (v: unknown) => v === null || isTeam(v);

/** A well-formed order change (an add, remove, move or copy as the server takes one: every team a team number). */
export function isOrderOp(x: unknown): x is OrderOp {
  if (!isObj(x) || x.op === "note" || "error" in cleanPickOp(x)) return false;
  switch (x.op) {
    case "add": return optional(x.beforeTeam, teamOrNull) && optional(x.restore, (v) => typeof v === "boolean");
    case "move": return optional(x.beforeTeam, teamOrNull) && optional(x.afterTeam, isTeam);
    case "import": return Array.isArray(x.teams) && new Set(x.teams).size === x.teams.length;
    default: return x.op === "remove";
  }
}

/** An order of teams as the list holds one: team numbers, each once, at most a full list. */
const isOrder = (x: unknown): x is number[] => Array.isArray(x) && x.length <= MAX_PICKS && x.every(isTeam) && new Set(x).size === x.length;

/** A kept change read back whole and well-formed (`now`: a time far in the future is damage, not a clock a little off). */
export function isKeptPickOp(x: unknown, now = Date.now()): x is KeptPickOp {
  if (!isObj(x)) return false;
  return Number.isSafeInteger(x.account) && typeof x.space === "string" && x.space.length > 0 && Number.isSafeInteger(x.season) && (x.season as number) > 0
    && isPickOpId(x.opId) && isOrderOp(x.op)
    && typeof x.at === "number" && Number.isFinite(x.at) && x.at > 0 && x.at <= now + KEPT_OP_MAX_AGE_MS
    && isOrder(x.base) && Number.isSafeInteger(x.baseVersion) && (x.baseVersion as number) >= 0
    && (x.state === "sending" || x.state === "kept")
    && optional(x.tab, (v) => typeof v === "string") && optional(x.message, (v) => typeof v === "string") && optional(x.uncertain, (v) => typeof v === "boolean");
}

/**
 * A kept record that isn't well-formed: never applied, never sent. Only what identifies it is read from it, each
 * part only when it is what it should be (null otherwise), so nothing damaged reaches the page.
 */
export interface DamagedPickOp {
  account: number;
  /** Its key in the store (what discarding it deletes). */
  key: IDBValidKey;
  space: string | null;
  season: number | null;
  opId: string | null;
  at: number | null;
  /** Its change, when that part alone is well-formed (what to call it: "Move 104"); never sent. */
  op: OrderOp | null;
}

function damagedOf(account: number, key: IDBValidKey, x: unknown): DamagedPickOp {
  const r = isObj(x) ? x : {};
  const k = Array.isArray(key) ? key : [];
  const space = typeof k[1] === "string" && k[1] ? k[1] : null;
  const season = Number.isSafeInteger(k[2]) && (k[2] as number) > 0 ? k[2] as number : null;
  const opId = typeof k[3] === "string" ? k[3] : null;
  return { account, key, space, season, opId, at: typeof r.at === "number" && Number.isFinite(r.at) && r.at > 0 ? r.at : null, op: isOrderOp(r.op) ? r.op : null };
}

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

/** Is this key one of this account's? */
const ownKey = (account: number, key: IDBValidKey) => Array.isArray(key) && key.length === 4 && key[0] === account;

/**
 * Everything this account kept: the well-formed changes, oldest first, and the damaged records (isKeptPickOp), to
 * show and let the member discard one by one. Expired ones (a readable time over 14 days ago) are removed unread.
 * Never another account's.
 */
export async function readKeptOps(account: number, now = Date.now()): Promise<{ ops: KeptPickOp[]; damaged: DamagedPickOp[] }> {
  if (typeof IDBKeyRange === "undefined") return { ops: [], damaged: [] };
  const rows: { key: IDBValidKey; value: unknown }[] = [];
  const out = await run("readonly", (s) => {
    const req = s.openCursor(accountRange(account));
    req.onsuccess = () => { const c = req.result; if (c) { rows.push({ key: c.primaryKey, value: c.value }); c.continue(); } };
  });
  if (!out.ok) return { ops: [], damaged: [] };
  const ops: KeptPickOp[] = [];
  const damaged: DamagedPickOp[] = [];
  const expired: IDBValidKey[] = [];
  for (const { key, value } of rows) {
    if (!ownKey(account, key)) continue;
    const at = isObj(value) && typeof value.at === "number" && Number.isFinite(value.at) ? value.at : null;
    if (at != null && now - at > KEPT_OP_MAX_AGE_MS) expired.push(key);
    else if (isKeptPickOp(value, now) && value.account === account) ops.push(value);
    else damaged.push(damagedOf(account, key, value));
  }
  if (expired.length) await run("readwrite", (s) => { for (const k of expired) s.delete(k); });
  return { ops: ops.sort((a, b) => a.at - b.at), damaged: damaged.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)) };
}

/** Every well-formed change this account kept, oldest first (readKeptOps). Never another account's. */
export async function keptOps(account: number, now = Date.now()): Promise<KeptPickOp[]> {
  return (await readKeptOps(account, now)).ops;
}

/** Forget one damaged record of this account's, by its key: that one only. */
export async function deleteDamagedOp(d: { account: number; key: IDBValidKey }): Promise<boolean> {
  if (!ownKey(d.account, d.key)) return false;
  const out = await run("readwrite", (s) => s.delete(d.key));
  if (out.ok) changed(d.account);
  return out.ok;
}

/** Tests: forget everything and let go of the database. */
export async function resetKeptOps(): Promise<void> {
  await run("readwrite", (s) => s.clear());
  const db = await open();
  db?.close();
  opening = null;
}
