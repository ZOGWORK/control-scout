// New Jersey conferences in search: read from the words generically (the conference found from the stored names, a
// team by number or whole name, a season), answered with the league page's own numbers: a team's place by league RS
// beside its league rank, a conference's table, who won it from the awards (never the top seed), and "which
// conference?" when none is named. A team "at" a conference is its tournament's question, left to the event readers.
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../../db";
import { clearAllCaches } from "../../../caches";
import { syncConferences } from "../../../data/conferences";
import { allConferences } from "../../conferences";
import { conferenceAskAnswer, matchConference, readConferenceAsk } from "./conference";

describe("reading a conference ask", () => {
  it.each([
    ["4215 conference ranking", { team: 4215, words: [], season: null, won: false }],
    ["4215 conference ranking 2025-26", { team: 4215, words: [], season: 2025 }],
    ["4215 conference ranking 2026-27", { team: 4215, words: [], season: 2026 }],
    ["where does 4215 rank in East Bergen Conference", { team: 4215, words: ["east", "bergen"] }],
    ["East Bergen Conference rankings", { team: null, words: ["east", "bergen"], won: false }],
    ["top teams in East Bergen Conference", { team: null, words: ["east", "bergen"] }],
    ["best team in East Bergen Conference", { team: null, words: ["east", "bergen"] }],
    ["who won East Bergen Conference", { team: null, words: ["east", "bergen"], won: true }],
    ["who won Conference?", { team: null, words: [], won: true }],
    ["essex/union conference standings", { words: ["essex", "union"] }],
    ["what is hypnotic robotics conference rank", { team: null, words: ["hypnotic", "robotics"] }],
    ["top teams at east bergen conference", { team: null, words: ["east", "bergen"] }],
    // A place in the ranking is never a team's number.
    ["top 10 teams in East Bergen Conference", { team: null, words: ["east", "bergen"] }],
    ["#1 in East Bergen Conference", { team: null, words: ["east", "bergen"] }],
    ["number 2 in east bergen conference", { team: null, words: ["east", "bergen"] }],
    // This season is the current one; a season after every stored one is kept.
    ["4215 conference ranking this season", { team: 4215, season: null, now: true, last: false }],
    ["East Bergen Conference rankings this season", { team: null, now: true }],
    ["East Bergen Conference rankings in 2027", { season: 2027, now: false }],
    // The name after a bare "conference".
    ["conference rankings for east bergen", { team: null, words: ["east", "bergen"] }],
    ["who won the conference for east bergen", { words: ["east", "bergen"], won: true }],
  ])("%s", (q, want) => expect(readConferenceAsk(q)).toMatchObject(want));

  it.each([
    "east bergen conference", // the event's name alone
    "east bergen conference inspire award", // an award's ask
    "4215 rank at east bergen conference", // the tournament's rank
    "how did 4215 do at east bergen conference",
    "how did 4215 do in east bergen conference",
    "4215 northern league ranking", // no conference said
    "compare 4215 and 207 conference",
    "4215 conference schedule", // the tournament's schedule, not its ranking
    "4215 conference venue",
  ])("leaves %s to the other readers", (q) => expect(readConferenceAsk(q)).toBeNull());
});

const S = (season: number, code: string, name: string, aliases: string[]) => ({ season, code, region: "USNJ", league: "NO", leagueName: "Northern", name, slug: aliases[0], aliases, start: null, end: null });

describe("matching a conference's name", () => {
  const list = [
    S(2025, "USNJNOLT2", "East Bergen Conference", ["east-bergen-conference"]),
    S(2026, "USNJNELT2", "Hudson/East Bergen Conference", ["hudson-east-bergen-conference", "east-bergen-conference"]),
    S(2026, "USNJCENLT", "Central Conference", ["central-conference"]),
    S(2026, "USNJNELT", "W Central/Bergen Conference", ["w-central-bergen-conference"]),
    S(2026, "USNJNOLT2", "Northern Conference", ["northern-conference"]),
  ];
  it("finds a conference by its own or FIRST's words, the whole name before a name it is part of", () => {
    expect(matchConference(["east", "bergen"], list).hits.map((c) => c.code)).toEqual(["USNJNOLT2", "USNJNELT2"]);
    expect(matchConference(["central"], list).hits.map((c) => c.code)).toEqual(["USNJCENLT"]);
    expect(matchConference(["northeast"], list).hits).toEqual([]);
    // A team's name before the conference's.
    expect(matchConference(["hypnotic", "robotics", "east", "bergen"], list)).toMatchObject({ lead: ["hypnotic", "robotics"] });
  });
});

describe("answering a conference ask", () => {
  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    clearAllCaches();
    const ev = (season: number, code: string, name: string, type: string, league: string, start: string) =>
      run("INSERT INTO events (season, code, name, type, region, league, state, country, start, end, source) VALUES (?, ?, ?, ?, 'USNJ', ?, 'NJ', 'USA', ?, ?, 'first')", [season, code, name, type, league, start, start]);
    await ev(2025, "USNJNOM3", "P3-6 Northern League Meet", "LeagueMeet", "NO", "2026-02-01");
    await ev(2025, "USNJNOLT2", "East Bergen Conference Northern League Tournament", "LeagueTournament", "NO", "2026-03-08");
    await ev(2025, "USNJUCLT", "Central Conference Upper Central League Tournament", "LeagueTournament", "UC", "2026-02-14");
    await ev(2026, "USNJNELT2", "East Bergen Conference Northeast League", "LeagueTournament", "NE", "2027-02-21");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'USNJNOM3', 'qual', 0, 1, 'Q1', 1, 'first'), (2025, 'USNJNOLT2', 'qual', 0, 1, 'Q1', 1, 'first'), (2025, 'USNJUCLT', 'qual', 0, 1, 'Q1', 1, 'first')");
    for (const [n, name, state] of [[4215, "Hypnotic Robotics", "NJ"], [207, "Critical Mass", "NJ"], [6980, "Bad Wolf", "NJ"], [30680, "Tech BnB", "NJ"], [31257, "KinetIQ", "NJ"], [31814, "Top Seed", "NJ"], [19772, "Rust in Piece", "NJ"], [1111, "Michigan Team", "MI"]] as const)
      await run("INSERT INTO teams (number, name, state, country) VALUES (?, ?, ?, 'USA')", [n, name, state]);
    // East Bergen: 4215 won the tournament (rank 1) but is 2nd here by league RS (6980 first; 4215 beats 207 on TBP).
    for (const [t, rank] of [[4215, 1], [207, 2], [6980, 5], [30680, 21]]) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJNOLT2', ?, ?)", [t, rank]);
    for (const [t, rank, rs, tbp] of [[6980, 7, 4.0, 75.4], [207, 13, 3.8, 91.9], [4215, 12, 3.8, 92.4], [99, 1, 5, 100]]) {
      await run("INSERT INTO league_rankings (season, region, league, team, rank, rs, tbp, wins, losses, ties, played) VALUES (2025, 'USNJ', 'NO', ?, ?, ?, ?, 10, 0, 0, 16)", [t, rank, rs, tbp]);
    }
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2025, 'USNJNOLT2', 'Winner', 1, 4215, 'Winning Alliance - Captain'), (2025, 'USNJNOLT2', 'Winner', 2, 207, 'Winning Alliance - 1st Team Selected')");
    // Central: qual rank 1 was 31814; the winner was 31257.
    for (const [t, rank] of [[31814, 1], [31257, 2], [19772, 3]]) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJUCLT', ?, ?)", [t, rank]);
    await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2025, 'USNJUCLT', 'Winner', 1, 31257, 'Winning Alliance - Captain'), (2025, 'USNJUCLT', 'Winner', 2, 19772, 'Winning Alliance - 1st Team Selected')");
    await run(`INSERT INTO event_provisional (season, code, source, url, title, teams, fetched_at) VALUES (2026, 'USNJNELT2', 'ftcnj', 'https://www.newjerseyftc.com/upcoming-events.html',
      'FTCNJ Hudson/East Bergen Conference, Northeast League Tournament (Sunday)', ?, '2026-11-15T23:47:01.825Z')`, [JSON.stringify([{ team: 4215, name: "Hypnotic Robotics", status: "registered", session: null }])]);
    await syncConferences(2025, { now: new Date("2026-11-16T12:00:00Z") });
    await syncConferences(2026, { now: new Date("2026-11-16T12:00:00Z") });
    expect((await allConferences()).length).toBe(3);
  });
  const ask = (q: string) => conferenceAskAnswer(readConferenceAsk(q)!, 2026);

  it("gives a team's conference place by league RS, beside its league rank, linking the table", async () => {
    const a = (await ask("4215 conference ranking"))!;
    expect(a.title).toBe("4215 in East Bergen Conference · 2025–26");
    expect(a.headline).toMatchObject({ value: "2nd of 4", href: "/leagues/2025/USNJ/NO?conference=east-bergen-conference&team=4215#conferences" });
    expect(a.headline!.sub).toContain("League rank 12 of 4 · RS 3.8 · TBP 92.4 · 16 played");
    expect(a.headline!.sub).toContain("League meets only — excludes this tournament.");
    // Two rankings, said apart: 1st at the tournament itself.
    expect(a.definition).toContain("At the tournament itself 4215 ranked 1st: a different ranking from the league's.");
    const table = a.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => [r.cells.team, r.cells.rank, r.cells.rs])).toEqual([
      ["6980 Bad Wolf", 1, "4.0"], ["4215 Hypnotic Robotics", 2, "3.8"], ["207 Critical Mass", 3, "3.8"], ["30680 Tech BnB", "Not ranked yet", "—"]]);
  });

  it("answers the season asked, going in from the sign-ups when FIRST has no field yet", async () => {
    const a = (await ask("4215 conference ranking 2026-27"))!;
    expect(a.title).toBe("4215 going into Hudson/East Bergen Conference · 2026–27");
    expect(a.headline!.label).toContain("is registered for Hudson/East Bergen Conference");
    expect(a.definition).toContain("Tournament hasn't started yet — 1 team registered via FTC New Jersey, fetched Nov 15, 2026. Registered, not the final field.");
  });

  it("gives a conference's latest finished table, with the next one said, and who won from the awards", async () => {
    const t = (await ask("East Bergen Conference rankings"))!;
    expect(t.title).toBe("East Bergen Conference rankings · 2025–26");
    expect(t.headline).toMatchObject({ value: "#1 6980" });
    const next = t.blocks.find((b) => b.kind === "links" && b.title.startsWith("Next"));
    expect(next && next.kind === "links" && [next.title, next.items[0].label]).toEqual(["Next: Hudson/East Bergen Conference, 2026–27", "Feb 21, 2027 · NE League, 1 team registered via FTC New Jersey (fetched Nov 15, 2026)"]);
    const w = (await ask("who won East Bergen Conference"))!;
    expect(w.headline).toMatchObject({ value: "4215", label: "4215 Hypnotic Robotics, Winning Alliance Captain, East Bergen Conference 2025–26" });
    expect(w.headline!.sub).toContain("with 207 Critical Mass");
    // Qual rank 1 (31814) didn't win Central: the captain did.
    expect((await ask("who won the central conference"))!.headline).toMatchObject({ value: "31257" });
  });

  it("asks which conference when none is named, never guessing", async () => {
    const a = (await ask("who won Conference?"))!;
    expect(a.headline).toBeUndefined();
    const l = a.blocks[0];
    expect(l.kind === "links" && l.title).toBe("Which conference? Each New Jersey conference's winner, 2025–26");
    expect(l.kind === "links" && l.items.map((i) => i.label)).toEqual(["Central Conference: won by 31257 KinetIQ with 19772 Rust in Piece", "East Bergen Conference: won by 4215 Hypnotic Robotics with 207 Critical Mass"]);
  });

  it("says plainly when a team has no conference, and leaves a name no conference has to the others", async () => {
    expect((await ask("1111 conference ranking"))!.none).toBe("1111 isn't a New Jersey team: conferences are New Jersey's alone.");
    expect(await ask("big ten conference rankings")).toBeNull();
  });

  it("says a waitlisted team is on the waitlist, and a finished tournament with no awards has no winner on record", async () => {
    await run("INSERT INTO teams (number, name, state, country) VALUES (5555, 'Wait Team', 'NJ', 'USA')");
    await run("UPDATE event_provisional SET teams = ? WHERE code = 'USNJNELT2'", [JSON.stringify([
      { team: 4215, name: "Hypnotic Robotics", status: "registered", session: null }, { team: 5555, name: "Wait Team", status: "pending", session: null }])]);
    clearAllCaches();
    const a = (await ask("5555 conference ranking"))!;
    expect(a.headline!.label).toContain("5555 Wait Team is on the waitlist for Hudson/East Bergen Conference");
    expect(a.blocks[0].kind === "kpis" && a.blocks[0].items[0].label).toBe("Waitlist, by league RS");
    const table = a.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => [r.cells.team, r.cells.rank])).toEqual([["4215 Hypnotic Robotics", "Registered"], ["5555 Wait Team", "Waitlist"]]);
    expect((await ask("4215 conference ranking 2026-27"))!.headline!.label).toContain("is registered for");
    // Central is past, its awards not in yet: no winner on record, never "not won yet".
    await run("DELETE FROM awards WHERE code = 'USNJUCLT'");
    clearAllCaches();
    expect((await ask("who won the central conference"))!.none).toBe("No winner is on record yet for Central Conference 2025–26: FIRST hasn't posted the tournament's awards.");
  });

  it("names the season asked's conference, says a tournament under way has no winner yet, and finds a name after 'conference'", async () => {
    expect((await ask("where does 207 rank in east bergen conference 2026-27"))!.none).toBe("207 isn't on Hudson/East Bergen Conference's team list in 2026–27. A conference ranking is its tournament's teams by league standing.");
    expect((await ask("conference rankings for east bergen"))!.title).toBe("East Bergen Conference rankings · 2025–26");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2026, 'USNJNELT2', 'qual', 0, 1, 'Q1', 1, 'first')");
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2026, 'USNJNELT2', 4215, 1)");
    clearAllCaches();
    expect((await ask("who won hudson/east bergen conference 2026-27"))!.none).toBe("Hudson/East Bergen Conference 2026–27 is under way: no winner yet.");
  });

  it("lists every conference of the season in 'which conference?', each one's winner or where it stands", async () => {
    await run("DELETE FROM awards WHERE code = 'USNJUCLT'");
    clearAllCaches();
    const w = (await ask("who won Conference?"))!;
    const l = w.blocks[0];
    expect(l.kind === "links" && l.items.map((i) => i.label)).toEqual(["Central Conference: no winner on record yet", "East Bergen Conference: won by 4215 Hypnotic Robotics with 207 Critical Mass"]);
    // Not a winner ask: the latest season with conferences, awards or not.
    await run("DELETE FROM awards");
    clearAllCaches();
    const t = (await ask("conference rankings"))!;
    expect(t.title).toBe("Which conference? New Jersey's conferences · 2026–27");
    expect(t.none).toBeUndefined();
    expect((await ask("East Bergen Conference rankings 2027-28"))!.title).toBe("Hudson/East Bergen Conference · 2027–28");
  });

  it("says the phase from the tournament's status, not where its list came from, and a season with no conferences plainly", async () => {
    // FIRST's field out for a tournament not started yet: still going in.
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2026, 'USNJNELT2', 4215, NULL)");
    clearAllCaches();
    const a = (await ask("4215 conference ranking 2026-27"))!;
    expect(a.title).toBe("4215 going into Hudson/East Bergen Conference · 2026–27");
    expect(a.headline!.label).toContain("4215 Hypnotic Robotics is going into Hudson/East Bergen Conference");
    expect(a.blocks[0].kind === "kpis" && a.blocks[0].items[0].label).toBe("Going in, by league RS");
    // A past tournament FIRST never posted a team list for: the sign-ups, said so, never "hasn't started".
    await run("INSERT INTO teams (number, name, state, country) VALUES (5555, 'Wait Team', 'NJ', 'USA')");
    await run("INSERT INTO events (season, code, name, type, region, league, state, country, start, end, source) VALUES (2025, 'USNJGOLT', 'Gold Conference Northern League Tournament', 'LeagueTournament', 'USNJ', 'NO', 'NJ', 'USA', '2026-01-10', '2026-01-10', 'first')");
    await run(`INSERT INTO event_provisional (season, code, source, url, title, teams, fetched_at) VALUES (2025, 'USNJGOLT', 'ftcnj', 'https://www.newjerseyftc.com/upcoming-events.html', 'FTCNJ Gold Conference', ?, '2026-01-05T12:00:00.000Z')`,
      [JSON.stringify([{ team: 5555, name: "Wait Team", status: "registered", session: null }])]);
    await syncConferences(2025, { now: new Date("2026-01-06T12:00:00Z") });
    clearAllCaches();
    const g = (await ask("5555 conference ranking 2025-26"))!;
    expect(g.title).toBe("5555 in Gold Conference · 2025–26");
    expect(g.definition).toContain("FIRST hasn't posted this tournament's team list: these are the 1 team registered via FTC New Jersey, fetched Jan 5, 2026, not its final field.");
    expect(g.definition).not.toContain("hasn't started");
    expect((await ask("conference rankings 2027-28"))!.none).toBe("No New Jersey conference tournaments are listed for 2027–28.");
  });

  it("keeps the next edition when a later season has two tournaments of the name", async () => {
    for (const code of ["USNJAALT", "USNJBBLT"]) {
      await run("INSERT INTO events (season, code, name, type, region, league, state, country, start, end, source) VALUES (2027, ?, 'East Bergen Conference Northeast League Tournament', 'LeagueTournament', 'USNJ', 'NE', 'NJ', 'USA', '2028-02-20', '2028-02-20', 'first')", [code]);
    }
    await syncConferences(2027, { now: new Date("2026-11-16T12:00:00Z") });
    clearAllCaches();
    const t = (await ask("East Bergen Conference rankings"))!;
    const next = t.blocks.find((b) => b.kind === "links" && b.title.startsWith("Next"));
    expect(next && next.kind === "links" && next.title).toBe("Next: Hudson/East Bergen Conference, 2026–27");
    // That season asked: which one, never a guess.
    expect((await ask("East Bergen Conference rankings 2027-28"))!.title).toBe("Which conference?");
  });

  it("answers this season as the current one, says a later season has none, and never picks between two same-named teams", async () => {
    expect((await ask("4215 conference ranking this season"))!.title).toBe("4215 going into Hudson/East Bergen Conference · 2026–27");
    expect((await ask("East Bergen Conference rankings in 2027"))!.none).toBe("No New Jersey conference by that name in 2027–28.");
    expect((await ask("where does hypnotic robotics rank in east bergen conference"))!.title).toBe("4215 in East Bergen Conference · 2025–26");
    await run("INSERT INTO teams (number, name, state, country) VALUES (9999, 'Hypnotic Robotics', 'NJ', 'USA')");
    expect(await ask("where does hypnotic robotics rank in east bergen conference")).toBeNull();
  });
});
