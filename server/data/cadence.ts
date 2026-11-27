// The data cycle's cadence: whether it runs as its own process, whether an event is on today, and how often an event
// day syncs. Kept apart from cycle.ts and jobs.ts so each can read them without importing the other (jobs runs the
// cycle; the cycle needs the cadence), and so the answer for a remote database is in one place (childCycle).
import { env } from "../env.js";
import { all, isRemote } from "../db.js";
import { CURRENT_SEASON } from "./seasons.js";

/** The data cycle runs in a child process (DATA_CYCLE=child), which needs a local database file. A remote database
 *  (or its embedded replica) keeps the cycle in the server process. */
export function childCycle(): boolean { return process.env.DATA_CYCLE === "child" && !isRemote(env.databaseUrl); }

/** Is any event running today ±1 day? (Event days sync often, and rebuild the offline packs; other days daily.) */
export async function eventDayNow(now = new Date()): Promise<boolean> {
  const d = (n: number) => new Date(now.getTime() + n * 864e5).toISOString().slice(0, 10);
  const r = await all("SELECT 1 FROM events WHERE season = ? AND start <= ? AND COALESCE(end, start) >= ? AND type NOT IN ('Kickoff','Workshop','DemoExhibition') LIMIT 1", [CURRENT_SEASON, d(1), d(-1)]);
  return r.length > 0;
}

/** How often an event day syncs: EVENT_DAY_SYNC_MINUTES when set, else 15 minutes where the cycle runs in a child
 *  process (the VM), hourly where it runs in the server process (Render's 0.15 CPU would stall pages). */
export function eventDaySyncMinutes(): number {
  const configured = Number(process.env.EVENT_DAY_SYNC_MINUTES);
  if (Number.isFinite(configured) && configured >= 1) return configured;
  return childCycle() ? 15 : 60;
}
