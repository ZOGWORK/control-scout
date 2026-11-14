// The pure parts of the frame reader (scripts/video-frames.ts): the overlay's match, the timer's elapsed time, and
// placing a video's matches from what was read.
import { describe, expect, it } from "vitest";
import { elapsed, judge, overlayLabel, placed, secondsOf, type M } from "./videoFrames";

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
    const out = placed(ms, seen);
    expect(out.has("Q5")).toBe(false);
    expect([...out.keys()]).toEqual(["Q1", "Q2", "Q3", "Q4", "Q6", "Q7", "Q8", "Q9", "Q10"]);
    expect(out.get("Q3")).toBe(1800 - 29);
    expect(out.get("Q8")).toBe(3800 - 107);
  });

  it("keeps a match only where a read saw it or agreeing reads hold it", () => {
    const ms: M[] = Array.from({ length: 4 }, (_, i) => ({ label: `M${i + 1}`, epoch: i * 500 }));
    const out = placed(ms, new Map([[0, 10], [3, 1500 - 300]]));
    expect([...out.keys()]).toEqual(["M1", "M4"]);
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

    it("never places a match on one signal alone: a lone read goes to review unless the broadcast's clock agrees", () => {
      // Q1–Q5 agree at -9000; Q9 alone at -9300 (a gap: the stream stopped for 5 minutes).
      const seen = new Map([at(0, -9000), at(4, -9000), at(8, -9300)]);
      const j = judge(ms, seen, null, 8000);
      expect(j.review.get("Q9")).toMatchObject({ t: ms[8].epoch - 9300, why: /one frame read/ });
      expect(j.placed.has("Q9")).toBe(false);
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
    });

    it("tells a match whose frames were read but never confirmed from one never read", () => {
      const j = judge(ms, new Map([at(0, -9000), at(9, -9000)]), null, 8000, new Set([0, 9]));
      expect(j.placed.size).toBe(10);
      const k = judge(ms, new Map(), null, 8000, new Set([2]));
      expect(k.missing.get("Q3")).toMatch(/didn't confirm/);
      expect(k.missing.get("Q4")).toMatch(/no frame of the video/);
    });
  });
});
