import { describe, expect, it } from "vitest";
import { disagreementMode, findDisagreements, minGapFor, RULES, type DisagreementInput } from "./disagreements";

/** A field of n teams seeded 1..n, rated in the same order unless `rate` says otherwise. */
function field(n: number, o: { rate?: (rank: number) => number; matches?: number; qual?: number; sd?: number } = {}): DisagreementInput[] {
  return Array.from({ length: n }, (_, i) => ({
    team: 1000 + i + 1, name: `Team ${i + 1}`, rank: i + 1, qualPlayed: o.qual ?? 5, wins: 3, losses: 2, ties: 0, rp: 2,
    opr: 50, seasonOpr: 45, rating: { np: o.rate ? o.rate(i + 1) : 100 - (i + 1) * 3, sd: o.sd ?? 2, matches: o.matches ?? 12 }, prior: null,
  }));
}
const opts = { season: 2025, code: "X", finished: false, ratingsAsOf: "now" as const };

describe("findDisagreements", () => {
  it("finds nothing when the model's order and the seeding agree", () => {
    const v = findDisagreements(field(24), opts);
    expect(v.hidden).toBeNull();
    expect(v.mode).toBe("quals");
    expect(v.rows).toEqual([]);
  });

  it("calls out a team the model rates well above its seed, with the numbers behind it", () => {
    // Seed 18 is rated like a 3rd seed.
    const v = findDisagreements(field(24, { rate: (r) => (r === 18 ? 100 - 2.5 * 3 : 100 - r * 3) }), opts);
    const up = v.rows.filter((r) => r.direction === "model-higher");
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ team: 1018, modelPlace: 3, seedPlace: 18, seed: { rank: 18, of: 24, event: null }, tier: "confident", oprKind: "event", record: { wins: 3, losses: 2, ties: 0 } });
    expect(up[0].gap).toBe(15);
    expect(up[0].margin).toBeGreaterThan(0);
    // The teams it passed each slide one place down the model's order: too small a gap to show.
    expect(v.rows.filter((r) => r.direction === "seed-higher")).toEqual([]);
  });

  it("never phrases a call as a verdict", () => {
    const v = findDisagreements(field(24, { rate: (r) => (r === 18 ? 100 : r === 2 ? 30 : 100 - r * 3) }), opts);
    const text = JSON.stringify(v).toLowerCase();
    for (const w of ["overrated", "underrated", "underperform", "overperform", "lucky", "fraud"]) expect(text).not.toContain(w);
    expect(v.rows.map((r) => r.direction).sort()).toEqual(["model-higher", "seed-higher"]);
  });

  it("hides tiny events and thin ratings", () => {
    expect(findDisagreements(field(8), opts).hidden).toMatch(/too small a field/);
    const thin = findDisagreements(field(24, { matches: RULES.minRatingMatches - 1 }), opts);
    expect(thin.hidden).toMatch(/enough matches/);
    expect(thin.rows).toEqual([]);
  });

  it("marks calls on few matches provisional", () => {
    const v = findDisagreements(field(24, { matches: 6, rate: (r) => (r === 20 ? 99 : 100 - r * 3) }), opts);
    expect(v.rows[0]).toMatchObject({ team: 1020, tier: "provisional" });
  });

  it("leaves out a gap the model can't tell from its own uncertainty", () => {
    // Ratings almost flat with large uncertainty: a big gap in places, a tiny one in points.
    const v = findDisagreements(field(24, { sd: 10, rate: (r) => (r === 18 ? 60.5 : 60 - r * 0.05) }), opts);
    expect(v.rows).toEqual([]);
  });

  it("before quals, compares with each team's seed at its last event, scaled to this field", () => {
    const f = field(20, { qual: 0 }).map((x, i) => ({ ...x, rank: null, wins: null, losses: null, rp: null, opr: null, prior: { rank: i + 1, of: 20, code: `P${i}`, name: "Earlier" } }));
    // The last seed of its last event is rated 2nd here.
    f[19] = { ...f[19], rating: { np: 96, sd: 2, matches: 10 } };
    const v = findDisagreements(f, opts);
    expect(v.mode).toBe("pre-quals");
    const up = v.rows.find((r) => r.team === 1020)!;
    expect(up).toMatchObject({ direction: "model-higher", modelPlace: 2, seedPlace: 20, seed: { rank: 20, of: 20, event: { code: "P19", name: "Earlier" } }, oprKind: "season", opr: 45, record: null });
  });

  it("before quals, leaves out last-event seeds from tiny fields", () => {
    const f = field(20, { qual: 0 }).map((x, i) => ({ ...x, rank: null, prior: { rank: (i % 4) + 1, of: 4, code: "P", name: "Tiny" } }));
    expect(findDisagreements(f, opts).hidden).toMatch(/seed from an earlier event/);
  });

  it("a finished event with no seeding of its own shows nothing", () => {
    const f = field(30, { qual: 0 }).map((x) => ({ ...x, rank: null }));
    const v = findDisagreements(f, { ...opts, finished: true });
    expect(v.hidden).toMatch(/No official seeding/);
  });

  it("goes by the median matches played for the mode", () => {
    expect(disagreementMode(field(20, { qual: 2 }), false)).toBe("pre-quals");
    expect(disagreementMode(field(20, { qual: 3 }), false)).toBe("quals");
    expect(disagreementMode(field(20, { qual: 3 }), true)).toBe("final");
  });

  it("keeps at most five per side, biggest gaps first", () => {
    // Every other team in the bottom half rated like a top team.
    const v = findDisagreements(field(60, { rate: (r) => (r > 30 && r % 2 ? 200 - r : 100 - r) }), opts);
    const up = v.rows.filter((r) => r.direction === "model-higher");
    expect(up).toHaveLength(RULES.perSide);
    expect(up.map((r) => r.gap)).toEqual([...up.map((r) => r.gap)].sort((a, b) => b - a));
  });

  it("scales the smallest gap with the field", () => {
    expect(minGapFor(12)).toBe(4);
    expect(minGapFor(48)).toBe(10);
  });
});
