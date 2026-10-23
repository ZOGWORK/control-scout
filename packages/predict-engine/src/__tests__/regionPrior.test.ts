/**
 * Regional prior offsets (engine 2.7): a team new to the season starts from
 * its prior plus the shrunk mean lift its region's returning teams showed
 * over their first regionFreezeN matches. Off by default, and a cold-start
 * season (no team has history) is unchanged.
 */
import { describe, it, expect } from "vitest";
import { RatingBook, type RatingParams } from "../rating";
import type { MatchRecord } from "../types";

const al = (teams: number[], np: number) => ({ teams, auto: np * 0.2, teleop: np * 0.7, endgame: np * 0.1, np, penCommitted: 0, total: np });
let clock = 0;
const match = (season: number, region: string | undefined, red: [number[], number], blue: [number[], number]): MatchRecord => ({
  season, eventCode: `E-${region ?? "none"}`, level: "qual", series: 0, number: ++clock, time: Date.UTC(season, 10, 1) + clock * 60_000,
  red: al(red[0], red[1]), blue: al(blue[0], blue[1]), ...(region ? { region } : {}),
});

/** Season 1 gives teams 1–8 a history; in season 2 region "HOT" returning teams 1–4 all beat their priors. */
function build(params: Partial<RatingParams>, regionOf: (season: number) => string | undefined = () => "HOT") {
  clock = 0; // every book sees the same match times
  const book = new RatingBook(params);
  book.startSeason(2024);
  for (let i = 0; i < 6; i++) { book.update(match(2024, regionOf(2024), [[1, 2], 100], [[3, 4], 100])); book.update(match(2024, regionOf(2024), [[5, 6], 100], [[7, 8], 100])); }
  book.startSeason(2025);
  // A plain field of new teams sets the season's baseline first.
  for (let i = 0; i < 4; i++) book.update(match(2025, "COLD", [[101, 102], 100], [[103, 104], 100]));
  // Returning HOT teams 1–4 score far above their priors for three matches each.
  for (let i = 0; i < 3; i++) book.update(match(2025, regionOf(2025), [[1, 2], 260], [[3, 4], 260]));
  return book;
}

describe("regional prior offsets", () => {
  it("are off by default: no regional state, newcomers get the history prior", () => {
    const off = build({});
    expect(off.regionOffset("HOT")).toEqual({ auto: 0, teleop: 0, endgame: 0 });
    expect(off.toData().regions).toBeUndefined();
  });

  it("raise a newcomer's prior in a region whose returning teams beat theirs, and not elsewhere", () => {
    const on = build({ regionKappa: 2 }), off = build({});
    const o = on.regionOffset("HOT");
    expect(o.teleop).toBeGreaterThan(0);
    expect(on.regionOffset("COLD")).toEqual({ auto: 0, teleop: 0, endgame: 0 });
    // Team 9 (no history) first plays at a HOT event; team 10 at a COLD one.
    const t0 = clock;
    for (const b of [on, off]) { clock = t0; b.update(match(2025, "HOT", [[9, 5], 100], [[6, 7], 100])); b.update(match(2025, "COLD", [[10, 101], 100], [[102, 103], 100])); }
    expect(on.get(9).teleop).toBeGreaterThan(off.get(9).teleop);
    expect(on.get(10).teleop).toBeCloseTo(off.get(10).teleop, 12);
  });

  it("shrink harder with a larger kappa", () => {
    expect(build({ regionKappa: 50 }).regionOffset("HOT").teleop).toBeLessThan(build({ regionKappa: 2 }).regionOffset("HOT").teleop);
  });

  it("learn only from returning teams: a cold-start season is identical to no offsets", () => {
    const cold = (p: Partial<RatingParams>) => {
      clock = 0;
      const b = new RatingBook(p);
      b.startSeason(2025);
      for (let i = 0; i < 5; i++) b.update(match(2025, "HOT", [[1, 2], 200 + i], [[3, 4], 80]));
      b.update(match(2025, "HOT", [[11, 12], 100], [[13, 14], 100]));
      return b;
    };
    const on = cold({ regionKappa: 2 }), off = cold({});
    expect(on.regionOffset("HOT")).toEqual({ auto: 0, teleop: 0, endgame: 0 });
    for (const t of [1, 2, 3, 4, 11, 12, 13, 14]) expect(on.get(t)).toEqual(off.get(t));
  });

  it("matches without a region leave priors alone", () => {
    const on = build({ regionKappa: 2 }, () => undefined), off = build({}, () => undefined);
    for (const t of [1, 2, 3, 4, 101]) expect(on.get(t)).toEqual(off.get(t));
  });

  it("survive serialization and cloning (lifts and teams still being measured)", () => {
    const book = new RatingBook({ regionKappa: 2 });
    book.startSeason(2024);
    for (let i = 0; i < 4; i++) book.update(match(2024, "HOT", [[1, 2], 100], [[3, 4], 100]));
    book.startSeason(2025);
    book.update(match(2025, "COLD", [[101, 102], 100], [[103, 104], 100]));
    book.update(match(2025, "HOT", [[1, 2], 260], [[3, 4], 260])); // 1–4 now pending (1 of 3 matches)
    const copy = RatingBook.fromData(JSON.parse(JSON.stringify(book.toData())));
    const clone = book.clone();
    const t0 = clock;
    for (const b of [book, copy, clone]) { clock = t0; for (let i = 0; i < 2; i++) b.update(match(2025, "HOT", [[1, 2], 260], [[3, 4], 260])); }
    expect(book.regionOffset("HOT").teleop).toBeGreaterThan(0);
    expect(copy.regionOffset("HOT")).toEqual(book.regionOffset("HOT"));
    expect(clone.regionOffset("HOT")).toEqual(book.regionOffset("HOT"));
    // A subset pack keeps the region lifts (shared) and only its own teams' pending entries.
    const sub = book.toData(new Set([101]));
    expect(sub.regions!.lift.length).toBeGreaterThan(0);
    expect(sub.regions!.pending).toEqual([]);
  });
});
