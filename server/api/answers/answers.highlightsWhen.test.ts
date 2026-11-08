// A team's highlights in a time said: a month (its short form alone as the last word too), or this week, and when
// nothing was played then, its season, said on the card (failed-search #1162; held out: other teams, months, words).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { parseQuery } from "../query/parse";
import { parseContext } from "../query/context";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[6980, "Bad Wolf"], [207, "Critical Mass"], [9999, "Top Hat Robotics"], [23268, "Rookie Robots"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Fair Lawn', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (code: string, name: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, 'Qualifier', 'Town', 'NJ', 'USA', ?, ?, 't')", [code, name, start, start]);
  await ev("USNJQ7", "February Qualifier", "2026-02-07");
  await ev("USNJQ8", "March Qualifier", "2026-03-14");
  // The 2025–26 FIRST Championship has finished, so 2025–26 is the season a query with none named reads.
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'FTCCMP1', 'FIRST Championship', 'FIRSTChampionship', 'Houston', 'TX', 'USA', '2026-04-29', '2026-05-02', 't')");
  const match = (code: string, n: number, time: string, red: number, blue: number) => Promise.all([
    run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source)
         VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')`, [code, n, `Q${n}`, time, red, red, blue, blue]),
    ...[6980, 207].map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, ?, 'qual', 0, ?, ?, 'red')", [code, n, t])),
    ...[9999, 23268].map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, ?, 'qual', 0, ?, ?, 'blue')", [code, n, t])),
  ]);
  await match("USNJQ7", 1, "2026-02-07T10:00:00Z", 140, 90);
  await match("USNJQ7", 2, "2026-02-07T11:00:00Z", 120, 100);
  await match("USNJQ8", 1, "2026-03-14T10:00:00Z", 210, 150);
  await rebuildSearch();
});

const ask = (q: string) => searchAnswer(q, { learn: false, limit: 12, full: true });

describe("a team's highlights in a time said", () => {
  it("a month with its year: that month's matches only, said in the title", async () => {
    const a = await ask("bad wolf highlights in february 2026");
    expect(a.stat).toMatchObject({ intent: "team-highlights", title: "Highlights in February 2026, 2025–26", headline: { value: "140 points" } });
  });
  it("a month with nothing played, its year typed: said plainly, never another month's", async () => {
    const a = await ask("6980 highlights in january 2026");
    expect(a.stat?.title).toBe("No highlights in January 2026, 2025–26");
    expect(a.stat?.none).toMatch(/no played matches in January 2026/);
  });
  it("a month said against today with nothing played: its season's highlights, the step said on the card", async () => {
    const a = await ask("bad wolf highlights in october");
    expect(a.stat).toMatchObject({ title: "Highlights, 2025–26", headline: { value: "210 points" } });
    expect(a.stat?.scope[0]).toMatch(/^Relaxed: in October \d{4} → /);
  });
  it("a month's short form alone is a month as the last word only; mar and may never alone", async () => {
    const ctx = await parseContext();
    expect((await parseQuery("bad wolf highlights feb", ctx)).time).toMatchObject({ kind: "window", label: expect.stringMatching(/^in February/) });
    expect((await parseQuery("6980 record nov", ctx)).time).toMatchObject({ kind: "window" });
    expect((await parseQuery("bad wolf highlights mar", ctx)).time).toBeNull();
    expect((await parseQuery("6980 dec highlights", ctx)).time).toBeNull();
  });
});
