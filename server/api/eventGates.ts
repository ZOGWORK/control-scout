// The owner's switches that leave figures out of an event's detail, shared by every answer built from it: the event
// page (server/app.ts) and event-day bundles (server/packs/bundle.ts), so a bundle never carries what the page hides.
import { isEnabled } from "../flags.js";
import { withBracketGate } from "./bracket.js";
import type { EventDetail } from "../../src/shared/api.js";

/** The owner's scheduleDifficulty toggle off: the event answer leaves the figures out (a copy; the cached detail is shared). */
export const scheduleGate = async <T extends { scheduleDifficulty?: unknown }>(d: T): Promise<T> => {
  if (await isEnabled("scheduleDifficulty")) return d;
  const { scheduleDifficulty: _off, ...rest } = d;
  return rest as T;
};

/** The event detail as the public event endpoint answers it, owner switches applied (the recording aside). */
export const gatedEventDetail = async (d: EventDetail): Promise<EventDetail> => scheduleGate(await withBracketGate(d));
