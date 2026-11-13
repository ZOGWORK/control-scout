// The pure parts of the frame reader (scripts/video-frames.ts): the overlay's match, the timer's elapsed time, and
// placing a video's matches from what was read.
import { describe, expect, it } from "vitest";
import { elapsed, overlayLabel, placed, secondsOf, type M } from "./videoFrames";

describe("the frame reader", () => {
  it("names the match the overlay shows, and nothing else", () => {
    expect(overlayLabel("FIRST AGE  Qualification 21 of 36  2:05")).toBe("Q21");
    expect(overlayLabel("Playoff Match 10")).toBe("M10");
    expect(overlayLabel("Match 7")).toBeNull();
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
});
