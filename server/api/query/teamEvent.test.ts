// One word of a named team's own event's name reads as that event, its latest (ParseContext.teamEvent); never with
// no team named, never another team's event, never a kind of event's word.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { searchAnswer } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "../answers/season";
import { parseContext } from "./context";
import { parseQuery } from "./parse";

const S = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 40 });
const parse = async (q: string, prefer: string[] = []) => parseQuery(q, await parseContext(Date.now(), new Set(prefer)));

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Two teams named Gearheads: only 31002 was at Riverside.
  for (const [n, name] of [[7149, "ENFORCERS"], [23268, "Ultraviolet"], [6980, "Bad Wolf"], [31001, "Gearheads"], [31002, "Gearheads"], [31003, "Rivertide"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    for (const s of [S - 1, S]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Trenton', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  // The same tournament two seasons running, under two codes; 6980 played neither.
  await ev(S - 1, "USNJRIV", "Riverside Invitational League Tournament", "LeagueTournament", `${S}-02-10`);
  await ev(S, "USNJRIV2", "Riverside Invitational League Tournament", "LeagueTournament", `${S + 1}-02-08`);
  await ev(S, "USNJQ5", "Delaware Valley Qualifier", "Qualifier", `${S + 1}-01-11`);
  // Another "riverside" event of 7149's in the same season, in January: a window said picks between the two.
  await ev(S, "USNJRWC", "Riverside Winter Classic", "Qualifier", `${S + 1}-01-18`);
  // One code, renamed the next season: "bayview" is only the older one's.
  await ev(S - 1, "USNJBAY", "Bayview Scrimmage Cup", "Scrimmage", `${S}-01-05`);
  await ev(S, "USNJBAY", "Harbor Scrimmage Cup", "Scrimmage", `${S + 1}-01-04`);
  let n = 0;
  const match = (season: number, code: string, red: number, blue: number, rs: number, bs: number) => {
    n++;
    return Promise.all([
      run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [season, code, n, `Q${n}`, `${season + 1}-02-08T${String(8 + n).padStart(2, "0")}:00:00Z`, rs, rs, bs, bs]),
      run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, 'red', 1), (?, ?, 'qual', 0, ?, ?, 'blue', 1)", [season, code, n, red, season, code, n, blue]),
    ]);
  };
  await match(S - 1, "USNJRIV", 7149, 23268, 90, 80);
  await match(S, "USNJRIV2", 7149, 23268, 120, 100);
  await match(S, "USNJQ5", 6980, 23268, 70, 60);
  await match(S - 1, "USNJBAY", 7149, 6980, 50, 40);
  await match(S, "USNJBAY", 7149, 6980, 60, 70);
  for (const [t, rating] of [[7149, 120], [23268, 110], [6980, 60]] as const) {
    for (const s of [S - 1, S]) await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, matches, wins, losses, ties) VALUES (?, ?, ?, 3, 1, 2, 1, 1, 0)", [s, t, rating]);
  }
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USNJRIV', 7149), (?, 'USNJRIV', 23268), (?, 'USNJRIV2', 7149), (?, 'USNJRIV2', 23268), (?, 'USNJQ5', 6980), (?, 'USNJQ5', 23268), (?, 'USNJBAY', 7149), (?, 'USNJBAY', 7149), (?, 'USNJRIV2', 31002), (?, 'USNJQ5', 31001), (?, 'USNJRWC', 7149)", [S - 1, S - 1, S, S, S, S, S - 1, S, S, S, S]);
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
});

describe("one word of a named team's own event", () => {
  it("is that team's latest event with the word in its name, said so", async () => {
    const a = await ask("what was the forecast for 7149 at riverside");
    expect(a.stat).toMatchObject({ intent: "pipeline-team-predict-event", team: { number: 7149 }, title: "Prediction vs result at Riverside Invitational League Tournament" });
    expect(a.understood!.season).toBe(S);
    expect(a.understood!.label).toContain(`the latest event with "riverside" in its name`);
    expect(a.understood!.label).not.toMatch(/isn't part of this answer/);
    // "Last" is that pick: no note that it went unread.
    expect((await ask("23268 last forecast for invitational")).understood!.label).not.toMatch(/isn't part of this answer/);
  });
  it("in the season said, when one is", async () => {
    const season = await ask(`7149 prediction at riverside in ${S - 1}-${String(S % 100).padStart(2, "0")}`);
    expect(season.stat).toMatchObject({ intent: "pipeline-team-predict-event", title: "Prediction vs result at Riverside Invitational League Tournament" });
    expect(season.understood!.season).toBe(S - 1);
    // A calendar year is the event held that year: the earlier season's, held in February of it.
    const year = await ask(`7149 prediction at riverside in ${S}`);
    expect(year.stat).toMatchObject({ intent: "pipeline-team-predict-event", title: "Prediction vs result at Riverside Invitational League Tournament" });
    expect(year.understood!.season).toBe(S - 1);
  });
  it("in the window said, when one is: an event held in it, not the season's latest", async () => {
    const p = await parse(`7149 prediction at riverside in january ${S + 1}`);
    expect(p.event).toMatchObject({ typed: "riverside", words: "riverside winter classic" });
    // No event of the team's with the word held in the window: the word isn't read as one.
    expect((await parse(`7149 prediction at riverside in march ${S + 1}`)).event).toBeNull();
  });
  it("is the event by its name, never another season's event under the same code", async () => {
    const a = await ask("7149 forecast at bayview");
    expect(a.stat).toMatchObject({ intent: "pipeline-team-predict-event", title: "Prediction vs result at Bayview Scrimmage Cup" });
    expect(a.understood!.season).toBe(S - 1);
  });
  it("comes before a team named nearly the same word", async () => {
    const p = await parse("7149 prediction at riverside");
    expect(p.teams.map((t) => t.number)).toEqual([7149]);
    expect(p.event).toMatchObject({ typed: "riverside" });
  });
  it("said before a team typed nearly right, is read once that team is found", async () => {
    expect((await parse("bayview forecast for enforcrs")).event).toMatchObject({ typed: "bayview" });
  });
  it("is read once a name several teams share is settled", async () => {
    expect((await parse("gearheads prediction at riverside", ["team:31002"])).event).toMatchObject({ typed: "riverside" });
    expect((await parse("gearheads prediction at riverside", ["team:31001"])).event).toBeNull();
  });
  it("never with no team named, never another team's event, never a kind of event's word", async () => {
    expect((await parse("riverside predictions")).event).toBeNull();
    expect((await parse("6980 prediction at riverside")).event).toBeNull();
    const kind = await parse("7149 record at qualifiers");
    expect(kind.event).toBeNull();
    expect(kind.eventKind).toBe("qualifiers");
  });
});
