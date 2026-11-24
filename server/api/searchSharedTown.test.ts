// A town several regions share (search audit 2026-11-24, Q9): said alone as the question's place, search asks which
// one, each a tap that asks the same question with the town's region beside it; said with its region, it is that
// town. A town one region holds most of the teams of is read as that one, never asked about.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { buildNames } from "../../src/shared/query/names";
import { queryCut } from "../../src/shared/search";

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
  it("answered for every town at once: the answer kept, a tap for each town", async () => {
    const a = await ask("teams in fairbrook");
    expect(a.step).toBe("deterministic");
    expect(a.understood?.label).not.toMatch(/^Which/);
    // Each region as it is written: "MO" in capitals is the region, "mo" may be a word.
    expect([...(a.suggest ?? [])].sort()).toEqual(["teams in fairbrook IL", "teams in fairbrook MO"]);
  });
  it("a long question about it says its cut once (Loopy on #2263)", async () => {
    const q = `teams in fairbrook this season ${"please ".repeat(22)}thanks`;
    const a = await ask(q);
    expect(a.suggest?.length).toBe(2);
    expect((a.understood?.unread ?? []).filter((u) => u === queryCut(q))).toEqual([queryCut(q)]);
  });
  it("each tap is read as its town", async () => {
    const a = await ask("teams in fairbrook MO");
    expect(a.understood?.label).toMatch(/Fairbrook, MO/);
    expect(a.suggest ?? []).not.toContain("teams in fairbrook IL");
  });
  it("with no direct answer, asks which", async () => {
    const a = await ask("zqx stuff in fairbrook");
    expect(a.step).toBe("did-you-mean");
    expect(a.understood?.label).toMatch(/^Which Fairbrook\? Fairbrook (IL|MO) or Fairbrook (IL|MO)$/);
    expect([...(a.suggest ?? [])].sort()).toEqual(["zqx stuff in fairbrook IL", "zqx stuff in fairbrook MO"]);
  });
  it("a town going on into a longer name (a venue), or one region holds, gets no taps", async () => {
    expect((await ask("events at fairbrook high school")).suggest ?? []).not.toContain("events at fairbrook IL high school");
    expect((await ask("teams in lakemont")).suggest ?? []).toEqual([]);
  });
});
