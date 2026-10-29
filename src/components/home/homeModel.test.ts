// @vitest-environment node
// The home page's rules, apart from its markup: live calls and replays never mix,
// correct + missed come from one decisive-call denominator, an unavailable usage
// feed is never shown as zero, the atlas's listings always add up, and a stale
// left-over match is never "next".
import { describe, expect, it } from "vitest";
import type { AccuracyBlock, MatchView, TrackRecord } from "../../shared/api";
import type { HomeOverview, PublicUsage } from "../../shared/home";
import { defaultEvidence, eventState, homeReplays, recordFor, usageView } from "./homeModel";
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

  it("says when a live figure blends engine versions, with the serving engine's own figure beside it", () => {
    const e = (engine: string, n: number, accuracy: number, decided: number | undefined = n) => ({ engine, n, decided, accuracy, brier: 0.2, logLoss: 0.6 });
    const mixed = record({ engineVersion: "3.2.0", seasons: [{ ...t.seasons[0], liveByEngine: [e("3.2.0", 632, 0.601), e("2.1.1", 59, 0.49), e("2.6.0", 15, 0.73)] }, t.seasons[1]] });
    expect(recordFor(mixed, "live")!.engines).toEqual({ versions: ["2.1.1", "2.6.0", "3.2.0"], current: { engine: "3.2.0", n: 632, decided: 632, accuracy: 0.601 } });
    // One engine: nothing blended, so no label. The replay never carries engine splits.
    const single = record({ engineVersion: "3.2.0", seasons: [{ ...t.seasons[0], liveByEngine: [e("3.2.0", 40, 0.75)] }, t.seasons[1]] });
    expect(recordFor(single, "live")!.engines).toBeNull();
    expect(recordFor(mixed, "backtest")!.engines).toBeNull();
    // Blended, but the serving engine hasn't made a call yet: the versions, no current figure.
    const none = record({ engineVersion: "3.3.0", seasons: [{ ...t.seasons[0], liveByEngine: [e("3.2.0", 30, 0.6), e("2.1.1", 10, 0.5)] }] });
    expect(recordFor(none, "live")!.engines).toEqual({ versions: ["2.1.1", "3.2.0"], current: null });
    // The serving engine has only ties or 50:50 calls: the API's accuracy is a stand-in 0, so there's no percentage.
    const ties = record({ engineVersion: "3.3.0", seasons: [{ ...t.seasons[0], liveByEngine: [e("3.2.0", 30, 0.6), e("3.3.0", 4, 0, 0)] }] });
    expect(recordFor(ties, "live")!.engines!.current).toEqual({ engine: "3.3.0", n: 4, decided: 0, accuracy: null });
    // An older response without the decided count: no percentage either, never a guess.
    const old = record({ engineVersion: "3.3.0", seasons: [{ ...t.seasons[0], liveByEngine: [e("3.2.0", 30, 0.6), { engine: "3.3.0", n: 4, accuracy: 0.5, brier: 0.2, logLoss: 0.6 }] }] });
    expect(recordFor(old, "live")!.engines!.current).toEqual({ engine: "3.3.0", n: 4, decided: null, accuracy: null });
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

  it("keeps last season's replay beside this season's, even once this season's replay is the headline", () => {
    const t = record({
      seasons: [
        { season: 2026, label: "2026–27 BIOBUZZ", live: block({ n: 900, decided: 890, accuracy: 0.6 }), backtest: block({ n: 12000, decided: 11900, accuracy: 0.7 }) },
        { season: 2025, label: "2025–26 DECODE", live: null, backtest: block({ n: 41743, decided: 41405, accuracy: 0.738 }) },
      ],
      headline: { kind: "backtest", season: 2026, accuracy: 0.7, n: 12000 },
    });
    const { replay, soFar } = homeReplays(t);
    expect(replay).toMatchObject({ season: 2025, isHeadline: false });
    expect(soFar).toMatchObject({ season: 2026, isHeadline: true });
    // One replayed season: it's the only replay, with no "so far" beside it.
    const one = record({ seasons: [{ season: 2025, label: "x", live: null, backtest: block({ n: 5, decided: 5, accuracy: 0.6 }) }] });
    expect(homeReplays(one)).toMatchObject({ replay: { season: 2025 }, soFar: null });
    // The current season has no replay yet: last season's is the one replay, never filed as "so far".
    const early = record({
      seasons: [
        { season: 2026, label: "2026–27", live: block({ n: 4, decided: 4, accuracy: 0.5 }), backtest: null },
        { season: 2025, label: "2025–26", live: null, backtest: block({ n: 400, decided: 390, accuracy: 0.7 }) },
        { season: 2024, label: "2024–25", live: null, backtest: block({ n: 300, decided: 290, accuracy: 0.69 }) },
      ],
    });
    expect(homeReplays(early)).toMatchObject({ replay: { season: 2025 }, soFar: null });
  });

  it("shows the last full season's replay, not the partial replay of the season being logged live", () => {
    // The season in progress has both: its partial replay stays out of the replay tab while a full season's exists.
    const rollover = record({
      seasons: [
        { season: 2026, label: "2026–27 BIOBUZZ", live: block({ n: 592, decided: 586, accuracy: 0.578, upsets: 247 }), backtest: block({ n: 939, decided: 920, accuracy: 0.667, upsets: 306 }) },
        { season: 2025, label: "2025–26 DECODE", live: null, backtest: block({ n: 41743, decided: 41405, accuracy: 0.738, upsets: 10851 }) },
      ],
      headline: { kind: "live", season: 2026, accuracy: 0.578, n: 592 },
    });
    expect(recordFor(rollover, "backtest")).toMatchObject({ season: 2025, seasonLabel: "2025–26 DECODE" });
    expect(recordFor(rollover, "live")).toMatchObject({ season: 2026, isHeadline: true });
    // With no other season replayed, the newest replay still shows.
    expect(recordFor(record({ seasons: [rollover.seasons[0]] }), "backtest")).toMatchObject({ season: 2026 });
    // A finished season keeps its saved live calls; only the season being logged live (the newest with live calls) is skipped.
    const finishedWithLive = record({ ...rollover, seasons: [rollover.seasons[0], { ...rollover.seasons[1], live: block({ n: 300, decided: 296, accuracy: 0.7, upsets: 89 }) }] });
    expect(recordFor(finishedWithLive, "backtest")).toMatchObject({ season: 2025, seasonLabel: "2025–26 DECODE" });
  });

  it("has no percentage when every scored call was a tie or a 50:50 call (accuracy is a stand-in 0 then)", () => {
    const ties = record({ seasons: [{ season: 2026, label: "x", live: block({ n: 3, decided: 0, accuracy: 0, upsets: 0 }), backtest: null }] });
    expect(recordFor(ties, "live")).toMatchObject({ noneDecided: true, split: null });
    expect(recordFor(t, "backtest")!.noneDecided).toBe(false);
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
