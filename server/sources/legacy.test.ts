// 2019–2022 (history-only seasons): FIRST score breakdowns → engine components,
// checked against FTC Scout's normalised numbers for the same matches; remote
// events keep rankings and awards but never matches.
import { afterEach, describe, expect, it, vi } from "vitest";
import fx from "./fixtures/first-legacy.json";
import { splitFirstScore } from "../data/seasons";
import { firstEventBundle, totalsOnly } from "./first";
import { bundleFromScout, split } from "./ftcScout";
import type { EventRow } from "../data/bundle";

type Fx = { scores: { alliances: Record<string, unknown>[] }; result: Record<string, number> };
const sides = (f: Fx) => {
  const red = f.scores.alliances.find((a) => a.alliance === "Red")!, blue = f.scores.alliances.find((a) => a.alliance === "Blue")!;
  return { red, blue };
};
const comp = (s: { auto: number; teleop: number; endgame: number; np: number; pen: number; total: number }) => [s.auto, s.teleop, s.endgame, s.np, s.pen, s.total];

// [season, fixture, red, blue] as [auto, teleop, endgame, np, pen committed, total] — FTC Scout's numbers.
const CASES: [number, string, number[], number[]][] = [
  // SKYSTONE: fouls credited to the opponent; FIRST's endGamePoints reads 0 (unreliable).
  [2019, "2019 2019ALCMP Q10", [15, 12, 23, 50, 0, 55], [2, 12, 5, 19, 5, 19]],
  // ULTIMATE GOAL: fouls come off the offender's own score.
  [2020, "2020 AUNSWPYQT01 Q3", [56, 54, 20, 130, 0, 130], [65, 36, 55, 156, 10, 146]],
  // FREIGHT FRENZY: same, driverControlledPoints.
  [2021, "2021 CABCCMP Q1", [36, 6, 39, 81, 30, 51], [15, 28, 47, 90, 10, 80]],
  // POWERPLAY: fouls credited to the opponent, prePenaltyTotal = np.
  [2022, "2022 AUCAQ Q2", [0, 22, 12, 34, 10, 54], [0, 28, 15, 43, 20, 53]],
];

describe("splitFirstScore, legacy seasons", () => {
  for (const [season, key, red, blue] of CASES) {
    it(`${key}`, () => {
      const f = (fx as unknown as Record<string, Fx>)[key];
      const s = sides(f);
      expect(comp(splitFirstScore(season, s.red, s.blue))).toEqual(red);
      expect(comp(splitFirstScore(season, s.blue, s.red))).toEqual(blue);
      // The results feed agrees on totals.
      expect(splitFirstScore(season, s.red, s.blue).total).toBe(f.result.scoreRedFinal);
      expect(splitFirstScore(season, s.blue, s.red).total).toBe(f.result.scoreBlueFinal);
      if (season === 2022) expect(splitFirstScore(season, s.blue, s.red).np).toBe(s.blue.prePenaltyTotal);
    });
  }

  it("totals-only fallback: scoreXFoul is what X committed", () => {
    for (const [season, key, red, blue] of CASES) {
      const r = (fx as unknown as Record<string, Fx>)[key].result;
      const rt = totalsOnly(season, r.scoreRedFinal, r.scoreRedFoul, r.scoreBlueFoul, r.scoreRedAuto)!;
      const bt = totalsOnly(season, r.scoreBlueFinal, r.scoreBlueFoul, r.scoreRedFoul, r.scoreBlueAuto)!;
      expect([rt.np, rt.pen, rt.total, rt.auto], key).toEqual([red[3], red[4], red[5], red[0]]);
      expect([bt.np, bt.pen, bt.total, bt.auto], key).toEqual([blue[3], blue[4], blue[5], blue[0]]);
    }
  });

  it("FTC Scout fallback: 2020/2021 penalties are stored negative and rebuilt into FIRST's total", () => {
    // FTC Scout's raw alliance for 2020 AUNSWPYQT01 Q3 blue (its totalPoints leaves the foul in).
    expect(comp(split(2020, { autoPoints: 65, dcPoints: 36, egPoints: 55, penaltyPointsCommitted: -10, totalPointsNp: 156, totalPoints: 156 })!)).toEqual([65, 36, 55, 156, 10, 146]);
    expect(comp(split(2021, { autoPoints: 36, dcPoints: 6, egPoints: 39, penaltyPointsCommitted: -30, totalPointsNp: 81, totalPoints: 51 })!)).toEqual([36, 6, 39, 81, 30, 51]);
    expect(comp(split(2022, { autoPoints: 0, dcPoints: 22, egPoints: 12, penaltyPointsCommitted: 10, totalPointsNp: 34, totalPoints: 54 })!)).toEqual([0, 22, 12, 34, 10, 54]);
  });

  it("2023+ is untouched (opponent argument ignored)", () => {
    const a = { autoPoints: 10, dcPoints: 20, endgamePoints: 5, penaltyPointsCommitted: 10, totalPoints: 45 };
    expect(splitFirstScore(2023, a, { penaltyPointsCommitted: 99 })).toEqual(splitFirstScore(2023, a));
  });
});

// 2023+ totals-only fallback (FIRST has results but no /scores breakdown yet).
// Real matches: FIRST's results feed vs the breakdown-derived truth stored for
// the same match ([np, pen committed, auto, total] per side). In every case
// scoreXFoul is what X committed, so X's np = X's total − the opponent's fouls.
type TotalsCase = { season: number; key: string; level: "QUALIFICATION" | "PLAYOFF"; series: number; number: number;
  res: { rF: number; rFoul: number; rA: number; bF: number; bFoul: number; bA: number }; red: number[]; blue: number[] };
const TOTALS: TotalsCase[] = [
  // CENTERSTAGE: red committed 30, credited to blue (134 = 104 np + 30).
  { season: 2023, key: "2023 AUADOS Q4", level: "QUALIFICATION", series: 0, number: 4,
    res: { rF: 121, rFoul: 30, rA: 63, bF: 134, bFoul: 0, bA: 56 }, red: [121, 30, 63, 121], blue: [104, 0, 56, 134] },
  // INTO THE DEEP: both sides fouled (red 20, blue 5).
  { season: 2024, key: "2024 AUCMP Upper Bracket Match 11", level: "PLAYOFF", series: 11, number: 1,
    res: { rF: 276, rFoul: 20, rA: 49, bF: 218, bFoul: 5, bA: 38 }, red: [271, 20, 49, 276], blue: [198, 5, 38, 218] },
  // DECODE.
  { season: 2025, key: "2025 AECMP Q2", level: "QUALIFICATION", series: 0, number: 2,
    res: { rF: 132, rFoul: 25, rA: 40, bF: 143, bFoul: 0, bA: 46 }, red: [132, 25, 40, 132], blue: [118, 0, 46, 143] },
];

describe("totals-only fallback, 2023+", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  for (const c of TOTALS) {
    it(`${c.key}: fouls credited to the opponent`, async () => {
      vi.stubEnv("FTC_EVENTS_USERNAME", "u"); vi.stubEnv("FTC_EVENTS_TOKEN", "t");
      const r = c.res;
      const match = {
        tournamentLevel: c.level, series: c.series, matchNumber: c.number, description: "M", postResultTime: "2024-01-01T10:00:00",
        teams: [{ teamNumber: 1, station: "Red1" }, { teamNumber: 2, station: "Red2" }, { teamNumber: 3, station: "Blue1" }, { teamNumber: 4, station: "Blue2" }],
        scoreRedFinal: r.rF, scoreRedFoul: r.rFoul, scoreRedAuto: r.rA, scoreBlueFinal: r.bF, scoreBlueFoul: r.bFoul, scoreBlueAuto: r.bA,
      };
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        // No breakdown published: /scores is empty, only the results feed has the match.
        const body = url.includes("/matches/") ? { matches: [match] } : url.includes("/scores/") ? { matchScores: [] } : {};
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }));
      const b = await firstEventBundle({ ...REMOTE_META, season: c.season, code: "TEST", remote: false });
      const m = b.detail!.matches[0];
      const side = (s: typeof m.redScore) => [s!.np, s!.pen, s!.auto, s!.total];
      expect(side(m.redScore)).toEqual(c.red);
      expect(side(m.blueScore)).toEqual(c.blue);
      // Each alliance's total is its own np plus the fouls the other side committed.
      expect(m.redScore!.np + m.blueScore!.pen).toBe(m.redScore!.total);
      expect(m.blueScore!.np + m.redScore!.pen).toBe(m.blueScore!.total);
    });
  }

  it("unchanged for 2019–2022 (same rule as the breakdown fixtures)", () => {
    expect(totalsOnly(2022, 54, 10, 20, 0)).toEqual({ total: 54, np: 34, auto: 0, teleop: 34, endgame: 0, pen: 10 });
    expect(totalsOnly(2021, 51, 30, 10, 36)).toEqual({ total: 51, np: 81, auto: 36, teleop: 45, endgame: 0, pen: 30 });
  });
});

const REMOTE_META: EventRow = {
  season: 2020, code: "CAONPIQT1", name: "ON FTC Qualifier #1 REMOTE", type: "Qualifier", divisionCode: null, region: null, league: null,
  venue: null, city: null, state: null, country: "Canada", start: "2021-03-06", end: "2021-03-11", timezone: null, remote: true, hybrid: false,
  website: null, livestream: null, source: "first", upstreamUpdated: null,
};

describe("remote events", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("FIRST bundle: rankings and awards, no matches (and match endpoints never fetched)", async () => {
    vi.stubEnv("FTC_EVENTS_USERNAME", "u"); vi.stubEnv("FTC_EVENTS_TOKEN", "t");
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      const body = url.includes("/rankings/") ? fx.remote.rankings : url.includes("/awards/") ? fx.remote.awards : url.includes("/alliances/") ? { alliances: [] } : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const b = await firstEventBundle(REMOTE_META);
    expect(b.detail!.matches).toEqual([]);
    expect(b.detail!.entries.map((e) => [e.team, e.rank])).toEqual(fx.remote.rankings.rankings.map((r) => [r.teamNumber, r.rank]));
    // Judged awards kept; remote "Top Ranked" isn't an award type we model.
    expect(b.detail!.awards.map((a) => [a.type, a.placement])).toEqual([["Inspire", 1], ["Inspire", 2], ["Inspire", 3]]);
    expect(asked.some((u) => /\/(schedule|matches|scores)\//.test(u))).toBe(false);
  });

  it("FIRST's 503 'Advancement data unavailable' (2019–2022) doesn't cost the event", async () => {
    vi.stubEnv("FTC_EVENTS_USERNAME", "u"); vi.stubEnv("FTC_EVENTS_TOKEN", "t");
    let advancementCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/advancement/")) { advancementCalls++; return new Response('"Unknown Error : Advancement data unavailable"', { status: 503 }); }
      const body = url.includes("/rankings/") ? fx.remote.rankings : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const b = await firstEventBundle({ ...REMOTE_META, season: 2021, remote: false });
    expect(b.detail!.entries).toHaveLength(fx.remote.rankings.rankings.length);
    expect(b.detail!.advancement).toBeNull();
    expect(advancementCalls).toBe(1); // no retries
  });

  it("FTC Scout bundle: one-team 'matches' are dropped", () => {
    const resp = { data: { eventByCode: {
      code: "APOAEQT1", name: "Remote", type: "Championship", start: "2021-03-08", end: "2021-03-12", remote: true, hybrid: false,
      teams: [{ teamNumber: 3954, stats: { rank: 1, rp: 1752 } }, { teamNumber: 16360, stats: { rank: 2, rp: 1500 } }],
      awards: [{ type: "Inspire", placement: 1, teamNumber: 3954 }],
      matches: [1, 2].map((n) => ({ matchNum: 1, series: 0, tournamentLevel: "Quals", hasBeenPlayed: true, teams: [{ teamNumber: n === 1 ? 3954 : 16360, alliance: "Red", station: "One" }], scores: {} })),
    } } };
    const b = bundleFromScout(resp, 2020)!;
    expect(b.detail!.matches).toEqual([]);
    expect(b.detail!.entries.map((e) => e.rank)).toEqual([1, 2]);
    expect(b.detail!.awards).toHaveLength(1);
  });
});
