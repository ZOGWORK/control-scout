// A Compare's teams and season come from its link, whatever it opens on (#awards included).
import { describe, expect, it } from "vitest";
import type { SearchHit } from "../../../shared/api";
import { compareSeason, compareTeams } from "./results";

const cmp = (href: string): SearchHit => ({ kind: "team", ref: "4215", title: "", subtitle: "", season: null, href });

describe("Compare links", () => {
  it("reads teams and season", () => { const h = cmp("/compare?teams=4215,6980&season=2024"); expect(compareTeams(h)).toEqual([4215, 6980]); expect(compareSeason(h)).toBe(2024); });
  it("ignores a #section", () => {
    expect(compareSeason(cmp("/compare?teams=4215,6980&season=2024#awards"))).toBe(2024);
    expect(compareTeams(cmp("/compare?teams=4215,6980#awards"))).toEqual([4215, 6980]);
  });
  it("no season: the current one", () => expect(compareSeason(cmp("/compare?teams=4215,6980"))).toBeNull());
});

describe("answerTeams", () => {
  const team = (n: number): SearchHit => ({ kind: "team", ref: String(n), title: `${n} Team`, subtitle: "", season: null, href: `/teams/${n}` });
  const hits = [team(4215), team(6980), team(207)];
  it("a fact or stat answer's team", async () => {
    const { answerTeams } = await import("./results");
    expect(answerTeams({ card: { team: { number: 4215 } } }, [], hits)).toEqual([4215]);
    expect(answerTeams({ stat: { family: "single-stat", title: "OPR in 2025–26", team: { number: 4215 } } }, [], hits)).toEqual([4215]);
  });
  it("a two-team answer's other side, named in its title", async () => {
    const { answerTeams } = await import("./results");
    expect(answerTeams({ stat: { family: "two-team", title: "4215 vs 6980 head to head", team: { number: 4215 } } }, [], hits)).toEqual([4215, 6980]);
  });
  it("a Compare's sides; nothing named, nothing hidden", async () => {
    const { answerTeams } = await import("./results");
    expect(answerTeams(undefined, [cmp("/compare?teams=4215,6980")], hits)).toEqual([4215, 6980]);
    expect(answerTeams({ card: {} }, [], hits)).toEqual([]);
  });
});

describe("statusOf", () => {
  const today = "2026-11-02";
  it("uses the last day when known", async () => {
    const { statusOf } = await import("./results");
    expect(statusOf("2026-11-01", "2026-11-03", today)).toBe("live");
    expect(statusOf("2026-10-30", "2026-11-01", today)).toBe("finished");
    expect(statusOf("2026-11-05", null, today)).toBe("upcoming");
  });
  it("without a last day, never calls a just-begun event finished", async () => {
    const { statusOf } = await import("./results");
    expect(statusOf("2026-11-01", null, today)).toBe("started");
    expect(statusOf("2026-10-30", null, today)).toBe("started");
    expect(statusOf("2026-10-29", null, today)).toBe("finished");
  });
});
