// The v8 wash the owner chose in the console (src/shared/wash.ts): one JSON value in owner_settings (migration 56)
// under the key "wash". No row: the defaults (src/index.css). Every page's HTML carries the owner's wash as an
// inline <style> (server/seo.ts), so it paints with the first frame; /api/wash is for a copy of the app without
// that first paint (development). Reads go through a short cache (WASH_TTL_MS), like the other owner settings, and
// a database that can't be read keeps the last known wash (or the defaults): a page never fails over it.
import { db, get } from "./db.js";
import { registerCache } from "./caches.js";
import { DEFAULT_WASH, parseWash, type OwnerWash, type WashResponse, type WashSettings } from "../src/shared/wash.js";

export const WASH_TTL_MS = 10_000;
const KEY = "wash";

interface Saved { wash: WashSettings; updatedAt: string; updatedBy: string }
let cached: { at: number; v: Promise<Saved | null> } | null = null;

/** The saved row, cleaned again on the way out (a row that no longer reads as a wash counts as none). */
async function load(): Promise<Saved | null> {
  const r = await get<{ value: string; updated_at: string; updated_by: string }>("SELECT value, updated_at, updated_by FROM owner_settings WHERE key = ?", [KEY]);
  if (!r) return null;
  let parsed: ReturnType<typeof parseWash>;
  try { parsed = parseWash(JSON.parse(r.value)); } catch { return null; }
  return "wash" in parsed ? { wash: parsed.wash, updatedAt: r.updated_at, updatedBy: r.updated_by } : null;
}

function saved(now = Date.now()): Promise<Saved | null> {
  if (cached && now - cached.at < WASH_TTL_MS) return cached.v;
  const last = cached?.v ?? Promise.resolve(null);
  const v = load().catch((e) => {
    console.warn(`[wash] couldn't read the owner's wash, keeping the last known one: ${(e as Error)?.message ?? e}`);
    return last.catch(() => null);
  });
  cached = { at: now, v };
  return v;
}

/** The wash in use: the owner's, else the defaults. Never rejects. */
export async function liveWash(now = Date.now()): Promise<WashResponse> {
  const s = await saved(now);
  return s ? { wash: s.wash, custom: true } : { wash: { ...DEFAULT_WASH }, custom: false };
}

/** The console's view of it. */
export async function ownerWash(now = Date.now()): Promise<OwnerWash> {
  const s = await saved(now);
  return { ...(await liveWash(now)), defaults: { ...DEFAULT_WASH }, updatedAt: s?.updatedAt ?? null, updatedBy: s?.updatedBy ?? null };
}

/** Save `wash` (already cleaned: parseWash) as the owner's. Returns the wash it replaced (null: the defaults). */
export async function setWash(wash: WashSettings, by: string, at = new Date()): Promise<WashSettings | null> {
  const [before] = await db().batch([
    { sql: "SELECT value FROM owner_settings WHERE key = ?", args: [KEY] },
    {
      sql: `INSERT INTO owner_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      args: [KEY, JSON.stringify(wash), at.toISOString(), by.slice(0, 200)],
    },
  ], "write");
  invalidateWash();
  return wasOf(before.rows[0]);
}

/** Go back to the defaults. Returns the wash it replaced (null: it was the defaults already). */
export async function resetWash(): Promise<WashSettings | null> {
  const [before] = await db().batch([
    { sql: "SELECT value FROM owner_settings WHERE key = ?", args: [KEY] },
    { sql: "DELETE FROM owner_settings WHERE key = ?", args: [KEY] },
  ], "write");
  invalidateWash();
  return wasOf(before.rows[0]);
}

function wasOf(row: unknown): WashSettings | null {
  if (!row) return null;
  try {
    const p = parseWash(JSON.parse(String((row as { value: unknown }).value)));
    return "wash" in p ? p.wash : null;
  } catch { return null; }
}

/** Drop the cache (tests, a save, and the console's "clear caches"). */
export function invalidateWash(): void { cached = null; }
registerCache("Wash", invalidateWash);
