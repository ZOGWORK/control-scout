// The home page's hero lines, as the owner sets them in the console (Rankings & content): table
// hero_lines (migration 55), in order, each on or off. The home page rotates through the lines that are
// on, one an hour by the clock (src/shared/boot.ts homeHeadlineAt), the same line for everyone. With no
// saved line switched on, or the database out of reach, it shows the built-in lines (DEFAULT_HERO_LINES).
//
// Read on every page's first paint (server/seo.ts renderPage), so the lines in use are kept in memory for
// HERO_TTL_MS and dropped at once when the owner changes them on this server.
import { all, db, get, run } from "./db.js";
import { registerCache } from "./caches.js";
import { DEFAULT_HERO_LINES, HERO_LINES_MAX, cleanHeroPart, type HeroLine, type HeroLineRow, type HeroLinesResponse } from "../src/shared/heroLines.js";

export const HERO_TTL_MS = 30_000;

interface Row { id: number; position: number; plain: string; accent: string; enabled: number; updated_at: string }
const view = (r: Row): HeroLineRow => ({ id: Number(r.id), position: Number(r.position), plain: r.plain, accent: r.accent, enabled: !!Number(r.enabled), updatedAt: r.updated_at });

let cache: { at: number; v: Promise<HeroLinesResponse> } | null = null;

/** Forget the lines in memory (after a change, and from the owner's "clear caches"). */
export function invalidateHeroLines(): void { cache = null; }
registerCache("Hero lines", invalidateHeroLines);

const DEFAULTS: HeroLinesResponse = { lines: DEFAULT_HERO_LINES.map(([a, b]) => [a, b] as HeroLine), custom: false };

/** The lines the home page shows now: the saved lines that are on, in order, else the built-in ones. Never throws. */
export function liveHeroLines(now = Date.now()): Promise<HeroLinesResponse> {
  if (cache && now - cache.at < HERO_TTL_MS) return cache.v;
  const v = all<Row>("SELECT * FROM hero_lines WHERE enabled = 1 ORDER BY position, id")
    .then((rows): HeroLinesResponse => (rows.length ? { lines: rows.map((r) => [r.plain, r.accent] as HeroLine), custom: true } : DEFAULTS))
    .catch(() => {
      // Unreachable (or not migrated yet): the built-in lines, and ask again soon rather than keep the failure.
      if (cache?.v === v) cache = null;
      return DEFAULTS;
    });
  cache = { at: now, v };
  return v;
}

/** Every saved line, on or off, in order. */
export async function listHeroLines(): Promise<HeroLineRow[]> {
  return (await all<Row>("SELECT * FROM hero_lines ORDER BY position, id")).map(view);
}

export async function heroLine(id: number): Promise<HeroLineRow | null> {
  const r = await get<Row>("SELECT * FROM hero_lines WHERE id = ?", [id]);
  return r ? view(r) : null;
}

export class HeroLineError extends Error {}

/** Add a line at the end. */
export async function addHeroLine(plain: string, accent: string, enabled = true, at = new Date().toISOString()): Promise<HeroLineRow> {
  const n = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM hero_lines"))!.n);
  if (n >= HERO_LINES_MAX) throw new HeroLineError(`There can be up to ${HERO_LINES_MAX} lines.`);
  const r = await get<Row>(
    "INSERT INTO hero_lines (position, plain, accent, enabled, created_at, updated_at) VALUES ((SELECT COALESCE(MAX(position), -1) + 1 FROM hero_lines), ?, ?, ?, ?, ?) RETURNING *",
    [cleanHeroPart(plain), cleanHeroPart(accent), enabled ? 1 : 0, at, at],
  );
  invalidateHeroLines();
  return view(r!);
}

/** Change a line's words or switch it on or off; null when there's no such line. */
export async function updateHeroLine(id: number, change: { plain?: string; accent?: string; enabled?: boolean }, at = new Date().toISOString()): Promise<HeroLineRow | null> {
  const was = await heroLine(id);
  if (!was) return null;
  const plain = change.plain !== undefined ? cleanHeroPart(change.plain) : was.plain;
  const accent = change.accent !== undefined ? cleanHeroPart(change.accent) : was.accent;
  const enabled = change.enabled ?? was.enabled;
  await run("UPDATE hero_lines SET plain = ?, accent = ?, enabled = ?, updated_at = ? WHERE id = ?", [plain, accent, enabled ? 1 : 0, at, id]);
  invalidateHeroLines();
  return heroLine(id);
}

export async function deleteHeroLine(id: number): Promise<boolean> {
  const n = await run("DELETE FROM hero_lines WHERE id = ?", [id]);
  invalidateHeroLines();
  return n > 0;
}

/** Put the lines in this order: `ids` must be every saved line, each once. In one transaction. */
export async function reorderHeroLines(ids: number[], at = new Date().toISOString()): Promise<boolean> {
  const have = (await all<{ id: number }>("SELECT id FROM hero_lines")).map((r) => Number(r.id));
  if (ids.length !== have.length || new Set(ids).size !== ids.length || !ids.every((id) => have.includes(id))) return false;
  await db().batch(ids.map((id, i) => ({ sql: "UPDATE hero_lines SET position = ?, updated_at = CASE WHEN position = ? THEN updated_at ELSE ? END WHERE id = ?", args: [i, i, at, id] })), "write");
  invalidateHeroLines();
  return true;
}

/** Start editing from the built-in lines: saves a copy of them (only when nothing is saved yet). */
export async function seedHeroLines(at = new Date().toISOString()): Promise<boolean> {
  const n = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM hero_lines"))!.n);
  if (n > 0) return false;
  await db().batch(DEFAULT_HERO_LINES.map(([a, b], i) => ({
    sql: "INSERT INTO hero_lines (position, plain, accent, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", args: [i, a, b, at, at],
  })), "write");
  invalidateHeroLines();
  return true;
}

/** Go back to the built-in lines: every saved line is removed (the audit log keeps what they were). */
export async function resetHeroLines(): Promise<number> {
  const n = await run("DELETE FROM hero_lines");
  invalidateHeroLines();
  return n;
}
