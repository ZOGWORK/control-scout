// Compound questions (./clauses.ts): each part joined by "and" asked on its own, its card under the first part's. Never
// a question the whole already reads ("<team> and <team> opr", a range of seasons), nor a name that holds "and".
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { resetSearchSeason } from "../answers/season";
import { searchAnswer } from "../searchAnswer";
import { searchPage } from "../../lite/pages";
import { answerFacts } from "../searchBrunoAnswer";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const S = 2025;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[30801, "Gear Hounds"], [30802, "Nuts and Bolts"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'VA', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USVARIV', 'River Qualifier', 'Qualifier', 'Town', 'VA', 'USA', '2026-01-10', '2026-01-10', 't')", [S]);
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, 'USVARIV', 'Inspire', 1, 30801)", [S]);
  for (const [k, red, blue] of [[1, 140, 60], [2, 90, 110]] as const) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USVARIV', 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [S, k, `Q${k}`, `2026-01-10T1${k}:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [[30801, "red"], [30802, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USVARIV', 'qual', 0, ?, ?, ?, 1)", [S, k, t, a]);
  }
  await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties, opr_np) VALUES (?, 30801, 2, 1, 1, 0, 55), (?, 30802, 2, 1, 1, 0, 35)", [S, S]);
  await rebuildSearch();
  resetSearchSeason();
  clearAllCaches();
});

describe("compound questions", () => {
  it("two teams, two asks: each its own card, in the order asked", async () => {
    const a = await ask("30801 opr and 30802 record");
    expect([a.intent?.kind, a.stat?.intent, a.clauses?.map((c) => c.stat?.intent)]).toEqual(["stat-clauses", "opr", ["record"]]);
    expect(a.understood?.label).toMatch(/OPR.*; .*Record/);
    // Every word read, "and" too: each part answered as asked.
    expect(a.understood?.unread).toBeUndefined();
  });
  it("every surface that shows an answer shows every part: Control Scout Lite's page, Bruno's facts", async () => {
    const a = await ask("30801 opr and 30802 record");
    const lite = searchPage("30801 opr and 30802 record", S, a).body;
    // Each part's card, beyond the reading that names both: its title as a card heading.
    const heads = (t: string) => lite.split(t).length - 1;
    expect([heads(a.stat!.title) > 1, heads(a.clauses![0].stat!.title) > 1]).toEqual([true, true]);
    const facts = await answerFacts(a);
    expect(facts.some((f) => f.includes(a.clauses![0].stat!.title))).toBe(true);
  });
  it("\";\" is never a joiner (search reads the query with its punctuation gone)", async () => {
    expect((await ask("30801 opr; 30802 record")).intent?.kind).not.toBe("stat-clauses");
  });
  it("a part with no subject of its own asks of the first part's team", async () => {
    const a = await ask("30801 awards and highest score");
    expect([a.stat?.intent, a.clauses?.[0].stat?.intent, a.clauses?.[0].stat?.headline?.value]).toEqual(["awards", "highest-score", "140 points"]);
    // Every word read, "and" too: each part answered as asked.
    expect(a.understood?.unread).toBeUndefined();
  });
  it("two teams asked different things are two questions, never one compare of both", async () => {
    const a = await ask("30801 last match and 30802 next event");
    expect([a.intent?.kind, a.stat?.intent, a.clauses?.[0].card?.kind]).toEqual(["stat-clauses", "recent-match", "next-event"]);
  });
  it("a question read whole stays whole; a name with \"and\" is a name", async () => {
    expect((await ask("30801 and 30802 opr")).intent?.kind).toBe("stat-opr-vs");
    expect((await ask("30801 record between 2024 and 2025")).intent?.kind).not.toBe("stat-clauses");
    // A part that points back ("their"), or "also" inside a filter, is one question.
    expect((await ask("30801 first event and how was their record")).intent?.kind).not.toBe("stat-clauses");
    expect((await ask("top teams by opr who also won inspire")).intent?.kind).not.toBe("stat-clauses");
    const name = await ask("nuts and bolts");
    expect([name.intent?.kind, name.clauses]).toEqual([undefined, undefined]);
  });
});
