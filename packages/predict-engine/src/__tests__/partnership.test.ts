import { describe, it, expect } from "vitest";
import { RatingBook } from "../rating";
import { explainMatch } from "../explain";
import { predictMatch } from "../matchModel";
import { FITTED_MODEL } from "../model";
import { PARTNERSHIP_PARAMS, PartnershipBook, PartnershipTable, partnershipFact, partnershipFeatures, partnershipShift, shrunkEffect } from "../partnership";
import type { MatchRecord } from "../types";

const al = (teams: number[], np: number) => ({ teams, auto: Math.round(np / 4), teleop: np - Math.round(np / 4) - 10, endgame: 10, np, penCommitted: 0, total: np });
let n = 0;
const match = (season: number, code: string, red: [number[], number], blue: [number[], number], level: "qual" | "playoff" = "qual"): MatchRecord => {
  n++;
  return { season, eventCode: code, level, series: 0, number: n, time: Date.UTC(season, 10, 1) + n * 60_000, red: al(...red), blue: al(...blue) };
};

/** 2024: teams 1 + 2 play together three times and score far above their ratings; 1 meets 3 twice. */
function history(): PartnershipBook {
  const b = new PartnershipBook(FITTED_MODEL.rating);
  b.nameEvent(2024, "NJCMP", "NJ Championship");
  for (let i = 0; i < 4; i++) b.observe(match(2024, "WARM", [[5, 6], 100], [[7, 8], 100]));
  b.observe(match(2024, "NJCMP", [[1, 2], 180], [[3, 4], 90]));
  b.observe(match(2024, "NJCMP", [[1, 2], 132 + 60], [[3, 9], 80]));
  b.observe(match(2024, "NJCMP", [[1, 2], 170], [[5, 6], 95]));
  b.observe(match(2024, "NJCMP", [[1, 7], 100], [[8, 9], 100])); // a single pairing: pruned at the season's end
  return b;
}

describe("partnership memory", () => {
  it("counts matches together, the record, and the best score with where it came", () => {
    const t = history().together(2, 1)!;
    expect(t.n).toBe(3);
    expect([t.wins, t.losses, t.ties]).toEqual([3, 0, 0]);
    expect(t.best).toBe(192);
    expect(t.bestEvent).toBe("NJCMP");
    expect(t.z).toBeGreaterThan(0); // above what the ratings expected
    const a = history().against(3, 1)!; // stored from team 1's side
    expect(a.n).toBe(2);
    expect(a.wins).toBe(2);
  });

  it("shrinks small samples toward zero", () => {
    const p = PARTNERSHIP_PARAMS;
    const one = shrunkEffect({ n: 2, w: 2, z: 4, season: 2025 }, 2025, p);
    const many = shrunkEffect({ n: 40, w: 40, z: 80, season: 2025 }, 2025, p);
    expect(one).toBeCloseTo(4 / (2 + p.k), 12);
    expect(many).toBeCloseTo(80 / (40 + p.k), 12);
    expect(Math.abs(one)).toBeLessThan(Math.abs(many));
    // Under minMatches, and older than maxSeasonsAgo: no effect at all.
    expect(shrunkEffect({ n: 1, w: 1, z: 3, season: 2025 }, 2025, p)).toBe(0);
    expect(shrunkEffect({ n: 9, w: 9, z: 9, season: 2025 - p.maxSeasonsAgo - 1 }, 2025, p)).toBe(0);
    // Older seasons weigh less (decay^seasons ago on both sums).
    const old = shrunkEffect({ n: 4, w: 4, z: 4, season: 2023 }, 2025, p);
    expect(old).toBeCloseTo((4 * p.seasonDecay ** 2) / (4 * p.seasonDecay ** 2 + p.k), 12);
  });

  it("keeps a single meeting for one more season, so a later meeting counts both", () => {
    const b = history();
    b.observe(match(2025, "OPEN", [[1, 7], 90], [[22, 23], 60])); // 1 + 7 met once in 2024
    const t = b.together(1, 7)!;
    expect([t.n, t.wins, t.ties]).toEqual([2, 1, 1]);
    expect(partnershipFact(b, [1, 7], [22, 23], 2025)!.label).toMatch(/^1 and 7 have played 2 matches together \(1–0–1\)/);
  });

  it("forgets a weak pair idle for a whole season, and the table answers exactly like the book", () => {
    const b = history();
    b.observe(match(2025, "OPEN", [[20, 21], 50], [[22, 23], 60]));
    expect(b.together(1, 7)!.n).toBe(1); // kept through the next season…
    expect(new PartnershipTable(b.toData()).together(1, 7)).toBeUndefined(); // …but never shown
    b.observe(match(2026, "OPEN", [[20, 21], 50], [[22, 23], 60]));
    expect(b.together(1, 7)).toBeUndefined(); // a whole season without a second match
    expect(b.together(1, 2)!.n).toBe(3);
    const table = new PartnershipTable(b.toData());
    // Same facts; the stored sums are rounded to 4 places (the pack stays small), so effects agree to ~1e-5.
    const strip = (f: ReturnType<typeof partnershipFact>) => f && { ...f, effect: Math.round(f.effect * 1e3) };
    for (const [red, blue] of [[[1, 2], [3, 4]], [[3, 4], [2, 1]], [[1, 5], [2, 6]]]) {
      expect(strip(partnershipFact(table, red, blue, 2025))).toEqual(strip(partnershipFact(b, red, blue, 2025)));
      const x = partnershipFeatures(table, red, blue, 2025), y = partnershipFeatures(b, red, blue, 2025);
      expect(x.together).toBeCloseTo(y.together, 4);
      expect(x.against).toBeCloseTo(y.against, 4);
    }
    // The state round-trips (the server keeps the finished seasons' part in kv).
    const again = PartnershipBook.fromState(JSON.parse(JSON.stringify(b.toState())));
    expect(again.toData()).toEqual(b.toData());
    again.observe(match(2025, "OPEN", [[1, 2], 70], [[22, 23], 60]));
    expect(again.together(1, 2)!.n).toBe(4);
    expect(b.together(1, 2)!.n).toBe(3);
  });

  it("states the strongest fact in words", () => {
    const b = history();
    const f = partnershipFact(b, [9, 10], [1, 2], 2024)!;
    expect(f.kind).toBe("together");
    expect(f.side).toBe("B");
    expect(f.teams).toEqual([1, 2]);
    expect(f.label).toBe("1 and 2 have played 3 matches together (3–0), above what their ratings expected; best 192 at NJ Championship");
    const next = partnershipFact(b, [1, 2], [3, 4], 2025)!;
    expect(next.label).toContain("best 192 at NJ Championship (2024–25)");
    expect(partnershipFact(b, [30, 31], [32, 33], 2024)).toBeNull();
  });

  it("keeps the names of a new season's events, named before its first match", () => {
    const b = history();
    b.nameEvent(2025, "TXCMP", "Texas Championship");
    b.observe(match(2025, "TXCMP", [[60, 61], 150], [[62, 63], 90]));
    b.observe(match(2025, "TXCMP", [[60, 61], 170], [[64, 65], 90]));
    expect(partnershipFact(b, [60, 61], [70, 71], 2025)!.label).toContain("best 170 at Texas Championship");
    expect(b.eventName(2024, "NJCMP")).toBe("NJ Championship"); // still used by 1 + 2's best
    // A new season's game: the best is that season's, even when lower than an older game's score.
    b.observe(match(2025, "TXCMP", [[1, 2], 90], [[64, 65], 80]));
    const t = b.together(1, 2)!;
    expect([t.n, t.best, t.bestSeason, t.bestEvent]).toEqual([4, 90, 2025, "TXCMP"]);
  });

  it("ranks by recent matches: one new meeting doesn't make old ones count as recent", () => {
    const b = new PartnershipBook(FITTED_MODEL.rating);
    for (let i = 0; i < 4; i++) b.observe(match(2022, "OLD", [[1, 2], 100], [[90, 91], 100]));
    b.observe(match(2025, "NEW", [[1, 2], 100], [[92, 93], 100]));
    for (let i = 0; i < 3; i++) b.observe(match(2025, "NEW", [[3, 4], 100], [[94, 95], 100]));
    expect(b.together(1, 2)!.n).toBe(5);
    expect(partnershipFact(b, [1, 2], [3, 4], 2025)!.teams).toEqual([3, 4]);
  });

  it("reports head-to-head records from the right side", () => {
    const b = new PartnershipBook(FITTED_MODEL.rating);
    for (let i = 0; i < 3; i++) b.observe(match(2024, "X", [[40, 41], 120], [[12, 13], 80]));
    b.observe(match(2024, "X", [[12, 13], 130], [[40, 41], 80]));
    const f = partnershipFact(b, [12, 50], [40, 51], 2024)!;
    expect(f.kind).toBe("against");
    expect(f.record).toEqual({ wins: 1, losses: 3, ties: 0 });
    expect(f.label).toBe("40 leads 12 3–1 in 4 earlier meetings");
  });

  it("with the 2.2 settings (β = 0) never moves a number", () => {
    const book = new RatingBook(FITTED_MODEL.rating);
    const b = history();
    for (let i = 0; i < 6; i++) book.update(match(2024, "NJCMP", [[1, 2], 150], [[3, 4], 90]));
    expect(partnershipShift(b, [1, 2], [3, 4], 2024)).toBe(0);
    const opts = { contextual: FITTED_MODEL.contextual, context: { level: "qual" as const, event: "NJCMP" } };
    const plain = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, FITTED_MODEL.calibration, opts);
    const withPairs = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, FITTED_MODEL.calibration, { ...opts, partnership: { table: b, season: 2024 } });
    expect(withPairs).toEqual(plain);
    const x = explainMatch(book, [1, 2], [3, 4], { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, ...opts, partnership: { table: b, season: 2024 } });
    expect(x.winProbA).toBe(plain.pRedWin);
    expect(x.partnership?.kind).toBe("together");
    expect(x.partnership?.shift).toBe(0);
    expect(explainMatch(book, [1, 2], [3, 4], { noise: FITTED_MODEL.noise }).partnership).toBeNull();
  });

  it("moves the odds toward the pair with the better history when β > 0", () => {
    const book = new RatingBook(FITTED_MODEL.rating);
    const b = history();
    const params = { ...PARTNERSHIP_PARAMS, betaTogether: 0.5 };
    const base = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, FITTED_MODEL.calibration);
    const moved = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, FITTED_MODEL.calibration, { partnership: { table: b, season: 2024, params } });
    expect(moved.pRedWin).toBeGreaterThan(base.pRedWin);
    expect(moved.partnershipShift).toBeGreaterThan(0);
  });
});
