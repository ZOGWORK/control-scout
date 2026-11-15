// The pure parts of the frame reader (scripts/video-frames.ts): the overlay's match, the timer's elapsed time, and
// placing a video's matches from what was read.
import { describe, expect, it } from "vitest";
import { dataRows, divisionOf, elapsed, overlayDivision, leadIn, LEAD_IN_S, judge, NOTHING_READ, overlayLabel, secondsOf, type M } from "./videoFrames";

describe("the frame reader", () => {
  it("names the match the overlay shows, and nothing else", () => {
    expect(overlayLabel("FIRST AGE  Qualification 21 of 36  2:05")).toBe("Q21");
    expect(overlayLabel("Playoff Match 10")).toBe("M10");
    expect(overlayLabel("APOC Decode 2026  Finals Match 2")).toBe("F2");
    expect(overlayLabel("FiT-North I&S League Tournament  Match 1  DECODE")).toBe("M1");
    expect(overlayLabel("Upcoming matches")).toBeNull();
  });

  it("reads a timer", () => {
    expect(secondsOf("2:25")).toBe(145);
    expect(secondsOf(" 0:07\n")).toBe(7);
    expect(secondsOf("2:75")).toBeNull();
    expect(secondsOf("")).toBeNull();
  });

  it("turns either layout's timer into seconds since the match started", () => {
    // Bottom bar counting the whole match down from 2:30: Auto above 2:00, then 8 s to switch.
    expect(elapsed({ where: "bottom", left: 150, auto: false })).toBeNull();
    expect(elapsed({ where: "bottom", left: 140, auto: false })).toBe(10);
    expect(elapsed({ where: "bottom", left: 100, auto: false })).toBe(58);
    // Bottom bar counting Auto down from 0:30 (what FTC Live's DECODE bar does): "0:20" is Auto when the read 45 s on
    // says so, 10 s in, never TeleOp's 0:20 (138 s in, where taking it for TeleOp put matches 2 minutes early).
    expect(elapsed({ where: "bottom", left: 20, auto: true })).toBe(10);
    expect(elapsed({ where: "bottom", left: 20, auto: false })).toBe(138);
    // Top bar: 0:30 Auto, then 2:00 TeleOp.
    expect(elapsed({ where: "top", left: 30, auto: true })).toBeNull();
    expect(elapsed({ where: "top", left: 20, auto: true })).toBe(10);
    expect(elapsed({ where: "top", left: 100, auto: false })).toBe(58);
    expect(elapsed({ where: "top", left: 120, auto: false })).toBeNull();
    // 8 s or less: the switch to TeleOp ("0:05" under a hand) reads the same as TeleOp's last seconds, so neither.
    expect(elapsed({ where: "bottom", left: 5, auto: false })).toBeNull();
    expect(elapsed({ where: "top", left: 8, auto: false })).toBeNull();
    expect(elapsed({ where: "bottom", left: 9, auto: false })).toBe(149);
  });

  it("drops a read that breaks the video's only-ever-losing-time order, and fills between agreeing reads", () => {
    const ms: M[] = Array.from({ length: 10 }, (_, i) => ({ label: `Q${i + 1}`, epoch: 1000 + i * 400 }));
    // Q1 and Q4 sit 29 s early, Q5 is a misread (227 s), Q6 and Q10 sit 107 s early.
    const seen = new Map([[0, 1000 - 29], [3, 2200 - 29], [4, 2600 - 227], [5, 3000 - 107], [9, 4600 - 107]]);
    const j = judge(ms, seen, null, 10_000);
    expect(j.missing.get("Q5")).toBe("its frame read disagrees with the matches around it");
    expect([...j.placed.keys()]).toEqual(["Q1", "Q2", "Q3", "Q4", "Q6", "Q7", "Q8", "Q9", "Q10"]);
    expect(j.placed.get("Q3")).toEqual({ t: 1800 - 29, confidence: "medium" });
    expect(j.placed.get("Q8")).toEqual({ t: 3800 - 107, confidence: "medium" });
  });

  it("doesn't take reads drifting a slack at a time for agreement", () => {
    const ms: M[] = Array.from({ length: 3 }, (_, i) => ({ label: `Q${i + 1}`, epoch: 1000 + i * 400 }));
    const j = judge(ms, new Map([[0, 1000], [1, 1400 + 6], [2, 1800 + 12]]), null, 10_000);
    // Q1 and Q2 agree; Q3, 12 s above Q1, is a rise and is set aside.
    expect([...j.placed.keys()]).toEqual(["Q1", "Q2"]);
    expect(j.missing.get("Q3")).toMatch(/disagrees/);
  });

  it("keeps the two reads that agree over a misread between them", () => {
    const ms: M[] = Array.from({ length: 3 }, (_, i) => ({ label: `Q${i + 1}`, epoch: 1000 + i * 400 }));
    const j = judge(ms, new Map([[0, 1000], [1, 1400 - 120], [2, 1800]]), null, 10_000);
    // Q2's misread is set aside; it sits between two agreeing reads, so it's placed from them.
    expect([...j.placed]).toEqual([["Q1", { t: 1000, confidence: "high" }], ["Q2", { t: 1400, confidence: "medium" }], ["Q3", { t: 1800, confidence: "high" }]]);
  });

  it("says nothing was read only when no frame named a match", () => {
    const ms: M[] = Array.from({ length: 3 }, (_, i) => ({ label: `Q${i + 1}`, epoch: i * 400 }));
    const j = judge(ms, new Map(), null, 10_000, new Set([1]));
    expect(j.missing.get("Q2")).toMatch(/didn't confirm/);
    expect(j.missing.get("Q1")).not.toBe(NOTHING_READ);
    expect(judge(ms, new Map(), null, 10_000).missing.get("Q1")).toBe(NOTHING_READ);
  });

  it("looks for a match the clock puts before a broadcast in the next broadcast only", () => {
    // Saturday 10:00–18:00 and Sunday 09:00–17:00 (epoch seconds from an arbitrary 0).
    const w = [{ start: 36_000, end: 64_800 }, { start: 118_800, end: 147_600 }];
    expect(leadIn(35_000, 0, w)).toBe(true); // 17 min before Saturday's broadcast: Saturday's video
    expect(leadIn(35_000, 1, w)).toBe(false); // ...never Sunday's
    expect(leadIn(36_000 - LEAD_IN_S - 1, 0, w)).toBe(false); // more than 6 hours before
    expect(leadIn(40_000, 0, w)).toBe(false); // inside Saturday's broadcast: already its
    expect(leadIn(117_000, 1, w)).toBe(true); // Sunday morning before Sunday's broadcast
    expect(leadIn(70_000, 1, w)).toBe(false); // Saturday evening, after Saturday's end: more than 6 h before Sunday's
    expect(leadIn(35_000, 0, [{ start: null, end: null }])).toBe(false); // an upload has no broadcast to be before
  });

  it("tells a division's overlay from its sibling's on a shared stream", () => {
    expect(divisionOf("Romania Championship - COANDA Division")).toBe("COANDA");
    expect(divisionOf("Chesapeake Championship - Blue Crab Division")).toBe("Blue Crab");
    expect(divisionOf("Brookline Robo Rally 1")).toBeNull();
    // Read off ROCMPCND's Friday stream (pvmxbH8YW-k): VLAICU's overlay at 9761 s, COANDA's at 10000 s.
    expect(overlayDivision("Romania Championship - VLAICU Divis  Qualification 1 of 72  2:23", "COANDA", ["VLAICU"])).toBe("other");
    expect(overlayDivision("Romania Championship - COANDĂ Divisi  Qualification 2 of 72", "COANDA", ["VLAICU"])).toBe("own");
    expect(overlayDivision("a Division  Romania Championship - (  Qualification 2 of 72", "COANDA", ["VLAICU"])).toBeNull();
    expect(overlayDivision("Western Edge Premier Event - Sea Division", "Sand", ["Sea"])).toBe("other");
    expect(overlayDivision("Seattle Qualifier", "Sand", ["Sea"])).toBeNull();
  });

  it("reads the data file's rows", () => {
    const text = 'export interface X {}\n// --- Data (scripts/video-frames.ts writes from here on) ---\nexport const FRAME_TIMINGS = [\n  {"videoId":"a","code":"X","starts":{"Q1":5}},\n  {"videoId":"b","code":"Y","starts":{}},\n];\n';
    expect(dataRows<{ videoId: string }>(text).map((r) => r.videoId)).toEqual(["a", "b"]);
    expect(dataRows("no marker")).toEqual([]);
  });

  it("places a lone confirmed read where the frames show it, unless it's far from where the rest of the video sits", () => {
    const ms: M[] = Array.from({ length: 4 }, (_, i) => ({ label: `M${i + 1}`, epoch: i * 500 }));
    // M1 and M4 disagree by 5 min (the stream lost time between them): each is in the video where its frames say.
    const j = judge(ms, new Map([[0, 10], [3, 1500 - 300]]), null, 10_000);
    expect([...j.placed]).toEqual([["M1", { t: 10, confidence: "high" }], ["M4", { t: 1200, confidence: "high" }]]);
    expect(j.missing.get("M2")).toMatch(/in a gap/);
    // A read 3 hours from the rest: nothing says it's this part of the stream (another day, another event).
    const k = judge(ms, new Map([[0, 10], [3, 1500 + 3 * 3600]]), null, 20_000);
    expect(k.placed.size).toBe(0);
    expect(k.review.get("M4")).toMatchObject({ why: /180 min from where the rest/ });
    // One read, and no clock or other read to tell where it is.
    expect(judge(ms, new Map([[1, 600]]), null, 10_000).review.get("M2")).toMatchObject({ why: /no clock or other read/ });
  });

  describe("judging a video's matches (clock first, frames must agree)", () => {
    // Ten matches 400 s apart; a video that starts 1000 s after the first.
    const ms: M[] = Array.from({ length: 10 }, (_, i) => ({ label: `Q${i + 1}`, epoch: 10_000 + i * 400 }));
    const at = (i: number, off: number) => [i, ms[i].epoch + off] as [number, number];

    it("places reads two or more agree on (high) and the matches between them (medium)", () => {
      const j = judge(ms, new Map([at(0, -9000), at(4, -9000), at(9, -9000)]), null, 8000);
      expect(j.placed.get("Q1")).toEqual({ t: 1000, confidence: "high" });
      expect(j.placed.get("Q3")).toEqual({ t: 1800, confidence: "medium" });
      expect(j.placed.size).toBe(10);
      expect(j.review.size + j.missing.size).toBe(0);
    });

    it("places a lone confirmed read after a gap where its frames show it (the stream is the truth)", () => {
      // Q1–Q5 agree at -9000; Q9 alone at -9300 (a gap: the stream stopped for 5 minutes).
      const seen = new Map([at(0, -9000), at(4, -9000), at(8, -9300)]);
      const j = judge(ms, seen, null, 8000);
      expect(j.placed.get("Q9")).toEqual({ t: ms[8].epoch - 9300, confidence: "high" });
      // Q6–Q8 sit in the gap: missing, with the reason, never silently skipped.
      expect(j.missing.get("Q7")).toMatch(/in a gap/);
      expect(j.missing.get("Q10")).toMatch(/no frame read/);
      // The same lone read where the broadcast's own clock puts it: two signals, placed.
      const k = judge(ms, seen, -9300, 8000);
      expect(k.placed.get("Q9")).toEqual({ t: ms[8].epoch - 9300, confidence: "high" });
    });

    it("drops a misread (a replay, an Auto 0:20 taken for TeleOp's) and says so", () => {
      const j = judge(ms, new Map([at(0, -9000), at(3, -9120), at(4, -9000), at(9, -9000)]), null, 8000);
      expect(j.placed.get("Q4")).toEqual({ t: ms[3].epoch - 9000, confidence: "medium" });
      expect(j.missing.size).toBe(0);
      // A misread with no agreeing reads around it to fill in for it stays missing, with why.
      const k = judge(ms, new Map([at(0, -9000), at(1, -9000), at(5, -8800)]), null, 8000);
      expect(k.missing.get("Q6")).toMatch(/disagrees/);
      expect(k.missing.get("Q4")).toMatch(/no frame read/);
    });

    it("sends starts outside the video or overlapping the next match to review", () => {
      // The video is 2300 s long: Q4 (at 2200) can't fit a whole match.
      const j = judge(ms, new Map([at(0, -9000), at(3, -9000)]), null, 2300);
      expect(j.review.get("Q4")?.why).toMatch(/outside the video/);
      // Two matches 60 s apart overlap.
      const close: M[] = [{ label: "Q1", epoch: 0 }, { label: "Q2", epoch: 60 }, { label: "Q3", epoch: 400 }];
      const k = judge(close, new Map([[0, 100], [1, 160], [2, 500]]), null, 5000);
      expect([...k.review.keys()].sort()).toEqual(["Q1", "Q2"]);
      // Q3, a match on, still stands.
      expect(k.placed.get("Q3")).toEqual({ t: 500, confidence: "high" });
      expect(k.review.size + k.placed.size + k.missing.size).toBe(3);
      // Q2's start (160) is inside Q1's play (100 + 158): written as an early start, read off the video.
      expect([...k.earlyStart]).toEqual([["Q2", { t: 160, previousEnds: 258 }]]);
    });

    it("tells a match whose frames were read but never confirmed from one never read", () => {
      const j = judge(ms, new Map([at(0, -9000), at(9, -9000)]), null, 8000, new Set([0, 9]));
      expect(j.placed.size).toBe(10);
      const k = judge(ms, new Map(), null, 8000, new Set([2]));
      expect(k.missing.get("Q3")).toMatch(/didn't confirm/);
      // A frame of the video was read (it named Q3), so the others aren't "nothing read".
      expect(k.missing.get("Q4")).toMatch(/no agreeing reads/);
    });
  });
});
