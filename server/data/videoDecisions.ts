// Decisions from evidence for Owner › Official videos (server/videos/videoDecisions.ts applies them at boot): only the
// videos the watcher's own rules can't decide. Everything they can (not FTC by its title, unplayable, a clip, no Scout
// event, a field's or division's stream, a broadcast or dated upload that fits one event) the watcher and the channel
// audit decide themselves each run. What is left needs the video itself: its frames (an overlay naming the event, an
// FRC field, one field of two), its description (the date of an undated upload), or knowing which Scout event a title
// means when the names differ. link: a real FTC recording of exactly that event, day and part. reject: not FTC.
// setAside: FTC, but not a day's recording Scout can play. Each entry says what the rules say on their own (rulesSay)
// and the evidence it rests on. Empty until the judgement cases of 2026-11-16 are added, once the rules that could
// decide more of them are in.
export interface VideoDecision {
  videoId: string;
  decision: "link" | "reject" | "setAside";
  /** A link's event and the venue-local day it covers; part only when the video's own title names it. */
  season?: number; code?: string; day?: string; part?: string | null;
  /** A link may take the day of a video YouTube no longer plays (deleted or private), which comes off the event. */
  replaces?: string;
  /** For reject and set aside: the specific reason, shown to the owner. */
  reason?: string;
  /** What the watcher's rules say about it on their own: why it needs a decision here. */
  rulesSay?: string;
  /** What was checked: title, description, broadcast date against the event's days, length, frames. */
  evidence: string;
}

export const VIDEO_DECISIONS: VideoDecision[] = [];
