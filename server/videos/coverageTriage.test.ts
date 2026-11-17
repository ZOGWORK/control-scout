// Clip coverage triage on the live missing lists the owner brief names (Owner › Clip coverage, 2026-11-14, its 2026-11-15
// addendum §7, and the zero-error brief's journey 5): the stream is the truth, the clock isn't. A match left out by the
// clock alone (an early start, a time before the broadcast) is a pending check, "Not yet checked against the video",
// until its video's frames are read; To review holds only matches checked against the video, each saying what the video
// showed; Early start / unsafe only once the frames show it starting inside the match before.
import { describe, expect, it } from "vitest";
import type { CoverageMatch, CoverageReason, CoverageVideoCheck } from "../../src/shared/api";
import { baseTriage, seasonTriage, triageCoverage } from "./coverageTriage";
import { WHY } from "./coverage";

const CURRENT = 2026;
const many = (reason: CoverageReason, n: number, video?: CoverageVideoCheck, from = 1): Pick<CoverageMatch, "reason" | "label" | "video">[] =>
  Array.from({ length: n }, (_, i) => ({ reason, label: `Q${from + i}`, ...(video ? { video } : {}) }));
const UNREAD: CoverageVideoCheck = { checked: null };
const EARLY: CoverageVideoCheck = { checked: "2026-11-14", earlyStart: { t: 1200, previousEnds: 1290 } };

describe("clip coverage triage", () => {
  it("an early start by the clock alone is a pending video check, never Early start or To review: Flagstaff 2026 USAZFLQ (no frame read yet)", () => {
    // Q3, Q5–Q6, Q8–Q9, Q13, Q15, Q19–Q20, M2, M4: "An early start would open on the match before (up to 5 min early)".
    const t = triageCoverage(2026, many("overlaps-previous", 11, UNREAD), CURRENT);
    expect(t).toEqual({ triage: "unchecked", why: "11 matches not yet checked against the video (Q1, Q2, Q3, Q4, Q5, 6 more)" });
    expect(t.why).not.toMatch(/early/i);
  });

  it("Early start / unsafe only once the video's frames show each starting inside the match before", () => {
    const t = triageCoverage(2026, many("overlaps-previous", 11, EARLY), CURRENT);
    expect(t).toEqual({ triage: "early-start", why: "11 matches checked in the video: each starts while the match before is still on, so a clip would open on the wrong match (Q1, Q2, Q3, Q4, Q5, 6 more)" });
    // One the frames haven't read yet keeps it a pending check.
    expect(triageCoverage(2026, [...many("overlaps-previous", 10, EARLY), ...many("overlaps-previous", 1, UNREAD, 11)], CURRENT))
      .toEqual({ triage: "unchecked", why: "1 match not yet checked against the video (Q11) (10 more held back for other reasons)" });
  });

  it("a match its recording's first or last frames prove isn't in it is settled, not the owner's (USTXSASQ 2025)", () => {
    // The recording ends on Q17: Q19–Q40 and the playoffs were played after it. Nothing to place, nothing to review.
    const after: CoverageVideoCheck = { checked: "2026-11-16", outside: "played after the recording ends: it ends on Q17 at 2:23:20" };
    const t = triageCoverage(2025, many("after-broadcast", 22, after, 19), CURRENT);
    expect(t.triage).toBe("no-timing");
    // One it doesn't prove keeps the event in To review.
    expect(triageCoverage(2025, [...many("after-broadcast", 22, after, 19), ...many("overlaps-previous", 1, { checked: "2026-11-16" }, 18)], CURRENT).triage).toBe("actionable");
  });

  it("Romania COANDA 2025 ROCMPCND: Q2 (an early start) and Q19 (before the broadcast) say what their videos showed", () => {
    const q2 = { reason: "overlaps-previous" as const, label: "Q2", video: { checked: "2026-11-14", found: "no frame read of it, and no agreeing reads on both sides", after: { label: "Q3", at: 10440 } } };
    const q19 = { reason: "before-broadcast" as const, label: "Q19", video: { checked: "2026-11-14", after: { label: "Q20", at: 209 } } };
    const t = triageCoverage(2025, [q2, q19], CURRENT);
    expect(t).toEqual({ triage: "actionable", why: "2 matches checked in the video, no start found there (Q2, Q19)" });
    expect(t.why).not.toMatch(/early|by the clock|broadcast started/i);
    // Seen by one frame read: said so, with the second.
    expect(triageCoverage(2025, [{ ...q2, video: { checked: "2026-11-14", seenAt: 10140, found: "one signal only" } }], CURRENT).why)
      .toBe("1 match seen in the video, not yet confirmed (Q2)");
  });

  it("USFLFNLT Q1–Q3, between two of Saturday's recordings: a pending check until both videos are checked, then settled", () => {
    const gap = (video: CoverageVideoCheck) => many("between-recordings", 3, video);
    expect(triageCoverage(2025, gap(UNREAD), CURRENT)).toEqual({ triage: "unchecked", why: "3 matches not yet checked against the video (Q1, Q2, Q3)" });
    expect(triageCoverage(2025, gap({ checked: "2026-11-15", found: "in neither video" }), CURRENT))
      .toEqual({ triage: "no-timing", why: "3 matches: Played between two of the day's recordings, in neither" });
    // Seen in one of them by a frame read: still To review.
    expect(triageCoverage(2025, gap({ checked: "2026-11-15", seenAt: 120 }), CURRENT).triage).toBe("actionable");
  });

  it("To review holds the matches checked against the video, and counts the ones still waiting for their check beside them", () => {
    const t = triageCoverage(2025, [
      { reason: "before-broadcast", label: "Q19", video: { checked: "2026-11-14", after: { label: "Q20", at: 209 } } },
      ...many("overlaps-previous", 2, UNREAD, 40),
    ], CURRENT);
    expect(t).toEqual({ triage: "actionable", why: "1 match checked in the video, no start found there (Q19); 2 matches not yet checked against the video (Q40, Q41)" });
  });

  it("Glendale 2026 USAZGLQ1, 0 of 42 (its video unavailable): Can't be played, settled, not To review", () => {
    const t = triageCoverage(2026, many("video-unavailable", 42), CURRENT);
    expect(t).toEqual({ triage: "unplayable", why: "42 matches: Recording can't be played: unavailable on YouTube (private or removed)" });
  });

  it("a gap-unplaced match its video's frames read stays settled (seen ones show as findings, not To review)", () => {
    const seen = { checked: "2026-11-17", seenAt: 5400, found: "its clip's opening frame doesn't name it" };
    const mixed = triageCoverage(2025, [...many("gap-unplaced", 1, seen), ...many("gap-unplaced", 4, undefined, 2)], CURRENT);
    expect(mixed.triage).toBe("no-timing");
    // Its why says the frames were read for some, and where what they saw is, never only the clock's shortfall.
    expect(mixed.why).toBe(`5 matches: ${WHY["gap-unplaced"]}; 1 of them checked in the video (1 seen there, under Found in the video)`);
    const outside = triageCoverage(2025, many("gap-unplaced", 8, { checked: "2026-11-17", outside: "played before the recording starts" }), CURRENT);
    expect(outside).toEqual({ triage: "no-timing", why: `8 matches: ${WHY["gap-unplaced"]}; all checked in the video` });
    // Not read: the shortfall alone, as before.
    expect(triageCoverage(2025, many("gap-unplaced", 3), CURRENT).why).toBe(`3 matches: ${WHY["gap-unplaced"]}`);
  });

  it("DESTQ 2025, its video's owner turned embedding off: Can't be played, in any season (never folded into Old season)", () => {
    expect(triageCoverage(2025, many("video-no-embed", 32), CURRENT).triage).toBe("unplayable");
    expect(triageCoverage(2021, many("video-unavailable", 12), CURRENT).triage).toBe("unplayable");
  });

  it("an event with other matches missing too is judged on those, the unplayable ones held aside and counted", () => {
    // A day unavailable, another day's early starts not checked yet: still a pending video check.
    const t = triageCoverage(2025, [...many("video-unavailable", 30), ...many("before-broadcast", 2, UNREAD, 31)], CURRENT);
    expect(t).toEqual({ triage: "unchecked", why: "2 matches not yet checked against the video (Q31, Q32); 30 more matches whose recording can't be played" });
    // And one checked in the video with no start found stays To review.
    expect(triageCoverage(2025, [...many("video-no-embed", 5), ...many("before-broadcast", 1, { checked: "2026-11-17" }, 6)], CURRENT).triage).toBe("actionable");
  });

  it("most matches clipped, a few missing that the video may still hold: a pending video check (AUSYQ2 2025, 42 of 53)", () => {
    // Q1 "Played before the broadcast started"; 10 more held back as early starts, all by the clock alone.
    const t = triageCoverage(2025, [...many("before-broadcast", 1, UNREAD), ...many("overlaps-previous", 10, UNREAD, 3)], CURRENT);
    expect(t).toEqual({ triage: "unchecked", why: "11 matches not yet checked against the video (Q1, Q3, Q4, Q5, Q6, 6 more)" });
  });

  it("every reason that rests on the clock alone is a pending video check in any season, and says nothing the clock said", () => {
    const clock: CoverageReason[] = ["before-broadcast", "after-broadcast", "before-cut", "past-video-end", "before-chapters", "past-chapters", "outside-span", "overlaps-previous"];
    for (const reason of clock) {
      for (const season of [2026, 2025, 2021]) {
        const t = triageCoverage(season, [...many(reason, 2, UNREAD), ...many("video-unavailable", 30, undefined, 3)], CURRENT);
        expect(t).toEqual({ triage: "unchecked", why: "2 matches not yet checked against the video (Q1, Q2); 30 more matches whose recording can't be played" });
      }
    }
  });

  it("a list stored before the video facts existed (no `video`) reads as not yet checked", () => {
    expect(triageCoverage(2026, [{ reason: "overlaps-previous" }, { reason: "before-broadcast" }], CURRENT))
      .toEqual({ triage: "unchecked", why: "2 matches not yet checked against the video" });
  });

  it("what the video itself shows isn't Actionable: past the frames checked, no video, no recording that day", () => {
    for (const r of ["past-checked", "no-recording-day", "gap-unplaced"] as CoverageReason[]) {
      expect(triageCoverage(2026, many(r, 3), CURRENT).triage).toBe("no-timing");
    }
  });

  it("an early start the video confirms that isn't most of the gap is No timing, naming the main reason and the rest", () => {
    const t = triageCoverage(2026, [...many("gap-unplaced", 84), ...many("overlaps-previous", 27, EARLY, 85)], CURRENT);
    expect(t).toEqual({ triage: "no-timing", why: "84 matches: Video shorter than its broadcast, missing time can't be placed, and 27 more for other reasons" });
  });

  it("a match with no reason found, or an empty list, stays Actionable", () => {
    expect(triageCoverage(2026, [{ label: "Q4" }], CURRENT)).toEqual({ triage: "actionable", why: "1 match with no clip and no reason found (Q4)" });
    expect(triageCoverage(2026, [], CURRENT)).toEqual({ triage: "actionable", why: "No missing list to judge from: look at the event" });
    expect(triageCoverage(2021, [], CURRENT).triage).toBe("actionable");
  });

  it("an older season than last is Old season, decided when read, and never hides Actionable", () => {
    expect(triageCoverage(2022, many("gap-unplaced", 84), CURRENT)).toEqual({ triage: "old-season", why: "2022–23 season. 84 matches: Video shorter than its broadcast, missing time can't be placed" });
    expect(triageCoverage(2025, many("gap-unplaced", 84), CURRENT).triage).toBe("no-timing");
    const stored = baseTriage(many("gap-unplaced", 84));
    expect(seasonTriage(stored, 2024, 2025).triage).toBe("no-timing");
    expect(seasonTriage(stored, 2024, 2026)).toEqual({ triage: "old-season", why: `2024–25 season. ${stored.why}` });
    expect(seasonTriage(baseTriage(many("before-broadcast", 1, UNREAD)), 2019, 2026).triage).toBe("unchecked");
    expect(seasonTriage(baseTriage(many("before-broadcast", 1, { checked: "2026-11-15" })), 2019, 2026).triage).toBe("actionable");
  });
});
