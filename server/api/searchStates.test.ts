// "<place> states" is that place's championship, for any place (owner, 2026-11-06: "nyc states winner" and "nyc
// championship winner" both name the NYC champions). Held out: every question about it reads the same both ways,
// for states, a city region and a country with no states.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";

const S = 2025;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
// Each place's championship, where it is, and its finals' alliances (red won).
const CHAMPS: [string, string, string, string, string, [number, number], [number, number]][] = [
  ["nj", "USNJCMP", "New Jersey Championship", "NJ", "USA", [23268, 7149], [4215, 6980]],
  ["nyc", "USNYNYCMP", "NYC Championship", "NY", "USA", [8721, 22437], [5100, 5200]],
  ["texas", "USTXCMP", "Texas State Championship", "TX", "USA", [7000, 7001], [7002, 7003]],
  ["michigan", "USMICMP", "Michigan State Championship", "MI", "USA", [8000, 8001], [8002, 8003]],
  ["romania", "ROCMP", "Romania National Championship", null as unknown as string, "Romania", [14270, 9000], [9001, 9002]],
];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [, code, name, state, country, red, blue] of CHAMPS) {
    const city = code === "USNYNYCMP" ? "New York" : "Town";
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Championship', ?, ?, ?, '2026-03-14', '2026-03-14', 't')", [S, code, name, city, state, country]);
    for (const n of [...red, ...blue]) {
      await run("INSERT OR IGNORE INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, `Team ${n}`, city, state, country]);
      await run("INSERT OR IGNORE INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
      await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, code, n]);
    }
    await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (?, ?, 1, ?, ?), (?, ?, 2, ?, ?)", [S, code, red[0], red[1], S, code, blue[0], blue[1]]);
    for (const n of [1, 2]) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'playoff', 6, ?, ?, 1, 287, 287, 275, 275, 't')", [S, code, n, `F${n}`]);
      for (const [t, al] of [...red.map((t) => [t, "red"]), ...blue.map((t) => [t, "blue"])]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'playoff', 6, ?, ?, ?)", [S, code, n, t, al]);
    }
  }
  await rebuildSearch();
});

const reading = (a: Awaited<ReturnType<typeof ask>>) => (a.step === "recovery" || a.sorry ? null : JSON.stringify([a.stat?.intent, a.stat?.headline?.value, a.card?.kind, a.hits.slice(0, 3).map((h) => h.ref)]));
const QUESTIONS = ["who won {p}", "{p} winner", "{p} winners", "{p} highlights", "{p} results", "{p} matches"];

describe("\"<place> states\" is \"<place> championship\"", () => {
  it("every question reads the same both ways, for every place", async () => {
    const failing: string[] = [];
    for (const [place] of CHAMPS) for (const q of QUESTIONS) {
      const [a, b] = await Promise.all([ask(q.replace("{p}", `${place} states`)), ask(q.replace("{p}", `${place} championship`))]);
      if (reading(a) == null || reading(a) !== reading(b)) failing.push(`${q.replace("{p}", `${place} states`)} → ${reading(a)} | ${reading(b)}`);
    }
    expect(failing).toEqual([]);
  });
  it("the winners are the place's own champions", async () => {
    for (const [place, , , , , red] of CHAMPS) {
      const a = await ask(`${place} states winner`);
      for (const n of red) expect(a.stat?.headline?.value, place).toContain(String(n));
    }
  });
});
