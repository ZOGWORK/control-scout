// An event's detail as the event page gets it (/api/events/:season/:code), shared with that page's first paint
// (server/firstPaint.ts), so the two never differ.
import type { EventDetail, MatchView } from "../../src/shared/api.js";
import { cachedEventDetail } from "./events.js";
import { withBracketGate } from "./bracket.js";
import { scheduleGate } from "./eventGates.js";
import { eventRecording, recordingStream, withClips } from "../videos/recordings.js";

/** An event's detail with its recording (server/videos/recordings.ts: the owner's stream, else FIRST's YouTube link)
 *  and each played match's place in it, for every route that answers with one (the page and "Refresh results" alike,
 *  or a refresh would take the Watch section away). Both ride along outside the cached detail (they change without a
 *  data version); the shared objects are never changed. */
export async function withStream<T extends { event: { season: number; code: string }; matches: MatchView[] }>(d: T): Promise<T> {
  const rec = await eventRecording(d.event.season, d.event.code).catch(() => null);
  return rec ? { ...d, event: { ...d.event, stream: recordingStream(rec) }, matches: withClips(d.matches, rec) } : d;
}

/** The event page's answer (null: no such event): the cached detail, its recording, and the bracket and schedule gates. */
export async function eventView(season: number, code: string): Promise<EventDetail | null> {
  const cached = await cachedEventDetail(season, code);
  return cached ? scheduleGate(await withBracketGate(await withStream(cached))) : null;
}
