// An event's detail as the event page gets it (/api/events/:season/:code), shared with that page's first paint
// (server/firstPaint.ts), so the two never differ.
import type { EventDetail, MatchView } from "../../src/shared/api.js";
import { cachedEventDetail } from "./events.js";
import { withBracketGate } from "./bracket.js";
import { scheduleGate } from "./eventGates.js";
import { hasEventHighlights } from "../eventHighlightsPage.js";
import { eventRecording, recordingStream, seasonRecordings, withClips } from "../videos/recordings.js";
import { eventHighlightVideos } from "../videos/officialVideos.js";

/** An event's detail with its recording (server/videos/recordings.ts: the owner's stream, else FIRST's YouTube link)
 *  and each played match's place in it, for every route that answers with one (the page and "Refresh results" alike,
 *  or a refresh would take the Watch section away). Both ride along outside the cached detail (they change without a
 *  data version); the shared objects are never changed. */
export async function withStream<T extends { event: { season: number; code: string; timezone?: string | null }; matches: MatchView[] }>(d: T): Promise<T> {
  const rec = await eventRecording(d.event.season, d.event.code).catch(() => null);
  if (rec) return { ...d, event: { ...d.event, stream: recordingStream(rec, d.event.timezone) }, matches: withClips(d.matches, rec) };
  // Linked, but YouTube won't play it (private, removed): the page still says why its matches have no clip (RecordingGaps).
  const gone = (await seasonRecordings(d.event.season, true).catch(() => null))?.get(d.event.code);
  return gone ? { ...d, event: { ...d.event, recordingUnavailable: [gone, ...(gone.more ?? [])].map((v) => v.videoId) } } : d;
}

/** What the event page shows beside the detail, for every route that answers with one (the page and "Refresh
 *  results" alike, or a refresh would take them away): whether its highlights page exists (server/eventHighlightsPage.ts),
 *  for the Highlights link; and the organiser's highlight videos (server/videos/officialVideos.ts), shown as highlights
 *  only, never as a match's video. */
export async function withPageExtras<T extends { event: { season: number; code: string } }>(d: T): Promise<T & { highlights: boolean; highlightVideos?: { videoId: string; title: string }[] }> {
  const [highlights, reels] = await Promise.all([hasEventHighlights(d.event.season, d.event.code), eventHighlightVideos(d.event.season, d.event.code).catch(() => [])]);
  return { ...d, highlights, ...(reels.length ? { highlightVideos: reels } : {}) };
}

/** The event page's answer (null: no such event): the cached detail, its recording, the bracket and schedule gates, and its extras. */
export async function eventView(season: number, code: string): Promise<EventDetail | null> {
  const cached = await cachedEventDetail(season, code);
  return cached ? withPageExtras(await scheduleGate(await withBracketGate(await withStream(cached)))) : null;
}
