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
  // The limit is checked by the insert itself (one statement), so overlapping adds can't pass it together.
  const r = await get<Row>(
    `INSERT INTO hero_lines (position, plain, accent, enabled, created_at, updated_at)
     SELECT COALESCE(MAX(position), -1) + 1, ?, ?, ?, ?, ? FROM hero_lines HAVING COUNT(*) < ? RETURNING *`,
    [cleanHeroPart(plain), cleanHeroPart(accent), enabled ? 1 : 0, at, at, HERO_LINES_MAX],
  );
  if (!r) throw new HeroLineError(`There can be up to ${HERO_LINES_MAX} lines.`);
  invalidateHeroLines();
  return view(r);
}

const one = (r: { rows: unknown[] }) => (r.rows[0] ? view(r.rows[0] as unknown as Row) : null);

/**
 * Change a line's words or switch it on or off: only the fields given are written, in one statement, and the
 * line as it was and as it is now are read in the same transaction, so two overlapping saves never undo each
 * other and the audit log records exactly what each one changed. Null when there's no such line.
 */
export async function updateHeroLine(id: number, change: { plain?: string; accent?: string; enabled?: boolean }, at = new Date().toISOString()): Promise<{ was: HeroLineRow; line: HeroLineRow } | null> {
  const sets: string[] = [], args: (string | number)[] = [];
  if (change.plain !== undefined) { sets.push("plain = ?"); args.push(cleanHeroPart(change.plain)); }
  if (change.accent !== undefined) { sets.push("accent = ?"); args.push(cleanHeroPart(change.accent)); }
  if (change.enabled !== undefined) { sets.push("enabled = ?"); args.push(change.enabled ? 1 : 0); }
  const read = { sql: "SELECT * FROM hero_lines WHERE id = ?", args: [id] };
  const [before, , after] = await db().batch([read, { sql: `UPDATE hero_lines SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`, args: [...args, at, id] }, read], "write");
  invalidateHeroLines();
  const was = one(before), line = one(after);
  return was && line ? { was, line } : null;
}

/** Delete a line; returns it as it was (read in the same transaction), or null when there's no such line. */
export async function deleteHeroLine(id: number): Promise<HeroLineRow | null> {
  const [before] = await db().batch([{ sql: "SELECT * FROM hero_lines WHERE id = ?", args: [id] }, { sql: "DELETE FROM hero_lines WHERE id = ?", args: [id] }], "write");
  invalidateHeroLines();
  return one(before);
}

/**
 * Put the lines in this order: `ids` must be every saved line, each once. One write batch: the order it
 * replaces is read first, and each move only lands while the saved lines are still exactly `ids` (a line added
 * or deleted meanwhile: nothing moves). Returns the order it replaced, or null.
 */
export async function reorderHeroLines(ids: number[], at = new Date().toISOString()): Promise<number[] | null> {
  if (!ids.length || new Set(ids).size !== ids.length) return null;
  const marks = ids.map(() => "?").join(",");
  const same = `(SELECT COUNT(*) FROM hero_lines) = ? AND (SELECT COUNT(*) FROM hero_lines WHERE id IN (${marks})) = ?`;
  const [before] = await db().batch([
    "SELECT id FROM hero_lines ORDER BY position, id",
    ...ids.map((id, i) => ({
      sql: `UPDATE hero_lines SET position = ?, updated_at = CASE WHEN position = ? THEN updated_at ELSE ? END WHERE id = ? AND ${same}`,
      args: [i, i, at, id, ids.length, ...ids, ids.length],
    })),
  ], "write");
  const was = before.rows.map((r) => Number(r.id));
  if (ids.length !== was.length || !ids.every((id) => was.includes(id))) return null;
  invalidateHeroLines();
  return was;
}

/** Start editing from the built-in lines: saves a copy of them, only when nothing is saved yet. One INSERT
 *  of every line, guarded on the table being empty: all of them land or none do, so a line added meanwhile
 *  means nothing is copied. */
export async function seedHeroLines(at = new Date().toISOString()): Promise<boolean> {
  const rows = DEFAULT_HERO_LINES.map(() => "(?, ?, ?, 1, ?, ?)").join(", ");
  const n = await run(
    `INSERT INTO hero_lines (position, plain, accent, enabled, created_at, updated_at)
     SELECT * FROM (VALUES ${rows}) WHERE NOT EXISTS (SELECT 1 FROM hero_lines)`,
    DEFAULT_HERO_LINES.flatMap(([a, b], i) => [i, a, b, at, at]),
  );
  if (!n) return false;
  invalidateHeroLines();
  return true;
}

/** Go back to the built-in lines: every saved line is removed (the audit log keeps what they were). */
export async function resetHeroLines(): Promise<HeroLineRow[]> {
  const [before] = await db().batch(["SELECT * FROM hero_lines ORDER BY position, id", "DELETE FROM hero_lines"], "write");
  invalidateHeroLines();
  return before.rows.map((r) => view(r as unknown as Row));
}
