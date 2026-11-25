import { describe, expect, it } from "vitest";
import { detail, m } from "./eventGlance.fixtures";
import { originNote, recordingHighlights } from "./recordingHighlights";

type S = { total: number; auto?: number; teleop?: number };
const sc = ({ total, auto = 0, teleop = 0 }: S) => ({ total, np: total, auto, teleop, endgame: 0, pen: 0 });

describe("recordingHighlights", () => {
  it("picks the best single-alliance auto and TeleOp, and the smallest margin", () => {
    const d = detail({ status: "finished", matches: [
      m(1, [1, 2], [3, 4], { red: sc({ total: 120, auto: 40, teleop: 60 }), blue: sc({ total: 80, auto: 50, teleop: 20 }) }),
      m(2, [5, 6], [7, 8], { red: sc({ total: 101, auto: 10, teleop: 90 }), blue: sc({ total: 98, auto: 12, teleop: 70 }) }),
      m(3, [1, 5], [2, 6]), // not played
    ] });
    const h = recordingHighlights(d);
    expect(h.auto).toMatchObject({ value: 50, side: "blue", teams: [3, 4] });
    expect(h.auto!.match.label).toBe("Q1");
    expect(h.teleop).toMatchObject({ value: 90, side: "red", teams: [5, 6] });
    expect(h.teleop!.match.label).toBe("Q2");
    expect(h.closest).toMatchObject({ value: 3, side: "red", teams: [5, 6] });
    expect(h.closest!.match.label).toBe("Q2");
  });

  it("a tie is the closest match, with no winning side; the earlier match keeps an equal best", () => {
    const d = detail({ status: "finished", matches: [
      m(1, [1, 2], [3, 4], { red: sc({ total: 90, auto: 30 }), blue: sc({ total: 85 }) }),
      m(2, [5, 6], [7, 8], { red: sc({ total: 70, auto: 30 }), blue: sc({ total: 70 }) }),
    ] });
    const h = recordingHighlights(d);
    expect(h.auto!.match.label).toBe("Q1");
    expect(h.closest).toMatchObject({ value: 0, side: null, teams: [5, 6, 7, 8] });
  });

  it("nothing without played, scored matches; no closest match at a remote event; zero periods are left out", () => {
    expect(recordingHighlights(detail({ status: "finished", matches: [m(1, [1, 2], [3, 4])] }))).toEqual({ auto: null, teleop: null, closest: null });
    const remote = detail({ status: "finished", remote: true, matches: [m(1, [1], [], { red: sc({ total: 50, auto: 20 }) })] });
    const h = recordingHighlights(remote);
    expect(h.auto).toMatchObject({ value: 20, teams: [1] });
    expect(h.teleop).toBeNull();
    expect(h.closest).toBeNull();
  });
});

describe("originNote", () => {
  it("says where the video came from, nothing when unknown", () => {
    expect(originNote("watcher")).toMatch(/our watcher/);
    expect(originNote("channel")).toMatch(/our watcher.*channel FIRST lists/);
    expect(originNote("first")).toMatch(/FIRST's event listing/);
    expect(originNote("list")).toMatch(/hand-checked list/);
    expect(originNote("owner")).toMatch(/site owner/);
    expect(originNote(undefined)).toBeNull();
  });
});
