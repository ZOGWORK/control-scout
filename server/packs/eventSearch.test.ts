// FTC One Search from the event pack (docs/event-bundle.md, "Search"), against the server's own answers: the pack
// holds /api/search's whole answer for every team's number and name, the event's code and name and each match; a
// versus of the pack's teams is built with no signal by the same functions the server uses and comes out byte for
// byte the same JSON; anything else is said plainly to need data the pack doesn't hold; the same query twice gives
// the same answer.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { rebuildSearch } from "../stats/job";
import { eventDetail } from "../api/events";
import { buildPackApi, packSearchQueries, packTeams } from "./eventApi";
import { packLookup, searchPackPath, type EventBundle } from "../../src/shared/eventBundle";
import { searchFromPacks, teamSummariesFromPacks } from "../../src/shared/searchOffline";
import type { EventDetail, SearchAnswer } from "../../src/shared/api";

const S = 2025, EV = "USMIQ9";
let app: Server, base = "";
let pack: EventBundle;

const TEAMS: [number, string, string][] = [[1111, "Gear Grinders", "Midland"], [2222, "Bolt Brigade", "Saginaw"], [3333, "Circuit Owls", "Bay City"], [4444, "Torque Turtles", "Flint"], [5555, "Pixel Pirates", "Midland"]];

async function seed() {
  for (const [n, name, city] of TEAMS) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, 'MI', 'USA')", [n, name, city]);
  // A team the event doesn't hold, for "not in your pack".
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (9999, 'Far Away', 'Oradell', 'NJ', 'USA')");
  await run("INSERT INTO events (season, code, name, type, region, city, state, country, start, end, remote, hybrid, source) VALUES (?, ?, 'Midland Robot Qualifier', 'Qualifier', 'USMI', 'Midland', 'MI', 'USA', '2025-11-08', '2025-11-08', 0, 0, 'test')", [S, EV]);
  for (const [i, [n]] of TEAMS.entries()) await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (?, ?, ?, ?, 1, 1, 0, 2)", [S, EV, n, i + 1]);
  const match = async (num: number, red: number[], blue: number[]) => {
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, 90, 90, 20, 50, 20, 0, 60, 60, 10, 40, 10, 0, 'test')`,
      [S, EV, num, `Q${num}`, `2025-11-08T10:0${num}:00`]);
    for (const [alliance, ts] of [["red", red], ["blue", blue]] as const)
      for (const [i, team] of ts.entries())
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, 0, 1)", [S, EV, num, team, alliance, i + 1]);
  };
  await match(1, [1111, 2222], [3333, 4444]);
  await match(2, [5555, 1111], [2222, 3333]);
  // Season numbers: this season for every team, last season for most (the compare card picks the latest all played).
  const stat = (season: number, team: number, opr: number, rank: number) => run(
    `INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_auto, rating_teleop, rating_endgame, rating_sd, rating_rank, matches, wins, losses, ties)
     VALUES (?, ?, ?, ?, ?, ?, ?, 40, ?, ?, ?, ?, 4, ?, 8, 5, 3, 0)`, [season, team, opr, opr / 4, opr / 2, opr / 4, rank, opr + 2, opr / 4, opr / 2, opr / 4, rank]);
  for (const [i, [n]] of TEAMS.entries()) {
    await stat(S, n, 60 - i * 7, i + 1);
    if (n !== 5555) await stat(S - 1, n, 50 - i * 5, i + 3);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, ?, ?, 50, 2)", [S, EV, n]);
  }
  await rebuildSearch();
}

const online = async (q: string): Promise<SearchAnswer> => {
  const r = await fetch(`${base}/api/search?answer=1&limit=25&q=${encodeURIComponent(q)}`);
  expect(r.status, q).toBe(200);
  return r.json();
};
/** The answer the device gives with no signal, asked as the /search page asks (its preferred teams too). */
const offline = async (q: string) => (await searchFromPacks(`/api/search?q=${encodeURIComponent(q)}&limit=25&answer=1&prefer=team:1111`, [pack]))!.body;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await seed();
  app = createApp().listen(0);
  await new Promise((r) => app.once("listening", r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const ev = (await eventDetail(S, EV)) as EventDetail;
  const parts = await buildPackApi(S, ev);
  pack = { manifest: { format: 1, season: S, code: EV, name: ev.event.name, end: null, version: "t", builtAt: "2025-11-08T20:09:00Z", dataAsOf: "2025-11-08T20:09:00Z", engineVersion: "t", team: null, workspace: null, sections: [], field: [], reportKeys: [] },
    format: 1, event: ev, ratings: null, reports: [], picklist: null, rules: null, venue: { name: ev.event.name } as never, api: parts.api, compare: parts.compare, search: parts.search };
}, 60_000);
afterAll(() => { app?.close(); });

describe("the event pack's searches", () => {
  it("are every team by number and name, the event by code and name, and each match as search reads one", () => {
    const qs = packSearchQueries({ code: EV, ev: pack.event, teams: packTeams(pack.event), matches: pack.event.matches });
    expect(qs).toEqual(["1111", "2222", "3333", "4444", "5555", "Gear Grinders", "Bolt Brigade", "Circuit Owls", "Torque Turtles", "Pixel Pirates", EV, "Midland Robot Qualifier", `${EV} Q1`, `${EV} Q2`]);
    for (const q of qs) expect(packLookup(pack.api, searchPackPath(q)), q).toMatchObject({ body: { q } });
  });

  it("answer with no signal exactly as online: team, name, event and match queries", async () => {
    for (const q of ["1111", "Circuit Owls", EV, "Midland Robot Qualifier", `${EV} Q2`]) expect(JSON.stringify(await offline(q)), q).toBe(JSON.stringify(await online(q)));
    // However it's typed: case and spacing.
    expect(await offline("  circuit   OWLS ")).toEqual(await online("Circuit Owls"));
    expect((await online(`${EV} Q2`)).hits[0]).toMatchObject({ kind: "match" });
  });

  it("a versus of the pack's teams is the server's own JSON, two, three and four teams", async () => {
    for (const q of ["1111 vs 3333", "2222 vs 4444 vs 5555", "1111 vs 2222 vs 3333 vs 4444", "4444 versus 2222"]) {
      const on = await online(q);
      expect(on.hits[0], q).toMatchObject({ kind: "compare" });
      expect(on.stat?.intent, q).toBe("compare");
      expect(JSON.stringify(await offline(q)), q).toBe(JSON.stringify(on));
    }
  });

  it("anything else says what it needs that isn't in the pack, and what is", async () => {
    const far = await offline("9999");
    expect(far.notInPack).toEqual({ about: ["team 9999"], packs: [{ season: S, code: EV, name: "Midland Robot Qualifier", teams: 5, matches: 2, dataAsOf: "2025-11-08T20:09:00Z" }], links: [] });
    expect((await offline("who won decode")).notInPack?.about).toEqual(["the 2025–26 season"]);
    expect((await offline("1111 vs 9999")).notInPack?.about).toEqual(["team 9999"]);
    // A match of the pack named alone ("Q2" is no match online): its page, to open.
    expect((await offline("Q2")).notInPack?.links).toEqual([{ label: "Q2 at Midland Robot Qualifier", href: `/events/${S}/${EV}?match=qual:0:2` }]);
    // The season picker's search isn't the pack's.
    expect((await searchFromPacks(`/api/search?q=1111&answer=1&season=2024`, [pack]))!.body.notInPack).toBeTruthy();
  });

  it("is deterministic: the same query twice, the same answer", async () => {
    for (const q of ["1111", "2222 vs 4444 vs 5555", "1111 vs 3333", "who won decode"]) expect(JSON.stringify(await offline(q)), q).toBe(JSON.stringify(await offline(q)));
    // And the pack built again holds the same answers.
    const again = await buildPackApi(S, pack.event);
    expect(JSON.stringify(again.search)).toBe(JSON.stringify(pack.search));
    for (const q of ["1111", EV]) expect(packLookup(again.api, searchPackPath(q))).toEqual(packLookup(pack.api, searchPackPath(q)));
  });

  it("team cards' season numbers come from the pack, one team a path, in the order asked", async () => {
    const r = await fetch(`${base}/api/teams-summary?season=${S}&teams=3333,1111`);
    const got = teamSummariesFromPacks(`/api/teams-summary?season=${S}&teams=3333,9999,1111`, [pack])!.body;
    expect(got).toEqual(await r.json().then((x: { season: number; teams: unknown[] }) => x));
  });
});
