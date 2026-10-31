import { describe, expect, it } from "vitest";
import { bracketOdds, bracketShape, lineup, seriesWinProb, type BracketAlliance, type BracketMatch, type Price } from "./bracketOdds";

// Alliance n's robots are 100n + 1 and 100n + 2; strength falls with the seed, so seed 1 is the favourite.
const alliances = (n: number): BracketAlliance[] => Array.from({ length: n }, (_, i) => ({ number: i + 1, teams: [100 * (i + 1) + 1, 100 * (i + 1) + 2] }));
const strength = (t: number) => 100 - Math.floor(t / 100) * 10;
/** A logistic call on the line-ups' summed strengths. */
const price: Price = (a, b) => {
  const s = (xs: number[]) => xs.reduce((x, t) => x + strength(t), 0);
  return { p: 1 / (1 + Math.exp(-(s(a) - s(b)) / 20)), tier: "confident" };
};
/** A played match: alliance `w` beat alliance `l` in series s. */
const played = (series: number, w: number, l: number, number = 1): BracketMatch => ({ series, number, red: [100 * w + 1, 100 * w + 2], blue: [100 * l + 1, 100 * l + 2], redScore: 200, blueScore: 100 });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("bracketShape", () => {
  it("reads the format from the season, alliance count and posted series", () => {
    expect(bracketShape(2025, 2, [0])?.format).toBe("final");
    expect(bracketShape(2025, 4, [1, 2, 3])?.format).toBe("double");
    expect(bracketShape(2025, 4, [])?.nodes).toHaveLength(7); // 6 + the if-needed replay
    expect(bracketShape(2025, 8, [])?.nodes).toHaveLength(15);
    expect(bracketShape(2023, 4, [0, 1, 2])?.format).toBe("classic");
    expect(bracketShape(2025, 3, [1])).toBeNull();
    expect(bracketShape(2023, 6, [1])).toBeNull();
    expect(bracketShape(2025, 4, [1, 9])).toBeNull(); // a series past the bracket
  });

  it("shifts a double bracket numbered from 0", () => {
    const s = bracketShape(2024, 4, [0, 1, 2])!;
    expect(s.nodes[0].series).toBe(0);
    expect(s.nodes[5].stage).toBe("Grand final");
  });

  it("names the stages", () => {
    const s = bracketShape(2025, 8, [])!;
    expect(s.nodes.map((n) => n.stage)).toEqual([
      "Upper bracket", "Upper bracket", "Upper bracket", "Upper bracket", "Lower bracket", "Lower bracket", "Upper bracket", "Upper bracket",
      "Lower bracket", "Lower bracket", "Upper final", "Lower bracket", "Lower final", "Grand final", "Final (if needed)",
    ]);
  });
});

describe("seriesWinProb", () => {
  it("prices best-of-N from the current score", () => {
    expect(seriesWinProb(0.6, 1)).toBeCloseTo(0.6);
    expect(seriesWinProb(0.6, 3)).toBeCloseTo(0.6 * 0.6 + 2 * 0.6 * 0.4 * 0.6);
    expect(seriesWinProb(0.6, 3, 1, 0)).toBeCloseTo(0.6 + 0.4 * 0.6);
    expect(seriesWinProb(0.6, 3, 2, 0)).toBe(1);
    expect(seriesWinProb(0.6, 3, 0, 2)).toBe(0);
  });
});

describe("lineup", () => {
  it("fields a three-robot alliance's two strongest", () => {
    expect(lineup([1, 2, 3], (t) => [0, 5, 9, 7][t])).toEqual([2, 3]);
    expect(lineup([1, 2], () => null)).toEqual([1, 2]);
  });
});

describe("bracketOdds", () => {
  it("gives every alliance odds that add up to one, the top seed first", () => {
    const o = bracketOdds({ season: 2025, alliances: alliances(4), matches: [], price, strength, runs: 4000, seed: 1 });
    expect(o.format).toBe("double");
    expect(sum(o.alliances.map((a) => a.pChampion))).toBeCloseTo(1, 6);
    expect(sum(o.alliances.map((a) => a.pFinal))).toBeCloseTo(2, 6);
    const p = o.alliances.map((a) => a.pChampion);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[3]);
    // First-round calls are priced; later ones show their likeliest winner.
    expect(o.series[0].call).toMatchObject({ alliance: 1 });
    expect(o.series[0].call!.p).toBeCloseTo(price([101, 102], [401, 402]).p, 6);
    expect(o.series[3].call).toBeNull();
    expect(o.series[3].likely?.alliance).toBe(1);
    expect(o.series[6].pending).toBe(true);
    // Unknown sides name the likeliest match-up: two different alliances.
    for (const x of o.series.filter((v) => v.red.likely && v.blue.likely)) expect(x.red.likely!.alliance).not.toBe(x.blue.likely!.alliance);
  });

  it("is deterministic for a seed", () => {
    const a = bracketOdds({ season: 2025, alliances: alliances(6), matches: [], price, strength, runs: 2000, seed: 7 });
    const b = bracketOdds({ season: 2025, alliances: alliances(6), matches: [], price, strength, runs: 2000, seed: 7 });
    expect(a).toEqual(b);
  });

  it("conditions on the series already played", () => {
    // 4 upset 1, and 1 then lost the lower bracket: 1 is out; 4 is in the upper final.
    const matches = [played(1, 4, 1), played(2, 2, 3), played(3, 3, 1)];
    const o = bracketOdds({ season: 2025, alliances: alliances(4), matches, price, strength, runs: 3000, seed: 3 });
    const by = new Map(o.alliances.map((a) => [a.alliance, a]));
    expect(by.get(1)).toMatchObject({ status: "out", pChampion: 0, danger: null });
    expect(by.get(4)!.status).toBe("alive");
    expect(o.series[0].winner).toBe(4);
    expect(o.series[3].red.alliance).toBe(4); // M4: winner M1 v winner M2
    expect(o.series[3].blue.alliance).toBe(2);
    expect(o.series[3].call?.alliance).toBe(2);
    expect(sum(o.alliances.map((a) => a.pChampion))).toBeCloseTo(1, 6);
  });

  it("names a champion and skips the replay when the upper alliance wins the grand final", () => {
    const matches = [played(1, 1, 4), played(2, 2, 3), played(3, 4, 3), played(4, 1, 2), played(5, 2, 4), played(6, 1, 2)];
    const o = bracketOdds({ season: 2025, alliances: alliances(4), matches, price, strength, runs: 500, seed: 3 });
    expect(o.alliances.map((a) => a.status)).toEqual(["champion", "out", "out", "out"]);
    expect(o.alliances[0].pChampion).toBe(1);
    expect(o.series[6].skipped).toBe(true);
  });

  it("plays the replay when the lower alliance wins the grand final", () => {
    const matches = [played(1, 1, 4), played(2, 2, 3), played(3, 4, 3), played(4, 1, 2), played(5, 2, 4), played(6, 2, 1)];
    const o = bracketOdds({ season: 2025, alliances: alliances(4), matches, price, strength, runs: 2000, seed: 3 });
    expect(o.alliances.filter((a) => a.status === "alive").map((a) => a.alliance)).toEqual([1, 2]);
    expect(o.series[6].call?.alliance).toBe(1);
    expect(o.alliances[0].pChampion).toBeCloseTo(o.series[6].call!.p, 1);
    expect(o.alliances[0].danger).toMatchObject({ label: "M7", opponent: 2 });
  });

  it("prices a best-of-3 final from its score", () => {
    const o = bracketOdds({ season: 2025, alliances: alliances(2), matches: [played(0, 2, 1, 1)], price, strength, runs: 2000, seed: 1 });
    expect(o.format).toBe("final");
    expect(o.series[0].wins).toEqual([0, 1]);
    const p = price([101, 102], [201, 202]).p;
    expect(o.series[0].call!.p).toBeCloseTo(Math.max(p * p, 1 - p * p), 6);
  });

  it("runs the 2023–24 semifinals and final", () => {
    const o = bracketOdds({ season: 2023, alliances: alliances(4), matches: [played(1, 1, 4, 1), played(1, 1, 4, 2)], price, strength, runs: 2000, seed: 1 });
    expect(o.format).toBe("classic");
    expect(o.series[0].winner).toBe(1);
    expect(o.series[2].red.alliance).toBe(1);
    expect(o.alliances[3]).toMatchObject({ status: "out", pChampion: 0 });
  });

  it("falls back to series calls for a format it can't map", () => {
    const o = bracketOdds({ season: 2025, alliances: alliances(3), matches: [{ ...played(1, 1, 2), redScore: null, blueScore: null }], price, strength });
    expect(o.format).toBe("unknown");
    expect(o.alliances).toEqual([]);
    expect(o.note).toMatch(/3-alliance/);
    expect(o.series[0].call?.alliance).toBe(1);
  });

  it("withholds championship odds while a later series is posted ahead of an earlier result", () => {
    // M4's line-up (winner M1 v winner M2) is posted, but M1's result isn't in yet.
    const m1 = { ...played(1, 1, 4), redScore: null, blueScore: null };
    const o = bracketOdds({ season: 2025, alliances: alliances(4), matches: [m1, played(2, 2, 3), { ...played(4, 1, 2), redScore: null, blueScore: null }], price, strength });
    expect(o.format).toBe("unknown");
    expect(o.alliances).toEqual([]);
    expect(o.note).toMatch(/earlier result/);
  });

  it("keeps a zero-based double bracket's single-match rounds while a result is missing", () => {
    // Series numbered from 0: M1 is series 0 (decided), M4 (series 3) posted while M2 (series 1) has no result yet.
    const m2 = { ...played(1, 2, 3), redScore: null, blueScore: null };
    const o = bracketOdds({ season: 2025, alliances: alliances(4), matches: [played(0, 1, 4), m2, { ...played(3, 1, 2), redScore: null, blueScore: null }], price, strength });
    expect(o.format).toBe("unknown");
    expect(o.series[0]).toMatchObject({ series: 0, label: "M1", stage: "Upper bracket", bestOf: 1, winner: 1, call: null });
    expect(o.series.map((s) => s.label)).toEqual(["M1", "M2", "M4"]);
  });

  it("keeps 2023–24 series best-of-3 in the calls-only fallback", () => {
    // Seeds 2 and 3 in series 1 doesn't fit the 1 v 4 semifinal: calls only, and one win doesn't end the series.
    const o = bracketOdds({ season: 2023, alliances: alliances(4), matches: [played(1, 2, 3, 1), { ...played(1, 2, 3, 2), redScore: null, blueScore: null }], price, strength });
    expect(o.format).toBe("unknown");
    expect(o.series[0]).toMatchObject({ bestOf: 3, winner: null, wins: [1, 0] });
    expect(o.series[0].call?.alliance).toBe(2);
  });

  it("falls back when a posted series contradicts the bracket", () => {
    // M1 is seed 1 v seed 4, but 2 and 3 played it.
    const o = bracketOdds({ season: 2025, alliances: alliances(4), matches: [played(1, 2, 3)], price, strength });
    expect(o.format).toBe("unknown");
    expect(o.note).toMatch(/don't fit/);
  });
});
