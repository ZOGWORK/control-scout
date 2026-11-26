// A team's schedule difficulty at one event (families/facts.ts scheduleAt): "schedule difficulty 4215 last meet" is the
// figure at its most recent event, never the event's own card that "last meet" names alone; "at <event>" is that event's.
// The engine's figure (server/predict/scheduleDifficulty.ts eventSchedule) is stood in for: it needs live ratings.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../predict/scheduleDifficulty.js", async (orig) => {
  const real = await orig<typeof import("../../predict/scheduleDifficulty.js")>();
  const side = (rank: number, opponents: number, partners: number, z: number) => ({ opponents, partners, difficulty: Math.round((opponents - partners) * 10) / 10, matches: 2, rank, of: 6, easyRank: 7 - rank, z });
  const figures: Record<string, ReturnType<typeof side>> = { USNJM1: side(1, 12, -4, 1.4), USNJM2: side(5, 3.2, 5.6, -0.6) };
  return {
    ...real,
    eventSchedule: async (_season: number, code: string) => (figures[code]
      ? { fieldMean: 40, scheduled: 12, played: 12, teams: [{ team: 4215, full: figures[code], remaining: null }] }
      : null),
  };
});

import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readTeamFact } from "./families/facts";
import { THEIR_FIRST, THEIR_LAST } from "./read";
import type { StatBlock } from "../../../src/shared/searchStat";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run(`INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA', 2010),
    (6980, 'Bad Wolf', 'Oradell', 'NJ', 'USA', 2013), (100, 'Alpha', 'Oradell', 'NJ', 'USA', 2013), (200, 'Beta', 'Oradell', 'NJ', 'USA', 2013)`);
  await run("INSERT INTO team_season_stats (season, team, opr_np, matches, wins, losses, ties) VALUES (2026, 4215, 50, 4, 2, 2, 0)");
  for (const [code, name, start] of [["USNJM1", "North Meet One", "2026-10-10"], ["USNJM2", "North Meet Two", "2026-11-07"], ["USNJX9", "Other Qualifier", "2026-11-01"]] as const) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, ?, ?, 'LeagueMeet', 'Town', 'NJ', 'USA', ?, ?, 't')", [code, name, start, start]);
  }
  for (const code of ["USNJM1", "USNJM2"]) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2026, ?, 4215, 3)", [code]);
    for (const n of [1, 2]) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1, 60, 60, 40, 40, 't')", [code, n, `Q${n}`, `2026-11-07T1${n}:00:00Z`]);
      for (const [t, a] of [[4215, "red"], [100, "red"], [6980, "blue"], [200, "blue"]] as const) {
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1)", [code, n, t, a]);
      }
    }
  }
  await rebuildSearch();
});

const kpi = (blocks: StatBlock[], label: string) => blocks.flatMap((b) => (b.kind === "kpis" ? b.items : [])).find((x) => x.label === label)?.value;

describe("schedule difficulty at one event", () => {
  it("reads the team's own last or first event, or the event named, beside the fact", () => {
    expect(readTeamFact("schedule difficulty 4215 last meet")).toMatchObject({ id: "schedule", core: "4215", at: THEIR_LAST });
    expect(readTeamFact("4215 schedule toughness at their first event")).toMatchObject({ id: "schedule", core: "4215", at: THEIR_FIRST });
    expect(readTeamFact("4215 schedule difficulty at north meet one")).toMatchObject({ id: "schedule", core: "4215", at: "north meet one" });
    // A fact that isn't kept event by event isn't read at one.
    expect(readTeamFact("4215 reliability last meet")).toBeNull();
    // The season's figure is unchanged.
    expect(readTeamFact("4215 schedule difficulty")).toMatchObject({ id: "schedule", core: "4215" });
    expect(readTeamFact("4215 schedule difficulty")?.at).toBeUndefined();
  });

  it("schedule difficulty 4215 last meet: the figure at its most recent event, with its matches", async () => {
    const a = await searchAnswer("schedule difficulty 4215 last meet", { full: true });
    expect(a.stat?.intent).toBe("schedule");
    expect(a.stat?.title).toBe("Schedule difficulty at North Meet Two");
    expect(a.stat?.scope).toEqual(["2026–27", "Most recent event"]);
    expect(a.stat?.headline).toMatchObject({ value: "Kind", label: "2nd-easiest of 6 at North Meet Two" });
    expect(a.stat?.headline?.sub).toMatch(/^Easier than an average draw there/);
    expect(kpi(a.stat!.blocks, "Opponents")).toBe("+3.2");
    expect(kpi(a.stat!.blocks, "Partners")).toBe("+5.6");
    const ms = a.stat!.blocks.find((b) => b.kind === "matches");
    expect(ms?.kind === "matches" && ms.rows.map((r) => r.label)).toEqual(["Q1", "Q2"]);
    expect(ms?.kind === "matches" && ms.rows.every((r) => r.event.label === "North Meet Two")).toBe(true);
  });

  it("at their first event, and at an event named", async () => {
    const first = await searchAnswer("4215 schedule difficulty at their first event", { full: true });
    expect(first.stat?.title).toBe("Schedule difficulty at North Meet One");
    expect(first.stat?.headline).toMatchObject({ value: "Hard", label: "hardest of 6 at North Meet One" });
    const named = await searchAnswer("4215 schedule difficulty at north meet one", { full: true });
    expect(named.stat?.title).toBe("Schedule difficulty at North Meet One");
    expect(named.stat?.scope).toEqual(["2026–27"]);
  });

  it("an event the team didn't play is said so, never another event's figure", async () => {
    const a = await searchAnswer("4215 schedule difficulty at other qualifier", { full: true });
    expect(a.stat?.title).toBe("Schedule difficulty at Other Qualifier");
    expect(a.stat?.none).toMatch(/didn't play at Other Qualifier/);
  });

  it("the event's words alone stay the event's own card", async () => {
    const a = await searchAnswer("4215 last meet", { full: true });
    expect(a.stat?.intent).not.toBe("schedule");
  });
});
