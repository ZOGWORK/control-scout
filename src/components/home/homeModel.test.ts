// @vitest-environment node
// The home page's rules, apart from its markup: live calls and replays never mix,
// correct + missed come from one decisive-call denominator, an unavailable usage
// feed is never shown as zero, the atlas's listings always add up, and a stale
// left-over match is never "next".
import { describe, expect, it } from "vitest";
import type { AccuracyBlock, MatchView, TrackRecord } from "../../shared/api";
import type { HomeOverview, PublicUsage } from "../../shared/home";
import { defaultEvidence, eventState, recordFor, usageView } from "./homeModel";
import { countryHref, pickCountry, reconcile, unmappedLabel } from "./atlasModel";
import { nextMatch } from "./HomeSections";

const block = (o: Partial<AccuracyBlock>): AccuracyBlock => ({
  n: 0, decided: 0, accuracy: 0, brier: 0, logLoss: 0, baselineBrier: 0.25, upsets: 0, reliability: [],
  byTier: { provisional: { n: 0, accuracy: 0, brier: 0 }, moderate: { n: 0, accuracy: 0, brier: 0 }, confident: { n: 0, accuracy: 0, brier: 0 } },
  byLevel: { qual: { n: 0, accuracy: 0 }, playoff: { n: 0, accuracy: 0 } }, weekly: [], ...o,
});
const record = (o: Partial<TrackRecord>): TrackRecord => ({ seasons: [], engineVersion: "2.1.1", liveThreshold: 200, headline: null, recentCalls: [], generatedAt: "2026-10-17T00:00:00Z", ...o });

describe("prediction record", () => {
  const t = record({
    seasons: [
      { season: 2026, label: "2026–27 BIOBUZZ", live: block({ n: 40, decided: 38, accuracy: 0.75, upsets: 9 }), backtest: null },
      { season: 2025, label: "2025–26 DECODE", live: null, backtest: block({ n: 41743, decided: 41405, accuracy: 30554 / 41405, upsets: 10851 }) },
    ],
    headline: { kind: "backtest", season: 2025, accuracy: 30554 / 41405, n: 41743 },
  });

  it("keeps live calls and replays apart, each with its own season", () => {
    expect(recordFor(t, "live")).toMatchObject({ kind: "live", season: 2026, early: true });
    expect(recordFor(t, "backtest")).toMatchObject({ kind: "backtest", season: 2025, early: false });
    expect(defaultEvidence(t)).toBe("backtest");
  });

  it("splits correct and missed from the decisive calls, never from every scored call", () => {
    const v = recordFor(t, "backtest")!;
    expect(v.split).toEqual({ correct: 30554, missed: 10851, decided: 41405 });
    expect(v.split!.correct + v.split!.missed).toBe(v.block.decided);
    expect(v.split!.decided).not.toBe(v.block.n);
  });

  it("draws no split when the response doesn't say how many calls were decided", () => {
    const old = record({ seasons: [{ season: 2025, label: "x", live: null, backtest: { ...block({ n: 10, accuracy: 0.7, upsets: 3 }), decided: undefined as unknown as number } }] });
    expect(recordFor(old, "backtest")!.split).toBeNull();
  });

  it("says when there's no evidence of a kind instead of borrowing the other", () => {
    const onlyReplay = record({ seasons: [{ season: 2025, label: "x", live: null, backtest: block({ n: 5, decided: 5, accuracy: 0.6, upsets: 2 }) }] });
    expect(recordFor(onlyReplay, "live")).toBeNull();
    expect(defaultEvidence(onlyReplay)).toBe("backtest");
    expect(recordFor(record({}), "backtest")).toBeNull();
  });

  it("opens on live calls once the headline has switched to them", () => {
    const live = record({ ...t, headline: { kind: "live", season: 2026, accuracy: 0.75, n: 40 } });
    expect(defaultEvidence(live)).toBe("live");
  });
});

describe("public usage", () => {
  const base: PublicUsage = { status: "available", reason: null, from: "2026-09-18", to: "2026-10-17", measuredFrom: null, generatedAt: "2026-10-17T12:00:00Z", measuredThrough: "2026-10-17T12:00:00Z", coverage: "opt-in", totals: { pageViews: 0, sessionStarts: 0 }, daily: [] };
  it("shows a measured zero as zero", () => {
    expect(usageView(base)).toMatchObject({ kind: "available", totals: { pageViews: 0, sessionStarts: 0 } });
  });
  it("never turns an unpublished, empty, unreadable or unreachable feed into zero", () => {
    for (const reason of ["not-published", "no-data", "error"] as const) {
      const v = usageView({ ...base, status: "unavailable", reason, totals: null });
      expect(v.kind).toBe("unavailable");
      expect(v).not.toHaveProperty("totals");
    }
    expect(usageView(undefined)).toMatchObject({ kind: "unavailable", reason: "unreachable" });
  });
  it("starts the window at the first measured day", () => {
    expect(usageView({ ...base, measuredFrom: "2026-10-10" })).toMatchObject({ from: "2026-10-10", to: "2026-10-17" });
  });
});

describe("calendar status", () => {
  it("calls an event live only once results are coming in", () => {
    expect(eventState({ status: "live", matchesPlayed: 3, matchesTotal: 40 }).label).toBe("Live");
    expect(eventState({ status: "live", matchesPlayed: 0, matchesTotal: 0 }).tone).toBe("today");
    expect(eventState({ status: "upcoming", matchesPlayed: 0, matchesTotal: 0 }).label).toBe("Scheduled");
    expect(eventState({ status: "finished", matchesPlayed: 40, matchesTotal: 40 }).label).toBe("Completed");
  });
});

describe("atlas", () => {
  const o: Pick<HomeOverview, "countries" | "unmapped" | "coverage"> = {
    coverage: { teamListings: 20, events: 0, matchScores: 0 },
    countries: [
      { code: "US", numeric: "840", name: "United States", listings: 12, withResults: 3 },
      { code: "SG", numeric: "702", name: "Singapore", listings: 3, withResults: 0 },
      { code: "CA", numeric: "124", name: "Canada", listings: 2, withResults: 1 },
    ],
    unmapped: [{ label: null, listings: 2 }, { label: "Independent", listings: 1 }],
  };
  it("selects the country asked for, else the one with the most listings", () => {
    expect(pickCountry(o, "CA")?.code).toBe("CA");
    expect(pickCountry(o, "FR")?.code).toBe("US");
    expect(pickCountry(o, null)?.code).toBe("US");
    expect(pickCountry({ countries: [] }, "US")).toBeNull();
  });
  it("links to the country's team records, keeping a past season", () => {
    expect(countryHref("CA", 2026, 2026)).toBe("/teams?view=season&country=CA");
    expect(countryHref("CA", 2025, 2026)).toBe("/teams?view=season&season=2025&country=CA");
  });
  it("adds up: drawn + too small to draw + without a country = every listing", () => {
    const before = reconcile(o, null);
    expect(before).toMatchObject({ total: 20, drawn: 17, undrawn: 0, unmapped: 3 });
    const after = reconcile(o, new Set(["840", "124"]));
    expect(after).toMatchObject({ drawn: 14, undrawn: 3, unmapped: 3 });
    expect(after.undrawnCountries.map((c) => c.code)).toEqual(["SG"]);
    expect(after.drawn + after.undrawn + after.unmapped).toBe(after.total);
  });
  it("names listings without a country plainly", () => {
    expect(unmappedLabel(null)).toBe("Country not reported");
    expect(unmappedLabel("Independent")).toBe("Reported as “Independent”");
  });
});

describe("your team's next match", () => {
  const NOW = Date.parse("2026-10-17T15:00:00Z");
  const m = (label: string, o: Partial<MatchView>) => ({ label, played: false, startsAt: null, time: null, ...o }) as unknown as MatchView;
  it("skips played matches and left-over slots from finished events, keeps today's delays, earliest first", () => {
    const next = nextMatch([
      m("Q1", { played: true, startsAt: "2026-10-17T16:00:00Z" }),
      m("old", { startsAt: "2026-10-15T10:00:00Z" }),
      m("delayed", { startsAt: "2026-10-17T09:00:00Z" }),
      m("Q9", { startsAt: "2026-10-17T18:00:00Z" }),
    ], NOW);
    expect(next?.label).toBe("delayed");
  });
  it("reads a time without a zone with extra slack, and puts unscheduled matches last", () => {
    expect(nextMatch([m("tba", {}), m("local", { time: "2026-10-16T20:00:00" })], NOW)?.label).toBe("local");
    expect(nextMatch([m("tba", {})], NOW)?.label).toBe("tba");
    expect(nextMatch([m("stale", { time: "2026-10-15T08:00:00" })], NOW)).toBeUndefined();
  });
});
