// The rows stored before src/shared/placeClean.ts tidied what is written (and past seasons, which no sync writes
// again): each team's school and town and each event's town, cleaned the same way, only the rows it changes. Run once
// soon after the server starts (server/index.ts), which rebuilds the search index when anything changed; a second run
// finds nothing to change. Each write holds only while the row still reads as it was read, its state and country
// included (the town is cleaned against them): a sync that wrote the row in between (already tidied) is never undone.
import { allInChunks, writeBatch } from "../db.js";
import { cleanCity, cleanSchool } from "../../src/shared/placeClean.js";

interface TeamRow { number: number; school: string | null; city: string | null; state: string | null; country: string | null }
interface EventRow { rid: number; season: number; code: string; city: string | null; state: string | null; country: string | null }

/** Rows per read, and rows cleaned between two yields. Each table read and cleaned in one go held the server's one
 *  thread 215-390 ms on a copy of the VM's data (2026-11-22), 95 s after every start, with nothing to change. */
const PART = 2_000;

/** `fn` over `rows` PART at a time, the event loop let go between: the rows it gives a value for, in order. */
async function changed<R, T>(rows: R[], fn: (r: R) => T | null): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += PART) {
    if (i) await new Promise<void>((r) => setImmediate(r));
    for (const r of rows.slice(i, i + PART)) { const x = fn(r); if (x != null) out.push(x); }
  }
  return out;
}

/** Clean the stored places; how many team and event rows changed. */
export async function tidyStoredPlaces(): Promise<{ teams: number; events: number }> {
  // In parts (db.ts allInChunks): a write between two of them is fine, as each write below holds only on the row as read.
  const teams = await changed(await allInChunks<TeamRow>("SELECT number, school, city, state, country FROM teams WHERE (school IS NOT NULL OR city IS NOT NULL) AND number > ?", [], "number", PART), (t) => {
    const x = { t, school: cleanSchool(t.school), city: cleanCity(t.city, t.state, t.country) };
    return x.school !== t.school || x.city !== t.city ? x : null;
  });
  const events = await changed(await allInChunks<EventRow>("SELECT rowid rid, season, code, city, state, country FROM events WHERE city IS NOT NULL AND rowid > ?", [], "rid", PART), (e) => {
    const x = { e, city: cleanCity(e.city, e.state, e.country) };
    return x.city !== e.city ? x : null;
  });
  const writes = [
    ...teams.map(({ t, school, city }) => ({ sql: "UPDATE teams SET school = ?, city = ? WHERE number = ? AND school IS ? AND city IS ? AND state IS ? AND country IS ?", args: [school, city, t.number, t.school, t.city, t.state, t.country] })),
    ...events.map(({ e, city }) => ({ sql: "UPDATE events SET city = ? WHERE season = ? AND code = ? AND city IS ? AND state IS ? AND country IS ?", args: [city, e.season, e.code, e.city, e.state, e.country] })),
  ];
  // writeBatch, not a bare batch: it counts as a data write, so cached reads are dropped.
  await writeBatch(writes, 500);
  return { teams: teams.length, events: events.length };
}
