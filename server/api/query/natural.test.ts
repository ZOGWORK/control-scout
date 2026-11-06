// Natural questions, said every way (docs/search-pipeline.md, "Natural questions"): one intent asked five or more ways
// gives the same card with the same numbers, and every question that answered before answers the same. A small
// database, fixture names only.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { searchOutcome } from "../searchLayers";

import { rewriteQuery } from "../searchCoverage";
import type { SearchAnswer } from "../../../src/shared/api";
import type { StatAnswer } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });
/** What a card says, in one line: its kind, title, headline and rows (or its none). */
const card = (a: SearchAnswer) => {
  const s = a.stat;
  if (!s) return { kind: a.card?.kind ?? null, title: a.card?.title ?? a.understood?.label ?? null, lines: a.card?.lines.map((l) => l.text) ?? [], hits: a.hits.map((h) => `${h.kind}:${h.ref}`) };
  const rows = s.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => String(r.cells[b.columns[0].key])) : []));
  return { kind: s.intent, title: s.title, headline: s.headline?.value ?? null, rows, none: s.none ?? null };
};

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string, string][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", "USA"], [6980, "Bad Wolf", "Fair Lawn", "NJ", "USA"], [7149, "Enforcers", "Oradell", "NJ", "USA"],
    [20245, "Ultraviolet", "Detroit", "MI", "USA"], [23268, "Ultraviolet", "Hackettstown", "NJ", "USA"], [22457, "Ultraviolet Bots", "Leeds", "", "United Kingdom"],
    [9848, "GearView", "Dallas", "TX", "USA"], [24033, "Alphatronic", "Cluj-Napoca", "CJ", "Romania"],
    // Names ending in a question's filler or holding a place's preposition; a name with punctuation; a placeholder.
    [30001, "Robots R Us", "Town", "OH", "USA"], [30002, "Lost In Space", "Town", "OH", "USA"], [30003, "O'Brien Robotics", "Town", "OH", "USA"],
    [30004, "Ultraviolet Bots", "Town", "OH", "USA"], [30005, "Ultraviolet Bots", "Town", "OH", "USA"], [30006, "Ultraviolet Bots", "Town", "OH", "USA"],
    [30007, "Ultraviolet Bots", "Town", "OH", "USA"], [30008, "Ultraviolet Beams", "Town", "OH", "USA"],
    [99950, "Off-Season Demo Team", "Town", "OH", "USA"], [99951, "Off-Season Demo Team", "Town", "OH", "USA"],
  ];
  for (const [n, name, city, state, country] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state || null, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USNJQ1', 'Garden Qualifier', 'Qualifier', 'Town', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't'), (2024, 'USMIQ1', 'Lakes Qualifier', 'Qualifier', 'Town', 'MI', 'USA', '2025-01-10', '2025-01-10', 't')");
  let n = 0;
  const match = async (season: number, code: string, red: number, blue: number, reds: number[], blues: number[]) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [season, code, n, `Q${n}`, `${season + 1}-01-10T10:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, n, t, a]);
    }
    for (const t of [...reds, ...blues]) await run("INSERT OR IGNORE INTO event_teams (season, code, team, rank) VALUES (?, ?, ?, 1)", [season, code, t]);
  };
  await match(2025, "USNJQ1", 150, 90, [4215, 23268], [6980]);
  await match(2025, "USNJQ1", 80, 120, [4215], [6980, 7149]);
  await match(2025, "USNJQ1", 170, 60, [4215], [9848]);
  // 7149 at its state championship and at Worlds, and beaten by 23268 only at an off-season event (never on the record).
  await run("INSERT INTO events (season, code, name, type, region, city, state, country, start, end, source) VALUES (2025, 'USNJCMP', 'New Jersey Championship', 'Championship', 'USNJ', 'Town', 'NJ', 'USA', '2026-03-01', '2026-03-01', 't'), (2025, 'FTCCMP1', 'FIRST Championship', 'FIRSTChampionship', 'CMP', 'Houston', 'TX', 'USA', '2026-04-20', '2026-04-20', 't'), (2025, 'USNJOFF', 'Summer Scrimmage', 'OffSeason', 'USNJ', 'Town', 'NJ', 'USA', '2026-06-01', '2026-06-01', 't')");
  await match(2025, "USNJCMP", 200, 100, [7149], [23268]);
  await match(2025, "FTCCMP1", 210, 190, [7149], [9848]);
  await match(2025, "USNJOFF", 50, 300, [7149], [23268]);
  // A league tournament 30008 played in the playoffs only (no qualification match on its record).
  await run("INSERT INTO events (season, code, name, type, region, city, state, country, start, end, source) VALUES (2025, 'USNJLT', 'Meadow League Tournament', 'LeagueTournament', 'USNJ', 'Town', 'NJ', 'USA', '2026-02-01', '2026-02-01', 't')");
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJLT', 'playoff', 1, 1, 'M1', '2026-02-01T10:00:00Z', 1, 120, 120, 110, 110, 't')");
  for (const [t, a] of [[30008, "red"], [30007, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJLT', 'playoff', 1, 1, ?, ?, 1)", [t, a]);
  // Two Worlds divisions: 30001 played in Edison only.
  await run("INSERT INTO events (season, code, name, type, division_code, region, city, state, country, start, end, source) VALUES (2025, 'FTCCMP1EDIS', 'Edison Division', 'FIRSTChampionship', 'FTCCMP1', 'CMP', 'Houston', 'TX', 'USA', '2026-04-20', '2026-04-20', 't'), (2025, 'FTCCMP1FRAN', 'Franklin Division', 'FIRSTChampionship', 'FTCCMP1', 'CMP', 'Houston', 'TX', 'USA', '2026-04-20', '2026-04-20', 't')");
  await match(2025, "FTCCMP1EDIS", 150, 140, [30001], [30002]);
  // 30004's only win over 30005, as a surrogate: never on its record.
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJQ1', 'qual', 0, 900, 'Q900', '2026-01-10T12:00:00Z', 1, 100, 100, 50, 50, 't')");
  for (const [t, a, sur] of [[30004, "red", 1], [30005, "blue", 0]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field, surrogate) VALUES (2025, 'USNJQ1', 'qual', 0, 900, ?, ?, 1, ?)", [t, a, sur]);
  await run("UPDATE teams SET home_region = 'USNJ' WHERE state = 'NJ'");
  await run("INSERT INTO awards (season, code, team, type, name, placement) VALUES (2025, 'USNJCMP', 7149, 'Inspire', 'Inspire Award', 1), (2025, 'USNJCMP', 7149, 'Winner', 'Winning Alliance', 1), (2025, 'FTCCMP1', 9848, 'Inspire', 'Inspire Award 2nd Place', 2), (2025, 'USNJQ1', 6980, 'Winner', 'Leadership Award', 1), (2025, 'USNJQ1', 30003, 'Inspire', 'Inspire Award', 1)");
  // An older season's match, 4215's highest score of all (a loss, so this season's numbers stay as they are).
  await match(2024, "USMIQ1", 190, 200, [4215], [20245]);
  await run("INSERT OR IGNORE INTO team_seasons (season, team) VALUES (2024, 4215), (2024, 20245)");
  // 20245 played only in 2024–25: a season named leaves it out.
  await match(2024, "USMIQ1", 100, 50, [20245], [24033]);
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) SELECT season, code, team, 50, 1 FROM event_teams");
  await run("UPDATE teams SET rookie_year = 2019, school = 'Oradell Public School' WHERE number = 4215");
  await rebuildSearch();
  clearAllCaches();
});

describe("count teams by name (3a)", () => {
  const SAID = ["how many teams named ultraviolet", "how many teams are called ultraviolet", "number of teams named ultraviolet", "teams named ultraviolet",
    "how many teams have the name ultraviolet", "how many teams named Ultraviolet are there?", "can you tell me how many teams are called ultraviolet please"];
  it("one card for every way it's asked: the count, then every team with the name, by number", async () => {
    const first = card(await ask(SAID[0]));
    expect(first).toEqual({ kind: "teams-named", title: "Teams named Ultraviolet", headline: "2 teams", rows: ["20245 Ultraviolet", "23268 Ultraviolet"], none: null });
    for (const q of SAID.slice(1)) expect(card(await ask(q)), q).toEqual(first);
  });
  it("the count is the list, with where each team is from to tell a shared name apart", async () => {
    const s = (await ask("how many teams named ultraviolet")).stat as StatAnswer;
    const t = s.blocks[0];
    expect(t.kind === "table" && t.rows.map((r) => [r.cells.from, r.href])).toEqual([["Detroit, MI", "/teams/20245"], ["Hackettstown, NJ", "/teams/23268"]]);
    expect(t.kind === "table" && t.rows.length).toBe(2);
  });
  it("a name another team already has is read as words, never as that team", async () => {
    for (const [q, row] of [["how many teams named gearview", "9848 GearView"], ["how many teams are called hypnotic robotics", "4215 Hypnotic Robotics"], ["number of teams named bad wolf", "6980 Bad Wolf"]]) {
      const c = card(await ask(q));
      expect(c, q).toMatchObject({ kind: "teams-named", headline: "1 team", rows: [row] });
    }
  });
  it("a place narrows to the teams from it, a season to the teams that played it; the card says which", async () => {
    expect(card(await ask("how many teams named ultraviolet from NJ"))).toMatchObject({ headline: "1 team", rows: ["23268 Ultraviolet"] });
    const s = (await ask("teams called ultraviolet in 2025-26")).stat as StatAnswer;
    expect(s).toMatchObject({ headline: { value: "1 team", label: "named Ultraviolet that played in 2025–26" }, scope: ["2025–26"] });
  });
  it("a whole stored name is read whole, whatever words it holds", async () => {
    expect(card(await ask("how many teams named robots r us"))).toMatchObject({ headline: "1 team", rows: ["30001 Robots R Us"] });
    expect(card(await ask("teams called lost in space"))).toMatchObject({ headline: "1 team", rows: ["30002 Lost In Space"] });
    expect(card(await ask("how many teams named o'brien robotics are there"))).toMatchObject({ headline: "1 team", rows: ["30003 O'Brien Robotics"] });
  });
  it("never counts a placeholder registration", async () => {
    expect(card(await ask("how many teams named off-season demo team"))).toMatchObject({ headline: "0 teams", rows: [] });
  });
  it("none: said plainly, with names to try and every team a tap away, never the no-match page", async () => {
    const a = await ask("how many teams named zzzqqq");
    expect(a.step).toBe("deterministic");
    expect(card(a)).toMatchObject({ kind: "teams-named", headline: "0 teams", rows: [], none: "No team is named zzzqqq." });
    expect(a.pages[0]).toEqual({ title: "Browse all teams", href: "/teams" });
    // The names the words are part of, and the name anywhere when a place narrowed it to none.
    const part = (await ask("how many teams named ultraviolet b")).stat as StatAnswer;
    expect(part.blocks).toContainEqual({ kind: "related", title: "Did you mean", queries: ["Ultraviolet Bots", "Ultraviolet Beams"] });
    // Spelled as the name search folds it: no apostrophe.
    expect(((await ask("how many teams named obrien r")).stat as StatAnswer).blocks).toContainEqual({ kind: "related", title: "Did you mean", queries: ["O'Brien Robotics"] });
    const there = (await ask("how many teams named bad wolf in Romania")).stat as StatAnswer;
    expect(there.none).toBe("No team is named bad wolf in Romania.");
    expect(there.blocks).toContainEqual({ kind: "related", title: "Did you mean", queries: ["teams named bad wolf"] });
  });
  it("never every team with the name for an event filter it doesn't take", async () => {
    for (const q of ["how many teams named ultraviolet at qualifiers", "teams named ultraviolet at league meets"]) {
      expect((await ask(q)).stat?.intent, q).not.toBe("teams-named");
    }
  });
});

describe("count teams by place (3a)", () => {
  it("a town's count is its list of teams", async () => {
    for (const q of ["how many teams from Oradell", "how many teams in Oradell", "number of teams from oradell"]) {
      expect(card(await ask(q)), q).toMatchObject({ kind: "city-teams", headline: "2 teams", rows: expect.arrayContaining(["4215 Hypnotic Robotics", "7149 Enforcers"]) });
    }
  });
  it("never a town's whole list for a filter it doesn't take", async () => {
    for (const q of ["how many teams from Oradell at worlds", "how many teams from Oradell at states", "how many teams from Oradell in 2025-26"]) {
      expect((await ask(q)).stat?.intent, q).not.toBe("city-teams");
    }
  });
});

describe("when: the last, the first and the next time (3b)", () => {
  it("the last time a team played: its most recent match, however it's asked", async () => {
    const SAID = ["4215 last match", "when was the last time 4215 played", "when did 4215 last play", "what was 4215's most recent match",
      "when was the last time hypnotic robotics played a match", "4215 last played when", "the last time 4215 played?"];
    const first = card(await ask(SAID[0]));
    expect(first).toMatchObject({ kind: "recent-match", title: "Most recent match" });
    for (const q of SAID.slice(1)) expect(card(await ask(q)), q).toEqual(first);
  });
  it("the first time: its first match", async () => {
    const SAID = ["when was 4215's first match", "when did 4215 first play", "4215 first ever match", "the first time 4215 played a match", "when did hypnotic robotics first play"];
    const first = card(await ask(SAID[0]));
    expect(first).toMatchObject({ kind: "first-match", title: "First match" });
    for (const q of SAID.slice(1)) expect(card(await ask(q)), q).toEqual(first);
  });
  it("when a team started: its rookie year", async () => {
    for (const q of ["4215 rookie year", "what year did 4215 start", "when did 4215 begin competing", "when did 4215 join ftc", "when was 4215 founded", "which year did hypnotic robotics start", "which season was 4215 founded", "what season did 4215 start"]) {
      const a = await ask(q);
      expect(a.card, q).toMatchObject({ title: "Rookie year", team: { number: 4215 } });
    }
  });
  it("the next time: its next match, and none said plainly, never its last one", async () => {
    for (const q of ["when is 4215's next match", "when does 4215 play next", "the next time 4215 plays", "when will 4215 play again", "when is the next time hypnotic robotics plays"]) {
      const a = await ask(q);
      expect(a.card, q).toMatchObject({ kind: "next-match", team: { number: 4215 } });
      expect(a.card?.lines, q).toEqual([]);
      expect(a.card?.none, q).toMatch(/^No upcoming match/);
    }
  });
});

describe("yes or no, with the evidence (3c)", () => {
  /** The yes or no, and the card under it: its kind and its rows (a stat's table or matches, a card's lines). */
  const yn = async (q: string) => {
    const a = await ask(q);
    const rows = a.stat ? a.stat.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => String(Object.values(r.cells)[0])) : b.kind === "matches" ? b.rows.map((r) => r.label) : [])) : a.card?.lines.map((l) => l.text);
    return { kind: a.stat?.intent ?? a.card?.kind, answer: a.verdict?.answer, label: a.verdict?.label, rows };
  };
  it("been to Worlds: yes, above the card that answered it before, however it's asked", async () => {
    const SAID = ["has 7149 ever been to worlds", "did 7149 ever go to worlds", "has enforcers ever been to worlds?", "did 7149 make it to worlds"];
    const first = await yn(SAID[0]);
    expect(first).toMatchObject({ kind: "worlds", answer: "Yes", label: "Enforcers (7149) played at Worlds" });
    for (const q of SAID.slice(1)) expect(await yn(q), q).toEqual(first);
    // The card is the one the question gave before, unchanged; only the yes or no is added.
    const { verdict, ...rest } = await ask(SAID[0]);
    expect(verdict).toBeTruthy();
    expect(rest.card?.kind).toBe("worlds");
    // Failed-search reporting still reads the answer's outcome.
    expect(searchOutcome(await ask(SAID[0]))?.result).toBe("answered");
  });
  it("no is an answer, never the no-match page", async () => {
    const a = await ask("has 6980 ever been to worlds");
    expect(a.step).toBe("deterministic");
    expect(a.verdict).toEqual({ answer: "No", label: "Bad Wolf (6980) has never played at Worlds" });
  });
  it("an event in a season, and a team's own state championship: its own card of where, or of what it played instead", async () => {
    for (const q of ["did 7149 play at NJ championship in 2025-26", "was 7149 at NJ championship in 2025-26", "did 7149 compete at new jersey championship in 2025-26", "did 7149 go to NJ championship in 2025-26"]) {
      expect(await yn(q), q).toMatchObject({ answer: "Yes", label: "Enforcers (7149) played at New Jersey Championship in 2025–26" });
    }
    expect(await yn("was 7149 at NJ championship in 2025-26")).toMatchObject({ kind: "yes-no-attended", rows: ["New Jersey Championship"] });
    expect(await yn("was 4215 at NJ championship in 2025-26")).toMatchObject({ kind: "yes-no-attended", answer: "No", rows: ["Garden Qualifier"] });
    expect((await yn("did 7149 make it to states")).answer).toBe("Yes");
  });
  it("an award won: 1st place only, and an event won never a Leadership Award", async () => {
    expect(await yn("has 7149 ever won inspire")).toMatchObject({ answer: "Yes", label: "Enforcers (7149) won the Inspire Award: 1 time" });
    expect(await yn("has gearview ever won inspire")).toMatchObject({ answer: "No" });
    expect(await yn("has 7149 ever won a championship")).toMatchObject({ answer: "Yes", kind: "yes-no-award", rows: ["Winning Alliance", "Inspire Award"] });
    expect(await yn("has 6980 ever won an event")).toMatchObject({ answer: "No" });
  });
  it("lost to or beaten another team: official meetings only, either way it's asked", async () => {
    for (const q of ["has 7149 ever lost to 23268", "did 7149 ever lose to 23268", "has 7149 ever been beaten by 23268"]) {
      expect(await yn(q), q).toMatchObject({ answer: "No", label: "Enforcers (7149) has never lost to Ultraviolet (23268) · 1 meeting: 7149 1-0-0" });
    }
    expect(await yn("did 7149 ever beat 23268")).toMatchObject({ answer: "Yes" });
  });
  it("a season said alone narrows the answer", async () => {
    expect(await yn("has 7149 won inspire in 2025-26")).toMatchObject({ answer: "Yes" });
    expect(await yn("has 7149 won inspire in 2024-25")).toMatchObject({ answer: "No", label: "Enforcers (7149) has never won the Inspire Award in 2024–25" });
    expect(await yn("did 7149 ever beat 23268 in 2024-25")).toMatchObject({ answer: "No" });
    expect(await yn("did 7149 ever beat 23268 in 2025-26")).toMatchObject({ answer: "Yes" });
  });
  it("played: any match on the field, a playoff only too; and a kind of event", async () => {
    expect(await yn("did 30008 play at meadow league tournament in 2025-26")).toMatchObject({ answer: "Yes", rows: ["Meadow League Tournament"] });
    expect(await yn("did 4215 ever play at a qualifier")).toMatchObject({ kind: "yes-no-attended", answer: "Yes" });
    expect(await yn("has 23268 ever been to a league tournament")).toMatchObject({ kind: "yes-no-attended", answer: "No" });
  });
  it("a division named is that division alone; its championship takes every division", async () => {
    expect(await yn("did 30001 play at edison division in 2025-26")).toMatchObject({ answer: "Yes" });
    expect(await yn("did 30001 play at franklin division in 2025-26")).toMatchObject({ answer: "No" });
  });
  it("the Winning Alliance award asked by name is that award; an event won also counts a 1st-place Inspire", async () => {
    expect(await yn("has 30003 ever won the winning alliance award")).toMatchObject({ answer: "No" });
    expect(await yn("has 30003 ever won an event")).toMatchObject({ answer: "Yes" });
    expect(await yn("has 7149 ever won the winning alliance award")).toMatchObject({ answer: "Yes" });
  });
  it("a win as a surrogate is never a win on the record", async () => {
    expect(await yn("did 30004 ever beat 30005")).toMatchObject({ answer: "No" });
  });
  it("only a yes-or-no question: a count or a list stays what it was", async () => {
    expect((await ask("how many times has 7149 been to worlds")).stat?.intent ?? "").not.toMatch(/^yes-no/);
    expect((await ask("7149 awards")).stat?.intent ?? "").not.toMatch(/^yes-no/);
  });
});

describe("who, what, where and the best, said more ways (3d, 3e)", () => {
  it("who beat a team: the teams it lost to, however it's asked", async () => {
    const SAID = ["who did 6980 lose to", "who beat 6980", "who has beaten 6980", "who beat bad wolf", "who defeated 6980?"];
    const first = card(await ask(SAID[0]));
    expect(first).toMatchObject({ kind: "lost-to-most" });
    for (const q of SAID.slice(1)) expect(card(await ask(q)), q).toEqual(first);
  });
  it("a team's fact asked with the fact first", async () => {
    for (const [q, title] of [["what school is 4215 from", "School"], ["which school does 4215 go to", "School"], ["what region is 4215 in", "Region"], ["which region is hypnotic robotics in", "Region"], ["4215 region", "Region"]]) {
      expect((await ask(q)).card, q).toMatchObject({ title, team: { number: 4215 } });
    }
  });
  it("the best match, ever or not: the highest score", async () => {
    const SAID = ["what was 4215's best score", "4215 highest scoring match", "4215 best match", "4215 best match ever", "4215 best game of all time"];
    const first = card(await ask(SAID[0]));
    expect(first).toMatchObject({ kind: "highest-score", headline: "170 points" });
    for (const q of SAID.slice(1)) expect(card(await ask(q)).headline, q).toBe("170 points");
  });
  it("ever: every season's own best (or worst) below the latest season's, an older higher score included", async () => {
    /** Each season's row of the "each season" table: season, score, event. */
    const seasons = async (q: string) => (await ask(q)).stat!.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => [r.cells.season, r.cells.score, r.cells.event]) : []));
    for (const q of ["4215 best match ever", "4215 best game of all time"]) {
      expect(await seasons(q), q).toEqual(await seasons("4215 highest score ever"));
      expect(await seasons(q), q).toContainEqual(["2024–25", 190, "Lakes Qualifier"]);
    }
    for (const q of ["4215 worst match ever", "4215 worst game of all time"]) {
      expect(card(await ask(q)), q).toMatchObject({ kind: "lowest-score", headline: "80 points" });
      expect(await seasons(q), q).toEqual(await seasons("4215 lowest score ever"));
    }
  });
  it("a team's division at Worlds asked as a question is its Worlds divisions", () => {
    expect(rewriteQuery("what division was 4215 in at worlds")).toMatchObject({ q: "4215 worlds division" });
    expect(rewriteQuery("which division did 4215 play in at worlds 2023-24")).toMatchObject({ q: "4215 worlds division 2023-24" });
  });
});

describe("what answered before answers the same (§5)", () => {
  it("a team's counts, stats and lists", async () => {
    expect(card(await ask("how many matches has 4215 won"))).toMatchObject({ kind: "wins-count", headline: "2 wins" });
    expect(card(await ask("4215 wins count"))).toMatchObject({ kind: "wins-count", headline: "2 wins" });
    expect(card(await ask("4215 record"))).toMatchObject({ kind: "record", headline: "2-1-0" });
    expect(card(await ask("4215 OPR"))).toMatchObject({ kind: "opr" });
    expect(card(await ask("4215 last 10 matches"))).toMatchObject({ kind: "last-matches" });
  });
  it("a region's count and a plain name stay search's own", async () => {
    expect(card(await ask("how many teams are from NJ"))).toMatchObject({ kind: "info", title: "How many teams in New Jersey · 2026–27" });
    // A name alone is still a team lookup: every team with it, never a count.
    const a = await ask("ultraviolet");
    expect(a.stat).toBeUndefined();
    expect(a.hits.filter((h) => h.kind === "team").map((h) => h.ref)).toEqual(expect.arrayContaining(["20245", "23268"]));
    expect((await ask("bad wolf")).hits[0]).toMatchObject({ kind: "team", ref: "6980" });
  });
});
