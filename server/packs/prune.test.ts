// Pruning old releases (packs/build.ts prunedReleases): the newest three stay, by day and then by the day's build
// number. Sorted as text, a day's 10th build ("…-10") came before its 9th, so on 2026-11-27 release .10 was deleted
// as it was published and every file its manifest named answered 404.
import { describe, expect, it } from "vitest";
import { prunedReleases } from "./build.js";

describe("prunedReleases", () => {
  it("a day's 10th build is the newest, not the oldest", () => {
    expect(prunedReleases(["2026-11-27-7", "2026-11-27-8", "2026-11-27-9", "2026-11-27-10"], 3, "2026-11-27.10")).toEqual(["2026-11-27-7"]);
    expect(prunedReleases(["2026-11-27-9", "2026-11-27-10", "2026-11-27-11", "2026-11-27-12"], 3, "2026-11-27.12")).toEqual(["2026-11-27-9"]);
    expect(prunedReleases(["2026-11-27-99", "2026-11-27-100", "2026-11-27-101", "2026-11-27-98"], 3, "2026-11-27.101")).toEqual(["2026-11-27-98"]);
  });

  it("a new day's first build is newer than the last day's later ones", () => {
    expect(prunedReleases(["2026-11-27-10", "2026-11-27-11", "2026-11-27-12", "2026-11-28-1"], 3, "2026-11-28.1")).toEqual(["2026-11-27-10"]);
    expect(prunedReleases(["2026-12-31-14", "2027-01-01-1", "2026-12-31-13", "2026-12-31-12"], 3, "2027-01-01.1")).toEqual(["2026-12-31-12"]);
  });

  it("three or fewer: nothing goes; the one just published never goes, whatever else is on disk", () => {
    expect(prunedReleases(["2026-11-27-1", "2026-11-27-2"], 3, "2026-11-27.2")).toEqual([]);
    // A stray newer-looking release (a clock that moved back) can't push the published one out.
    expect(prunedReleases(["2026-12-01-1", "2026-12-01-2", "2026-12-01-3", "2026-11-27-4"], 3, "2026-11-27.4")).toEqual([]);
  });
});
