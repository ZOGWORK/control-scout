// Paraphrase robustness (launch audit, Nov 9 2026, Phase A): the plural asks for the list, a team's name typed nearly
// right is read as that team even when each of its words is a real one, and a plain form of a known word is never
// split in two.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { correctQuery } from "./spelling";

const S = 2025;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
// "Robotix" is a team's whole name, so the word is real and no word of "hypnotic robotix" is a typo on its own.
const TEAMS: [number, string][] = [[4215, "Hypnotic Robotics"], [7149, "ENFORCERS"], [23268, "Ultraviolet"], [31999, "Robotix"]];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of TEAMS) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Oradell', 'NJ', 'USA', 2010)", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rating_np, rating_matches, matches, wins, losses, ties)
      VALUES (?, ?, 100, 30, 60, 10, 90, 10, 10, 7, 3, 0)`, [S, n]);
  }
  await run(`INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES
    (?, 'USNJQ1', 'Garden Qualifier', 'Qualifier', 'Union', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't'),
    (2026, 'USNJM1', 'Northeast League Meet', 'LeagueMeet', 'Union', 'NJ', 'USA', ?, ?, 't'),
    (2026, 'USNJM2', 'Southern League Meet', 'LeagueMeet', 'Union', 'NJ', 'USA', ?, ?, 't')`, [S, day(2), day(2), day(9), day(9)]);
  // 4215 has two events ahead, 7149 one, 23268 none.
  for (const [n, codes] of [[4215, ["USNJM1", "USNJM2"]], [7149, ["USNJM1"]]] as const) for (const code of codes) await run("INSERT INTO event_teams (season, code, team) VALUES (2026, ?, ?)", [code, n]);
  for (const [n] of TEAMS) await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USNJQ1', ?)", [S, n]);
  await rebuildSearch();
});

describe("the plural is the list", () => {
  it("upcoming events: every one listed, titled as a list, even with one or none", async () => {
    const two = (await ask("4215 upcoming events")).card!;
    expect(two).toMatchObject({ kind: "next-event", title: "Upcoming events" });
    expect(two.lines.map((l) => l.text)).toEqual(["Northeast League Meet", "Southern League Meet"]);
    expect((await ask("7149 upcoming events")).card).toMatchObject({ title: "Upcoming events", lines: [{ text: "Northeast League Meet" }] });
    expect((await ask("23268 upcoming events")).card).toMatchObject({ title: "Upcoming events", lines: [], none: "No upcoming events are published for Ultraviolet yet." });
    // Said any way a person says it.
    for (const q of ["whats 4215s upcoming events", "4215 next events", "hypnotic robotics upcoming competitions"]) expect((await ask(q)).card, q).toMatchObject({ kind: "next-event", title: "Upcoming events" });
  });
  it("a place's upcoming events stay the place's, never a team named like it", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (31998, 'Ro2D2', 'Cluj', 'CJ', 'Romania')");
    await rebuildSearch();
    for (const q of ["upcoming meets in romania", "upcoming events in nj", "upcoming events in new jersey"]) expect((await ask(q)).card?.kind, q).toBeUndefined();
    // A city ("in Oradell", where these teams are) is a place too: never one team's schedule, never a "correction".
    for (const q of ["upcoming events in oradell", "next meet at union"]) {
      const a = await ask(q);
      expect([a.card?.kind, a.didYouMean], q).toEqual([undefined, undefined]);
    }
  });
  it("the singular is the next one", async () => {
    expect((await ask("7149 upcoming event")).card).toMatchObject({ kind: "next-event", title: "Next event", lines: [{ text: "Northeast League Meet" }] });
    expect((await ask("23268 next event")).card).toMatchObject({ title: "Next event", none: "No upcoming event is published for Ultraviolet yet." });
  });
  it("upcoming matches: the match list, titled as one", async () => {
    expect((await ask("4215 upcoming matches")).card).toMatchObject({ kind: "next-match", title: "Upcoming matches" });
    expect((await ask("4215 upcoming match")).card).toMatchObject({ kind: "next-match", title: "Next match" });
  });
});

describe("a team's name typed nearly right", () => {
  it("is read as the team when every word is a real one (another team's)", async () => {
    const a = await ask("hypnotic robotix opr");
    expect(a.stat?.team?.number).toBe(4215);
    expect(a.didYouMean).toBe("Hypnotic Robotics opr");
    // This fixture has no matches: the record is the team's page, read for the right team, with the same correction.
    const r = await ask("hypnotic robotix record");
    expect([r.hits[0]?.ref, r.didYouMean]).toEqual(["4215", "Hypnotic Robotics record"]);
    // The team named so is still itself.
    expect((await ask("robotix opr")).stat?.team?.number).toBe(31999);
  });
  it("is said as a correction when a question reads it", async () => {
    const a = await ask("hypnotik robotics upcoming events");
    expect(a.card).toMatchObject({ kind: "next-event", title: "Upcoming events" });
    expect(a).toMatchObject({ step: "did-you-mean", didYouMean: "Hypnotic Robotics upcoming events" });
  });
  it("is never said for words found only in a team's city or school", async () => {
    // One team in its own city, with its school: the words typed are those, spelled right.
    await run("UPDATE teams SET school = 'River Dell', city = 'Paramus' WHERE number = 4215");
    // A team that has played (a near name to one that never did is only a closest match).
    await run("INSERT INTO team_event_stats (season, code, team, matches) VALUES (?, 'USNJQ1', 4215, 5)", [S]);
    await rebuildSearch();
    try {
      const a = await ask("river dell robotics upcoming events");
      expect([a.card?.kind, a.didYouMean]).toEqual(["next-event", undefined]);
      // Its city alone is a place: the place's events, not this one team's.
      const city = await ask("upcoming events in paramus");
      expect([city.card?.kind, city.didYouMean]).toEqual([undefined, undefined]);
    } finally {
      await run("UPDATE teams SET school = NULL, city = 'Oradell' WHERE number = 4215");
      await run("DELETE FROM team_event_stats WHERE team = 4215");
      await rebuildSearch();
    }
  });
});

describe("a plain form of a known word", () => {
  it("is never split into two words", async () => {
    expect((await correctQuery("who partnered 4215 at the qualifier"))?.q ?? "").not.toMatch(/partner red/);
  });
});
