// The atlas's country paths and its results line (DATA-F01, E1): a zero is the true
// "nobody has played" only when the season's statistics are ready; otherwise it is
// "still being prepared". Every country leads to its full directory.
import { describe, expect, it } from "vitest";
import { countryHref, directoryHref, resultsLine } from "./atlasModel";
import type { SeasonReadiness } from "../../shared/home";

const r = (state: SeasonReadiness["state"]): SeasonReadiness => ({ state, resultsAt: "2026-10-17T12:00:00Z", statsAt: "2026-10-17T12:05:00Z" });

describe("resultsLine", () => {
  it("links a count when the statistics are ready", () => {
    expect(resultsLine({ withResults: 108 }, r("ready"))).toEqual({ kind: "link", count: 108, behind: false });
  });
  it("states the true zero only when ready", () => {
    expect(resultsLine({ withResults: 0 }, r("ready"))).toEqual({ kind: "none" });
  });
  it("never states a zero (or any count) while the statistics are being prepared", () => {
    expect(resultsLine({ withResults: 0 }, r("preparing"))).toEqual({ kind: "preparing" });
    expect(resultsLine({ withResults: 3 }, r("preparing"))).toEqual({ kind: "preparing" });
  });
  it("marks counts as behind while catching up, and a zero as pending", () => {
    expect(resultsLine({ withResults: 5 }, r("catching-up"))).toEqual({ kind: "link", count: 5, behind: true });
    expect(resultsLine({ withResults: 0 }, r("catching-up"))).toEqual({ kind: "pending" });
  });
  it("makes no claim when readiness is unknown", () => {
    expect(resultsLine({ withResults: 0 }, undefined)).toEqual({ kind: "pending" });
  });
});

describe("country links", () => {
  it("leads to the directory or the statistics, keeping a past season", () => {
    expect(countryHref("US", 2026, 2026, "listed")).toBe("/teams?view=listed&country=US");
    expect(countryHref("US", 2026, 2026)).toBe("/teams?view=season&country=US");
    expect(countryHref("CA", 2025, 2026, "listed")).toBe("/teams?view=listed&season=2025&country=CA");
    expect(directoryHref(2025, 2026)).toBe("/teams?view=listed&season=2025");
    expect(directoryHref(2026, 2026)).toBe("/teams?view=listed");
  });
});
