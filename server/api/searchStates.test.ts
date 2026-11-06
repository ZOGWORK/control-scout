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
  ["germany", "DECMP", "Germany Championship", null as unknown as string, "Germany", [10183, 9100], [9101, 9102]],
  ["canada", "CACMP", "FIRST Canada Championship", null as unknown as string, "Canada", [19555, 9200], [9201, 9202]],
];
// Teams with a place in their name, playing at that place's championship (owner, 2026-11-06: "romania states results"
// read the "2025 FTC Romania Team"), and one named just a country, which has no championship here.
const NAMED: Record<number, string> = { 14270: "2025 FTC Romania Team (identity management)", 10183: "F.R.O.G. Frog Robots Of Germany", 19555: "FIRST Canada 51 - Wikwemikong", 7000: "Texas Torque" };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [, code, name, state, country, red, blue] of CHAMPS) {
    const city = code === "USNYNYCMP" ? "New York" : "Town";
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Championship', ?, ?, ?, '2026-03-14', '2026-03-14', 't')", [S, code, name, city, state, country]);
    for (const n of [...red, ...blue]) {
      await run("INSERT OR IGNORE INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, NAMED[n] ?? `Team ${n}`, city, state, country]);
      await run("INSERT OR IGNORE INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
      await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, code, n]);
    }
    await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (?, ?, 1, ?, ?), (?, ?, 2, ?, ?)", [S, code, red[0], red[1], S, code, blue[0], blue[1]]);
    for (const n of [1, 2]) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'playoff', 6, ?, ?, 1, 287, 287, 275, 275, 't')", [S, code, n, `F${n}`]);
      for (const [t, al] of [...red.map((t) => [t, "red"]), ...blue.map((t) => [t, "blue"])]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'playoff', 6, ?, ?, ?)", [S, code, n, t, al]);
    }
  }
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (9300, 'Mexico', 'Monterrey', 'NL', 'Mexico')");
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
  // Owner, 2026-11-06: a place's name beside states or championship is the place, never a team with it in its name.
  it("a place's name is the place's championship, never a team with the place in its name", async () => {
    for (const q of ["romania states results", "romania states", "romania states matches", "canada states results", "germany states results", "texas states results"]) {
      const a = await ask(q);
      expect(a.understood?.label ?? "", q).not.toMatch(/\(\d+\)/);
      expect(a.hits.map((h) => h.kind), q).not.toContain("team");
    }
    // A team's number or its whole name still reads the team.
    expect((await ask("14270 states")).hits[0]?.ref).toBe("14270");
    expect((await ask("mexico states")).hits[0]?.ref).toBe("9300");
  });
  it("the winners are the place's own champions", async () => {
    for (const [place, , , , , red] of CHAMPS) {
      const a = await ask(`${place} states winner`);
      expect(a.stat?.headline?.teams?.map((t) => Number(t.label.split(" ")[0])), place).toEqual(red);
    }
  });
});
