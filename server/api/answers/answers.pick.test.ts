// Who a team should pick at an event (families/pick.ts): Scout's pick helper on the event's teams, through search end to
// end. The event named, its Worlds or states division, or no event named (the team's next event, else its latest).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import type { StatAnswer } from "../../../src/shared/searchStat";
import { refreshSearchSeason, resetSearchSeason } from "./season";

const S = CURRENT_SEASON;
const stat = async (q: string) => (await searchAnswer(q, { limit: 25, full: true })).stat as StatAnswer;
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Rating components (points a match): 4215 strong in auto and TeleOp with a weak endgame; 6980 an endgame team.
  const teams: [number, string, number, number, number, number][] = [
    [4215, "Hypnotic Robotics", 40, 60, 5, 2], [6980, "Bad Wolf", 10, 30, 40, 1], [23268, "Ultraviolet", 45, 70, 10, 3],
    [7149, "ENFORCERS", 20, 40, 20, 2], [207, "Critical Mass", 5, 10, 5, 6],
  ];
  for (const [n, name, auto, teleop, endgame, pen] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_auto, rating_teleop, rating_endgame, rating_pen, rating_matches, matches, wins, losses, ties) VALUES (?, ?, ?, ?, ?, ?, ?, 10, 10, 5, 5, 0)",
      [S, n, auto + teleop + endgame, auto, teleop, endgame, pen]);
  }
  const ev = (code: string, name: string, start: string, list: number[]) => Promise.all([
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Union', 'NJ', 'USA', ?, ?, 't')", [S, code, name, start, start]),
    ...list.map((t) => run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, code, t])),
  ]);
  // Past, its alliances picked; still to come, none picked yet.
  await ev("USNJQ1", "Garden Qualifier", day(-20), [4215, 6980, 23268, 7149, 207]);
  await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (?, 'USNJQ1', 1, 23268, 4215), (?, 'USNJQ1', 2, 6980, 7149)", [S, S]);
  await ev("USNJQ2", "Northeast League Meet", day(5), [4215, 6980, 7149, 207]);
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});

describe("who to pick at an event", () => {
  it("the event named: the partner that fills the team's gaps first, the rest after it, the pick helper linked", async () => {
    const a = await stat("who should hypnotic robotics pick at northeast league meet");
    expect(a).toMatchObject({ intent: "pick-partners", team: { number: 4215 }, title: "Who 4215 should pick at Northeast League Meet", headline: { value: "Bad Wolf (6980)" } });
    expect(a.headline!.sub).toMatch(/Endgame \+\d+/);
    expect(a.scope).toContain("Weighs auto, TeleOp, endgame and fouls");
    const next = a.blocks.find((b) => b.kind === "table");
    expect(next && next.kind === "table" && next.rows.map((r) => r.cells.team)).toEqual(["ENFORCERS (7149)", "Critical Mass (207)"]);
    const links = a.blocks.find((b) => b.kind === "links");
    expect(links && links.kind === "links" && links.items[0]).toEqual({ label: "Open the pick helper", href: `/scout?tab=picks&pevent=USNJQ2&season=${S}` });
  });
  it("no event named: the team's next event, said so; a stat named gets its own column", async () => {
    const a = await stat("show me teams that complement 4215's weak endgame");
    expect(a).toMatchObject({ intent: "pick-partners", title: "Who 4215 should pick at Northeast League Meet", headline: { value: "Bad Wolf (6980)" } });
    expect(a.definition).toMatch(/No event was named: this is 4215's next event\./);
    const t = a.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.columns.map((c) => c.label)).toContain("Endgame");
  });
  it("selection over: the suggestions as it opened, beside who the team picked", async () => {
    const a = await stat("best second pick for 4215 at garden qualifier");
    expect(a.headline!.sub).toMatch(/^As selection opened · /);
    const picked = a.blocks.find((b) => b.kind === "links" && b.title === "Picked at the event");
    expect(picked && picked.kind === "links" && picked.items.map((i) => i.label)).toEqual(["Ultraviolet (23268)"]);
  });
  it("a team not on the event's list is said so, never another event's suggestions", async () => {
    expect((await stat("who should 23268 pick at northeast league meet")).none).toMatch(/isn't on Northeast League Meet's team list/);
  });
});
