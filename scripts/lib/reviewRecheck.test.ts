// The second look at review entries (scripts/lib/reviewRecheck.ts): what the frames after an entry settle, and the row
// it writes, checked by the server's own rules (server/data/frameRowRules.ts).
import { describe, expect, it } from "vitest";
import { recheckDue, recheckRow, recheckVerdict, sawText, type RecheckRead } from "./reviewRecheck";
import { rowProblems } from "../../server/data/frameRowRules";
import type { FrameTiming } from "../../server/data/frameTimings";

/** A frame read `after` seconds past 1000 (a playing frame is read about a second on): its bar's match and timer start. */
const at = (after: number, label: string | null, start: number | null = null, division?: "own" | "other"): RecheckRead => ({ at: 1000 + after + 0.9, label, start, ...(division ? { division } : {}) });
const ONE = "one frame read, and nothing else agrees where the video sits";
const SHOWS = "its clip's first frame shows Q6, not Q7";

describe("recheckVerdict", () => {
  it("settles a one-read start on two frames whose timers agree, the clip opening on the first", () => {
    const v = recheckVerdict("Q7", 1000, [at(2, "Q7", 1000), at(8, "Q7", 1001), at(20, "Q7", 1000), at(40, null)]);
    // The timer's start stands; the first frame naming it is 3 s after it, no lead the rules know: the start moves there.
    expect(v).toEqual({ settled: { start: 1003, open: 1003, frames: [1003, 1009, 1021] } });
    // A first frame 2 s after the timer's start is a lead the rules know (-2): the timer's start stands.
    expect(recheckVerdict("Q7", 1000, [{ at: 1002, label: "Q7", start: 1000 }, { at: 1008, label: "Q7", start: 1000 }])).toEqual({ settled: { start: 1000, open: 1002, frames: [1002, 1008] } });
  });

  it("settles a start whose opening showed the match before: the bar named Q6 at first, then Q7 with its timer", () => {
    expect(recheckVerdict("Q7", 1000, [at(2, "Q6"), at(8, "Q7", 1004), at(20, "Q7", 1004), at(40, "Q7", 1005)]))
      .toEqual({ settled: { start: 1009, open: 1009, frames: [1009, 1021, 1041] } });
  });

  it("leaves it for the owner when fewer than two frames agree, they disagree, or another match shows throughout", () => {
    expect(recheckVerdict("Q7", 1000, [at(2, "Q7", 1000), at(8, null), at(20, "Q7"), at(40, null)])).toEqual({ stays: "only 1 frame after it named Q7 with its timer running" });
    expect(recheckVerdict("Q7", 1000, [at(2, "Q7", 1000), at(20, "Q7", 1015)])).toEqual({ stays: "the frames after it named Q7, but their timers gave starts more than 6 s apart" });
    expect(recheckVerdict("Q7", 1000, [at(2, "Q6"), at(8, "Q6"), at(20, "Q8")])).toEqual({ stays: "the frames after it named Q6, Q8, not Q7" });
    expect(recheckVerdict("Q7", 1000, [at(2, null), at(8, null)])).toEqual({ stays: "no frame after it named a match" });
    expect(recheckVerdict("Q7", 1000, [])).toEqual({ stays: "no frame after it named a match" });
    // Another division's (or event's) overlay is never this match, whatever its number.
    expect(recheckVerdict("Q7", 1000, [at(2, "Q7", 1000, "other"), at(8, "Q7", 1000, "other")])).toEqual({ stays: "the frames after it named another division's or event's match, not Q7" });
    // A frame between the agreeing ones naming another match: not one match throughout.
    expect(recheckVerdict("Q7", 1000, [at(2, "Q7", 1000), at(8, "Q8"), at(20, "Q7", 1000)])).toEqual({ stays: "a frame between the ones naming Q7 named Q8" });
    // Timers putting it far from where it was seen: another match's frames, or a misread.
    expect(recheckVerdict("Q7", 1000, [at(2, "Q7", 940), at(8, "Q7", 941)])).toEqual({ stays: "the frames after it put Q7's start at 940 s, 60 s from where it was seen" });
  });

  it("takes no look where frames weren't read and the rest settle nothing; a settled start stands whatever was missed", () => {
    expect(recheckVerdict("Q7", 1000, [], 4)).toEqual({ unread: "4 of its frames weren't read (no frame after it named a match): looked at again next run" });
    expect(recheckVerdict("Q7", 1000, [at(2, "Q6")], 3)).toMatchObject({ unread: expect.stringMatching(/^3 of its frames weren't read/) });
    expect(recheckVerdict("Q7", 1000, [at(2, "Q7", 1000), at(8, "Q7", 1000)], 2)).toMatchObject({ settled: { start: 1003 } });
  });

  it("names a replay's frames by its match, as the reader does (sameMatch)", () => {
    expect("settled" in recheckVerdict("M6-2", 1000, [{ at: 1002, label: "M6", start: 1000 }, { at: 1008, label: "M6", start: 1000 }])).toBe(true);
  });

  it("says what each frame showed", () => {
    expect(sawText(1000, [at(2, "Q6"), at(8, "Q7", 1004), at(20, null), at(40, "Q7", 1, "other")])).toBe("3 s on: Q6; 9 s on: Q7 from 1004 s; 21 s on: nothing; 41 s on: another division's or event's match");
  });
});

describe("recheckDue", () => {
  const row = (review: FrameTiming["review"], starts: Record<string, number> = { Q6: 700 }) => ({ starts, review });
  it("takes entries in review with a second, not starts already, not looked at again, not rejected there", () => {
    expect(recheckDue(row({ Q7: { t: 1000.4, why: ONE }, Q8: { t: 1300, why: SHOWS, again: { on: "2026-11-20", saw: "" } } }))).toEqual([{ label: "Q7", t: 1000 }]);
    expect(recheckDue(row({ Q6: { t: 700, why: ONE } }))).toEqual([]);
    expect(recheckDue(row({ Q7: { t: -1, why: ONE } }))).toEqual([]);
    expect(recheckDue(row({ Q7: { t: 1000, why: ONE } }), (l, t) => l === "Q7" && t === 1000)).toEqual([]);
  });
});

describe("recheckRow", () => {
  const ORDER = ["Q5", "Q6", "Q7", "Q8"];
  const live = (o: Partial<FrameTiming> = {}): FrameTiming => ({ videoId: "aaaaaaaaaa1", code: "XX", checked: "2026-11-10", starts: { Q6: 700, Q8: 1400 }, opens: { Q6: 688, Q8: 1395 }, review: { Q7: { t: 1000, why: ONE } }, missing: { Q7: "its frames didn't confirm a start" }, ...o });
  const settled = (start: number, open: number, frames: number[]) => ({ verdict: { settled: { start, open, frames } }, saw: "frames" });

  it("moves a confirmed entry into the starts, its opening and frames kept, out of review and missing: a row the server puts live", () => {
    const r = recheckRow(live(), new Map([["Q7", settled(1003, 1003, [1003, 1009])]]), live(), ORDER, "2026-11-21");
    expect(r.row).toEqual({ videoId: "aaaaaaaaaa1", code: "XX", checked: "2026-11-21", starts: { Q6: 700, Q7: 1003, Q8: 1400 }, opens: { Q6: 688, Q8: 1395, Q7: 1003 }, confirmed: { Q7: [1003, 1009] } });
    expect(rowProblems(r.row!, live(), ORDER)).toEqual([]);
  });

  it("marks an entry it couldn't settle looked at (again), so the queue lets it be; the row goes live, still for the owner", () => {
    const r = recheckRow(live(), new Map([["Q7", { verdict: { stays: "no frame after it named a match" }, saw: "3 s on: nothing" }]]), live(), ORDER, "2026-11-21");
    expect(r.row?.review).toEqual({ Q7: { t: 1000, why: ONE, again: { on: "2026-11-21", saw: "no frame after it named a match (3 s on: nothing)" } } });
    expect(r.row?.starts).toEqual(live().starts);
    expect(recheckDue(r.row!)).toEqual([]);
    expect(rowProblems(r.row!, live(), ORDER)).toEqual([]);
  });

  it("keeps for the owner a confirmed start the row's rules refuse: out of order, overlapping, outside the video", () => {
    // Out of order: Q7 confirmed after Q8's start.
    const late = recheckRow(live(), new Map([["Q7", settled(1500, 1500, [1500, 1520])]]), live(), ORDER, "2026-11-21");
    expect(late.row?.starts).toEqual(live().starts);
    expect(late.row?.review?.Q7.again?.saw).toBe("confirmed at 1500 s by frames 1500, 1520, but Q8: starts before Q7, out of the order they were played (frames)");
    // Overlapping the match before it.
    const close = recheckRow(live(), new Map([["Q7", settled(760, 760, [760, 780])]]), live(), ORDER, "2026-11-21");
    expect(close.row?.review?.Q7.again?.saw).toMatch(/^confirmed at 760 s by frames 760, 780, but Q\d: its start overlaps another match's/);
    // Running past the video's end (the reader's judge sends such a start to review): stays.
    const end = live({ starts: { Q6: 700 }, opens: { Q6: 688 } });
    const out = recheckRow(end, new Map([["Q7", settled(1003, 1003, [1003, 1009])]]), end, ORDER, "2026-11-21", 1100);
    expect(out.row?.starts).toEqual({ Q6: 700 });
    expect(out.row?.review?.Q7.again?.saw).toBe("confirmed at 1003 s by frames 1003, 1009, but the match would run past the video's end (1100 s) (frames)");
    expect(recheckRow(end, new Map([["Q7", settled(1003, 1003, [1003, 1009])]]), end, ORDER, "2026-11-21", 1200).row?.starts).toEqual({ Q6: 700, Q7: 1003 });
  });

  it("leaves an entry whose frames weren't read as it was: unmarked, due its look on the next run", () => {
    const r = recheckRow(live(), new Map([["Q7", { verdict: { unread: "4 of its frames weren't read" }, saw: "" }]]), live(), ORDER, "2026-11-21");
    expect(r.row?.review).toEqual(live().review);
    expect(recheckDue(r.row!)).toEqual([{ label: "Q7", t: 1000 }]);
  });

  it("writes nothing where the server would hold the row anyway, the live row is today's, or openings were never checked", () => {
    const overlapping = live({ starts: { Q6: 700, Q8: 750 }, opens: { Q6: 688, Q8: 745 } });
    expect(recheckRow(overlapping, new Map([["Q7", settled(1003, 1003, [1003, 1009])]]), overlapping, ORDER, "2026-11-21")).toMatchObject({ row: null });
    expect(recheckRow(live({ checked: "2026-11-21" }), new Map([["Q7", settled(1003, 1003, [1003, 1009])]]), live({ checked: "2026-11-21" }), ORDER, "2026-11-21")).toMatchObject({ row: null });
    expect(recheckRow(live({ opens: undefined }), new Map([["Q7", settled(1003, 1003, [1003, 1009])]]), undefined, ORDER, "2026-11-21")).toMatchObject({ row: null });
  });
});

describe("the server's rule for a confirmed start (rowProblems)", () => {
  const row = (confirmed: Record<string, number[]>, o: Partial<FrameTiming> = {}): FrameTiming => ({ videoId: "aaaaaaaaaa1", code: "XX", checked: "2026-11-21", starts: { Q7: 1003 }, opens: { Q7: 1003 }, confirmed, ...o });
  it("stands on two separate frames inside its match, never fewer, never outside it, never still for review", () => {
    expect(rowProblems(row({ Q7: [1003, 1009] }))).toEqual([]);
    expect(rowProblems(row({ Q7: [1003] }))).toEqual(["Q7: confirmed by fewer than 2 separate frames"]);
    expect(rowProblems(row({ Q7: [1003, 1003] }))).toEqual(["Q7: confirmed by fewer than 2 separate frames"]);
    expect(rowProblems(row({ Q7: [1003, 1.5] as number[] }))).toEqual(["Q7: confirmed by fewer than 2 separate frames"]);
    expect(rowProblems(row({ Q7: [1003, 1300] }))).toEqual(["Q7: a confirming frame at 1300 s isn't inside its match (start 1003 s)"]);
    expect(rowProblems(row({ Q9: [1003, 1009] }))).toEqual(["Q9: confirmed by frames, but has no start"]);
    expect(rowProblems(row({ Q7: [1003, 1009] }, { review: { Q7: { t: 1000, why: ONE } } }))).toEqual(["Q7: confirmed, yet still for review"]);
  });
});
