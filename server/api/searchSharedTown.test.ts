// A town several regions share (search audit 2026-11-24, Q9): said alone as the question's place, search asks which
// one, each a tap that asks the same question with the town's region beside it; said with its region, it is that
// town. A town one region holds most of the teams of is read as that one, never asked about.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { buildNames } from "../../src/shared/query/names";

const S = CURRENT_SEASON;
const now = Date.parse("2026-11-02T12:00:00Z");
const ask = (q: string) => searchAnswer(q, { now, limit: 25, learn: false });

const TEAMS: [number, string, string, string][] = [
  // Two towns called Fairbrook, two teams each: neither holds most.
  [31001, "Gear Owls", "Fairbrook", "IL"], [31002, "Bolt Foxes", "Fairbrook", "IL"],
  [31003, "Sprocket Hares", "Fairbrook", "MO"], [31004, "Torque Moles", "Fairbrook", "MO"],
  // Lakemont: five in Minnesota, one in Maine. Minnesota's.
  [31005, "Axle Bees", "Lakemont", "MN"], [31006, "Cog Wrens", "Lakemont", "MN"], [31007, "Gear Bats", "Lakemont", "MN"],
  [31008, "Pinion Elk", "Lakemont", "MN"], [31009, "Rivet Owls", "Lakemont", "MN"], [31010, "Lone Moose", "Lakemont", "ME"],
];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name, city, state] of TEAMS) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, 'USA')", [n, name, city, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  await rebuildSearch();
});

describe("the names index", () => {
  const idx = buildNames(TEAMS.map(([number, name, city, state]) => ({ number, name, city, state, country: "USA", lastPlayed: S })), []);
  it("lists the regions of a town none holds most of, and none for a town one region holds", () => {
    expect(idx.townsShared?.("fairbrook").map((t) => t.state).sort()).toEqual(["IL", "MO"]);
    expect(idx.townsShared?.("lakemont")).toEqual([]);
    expect(idx.place("fairbrook", "fairbrook")).toBeNull();
  });
  it("reads a shared town with its region typed after it", () => {
    expect(idx.place("fairbrook il", "fairbrook il")).toMatchObject({ kind: "city", state: "IL" });
    expect(idx.place("fairbrook missouri", "fairbrook missouri")).toMatchObject({ kind: "city", state: "MO" });
  });
});

describe("a question about a shared town", () => {
  it("asks which, each a tap", async () => {
    const a = await ask("teams in fairbrook");
    expect(a.step).toBe("did-you-mean");
    expect(a.understood?.label).toMatch(/^Which Fairbrook\? Fairbrook (IL|MO) or Fairbrook (IL|MO)$/);
    expect([...(a.suggest ?? [])].sort()).toEqual(["teams in fairbrook il", "teams in fairbrook mo"]);
  });
  it("with its region beside it, is that town", async () => {
    const a = await ask("teams in fairbrook il");
    expect(a.step).not.toBe("did-you-mean");
    expect(a.understood?.label).toMatch(/Fairbrook, IL/);
  });
  it("a town going on into a longer name (a venue) is never asked about", async () => {
    expect((await ask("events at fairbrook high school")).understood?.label ?? "").not.toMatch(/^Which/);
    expect((await ask("teams in fairbrook this season")).understood?.label ?? "").toMatch(/^Which Fairbrook\?/);
  });
  it("a town one region holds is never asked about", async () => {
    expect((await ask("teams in lakemont")).understood?.label ?? "").not.toMatch(/^Which/);
  });
});
