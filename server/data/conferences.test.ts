// New Jersey's conferences: read once from each NJ league tournament's name (FTC New Jersey's wording first), stored by
// (season, code), and each conference's table is the tournament's teams by FIRST's league standing over the league meets
// only. Fixtures are the brief's real 2025–26 East Bergen numbers (USNJNOLT2) and the 2026–27 code reuse.
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { conferenceOf, syncConferences } from "./conferences";
import { conferenceByEvent, leagueConferences, teamConference, teamConferenceInfo } from "../api/conferences";
import { CONFERENCE_LABEL, conferenceHref, conferenceName, conferenceSlug, ordinal } from "../../src/shared/conferences";

const ev = (season: number, code: string, name: string, type: string, region: string, league: string, start: string) =>
  run("INSERT INTO events (season, code, name, type, region, league, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'USA', ?, ?, 'first')",
    [season, code, name, type, region, league, region.slice(2), start, start]);
const lr = (season: number, league: string, team: number, rank: number, rs: number, tbp: number, played: number, w: number, l: number) =>
  run("INSERT INTO league_rankings (season, region, league, team, rank, rs, tbp, wins, losses, ties, played, counted) VALUES (?, 'USNJ', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)", [season, league, team, rank, rs, tbp, w, l, played, played]);
/** A played qual match at a league meet with these teams (what counts a meet as played). */
const meetPlayed = async (season: number, code: string, teams: number[]) => {
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, ?, 'qual', 0, 1, 'Q1', 1, 'first')", [season, code]);
  for (const t of teams) {
    await run("INSERT OR IGNORE INTO event_teams (season, code, team) VALUES (?, ?, ?)", [season, code, t]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, 1, ?, 'red')", [season, code, t]);
  }
};

// East Bergen 2025–26 (a slice of its 21): league rank, RS, TBP, played, meets as FIRST's Northern League table has them.
const EB: [team: number, rank: number, rs: number, tbp: number, played: number, meets: number, w: number, l: number][] = [
  [6980, 7, 4.0, 75.4, 16, 3, 10, 0], [23717, 9, 3.9, 86.8, 16, 3, 10, 0], [15762, 11, 3.9, 76.4, 16, 3, 10, 0],
  [4215, 12, 3.8, 92.4, 16, 3, 10, 0], [207, 13, 3.8, 91.9, 16, 3, 10, 0], [11124, 31, 2.3, 55.4, 10, 2, 6, 4], [18155, 44, 0.7, 25.5, 5, 1, 2, 3],
];

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  // 2025–26 Northern League: three meets, then Far North (LT) and East Bergen (LT2).
  await ev(2025, "USNJNOM1", "P1-4 PM Northern League Meet", "LeagueMeet", "USNJ", "NO", "2025-11-08");
  await ev(2025, "USNJNOM2", "P2-8 Northern League Meet", "LeagueMeet", "USNJ", "NO", "2025-12-21");
  await ev(2025, "USNJNOM3", "P3-6 Northern League Meet", "LeagueMeet", "USNJ", "NO", "2026-02-01");
  await ev(2025, "USNJNOLT", "Far North Conference Northern League Tournament", "LeagueTournament", "USNJ", "NO", "2026-02-07");
  await ev(2025, "USNJNOLT2", "East Bergen Conference Northern League Tournament", "LeagueTournament", "USNJ", "NO", "2026-03-08");
  // Its meets played: each team at as many as FIRST says (18155 at one, 11124 at two, the rest at all three).
  for (const [i, code] of ["USNJNOM1", "USNJNOM2", "USNJNOM3"].entries()) await meetPlayed(2025, code, EB.filter(([, , , , , m]) => m > i).map(([t]) => t));
  for (const [t, r, rs, tbp, p, , w, l] of EB) await lr(2025, "NO", t, r, rs, tbp, p, w, l);
  // Two more league rows that are not East Bergen's, so the league holds more teams than the conference.
  await lr(2025, "NO", 14450, 1, 5.0, 140, 16, 10, 0); await lr(2025, "NO", 99999, 50, 0, 0, 0, 0, 0);
  // East Bergen's field: the slice plus 30680, which played no league meet (no league row at all).
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'USNJNOLT2', 'qual', 0, 1, 'Q1', 1, 'first')");
  for (const t of [...EB.map(([t]) => t), 30680]) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJNOLT2', ?, 1)", [t]);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [207, "Critical Mass"], [30680, "New Team"]] as const) await run("INSERT INTO teams (number, name) VALUES (?, ?)", [n, name]);
  // FIRST's awards: the winning alliance captain is 4215, picked 207; qual rank 1 says nothing about who won.
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2025, 'USNJNOLT2', 'Winner', 1, 4215, 'Winning Alliance - Captain'), (2025, 'USNJNOLT2', 'Winner', 2, 207, 'Winning Alliance - 1st Team Selected')");

  // 2026–27: East Bergen moved to the Northeast League (USNJNELT2); USNJNOLT2 is now the Northern League's other
  // conference, which FIRST names "Northeast Conference" and FTC New Jersey "Northern Conference".
  await ev(2026, "USNJNEM1", "P1-2 Northeast League Meet", "LeagueMeet", "USNJ", "NE", "2026-10-25");
  await ev(2026, "USNJNELT2", "East Bergen Conference Northeast League", "LeagueTournament", "USNJ", "NE", "2027-02-21");
  await ev(2026, "USNJNOLT2", "Northeast Conference Northern League", "LeagueTournament", "USNJ", "NO", "2027-02-28");
  await meetPlayed(2026, "USNJNEM1", [4215]);
  await lr(2026, "NE", 4215, 24, 1.2, 26.9, 6, 2, 3);
  const prov = (code: string, title: string, teams: object[]) => run(
    "INSERT INTO event_provisional (season, code, source, url, title, teams, fetched_at) VALUES (2026, ?, 'ftcnj', 'https://www.newjerseyftc.com/upcoming-events.html', ?, ?, '2026-11-15T23:47:01.825Z')",
    [code, title, JSON.stringify(teams)]);
  await prov("USNJNELT2", "FTCNJ Hudson/East Bergen Conference, Northeast League Tournament (Sunday)",
    [{ team: 4215, name: "Hypnotic Robotics", status: "registered", session: null }, { team: 207, name: "Critical Mass", status: "registered", session: null }, { team: 5555, name: "Waitlisted", status: "pending", session: null }]);
  await prov("USNJNOLT2", "FTCNJ Northern Conference, Northern League Tournament (Sunday)", []);

  // A Michigan league tournament: no conferences outside New Jersey, whatever its name says.
  await ev(2025, "USMIABLT", "Alpha Conference Alpha League Tournament", "LeagueTournament", "USMI", "AB", "2026-02-07");
});

describe("conference names", () => {
  it("reads the conference from a tournament title, FIRST's or FTC New Jersey's, and nothing from one that names none", () => {
    expect(conferenceName("East Bergen Conference Northern League Tournament")).toBe("East Bergen Conference");
    expect(conferenceName("FTCNJ Hudson/East Bergen Conference, Northeast League Tournament (Sunday)")).toBe("Hudson/East Bergen Conference");
    expect(conferenceName("FTCNJ W Central/Bergen Conference, ​Northeast League Tournament (Saturday)")).toBe("W Central/Bergen Conference");
    expect(conferenceName("Essex Conference Northeast Edge")).toBe("Essex Conference");
    // Older seasons' names: a date and the league before the conference.
    expect(conferenceName("NJ 2/25/24 Northern League East Bergen Conference Tournament")).toBe("East Bergen Conference");
    expect(conferenceName("NJ 2/17/24 South Essex Conference League Tournament")).toBe("South Essex Conference");
    expect(conferenceName("Central Conference Upper Central League Tournament")).toBe("Central Conference");
    expect(conferenceName("New Jersey Championship")).toBeNull();
    expect(conferenceName("P3-6 Northern League Meet")).toBeNull();
    expect(conferenceSlug("Hudson/East Bergen Conference")).toBe("hudson-east-bergen-conference");
  });

  it("prefers FTC New Jersey's wording, and keeps FIRST's as a way to find it only when it agrees", () => {
    expect(conferenceOf("East Bergen Conference Northeast League", "FTCNJ Hudson/East Bergen Conference, Northeast League Tournament (Sunday)"))
      .toEqual({ name: "Hudson/East Bergen Conference", slug: "hudson-east-bergen-conference", firstName: "East Bergen Conference", aliases: ["hudson-east-bergen-conference", "east-bergen-conference"], source: "ftcnj" });
    // FIRST's "Northeast" for FTC New Jersey's Northern Conference finds nothing: it would be another conference's name.
    expect(conferenceOf("Northeast Conference Northern League", "FTCNJ Northern Conference, Northern League Tournament (Sunday)"))
      .toEqual({ name: "Northern Conference", slug: "northern-conference", firstName: "Northeast Conference", aliases: ["northern-conference"], source: "ftcnj" });
    expect(conferenceOf("East Bergen Conference Northern League Tournament", null)).toMatchObject({ name: "East Bergen Conference", source: "first", firstName: null });
    expect(conferenceOf("Interleague Tournament", null)).toBeNull();
  });
});

describe("conference tables", () => {
  it("stores each NJ tournament's conference by (season, code), never outside New Jersey", async () => {
    await syncConferences(2025, { now: new Date("2026-11-16T12:00:00Z") });
    await syncConferences(2026, { now: new Date("2026-11-16T12:00:00Z") });
    expect(await all("SELECT season, code, league, name FROM event_conferences ORDER BY season, code")).toEqual([
      { season: 2025, code: "USNJNOLT", league: "NO", name: "Far North Conference" },
      { season: 2025, code: "USNJNOLT2", league: "NO", name: "East Bergen Conference" },
      { season: 2026, code: "USNJNELT2", league: "NE", name: "Hudson/East Bergen Conference" },
      { season: 2026, code: "USNJNOLT2", league: "NO", name: "Northern Conference" },
    ]);
    expect(await leagueConferences(2025, "USMI", "AB")).toEqual({ season: 2025, region: "USMI", code: "AB", conferences: [] });
    expect(await leagueConferences(2025, "USNJ", "ZZ")).toBeNull();
  });

  it("ranks East Bergen's field by the league standing, with the unranked team last and no number made up", async () => {
    await syncConferences(2025, { now: new Date("2026-11-16T12:00:00Z") });
    const d = await leagueConferences(2025, "usnj", "no", { now: "2026-11-16" });
    expect(d!.conferences.map((c) => [c.code, c.name])).toEqual([["USNJNOLT", "Far North Conference"], ["USNJNOLT2", "East Bergen Conference"]]);
    const eb = d!.conferences[1];
    expect(eb).toMatchObject({ status: "finished", teamsFrom: "field", registered: null, leagueOf: 8 });
    // No snapshot, but the last league meet (Feb 1) was before the tournament (Mar 8): the final league standing.
    expect(eb.rs).toEqual({ kind: "final", asOf: null, lastMeet: "2026-02-01" });
    expect(eb.rows.map((r) => [r.rank, r.team, r.leagueRank, r.rs, r.tbp, r.played, r.meets])).toEqual([
      [1, 6980, 7, 4, 75.4, 16, 3], [2, 23717, 9, 3.9, 86.8, 16, 3], [3, 15762, 11, 3.9, 76.4, 16, 3], [4, 4215, 12, 3.8, 92.4, 16, 3],
      [5, 207, 13, 3.8, 91.9, 16, 3], [6, 11124, 31, 2.3, 55.4, 10, 2], [7, 18155, 44, 0.7, 25.5, 5, 1],
      [null, 30680, null, null, null, null, null],
    ]);
    // League meets only: 18155's league record, not its tournament quals.
    expect(eb.rows.find((r) => r.team === 18155)).toMatchObject({ wins: 2, losses: 3, ties: 0 });
    expect(eb.rows.find((r) => r.team === 30680)).toMatchObject({ name: "New Team", wins: null, rating: null, opr: null });
    // Who won is the winning alliance from the awards.
    expect(eb.winner).toEqual({ captain: { team: 4215, name: "Hypnotic Robotics" }, picks: [{ team: 207, name: "Critical Mass" }] });
    // The same conference next season, in its new league (FIRST's wording finds FTC New Jersey's Hudson/East Bergen).
    await syncConferences(2026, { now: new Date("2026-11-16T12:00:00Z") });
    const again = await conferenceByEvent(2025, "USNJNOLT2", { now: "2026-11-16" });
    expect(again!.seasons).toEqual([{ season: 2026, region: "USNJ", league: "NE", code: "USNJNELT2", name: "Hudson/East Bergen Conference", slug: "hudson-east-bergen-conference" }]);
  });

  it("gives a team its conference place out of the whole field, beside its league place", async () => {
    await syncConferences(2025, { now: new Date("2026-11-16T12:00:00Z") });
    expect(await teamConference(2025, 4215, { now: "2026-11-16" })).toEqual({
      season: 2025, region: "USNJ", league: "NO", code: "USNJNOLT2", name: "East Bergen Conference", slug: "east-bergen-conference",
      rank: 4, of: 8, ranked: 7, leagueRank: 12, leagueOf: 8, href: "/leagues/2025/USNJ/NO?conference=east-bergen-conference&team=4215#conferences",
    });
    expect(await teamConference(2025, 30680, { now: "2026-11-16" })).toMatchObject({ rank: null, leagueRank: null });
    expect(await teamConference(2025, 14450, { now: "2026-11-16" })).toBeNull();
  });

  it("tells the conference button whether a team is based in New Jersey, its league and its conference", async () => {
    await syncConferences(2025, { now: new Date("2026-11-16T12:00:00Z") });
    await run("UPDATE teams SET state = 'NJ', country = 'USA' WHERE number = 4215");
    await run("INSERT INTO teams (number, name, state, country) VALUES (1111, 'Michigan Team', 'MI', 'USA')");
    expect(await teamConferenceInfo(4215, 2025)).toMatchObject({ team: 4215, season: 2025, nj: true, league: { region: "USNJ", code: "NO" }, conference: { name: "East Bergen Conference", rank: 4 } });
    expect(await teamConferenceInfo(1111, 2025)).toEqual({ team: 1111, season: 2025, nj: false, league: null, conference: null });
    expect((await teamConferenceInfo(424242, 2025)).nj).toBeNull();
    // 2026–27: in the Northeast League, registered for East Bergen but not in a FIRST field yet: no conference place.
    expect(await teamConferenceInfo(4215, 2026)).toMatchObject({ nj: true, league: { region: "USNJ", code: "NE" }, conference: null });
  });

  it("shows the teams going in from FTC New Jersey's sign-ups before FIRST posts a field, with today's standing", async () => {
    await syncConferences(2026, { now: new Date("2026-11-16T12:00:00Z") });
    const ne = (await leagueConferences(2026, "USNJ", "NE", { now: "2026-11-16" }))!.conferences[0];
    expect(ne).toMatchObject({ code: "USNJNELT2", name: "Hudson/East Bergen Conference", firstName: "East Bergen Conference", status: "upcoming", teamsFrom: "registered" });
    expect(ne.registered).toEqual({ count: 2, fetchedAt: "2026-11-15T23:47:01.825Z", url: "https://www.newjerseyftc.com/upcoming-events.html", sessionUnknown: false });
    expect(ne.rs.kind).toBe("live");
    expect(ne.rows.map((r) => [r.rank, r.team, r.rs, r.leagueRank, r.meets, r.played, r.registered])).toEqual([
      [1, 4215, 1.2, 24, 1, 6, "registered"], [null, 207, null, null, null, null, "registered"], [null, 5555, null, null, null, null, "pending"],
    ]);
    await syncConferences(2025, { now: new Date("2026-11-16T12:00:00Z") });
    // Code reuse: USNJNOLT2 is East Bergen in 2025 and the Northern Conference in 2026, never confused.
    expect((await conferenceByEvent(2026, "USNJNOLT2"))!.name).toBe("Northern Conference");
    expect((await conferenceByEvent(2025, "USNJNOLT2"))!.name).toBe("East Bergen Conference");
    // Registered isn't the field: no team page link before FIRST lists it.
    expect(await teamConference(2026, 4215)).toBeNull();
    // FIRST posts the field: the sign-ups give way, never one list of both.
    await run("INSERT INTO event_teams (season, code, team) VALUES (2026, 'USNJNELT2', 4215)");
    const posted = (await leagueConferences(2026, "USNJ", "NE", { now: "2026-11-16" }))!.conferences[0];
    expect(posted).toMatchObject({ teamsFrom: "field", registered: null });
    expect(posted.rows.map((r) => [r.team, r.registered])).toEqual([[4215, undefined]]);
  });

  it("snapshots the league standing the week before, and shows that, not today's, once the tournament has started", async () => {
    await syncConferences(2026, { now: new Date("2026-11-16T12:00:00Z") });
    expect(await all("SELECT * FROM conference_snapshots")).toEqual([]);
    const r = await syncConferences(2026, { now: new Date("2027-02-14T12:00:00Z") });
    expect(r.snapshots).toBe(1);
    // After the snapshot the league table moves (a meet after the tournament, say): the going-in numbers don't.
    await run("UPDATE league_rankings SET rs = 9.9 WHERE season = 2026 AND team = 4215");
    await run("INSERT INTO event_teams (season, code, team) VALUES (2026, 'USNJNELT2', 4215)");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2026, 'USNJNELT2', 'qual', 0, 1, 'Q1', 1, 'first')");
    const live = (await leagueConferences(2026, "USNJ", "NE", { now: "2027-02-21" }))!.conferences[0];
    expect(live.status).toBe("live");
    expect(live.rs).toMatchObject({ kind: "snapshot" });
    expect(live.rows[0]).toMatchObject({ team: 4215, rs: 1.2, rank: 1 });
    // No snapshot and a league meet after the tournament: no going-in numbers at all.
    await run("DELETE FROM conference_snapshots");
    await ev(2026, "USNJNEM9", "Late Northeast League Meet", "LeagueMeet", "USNJ", "NE", "2027-03-01");
    await meetPlayed(2026, "USNJNEM9", [4215]);
    const gone = (await leagueConferences(2026, "USNJ", "NE", { now: "2027-03-02" }))!.conferences[0];
    expect(gone.rs).toEqual({ kind: "gone" });
    expect(gone.rows.map((r) => [r.team, r.rank, r.rs])).toEqual([[4215, null, null]]);
  });

  it("links to the league page's conference section, and orders like FIRST", () => {
    expect(conferenceHref(2026, "USNJ", "NE", { slug: "hudson-east-bergen-conference", team: 4215 })).toBe("/leagues/2026/USNJ/NE?conference=hudson-east-bergen-conference&team=4215#conferences");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
    expect(CONFERENCE_LABEL).toBe("League meets only — excludes this tournament.");
  });
});
