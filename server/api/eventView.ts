// An event's detail as the event page gets it (/api/events/:season/:code), shared with that page's first paint
// (server/firstPaint.ts), so the two never differ.
import type { EventDetail, MatchView } from "../../src/shared/api.js";
import { cachedEventDetail } from "./events.js";
import { withBracketGate } from "./bracket.js";
import { scheduleGate } from "./eventGates.js";
import { hasEventHighlights } from "../eventHighlightsPage.js";
import { eventRecording, recordingStream, withClips } from "../videos/recordings.js";
import { eventHighlightVideos } from "../videos/officialVideos.js";

/** An event's detail with its recording (server/videos/recordings.ts: the owner's stream, else FIRST's YouTube link)
 *  and each played match's place in it, for every route that answers with one (the page and "Refresh results" alike,
 *  or a refresh would take the Watch section away). Both ride along outside the cached detail (they change without a
 *  data version); the shared objects are never changed. */
export async function withStream<T extends { event: { season: number; code: string; timezone?: string | null }; matches: MatchView[] }>(d: T): Promise<T> {
  const rec = await eventRecording(d.event.season, d.event.code).catch(() => null);
  return rec ? { ...d, event: { ...d.event, stream: recordingStream(rec, d.event.timezone) }, matches: withClips(d.matches, rec) } : d;
}

/** The event page's answer (null: no such event): the cached detail, its recording, and the bracket and schedule gates. */
export async function eventView(season: number, code: string): Promise<EventDetail | null> {
  const [cached, highlights, reels] = await Promise.all([cachedEventDetail(season, code), hasEventHighlights(season, code), eventHighlightVideos(season, code).catch(() => [])]);
  // Whether its highlights page exists (server/eventHighlightsPage.ts), for the page's Highlights link; and the
  // organiser's highlight videos (server/videos/officialVideos.ts), shown as highlights only, never as a match's video.
  return cached ? { ...(await scheduleGate(await withBracketGate(await withStream(cached)))), highlights, ...(reels.length ? { highlightVideos: reels } : {}) } : null;
}
