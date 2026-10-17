/**
 * Engine 2.0 rule repairs, checked against the official BIOBUZZ manuals
 * (Section 4 V1 Table 4-2, Section 6 TU04 A211, Section 13 V1 Table 13-1,
 * Section 10 TU05 Tables 10-2/10-3), and recorded bonus RPs kept as facts.
 */
import { describe, it, expect } from "vitest";
import { awardPoints, compareAdvancement, rankingPoints, tiebreakKeys, type AdvancementEntry } from "../rules";
import { simulateEvent, type SimInput, type QualMatch } from "../sim";
import { RatingBook } from "../rating";
import { Forecaster, type PredictModel, type AdvancementRecord } from "../forecast";
import { FITTED_MODEL } from "../model";
import type { EventInput, BonusFlags } from "../inputs";
import type { TeamRating } from "../types";

const rt = (np: number): TeamRating => ({ auto: np * 0.2, teleop: np * 0.7, endgame: np * 0.1, pen: 0, n: 20, uncertainty: 0 });

describe("award points (A211)", () => {
  it("Compass is an individual award: no advancement points", () => {
    expect(awardPoints([{ type: "Compass", placement: 1 }])).toBe(0);
    expect(awardPoints([{ type: "Compass", placement: 1 }, { type: "Think", placement: 2 }])).toBe(6);
  });
  it("team judged awards keep their points", () => {
    expect(awardPoints([{ type: "Inspire", placement: 1 }])).toBe(60);
    expect(awardPoints([{ type: "Reach", placement: 1 }])).toBe(12);
    expect(awardPoints([{ type: "Winner", placement: 1 }])).toBe(0);
  });
});

describe("qualification ranking (Table 13-1)", () => {
  it("BIOBUZZ sorts by non-foul points, then TIPS, then auto points", () => {
    expect(tiebreakKeys(2026, { np: 100, auto: 20, endgame: 10, tips: 3 })).toEqual([100, 3, 20]);
    // TIPS not reported: equal for everyone, so auto decides.
    expect(tiebreakKeys(2026, { np: 100, auto: 20, endgame: 10 })).toEqual([100, 0, 20]);
  });
  it("DECODE (2025) sorts by non-foul points, then BASE (endgame), then auto; earlier seasons unchanged", () => {
    expect(tiebreakKeys(2025, { np: 100, auto: 20, endgame: 10 })).toEqual([100, 10, 20]);
    expect(tiebreakKeys(2024, { np: 100, auto: 20, endgame: 10 })).toEqual([20, 10]);
  });
  it("ranking points count recorded bonus RPs (flags or a count)", () => {
    expect(rankingPoints(2026, { total: 50, bonus: { movement: true, goal: true, pattern: false } }, { total: 40 })).toBe(5);
    expect(rankingPoints(2026, { total: 40, bonus: 2 }, { total: 40 })).toBe(3);
    expect(rankingPoints(2024, { total: 50, bonus: 3 }, { total: 40 })).toBe(2);
  });
});

describe("advancement order (Table 4-2)", () => {
  const e = (x: Partial<AdvancementEntry>): AdvancementEntry => ({ total: 51, awards: 0, playoffs: 0, alliance: 0, quals: 0, avgNp: 0, avgAuto: 0, bestNp: 0, secondNp: 0, ...x });
  it("equal totals: judged award points come before qualification performance", () => {
    const rank4 = e({ quals: 13, alliance: 18, playoffs: 20 }), rank5 = e({ quals: 12, alliance: 17, awards: 12, playoffs: 10 });
    expect(compareAdvancement(rank5, rank4)).toBeLessThan(0); // rank 5 goes first
  });
  it("then playoff, alliance, qualification points, average NP, average auto, best and second-best NP", () => {
    expect(compareAdvancement(e({ playoffs: 20 }), e({ alliance: 18 }))).toBeLessThan(0);
    expect(compareAdvancement(e({ alliance: 18 }), e({ quals: 16 }))).toBeLessThan(0);
    expect(compareAdvancement(e({ quals: 12 }), e({ avgNp: 200 }))).toBeLessThan(0);
    expect(compareAdvancement(e({ avgNp: 90 }), e({ avgNp: 80, avgAuto: 50 }))).toBeLessThan(0);
    expect(compareAdvancement(e({ avgAuto: 30 }), e({ avgAuto: 20, bestNp: 300 }))).toBeLessThan(0);
    expect(compareAdvancement(e({ bestNp: 150 }), e({ bestNp: 140, secondNp: 140 }))).toBeLessThan(0);
    expect(compareAdvancement(e({ secondNp: 120 }), e({ secondNp: 110 }))).toBeLessThan(0);
    expect(compareAdvancement(e({}), e({}))).toBe(0);
  });

  it("the simulator advances the award winner over the better-ranked team on a points tie", () => {
    // 12 teams, official ranks 1..12, alliances fixed; rank 4 and rank 5 tie on
    // points once rank 5 holds a 2nd-place judged award worth the gap.
    const n = 12;
    const ratings = new Map(Array.from({ length: n }, (_, i) => [i + 1, rt(n - i)] as [number, TeamRating]));
    const ranks = new Map(Array.from({ length: n }, (_, i) => [i + 1, i + 1] as [number, number]));
    const base: SimInput = { season: 2026, ratings, quals: [], ranks, alliances: [[1, 2], [3, 4], [5, 6], [7, 8]], noise: { a: 0, b: 0 }, awards: { mode: "none" }, prequalified: new Set(), slots: 1, runs: 1, seed: 4 };
    const pts = simulateEvent(base);
    const gap = pts.get(4)!.points.total - pts.get(5)!.points.total;
    const award = [["Think", 1, 12], ["Think", 2, 6], ["Think", 3, 3]].find(([, , p]) => p === gap);
    expect(award).toBeDefined();
    const others = new Set(Array.from({ length: n }, (_, i) => i + 1).filter((t) => t !== 4 && t !== 5));
    const out = simulateEvent({ ...base, awards: { mode: "actual", awards: new Map([[5, [{ type: award![0] as string, placement: award![1] as number }]]]) }, ineligible: others });
    expect(out.get(5)!.pAdvance).toBe(1);
    expect(out.get(4)!.pAdvance).toBe(0);
  });
});

describe("recorded bonus RPs in event simulation", () => {
  const four = new Map([1, 2, 3, 4].map((t) => [t, rt(50)] as [number, TeamRating]));
  const played = (rb: BonusFlags | undefined, bb: BonusFlags | undefined, red = [1, 2], blue = [3, 4]): QualMatch => ({
    red, blue, result: { red: { total: 50, np: 50, auto: 10, endgame: 5, bonus: rb }, blue: { total: 50, np: 50, auto: 10, endgame: 5, bonus: bb } },
  });
  const sim = (quals: QualMatch[], extra: Partial<SimInput> = {}) => simulateEvent({ season: 2026, ratings: four, quals, noise: { a: 14, b: 0.2 }, awards: { mode: "none" }, prequalified: new Set(), slots: 1, runs: 200, seed: 3, ...extra });

  it("a recorded achievement decides the ranking exactly", () => {
    const yes = { movement: true, goal: true, pattern: true }, no = { movement: false, goal: false, pattern: false };
    const out = sim([played(yes, no), played(yes, no, [1, 2], [3, 4])]);
    for (const t of [1, 2]) expect(out.get(t)!.rankP90).toBeLessThanOrEqual(2);
    for (const t of [3, 4]) expect(out.get(t)!.rankP10).toBeGreaterThanOrEqual(3);
  });

  it("an unreported achievement is sampled per run, not fixed", () => {
    // Equal scores, red's flags unknown, blue's known as none: with a model
    // that gives ~50% per bonus, red sometimes out-ranks blue and sometimes not.
    const half = { movement: [0, 0], goal: [0, 0], pattern: [0, 0] } as SimInput["bonus"];
    const out = sim([played(undefined, { movement: false, goal: false, pattern: false })], { bonus: half });
    expect(out.get(1)!.rankP10).toBe(1);
    expect(out.get(1)!.rankP90).toBeGreaterThan(1);
  });

  it("without a season model, unplayed alliances draw from the event's recorded bonus counts", () => {
    const unplayed: QualMatch[] = [{ red: [1, 3], blue: [2, 4] }, { red: [1, 4], blue: [2, 3] }];
    // A constant draw adds the same RPs to everyone: same order as drawing 0s.
    const zeros = sim(unplayed, { bonusSamples: [0] });
    const threes = sim(unplayed, { bonusSamples: [3] });
    expect([...threes.values()].map((o) => o.meanRank)).toEqual([...zeros.values()].map((o) => o.meanRank));
    // A mixed record makes them matter.
    const mixed = sim(unplayed, { bonusSamples: [0, 3] });
    expect([...mixed.values()].map((o) => o.meanRank)).not.toEqual([...zeros.values()].map((o) => o.meanRank));
  });
});

class FixtureForecaster extends Forecaster {
  protected readonly model: PredictModel = FITTED_MODEL;
  protected readonly awardHistory = new Map();
  readonly b: RatingBook;
  stored: BonusFlags | null = null;
  constructor() { super(); this.b = new RatingBook(FITTED_MODEL.rating); this.b.startSeason(2025); }
  protected book() { return this.b; }
  protected hasRatings() { return true; }
  storedPlayedKeys() { return new Set<string>(); }
  protected advancementRecords(): AdvancementRecord[] { return []; }
  protected regionOf() { return null; }
  protected awardSlots() { return []; }
  protected recordedBonus() { return this.stored; }
  inputFor(ev: EventInput) { return (this as unknown as { simInput(e: EventInput, s: string, b: RatingBook, r: number): { input: SimInput; assumptions: string[] } }).simInput(ev, "live", this.b, 50); }
}

describe("Forecaster keeps recorded bonus RPs of played matches", () => {
  const sc = (bonusRp?: BonusFlags | null) => ({ total: 100, totalNp: 100, auto: 20, teleop: 70, endgame: 10, penaltiesCommitted: 0, bonusRp });
  const event = (bonusRp?: BonusFlags | null): EventInput => ({
    season: 2025, code: "FIX", type: "Qualifier", start: "2025-11-01", end: "2025-11-01",
    field: [1, 2, 3, 4].map((t) => ({ teamNumber: t, rank: null })), alliances: [],
    matches: [
      { key: "qual:0:1", label: "Q1", level: "qual", series: 0, number: 1, time: "2025-11-01T10:00:00Z", played: true, red: { teams: [{ number: 1 }, { number: 2 }], score: sc(bonusRp) }, blue: { teams: [{ number: 3 }, { number: 4 }], score: sc(bonusRp) } },
      { key: "qual:0:2", label: "Q2", level: "qual", series: 0, number: 2, time: "2025-11-01T10:10:00Z", played: false, red: { teams: [{ number: 1 }, { number: 3 }], score: null }, blue: { teams: [{ number: 2 }, { number: 4 }], score: null } },
    ],
  });

  it("uses the payload's recorded flags as facts (no score-threshold guess)", () => {
    // At 100 NP the old threshold guessed movement=true, goal=false, pattern=false.
    const flags = { movement: false, goal: true, pattern: true };
    const { input, assumptions } = new FixtureForecaster().inputFor(event(flags));
    expect(input.quals[0].result!.red.bonus).toEqual(flags);
    expect(assumptions.join(" ")).not.toMatch(/estimated from their scores/);
  });

  it("falls back to the app's stored record when the payload has none", () => {
    const f = new FixtureForecaster();
    f.stored = { movement: true, goal: true, pattern: false };
    expect(f.inputFor(event(null)).input.quals[0].result!.blue.bonus).toEqual(f.stored);
  });

  it("passes per-team DQs and recorded TIPS of played matches to the simulator", () => {
    const ev = event({ movement: false, goal: false, pattern: false });
    ev.matches[0].red.teams[0].dq = true;
    ev.matches[0].red.score!.tips = 4;
    const q = new FixtureForecaster().inputFor(ev).input.quals[0];
    expect(q.dq).toEqual([1]);
    expect(q.result!.red.tips).toBe(4);
    expect(q.result!.blue.tips).toBeUndefined();
  });

  it("leaves genuinely unknown flags missing and says they're sampled", () => {
    const { input, assumptions } = new FixtureForecaster().inputFor(event(undefined));
    expect(input.quals[0].result!.red.bonus).toBeUndefined();
    expect(assumptions.join(" ")).toMatch(/weren't reported for 2 played alliance results/);
  });
});

describe("per-team disqualification (T601) and TIPS", () => {
  const four = new Map([1, 2, 3, 4].map((t) => [t, rt(50)] as [number, TeamRating]));
  const res = (r: number, b: number, tips: [number, number] = [0, 0]) => ({ red: { total: r, np: r, auto: 10, endgame: 5, bonus: { movement: false, goal: false, pattern: false }, tips: tips[0] }, blue: { total: b, np: b, auto: 10, endgame: 5, bonus: { movement: false, goal: false, pattern: false }, tips: tips[1] } });
  const sim = (quals: QualMatch[]) => simulateEvent({ season: 2026, ratings: four, quals, noise: { a: 14, b: 0.2 }, awards: { mode: "none" }, prequalified: new Set(), slots: 1, runs: 50, seed: 2 });

  it("a disqualified team earns 0 for that match; its partner keeps the alliance's result", () => {
    // Red wins both matches; team 1 is disqualified in the first.
    const out = sim([{ red: [1, 2], blue: [3, 4], result: res(100, 50), dq: [1] }, { red: [1, 2], blue: [3, 4], result: res(100, 50) }]);
    expect(out.get(2)!.meanRank).toBe(1); // 3 RP per match vs team 1's 0 + 3
    expect(out.get(1)!.meanRank).toBe(2);
  });

  it("BIOBUZZ ties on RP and non-foul points are broken by average TIPS", () => {
    const out = sim([{ red: [1, 2], blue: [3, 4], result: res(80, 80, [6, 2]) }]);
    for (const t of [1, 2]) expect(out.get(t)!.rankP90).toBeLessThanOrEqual(2);
    for (const t of [3, 4]) expect(out.get(t)!.rankP10).toBeGreaterThanOrEqual(3);
  });
});
