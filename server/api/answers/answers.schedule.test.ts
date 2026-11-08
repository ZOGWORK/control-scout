// A team's schedule: its matches, those still to play first (failed-search #1152, Greptile on #1154; held out: other
// teams, states and words). The played list and every number on it stay the scored matches only.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";

const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[6980, "Bad Wolf"], [207, "Critical Mass"], [9999, "Top Hat Robotics"], [23268, "Rookie Robots"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Fair Lawn', 'NJ', 'USA', 2012)", [n, name]);
  }
  const ev = (season: number, code: string, name: string, state: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (?, ?, ?, 'Qualifier', 'Town', ?, 'USA', ?, ?, 'UTC', 't')", [season, code, name, state, start, start]);
  // One played match last season in New Jersey; this season's Massachusetts qualifier is in two days, its two
  // matches scheduled and not played; one from an event that ended stays unplayed and is never "still to play".
  await ev(2025, "USNJQ5", "Garden State Qualifier", "NJ", "2026-01-10");
  await ev(2026, "USMAQ2", "Bay State Qualifier", "MA", day(2));
  await ev(2026, "USCTQ1", "Nutmeg Qualifier", "CT", day(-5));
  // A later event's match with a time comes after the earlier event's untimed one.
  await ev(2026, "USMAQ9", "Cape Cod Qualifier", "MA", day(4));
  const match = (season: number, code: string, n: number, time: string | null, played: boolean, red: number[], blue: number[]) => Promise.all([
    run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source)
         VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, ?, ?, 't')`, [season, code, n, `Q${n}`, time, played ? 1 : 0, ...(played ? [120, 120, 80, 80] : [null, null, null, null])]),
    ...red.map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, 'red')", [season, code, n, t])),
    ...blue.map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, 'blue')", [season, code, n, t])),
  ]);
  await match(2025, "USNJQ5", 1, "2026-01-10T10:00:00Z", true, [6980, 207], [9999, 23268]);
  await match(2026, "USMAQ2", 1, `${day(2)}T09:30:00Z`, false, [6980, 207], [9999, 23268]);
  await match(2026, "USMAQ2", 7, null, false, [9999, 23268], [6980, 207]);
  await match(2026, "USMAQ9", 2, `${day(4)}T08:00:00Z`, false, [6980, 9999], [207, 23268]);
  await match(2026, "USCTQ1", 3, `${day(-5)}T09:30:00Z`, false, [6980, 9999], [207, 23268]);
  await rebuildSearch();
});

const ask = (q: string) => searchAnswer(q, { learn: false, limit: 12, full: true });
const toPlay = (a: Awaited<ReturnType<typeof ask>>) => a.stat?.blocks.find((b): b is Extract<typeof b, { kind: "table" }> => b.kind === "table" && b.title === "Still to play");

describe("a team's schedule", () => {
  it("in a state said short: the matches still to play there, though none are played yet", async () => {
    const a = await ask("bad wolf schedule in mass");
    expect(a.stat).toMatchObject({ intent: "season-matches" });
    expect(a.stat?.none).toBeUndefined();
    const t = toPlay(a);
    expect(t ? t.rows.map((r) => [r.cells.match, r.cells.event, r.cells.alliance]) : null).toEqual([["Q1", "Bay State Qualifier", "Red"], ["Q7", "Bay State Qualifier", "Blue"], ["Q2", "Cape Cod Qualifier", "Red"]]);
  });
  it("with no place: the rest still to play above the played list, whose record is the scored matches only", async () => {
    const a = await ask("6980 match schedule");
    expect(a.stat?.headline).toMatchObject({ value: "1-0-0" });
    expect(a.stat?.blocks.map((b) => b.kind === "table" ? b.title : b.kind)).toEqual(["record", "Still to play", "matches"]);
  });
  it("never in another state, nor from an event that has ended", async () => {
    expect(toPlay(await ask("bad wolf schedule in connecticut"))).toBeUndefined();
    expect(toPlay(await ask("6980 schedule in new jersey"))).toBeUndefined();
    // A past season named keeps to that season (Greptile on #1154).
    expect(toPlay(await ask("bad wolf schedule in 2024-25"))).toBeUndefined();
    expect(toPlay(await ask("6980 match schedule 2025-26"))).toBeUndefined();
  });
});
