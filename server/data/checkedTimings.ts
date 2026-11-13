// Recordings whose timing was checked by eye: a video shorter than its broadcast (YouTube's start to end) can't say on
// its own where the missing time went, so its matches get no clip (timingTrusted, src/shared/recording.ts). For a video
// listed here, frames were looked at, at the second each match's clock gives (from the broadcast's start), and showed that
// match beginning: the video holds the broadcast from its start, and the missing time is after the last match checked.
// `confirmedTo` (seconds from the broadcast's start, as the chapters' own confirmedTo) is the last match seen there, so
// no clip is given past what was seen. `seen` keeps what each frame showed.
export interface CheckedTiming { videoId: string; confirmedTo: number; seen: string[] }

export const CHECKED_TIMINGS: CheckedTiming[] = [
  {
    // Multinational Tech Invitational 2026 (USCHSLAOS, DECODE), Sunday, FUN Robotics Network. YouTube: 11:55:24 to
    // 03:15:59 UTC, 34,990 s long, 5.6 hours short; the stream ran on long after the last match. Checked 2026-11-13.
    videoId: "W6ywzjs-MUM",
    confirmedTo: 32_828,
    seen: [
      "401 s: Qualification 49 of 88 (30579 30030 v 5477 24064) starting, the day's first",
      "24,438 s: Playoff Match 5 (20265 14270 v 19066 23641) starting",
      "32,828 s: Playoff Match 14 Tiebreaker (30030 12808 v 20265 14270) starting, the day's last",
    ],
  },
];

const byId = new Map(CHECKED_TIMINGS.map((c) => [c.videoId, c]));

/** How far a video's timing was checked by eye (seconds from its broadcast's start), or null when it wasn't. */
export const checkedTo = (videoId: string): number | null => byId.get(videoId)?.confirmedTo ?? null;
