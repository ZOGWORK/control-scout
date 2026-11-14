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
import { buildPackApi, packSearchQueries, packTeamNames, packTeams } from "./eventApi";
import { packLookup, searchPackPath, type EventBundle } from "../../src/shared/eventBundle";
import { searchFromPacks, teamSummariesFromPacks } from "../../src/shared/searchOffline";
import { packParseContext } from "../../src/shared/query/packContext";
import { parseQuery } from "../../src/shared/query/parse";
import { parseContext } from "../api/query/context";
import type { EventDetail, SearchAnswer } from "../../src/shared/api";

const S = 2025, EV = "USMIQ9";
let app: Server, base = "";
let pack: EventBundle;

const TEAMS: [number, string, string][] = [[1111, "Gear Grinders", "Midland"], [2222, "Bolt Brigade", "Saginaw"], [3333, "Circuit Owls", "Bay City"], [4444, "Torque Turtles", "Flint"], [5555, "Pixel Pirates", "Midland"]];

async function seed() {
  for (const [n, name, city] of TEAMS) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, 'MI', 'USA')", [n, name, city]);
  // A team the event doesn't hold, for "not in your pack".
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (9999, 'Far Away', 'Oradell', 'NJ', 'USA')");
  await run("INSERT INTO events (season, code, name, type, region, city, state, country, start, end, remote, hybrid, source) VALUES (?, ?, 'Midland Tundra Qualifier', 'Qualifier', 'USMI', 'Midland', 'MI', 'USA', '2025-11-08', '2025-11-08', 0, 0, 'test')", [S, EV]);
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
  // A team on the schedule only (in a lineup, not in the event's field): the pack holds it all the same.
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (8888, 'Lone Lynx', 'Midland', 'MI', 'USA')");
  await match(3, [8888, 4444], [5555, 2222]);
  // Season numbers: this season for every team, last season for most (the compare card picks the latest all played).
  const stat = (season: number, team: number, opr: number, rank: number) => run(
    `INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_auto, rating_teleop, rating_endgame, rating_sd, rating_rank, matches, wins, losses, ties)
     VALUES (?, ?, ?, ?, ?, ?, ?, 40, ?, ?, ?, ?, 4, ?, 8, 5, 3, 0)`, [season, team, opr, opr / 4, opr / 2, opr / 4, rank, opr + 2, opr / 4, opr / 2, opr / 4, rank]);
  for (const [i, [n]] of TEAMS.entries()) {
    await stat(S, n, 60 - i * 7, i + 1);
    if (n !== 5555) await stat(S - 1, n, 50 - i * 5, i + 3);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, ?, ?, 50, 2)", [S, EV, n]);
  }
  // Two teams of one name at the event, one far stronger: search's parser picks the stronger one (shared.ts
  // pickShared), offline as online.
  for (const [n, city, rank] of [[6666, "Flint", 2], [7777, "Saginaw", 36]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, 'Iron Eagles', ?, 'MI', 'USA')", [n, city]);
    await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (?, ?, ?, ?, 0, 0, 0, 0)", [S, EV, n, rank]);
    await stat(S, n, 70 - rank, rank);
    await stat(S - 1, n, 60 - rank, rank);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, ?, ?, 40, 2)", [S, EV, n]);
  }
  // Last season, an event where 1111 and 3333 met over 400 other teams, and where 1111 played with 2222 once, first:
  // the matches together of "1111 vs 2222 2024-25" name teams past the 400 one read of names takes.
  const OLD = "USMIOLD";
  await run("INSERT INTO events (season, code, name, type, region, city, state, country, start, end, remote, hybrid, source) VALUES (?, ?, 'Lakeside League Qualifier', 'Qualifier', 'USMI', 'Bay City', 'MI', 'USA', '2024-11-02', '2024-11-03', 0, 0, 'test')", [S - 1, OLD]);
  const oldMatch = async (num: number, red: number[], blue: number[]) => {
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, 80, 80, 20, 40, 20, 0, 50, 50, 10, 30, 10, 0, 'test')`,
      [S - 1, OLD, num, `Q${num}`, new Date(Date.UTC(2024, 10, 2, 8) + num * 60_000).toISOString().slice(0, 19)]);
    for (const [alliance, ts] of [["red", red], ["blue", blue]] as const)
      for (const [i, team] of ts.entries())
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, 0, 1)", [S - 1, OLD, num, team, alliance, i + 1]);
  };
  for (const n of [29000, 29001, ...Array.from({ length: 420 }, (_, i) => 20000 + i)]) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Bay City', 'MI', 'USA')", [n, `Squad${n}`]);
  await oldMatch(1, [1111, 2222], [29000, 29001]);
  for (let k = 0; k < 210; k++) await oldMatch(k + 2, [1111, 3333], [20000 + 2 * k, 20001 + 2 * k]);
  await rebuildSearch();
}

const online = async (q: string): Promise<SearchAnswer> => {
  const r = await fetch(`${base}/api/search?answer=1&limit=25&q=${encodeURIComponent(q)}`);
  expect(r.status, q).toBe(200);
  return r.json();
};
/** A versus the device builds itself (shared compareStat): the server's answer minus `video`, which the device can't
 *  read with no signal. Absent there means "not read", so the page says nothing about video rather than "none". */
const builtOnDevice = (on: SearchAnswer) => { const { video: _video, ...rest } = on; return rest; };
const deviceBuilt = (off: SearchAnswer, on: SearchAnswer, q: string) => {
  expect("video" in off, q).toBe(false);
  expect(JSON.stringify(off), q).toBe(JSON.stringify(builtOnDevice(on)));
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
  it("are every team by number and name, the event by code and name, and each match as search reads one", async () => {
    const teams = packTeams(pack.event);
    const qs = packSearchQueries({ code: EV, ev: pack.event, teams, matches: pack.event.matches }, await packTeamNames(teams));
    expect(qs).toEqual(["1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "Gear Grinders", "Bolt Brigade", "Circuit Owls", "Torque Turtles", "Pixel Pirates", "Iron Eagles", "Lone Lynx", EV, "Midland Tundra Qualifier", `${EV} Q1`, `${EV} Q2`, `${EV} Q3`]);
    for (const q of qs) expect(packLookup(pack.api, searchPackPath(q)), q).toMatchObject({ body: { q } });
  });

  it("answer with no signal exactly as online: team, name, event and match queries", async () => {
    for (const q of ["1111", "Circuit Owls", EV, "Midland Tundra Qualifier", `${EV} Q2`]) expect(JSON.stringify(await offline(q)), q).toBe(JSON.stringify(await online(q)));
    // However it's typed: case and spacing.
    expect(JSON.stringify(await offline("  circuit   OWLS "))).toBe(JSON.stringify(await online("  circuit   OWLS ")));
    expect((await online(`${EV} Q2`)).hits[0]).toMatchObject({ kind: "match" });
  });

  it("a versus of the pack's teams is the server's own JSON, two, three and four teams", async () => {
    for (const q of ["1111 vs 3333", "2222 vs 4444 vs 5555", "1111 vs 2222 vs 3333 vs 4444", "4444 versus 2222"]) {
      const on = await online(q);
      expect(on.hits[0], q).toMatchObject({ kind: "compare" });
      expect(on.stat?.intent, q).toBe("compare");
      deviceBuilt(await offline(q), on, q);
    }
    // Their matches together (both of Q1 and Q2 for 1111 and 3333; Q1 alone for all four), latest first.
    const together = (a: SearchAnswer) => a.stat?.blocks.find((b) => b.kind === "matches");
    expect(together(await offline("1111 vs 3333"))).toMatchObject({ title: "Their matches together in 2025–26", rows: [{ label: "Q2" }, { label: "Q1" }] });
    expect(together(await offline("1111 vs 2222 vs 3333 vs 4444"))).toMatchObject({ rows: [{ label: "Q1" }] });
  });

  it("reads the query as the route does: punctuation and thousands commas still find the pack's answer", async () => {
    for (const q of ["gear grinders?", "Circuit Owls!", "1,111"]) {
      const off = await offline(q);
      expect(off.notInPack, q).toBeUndefined();
      expect(JSON.stringify(off), q).toBe(JSON.stringify(await online(q)));
    }
  });

  it("a versus naming a season compares that season, as online", async () => {
    for (const q of ["1111 vs 3333 2024-25", "2222 vs 4444 vs 1111 2024-25", "1111 vs 3333 2025-26", "2222 vs 5555 2024-25"]) {
      const on = await online(q);
      expect(on.stat?.intent, q).toBe("compare");
      deviceBuilt(await offline(q), on, q);
    }
    expect((await offline("1111 vs 3333 2024-25")).stat?.title).toBe("1111 vs 3333, 2024–25");
  });

  it("two teams of one name: the stronger one, read offline as online (strength from the pack's rows)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const ctx = packParseContext([pack], today);
    const server = await parseContext();
    for (const q of ["iron eagles opr", "iron eagles vs gear grinders", "1111 vs iron eagles"]) {
      const off = await parseQuery(q, ctx);
      expect(off.teams[0]?.number === 6666 || off.teams[1]?.number === 6666, q).toBe(true);
      // The parser's whole reading, the team's strength in it too, byte for byte the server's.
      expect(JSON.stringify(off), q).toBe(JSON.stringify(await parseQuery(q, server)));
    }
    // The card names the pack's team it's about, not every team worldwide.
    const card = (await offline("iron eagles opr")).notInPack;
    expect(card?.links).toEqual([{ label: "6666 Iron Eagles", href: `/teams/6666?season=${S}` }]);
  });

  it("two teams of one name, the visitor's own the weaker: theirs, read offline as online (?prefer=)", async () => {
    const prefer = new Set(["team:7777"]);
    const ctx = { ...packParseContext([pack], new Date().toISOString().slice(0, 10)), prefer };
    const server = await parseContext(Date.now(), prefer);
    for (const q of ["iron eagles opr", "1111 vs iron eagles"]) {
      const off = await parseQuery(q, ctx);
      expect(off.teams.some((t) => t.number === 7777), q).toBe(true);
      expect(JSON.stringify(off), q).toBe(JSON.stringify(await parseQuery(q, server)));
    }
    // Asked as the /search page asks, the visitor's team on the URL: the card names theirs.
    const card = (await searchFromPacks(`/api/search?q=${encodeURIComponent("iron eagles opr")}&limit=25&answer=1&prefer=team:7777`, [pack]))!.body.notInPack;
    expect(card?.links).toEqual([{ label: "7777 Iron Eagles", href: `/teams/7777?season=${S}` }]);
  });

  it("a name the pack's answer reads as another team than the visitor's own: not that answer", async () => {
    const ask = (prefer: string) => searchFromPacks(`/api/search?q=${encodeURIComponent("Iron Eagles")}&limit=25&answer=1${prefer}`, [pack]).then((r) => r!.body);
    // For no one in particular (or a visitor whose team isn't one of them): the server's own answer, kept in the pack.
    const kept = packLookup(pack.api, searchPackPath("Iron Eagles")) as { body: SearchAnswer };
    for (const prefer of ["", "&prefer=team:1111", "&prefer=team:6666"]) expect(JSON.stringify(await ask(prefer)), prefer).toBe(JSON.stringify(kept.body));
    // The visitor's own is 7777, the weaker: the kept answer is about 6666, so it says what it needs instead, with theirs.
    const mine = await ask("&prefer=team:7777");
    expect(mine.notInPack?.links).toEqual([{ label: "7777 Iron Eagles", href: `/teams/7777?season=${S}` }]);
  });

  it("a word of a named team's own event is read as that event, offline as online", async () => {
    const ctx = packParseContext([pack], new Date().toISOString().slice(0, 10));
    const server = await parseContext();
    for (const q of ["1111 tundra", "1111 tundra opr", "1111 rank at tundra", "1111 midland", "1111 tundra 2025-26", "1111 tundra 2024-25"]) {
      const off = await parseQuery(q, ctx);
      expect(JSON.stringify(off), q).toBe(JSON.stringify(await parseQuery(q, server)));
    }
    // "tundra": only the event's name says it. In 2024-25 the team had no event of that name.
    expect((await parseQuery("1111 tundra opr", ctx)).event).toEqual({ words: "midland tundra qualifier", typed: "tundra", latest: true });
    expect((await parseQuery("1111 tundra 2024-25", ctx)).event).toBeNull();
  });

  it("a season-named versus names every team on its matches together, however many teams the pack's team met", async () => {
    for (const q of ["1111 vs 2222 2024-25", "1111 vs 3333 2024-25"]) {
      const on = await online(q);
      deviceBuilt(await offline(q), on, q);
    }
    const rows = (await offline("1111 vs 2222 2024-25")).stat?.blocks.find((b) => b.kind === "matches");
    expect(rows).toMatchObject({ rows: [{ label: "Q1", opponents: [{ label: "29000 Squad29000" }, { label: "29001 Squad29001" }] }] });
  });

  it("a team on the schedule only, not in the field: its name finds the server's own answer", async () => {
    expect(pack.event.field.some((f) => f.team === 8888)).toBe(false);
    for (const q of ["Lone Lynx", "lone lynx", "8888"]) {
      const off = await offline(q);
      expect(off.notInPack, q).toBeUndefined();
      expect(JSON.stringify(off), q).toBe(JSON.stringify(await online(q)));
    }
  });

  it("anything else says what it needs that isn't in the pack, and what is", async () => {
    const far = await offline("9999");
    expect(far.notInPack).toEqual({ about: ["team 9999"], packs: [{ season: S, code: EV, name: "Midland Tundra Qualifier", teams: 8, matches: 3, dataAsOf: "2025-11-08T20:09:00Z" }], links: [] });
    expect((await offline("who won decode")).notInPack?.about).toEqual(["the 2025–26 season"]);
    expect((await offline("1111 vs 9999")).notInPack?.about).toEqual(["team 9999"]);
    // A match of the pack named alone ("Q2" is no match online): its page, to open.
    expect((await offline("Q2")).notInPack?.links).toEqual([{ label: "Q2 at Midland Tundra Qualifier", href: `/events/${S}/${EV}?match=qual:0:2` }]);
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
