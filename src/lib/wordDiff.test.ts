// The recoverable view's word diff: exact round trips (both sides give their text back), words compared whole
// (emoji sequences, combining marks and right-to-left text stay intact), changes grouped as phrases, and a long
// text stays fast.
import { describe, expect, it } from "vitest";
import { diffCounts, MAX_CELLS, sideOf, tokenize, wordDiff, type DiffPart } from "./wordDiff";

const join = (parts: DiffPart[]) => parts.map((p) => p.text).join("");
const both = (before: string, after: string) => {
  const d = wordDiff(before, after);
  expect(join(sideOf(d, "before"))).toBe(before);
  expect(join(sideOf(d, "after"))).toBe(after);
  return d;
};

describe("tokenize", () => {
  it("splits words from the whitespace between them, losing nothing", () => {
    expect(tokenize("Fast  auto,\nslow endgame")).toEqual(["Fast", "  ", "auto", ",", "\n", "slow", " ", "endgame"]);
    expect(tokenize(" \n\t x")).toEqual([" \n\t ", "x"]);
    expect(tokenize("Fast  auto,\nslow endgame").join("")).toBe("Fast  auto,\nslow endgame");
    expect(tokenize("")).toEqual([]);
  });

  it("keeps emoji sequences, combining marks and right-to-left words whole", () => {
    expect(tokenize("👨‍👩‍👧 été مرحبا بكم 🏳️‍🌈")).toEqual(["👨‍👩‍👧", " ", "été", " ", "مرحبا", " ", "بكم", " ", "🏳️‍🌈"]);
  });
});

describe("wordDiff", () => {
  it("marks nothing when the texts are the same", () => {
    expect(both("Fast cycles", "Fast cycles")).toEqual([{ type: "same", text: "Fast cycles" }]);
  });

  it("shows one word swapped as one removal then one addition", () => {
    expect(both("Fast cycles in auto", "Slow cycles in auto")).toEqual([
      { type: "removed", text: "Fast" }, { type: "added", text: "Slow" }, { type: "same", text: " cycles in auto" },
    ]);
  });

  it("finds words added and removed in the middle", () => {
    const d = both("Good intake, weak climb", "Good intake, very consistent, weak climb");
    expect(d.filter((p) => p.type !== "same")).toEqual([{ type: "added", text: "very consistent, " }]);
    expect(diffCounts(d)).toEqual({ added: 2, removed: 0 });
  });

  it("groups neighbouring changes into one phrase out and one phrase in", () => {
    const d = both("scores two in auto", "parks only in auto");
    expect(d).toEqual([{ type: "removed", text: "scores two" }, { type: "added", text: "parks only" }, { type: "same", text: " in auto" }]);
    expect(diffCounts(d)).toEqual({ added: 2, removed: 2 });
  });

  it("handles an empty side (a note that's gone, a comment that's new)", () => {
    expect(both("", "New note")).toEqual([{ type: "added", text: "New note" }]);
    expect(both("Old note", "")).toEqual([{ type: "removed", text: "Old note" }]);
    expect(both("", "")).toEqual([]);
  });

  it("compares emoji, combining marks and right-to-left text without splitting them", () => {
    const d = both("Great 🚀 auto, café ok, مرحبا", "Great 👨‍👩‍👧 auto, café ok, مرحبا بكم");
    expect(d.filter((p) => p.type === "removed").map((p) => p.text)).toEqual(["🚀", "café"]);
    expect(d.filter((p) => p.type === "added").map((p) => p.text)).toEqual(["👨‍👩‍👧", "café", " بكم"]);
  });

  it("treats markup as plain text", () => {
    const d = both("<b>fast</b>", "<img src=x onerror=alert(1)> fast");
    expect(join(sideOf(d, "after"))).toBe("<img src=x onerror=alert(1)> fast");
  });

  it("stays quick on a long text, and falls back to a whole replacement past its limit", () => {
    const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");
    const t0 = performance.now();
    const d = both(words(400, "a"), words(400, "b"));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(diffCounts(d)).toEqual({ added: 400, removed: 400 });
    const big = Math.ceil(Math.sqrt(MAX_CELLS)) + 10;
    const far = both(`start ${words(big, "x")} end`, `start ${words(big, "y")} end`);
    expect(far.map((p) => p.type)).toEqual(["same", "removed", "added", "same"]);
  });
});
