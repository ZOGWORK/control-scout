import { describe, expect, it } from "vitest";
import { parseVideoTime } from "./manualStarts";
import { frameStart, hasFrames, setManualStarts } from "../data/frameTimings";

describe("parseVideoTime", () => {
  it("reads the ways an owner types a time", () => {
    expect(parseVideoTime("1:42:05")).toBe(6125);
    expect(parseVideoTime("42:05")).toBe(2525);
    expect(parseVideoTime("6125")).toBe(6125);
    expect(parseVideoTime("1h42m5s")).toBe(6125);
    expect(parseVideoTime(" 0:00:03 ")).toBe(3);
  });
  it("refuses what isn't a time", () => {
    for (const s of ["", "abc", "1:60", "1:75:00", "1:2:3:4", "h"]) expect(parseVideoTime(s)).toBeNull();
  });
});

describe("typed starts in frameStart", () => {
  it("win over a frame read and count as framed", () => {
    expect(hasFrames("zzzzzzzzzzz", "XXTEST")).toBe(false);
    setManualStarts([{ videoId: "zzzzzzzzzzz", code: "XXTEST", label: "Q1", seconds: 600 }]);
    expect(frameStart("zzzzzzzzzzz", "XXTEST", "Q1")).toBe(600);
    expect(frameStart("zzzzzzzzzzz", "XXTEST", "Q2")).toBeNull();
    expect(hasFrames("zzzzzzzzzzz", "XXTEST")).toBe(true);
    setManualStarts([]);
    expect(frameStart("zzzzzzzzzzz", "XXTEST", "Q1")).toBeNull();
    expect(hasFrames("zzzzzzzzzzz", "XXTEST")).toBe(false);
  });
});
