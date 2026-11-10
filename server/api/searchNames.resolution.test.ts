// Which team a query means, through every reader search has (launch audit, Phase E): a typed number is always its
// team, a name several teams share is picked by the shared rules or asked about with each team's place, places and
// ordinary words never become a team. A small fixture database; none of the audit's teams.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { search } from "./search";
import { searchAnswer, WHICH, withoutAside } from "./searchAnswer";

const ask = (q: string) => searchAnswer(q, { learn: false, limit: 25, full: true });
const teamsOf = (a: Awaited<ReturnType<typeof ask>>) => [a.stat?.team?.number, ...a.hits.filter((h) => h.kind === "team").map((h) => Number(h.ref))].filter((n) => n != null);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, city, state, country, seasons played with [rank, of]
  const teams: [number, string, string, string, string, [number, number, number][]][] = [
    [5101, "Quartz Owls", "Paramus", "NJ", "USA", [[2025, 300, 8000]]],
    [5108, "Late Lanterns", "Leonardtown", "MD", "USA", [[2020, 4000, 5000]]],
    [5201, "Echo Kites", "Newark", "NJ", "USA", [[2025, 150, 8000]]],
    [5202, "Echo Kites", "Lansing", "MI", "USA", [[2025, 900, 8000], [2026, 100, 2000]]],
    [5301, "Sigma Wolves", "Arad", "AR", "Romania", [[2025, 90, 8000]]],
    [5302, "Sigma Wolves", "Pasco", "WA", "USA", [[2025, 6600, 8000], [2026, 1900, 2000]]],
    [5401, "Faker for Worlds", "Sydney", "NSW", "Australia", [[2024, 3000, 7000]]],
    [5402, "Actualizers", "Dubai", "DU", "United Arab Emirates", [[2025, 5000, 8000]]],
    [5403, "Romania Demo Team", "Otopeni", "B", "Romania", []],
    [5404, "Ohio Robots", "Allen", "TX", "USA", []],
  ];
  for (const [n, name, city, state, country, seasons] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [seasons[0]?.[0] ?? 2026, n]);
    for (const [season, rank, of] of seasons) {
      await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'X', ?, 50, 5)", [season, n]);
      await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, matches) VALUES (?, ?, 50, ?, ?, 5)", [season, n, rank, of]);
    }
  }
  await rebuildSearch();
});

describe("a typed team number", () => {
  it("is never another team a digit off, whatever words are beside it", async () => {
    // 5108 Late Lanterns is one digit and one letter from "5101 … late".
    expect((await search("5101 late", 10)).map((h) => h.ref)).not.toContain("5108");
    for (const q of ["5101 next match late please", "5101 late opr"]) expect(teamsOf(await ask(q)), q).not.toContain(5108);
  });
});

describe("a name several teams share", () => {
  it("still tied: which one, each with its place, and the same question about each", async () => {
    for (const q of ["did echo kites choke at states or nah", "echo kites opr"]) {
      const a = await ask(q);
      expect(a.understood?.label.startsWith(`${WHICH}echo kites"? 2 teams have that name: `), q).toBe(true);
      expect(a.understood?.label, q).toContain("5201 (Newark, NJ)");
      expect(a.understood?.label, q).toContain("5202 (Lansing, MI)");
      expect(a.hits.map((h) => h.ref).sort(), q).toEqual(["5201", "5202"]);
      expect(a.suggest?.every((s) => /\b520[12]\b/.test(s)), q).toBe(true);
      expect(a.verdict, q).toBeUndefined();
    }
  });
  it("is the one beside the other team named, or the clearly stronger one, and says so", async () => {
    const a = await ask("quartz owls and echo kites opr compare");
    expect(teamsOf(a)).toContain(5201);
    expect(teamsOf(a)).not.toContain(5202);
    const b = await ask("sigma wolves record");
    expect(teamsOf(b)[0]).toBe(5301);
    expect(b.understood?.label).toMatch(/5301.*the stronger one of 2 teams with the name/);
  });
});

describe("places and ordinary words", () => {
  it("a place's name is never a team named after it", async () => {
    for (const q of ["who has the longest winning streak in romania right now", "lowest score ohio last week"]) {
      expect(teamsOf(await ask(q)), q).not.toContain(5403);
      expect(teamsOf(await ask(q)), q).not.toContain(5404);
    }
  });
  it("worlds, actual and the like are words, never a team that has them in its name", async () => {
    const a = await ask("did 5101 and 5201 play at worlds");
    expect(a.hits.some((h) => h.kind === "compare" && h.ref.includes("5401"))).toBe(false);
    expect(teamsOf(a)).not.toContain(5401);
    expect(teamsOf(await ask("show me 5101's predicted vs actual rank"))).not.toContain(5402);
  });
  it("a last clause that only talks around the question goes; one that says something stays", async () => {
    expect(await withoutAside("who won inspire at bergen, i forgot")).toBe("who won inspire at bergen");
    expect(await withoutAside("5101 record, this month")).toBe("5101 record, this month");
    expect(await withoutAside("5101 vs 5201, or nah")).toBe("5101 vs 5201, or nah");
    expect(await withoutAside("5101 next match date please")).toBe("5101 next match");
  });
});
