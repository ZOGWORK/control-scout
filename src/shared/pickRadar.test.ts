// The pick helper's math: radar area, the per-event scale, normalization (fouls inverted after summing) and the
// order of suggestions (area first: a gap-filler beats a higher-rated team strong where you're already strong).
import { describe, expect, it } from "vitest";
import { clearPicks } from "./scoutSections";
import { allianceOf, alliancePicked, allianceTotals, coverage, fullArea, normalizeTotals, pickScale, radarArea, suggestPartners, type PickTeam } from "./pickRadar";

const team = (n: number, auto: number, teleop: number, endgame: number, fouls: number): PickTeam => ({ team: n, name: null, rank: null, auto, teleop, endgame, fouls, matches: 10 });

describe("radarArea", () => {
  it("is ½·sin(2π/k)·Σ rᵢ·rᵢ₊₁", () => {
    expect(radarArea([1, 1, 1, 1])).toBeCloseTo(2);
    expect(fullArea(4)).toBeCloseTo(2);
    expect(radarArea([1, 1, 1])).toBeCloseTo(0.5 * Math.sin((2 * Math.PI) / 3) * 3);
    expect(radarArea([0.5, 1, 0, 1])).toBeCloseTo(0.5 * (0.5 + 0 + 0 + 0.5));
  });
  it("depends on the axis order", () => {
    expect(radarArea([1, 1, 0, 0])).not.toBeCloseTo(radarArea([1, 0, 1, 0]));
    expect(radarArea([1, 0, 1, 0])).toBe(0);
  });
  it("is 0 with fewer than 3 axes", () => expect(radarArea([1, 1])).toBe(0));
});

describe("scale and normalization", () => {
  const teams = [team(1, 10, 50, 5, 2), team(2, 20, 40, 10, 8), team(3, 5, 30, 0, 20)];
  it("measures each axis against the top `size` teams added up (fouls: the most-fouling `size`)", () => {
    expect(pickScale(teams, 2)).toEqual({ size: 2, auto: 30, teleop: 90, endgame: 15, fouls: 28 });
    expect(pickScale(teams, 3)).toEqual({ size: 3, auto: 35, teleop: 120, endgame: 15, fouls: 30 });
  });
  it("sums the alliance, then inverts fouls after summing, clamped 0..1", () => {
    const t = allianceTotals([teams[0], teams[1]]);
    expect(t).toEqual({ auto: 30, teleop: 90, endgame: 15, fouls: 10 });
    const a = normalizeTotals(t, pickScale(teams, 2));
    expect(a.auto).toBe(1);
    expect(a.fouls).toBeCloseTo(1 - 10 / 28);
    expect(normalizeTotals({ auto: 99, teleop: -5, endgame: 0, fouls: 99 }, pickScale(teams, 2))).toEqual({ auto: 1, teleop: 0, endgame: 0, fouls: 0 });
  });
  it("a scale of 0 gives 0 on scoring axes and 1 on fouls (nobody fouls)", () => {
    const s = pickScale([team(1, 0, 0, 0, 0)], 2);
    expect(normalizeTotals({ auto: 0, teleop: 0, endgame: 0, fouls: 0 }, s)).toEqual({ auto: 0, teleop: 0, endgame: 0, fouls: 1 });
  });
  it("coverage is area ÷ the full chart", () => expect(coverage({ auto: 1, teleop: 1, endgame: 1, fouls: 1 })).toBeCloseTo(1));
});

describe("suggestPartners", () => {
  // You: strong TeleOp, no endgame. 20 is rated higher (more TeleOp) but 30 brings the endgame you lack.
  const me = team(10, 10, 80, 0, 5);
  const teams = [me, team(20, 12, 100, 0, 5), team(30, 10, 50, 15, 5), team(40, 2, 10, 1, 30), team(50, 1, 5, 0, 0)];
  it("puts the gap-filler ahead of the higher-rated team, and says why", () => {
    const v = suggestPartners({ teams, members: [10], size: 2 });
    expect(v.suggestions[0].team.team).toBe(30);
    expect(v.suggestions[0].ratingPlace).toBe(2);
    expect(v.suggestions[0].gains[0].axis).toBe("endgame");
    expect(v.suggestions.find((s) => s.team.team === 20)!.ratingPlace).toBe(1);
    expect(v.suggestions[0].result.area).toBeGreaterThan(v.suggestions[1].result.area);
    // A partner's fouls lower Few fouls: shown as a cost.
    expect(v.suggestions[0].costs.map((c) => c.axis)).toEqual(["fouls"]);
  });
  it("leaves out your alliance, unavailable teams, and caps the list", () => {
    const v = suggestPartners({ teams, members: [10], unavailable: [30], size: 2, limit: 2 });
    expect(v.suggestions.map((s) => s.team.team)).toEqual([20, 50]);
    expect(v.pool).toBe(3);
  });
  it("suggests nothing for a full alliance; a 3-team alliance gets a second pick", () => {
    expect(suggestPartners({ teams, members: [10, 30], size: 2 }).suggestions).toEqual([]);
    const three = suggestPartners({ teams, members: [10, 30], size: 3 });
    expect(three.suggestions.length).toBe(3);
    expect(three.current.members).toEqual([10, 30]);
  });
});

describe("clearPicks", () => {
  it("drops one event's pick choices and keeps your team and the size", () => {
    const sp = new URLSearchParams("tab=picks&pevent=AUCMP&pwith=1&ptaken=2,3&pposted=0&pteam=10&psize=3&season=2025");
    clearPicks(sp);
    expect(sp.toString()).toBe("tab=picks&pteam=10&psize=3&season=2025");
  });
});

describe("posted alliances", () => {
  const al = [{ number: 1, captain: 10, pick1: 20, pick2: null }, { number: 2, captain: 30, pick1: 40, pick2: 50 }];
  it("finds a team's alliance in pick order and everyone already picked", () => {
    expect(allianceOf(al, 40)).toEqual([30, 40, 50]);
    expect(allianceOf(al, 99)).toBeNull();
    expect([...alliancePicked(al)].sort()).toEqual([10, 20, 30, 40, 50]);
  });
});
