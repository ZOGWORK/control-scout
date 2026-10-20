// GET /api/directory/:season?q= (search inside All listed): numbers exact and by prefix, words of the
// name, city and state (case- and accent-blind, word prefixes), always inside the season and country,
// teams without results included; the full totals stay beside the matched count; paging and sorting
// still apply; bad input is refused; nothing typed reaches SQL or full-text syntax; the index follows
// the teams table; and the query uses indexes rather than scanning every team.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { CURRENT_SEASON } from "../data/seasons";
import { clearAllCaches } from "../caches";
import type { DirectoryPage } from "../../src/shared/directory";

const S = CURRENT_SEASON, P = CURRENT_SEASON - 1;
let server: Server;
let base = "";
const dir = async (q: string, season = S) => {
  const r = await fetch(`${base}/api/directory/${season}?${q}`);
  return { status: r.status, body: (await r.json()) as DirectoryPage & { error?: string } };
};
const teams = async (q: string, season = S) => (await dir(q, season)).body.rows.map((r) => r.team);
const enc = encodeURIComponent;

// [number, name, city, state, country]
const TEAMS: [number, string | null, string | null, string | null, string | null][] = [
  [123, "Robo Raiders", "Boston", "MA", "USA"],
  [1234, "Gear Heads", "Austin", "TX", "USA"],
  [12345, "Robotic Eagles", "Dallas", "TX", "USA"],
  [4123, "Lone Star Robotics", "Houston", "TX", "USA"],
  [5000, "Équipe Électrique", "Montréal", "QC", "Canada"],
  [5001, "Robo Moose", "Toronto", "ON", "Canada"],
  [7000, "São Paulo Bots", "São Paulo", "SP", "Brazil"],
  [254, "Team 254 Fans", "San Jose", "CA", "USA"],
];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name, city, state, country] of TEAMS) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  await run("INSERT INTO team_seasons (season, team) VALUES (?, 1239)", [S]); // registered, no directory entry
  await run("INSERT INTO team_seasons (season, team) VALUES (?, 123)", [P]); // last season: only 123
  await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 123, 'Robo Raiders')", [S]); // only 123 has results
  await run("INSERT INTO seasons (season, name, last_sync) VALUES (?, 'Test', '2026-10-17T12:00:00.000Z')", [S]);
  await kvSet(`records:at:${S}`, { at: "2026-10-17T12:05:00.000Z" });
  clearAllCaches();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe("GET /api/directory/:season?q=", () => {
  it("finds a team number exactly and by prefix, a registered number with no entry included", async () => {
    expect(await teams("q=12345")).toEqual([12345]);
    expect(await teams("q=123")).toEqual([123, 1234, 1239, 12345]);
    expect(await teams("q=4123")).toEqual([4123]); // a prefix, not a substring: 123 isn't inside-matched
  });

  it("finds words of the name, city and state by prefix, every word required", async () => {
    expect(await teams("q=robo")).toEqual([123, 4123, 5001, 12345]); // Robo, Robotics, Robotic
    expect(await teams("q=raid")).toEqual([123]);
    expect(await teams("q=austin")).toEqual([1234]);
    expect(await teams("q=tx")).toEqual([1234, 4123, 12345]);
    expect(await teams(`q=${enc("robo tx")}`)).toEqual([4123, 12345]);
    expect(await teams(`q=${enc("robo nowhere")}`)).toEqual([]);
    // A number typed among words still matches a name word: "254" is in Team 254 Fans's name and number.
    expect(await teams(`q=${enc("254 fans")}`)).toEqual([254]);
  });

  it("ignores case and accents, both ways", async () => {
    expect(await teams("q=EQUIPE")).toEqual([5000]);
    expect(await teams(`q=${enc("électrique")}`)).toEqual([5000]);
    expect(await teams("q=montreal")).toEqual([5000]);
    expect(await teams(`q=${enc("sao paulo")}`)).toEqual([7000]);
    expect(await teams(`q=${enc("SÃO")}`)).toEqual([7000]);
  });

  it("stays inside the season and country, and keeps teams without results", async () => {
    expect(await teams("country=US&q=robo")).toEqual([123, 4123, 12345]);
    expect(await teams("country=CA&q=robo")).toEqual([5001]);
    expect(await teams("country=CA&q=123")).toEqual([]);
    expect(await teams("q=123", P)).toEqual([123]);
    const us = await dir("country=US&q=tx");
    expect(us.body.rows.every((r) => !r.hasResults)).toBe(true);
  });

  it("returns the matched count beside the full totals", async () => {
    const { status, body } = await dir("country=US&q=robo");
    expect(status).toBe(200);
    expect(body).toMatchObject({ q: "robo", matched: 3, total: 5, withResults: 1, country: "US" });
    const none = await dir("country=US&q=zzz");
    expect(none.body).toMatchObject({ q: "zzz", matched: 0, total: 5, rows: [] });
    const plain = await dir("country=US");
    expect(plain.body).toMatchObject({ q: null, matched: 5, total: 5 });
    expect((await dir(`country=US&q=${enc("  ")}`)).body).toMatchObject({ q: null, matched: 5 });
    expect((await dir(`q=${enc("  robo  ")}`)).body.q).toBe("robo");
  });

  it("keeps sorting and paging over the matches", async () => {
    expect(await teams("q=robo&sort=name")).toEqual([4123, 5001, 123, 12345]);
    expect(await teams("q=robo&dir=desc")).toEqual([12345, 5001, 4123, 123]);
    expect(await teams("q=robo&sort=results")).toEqual([123, 4123, 5001, 12345]);
    const seen: number[] = [];
    for (let page = 1; page <= 2; page++) {
      const r = await dir(`q=robo&pageSize=3&page=${page}`);
      expect(r.body.matched).toBe(4);
      seen.push(...r.body.rows.map((x) => x.team));
    }
    expect(seen).toEqual([123, 4123, 5001, 12345]);
  });

  it("refuses searches it won't run", async () => {
    expect((await dir(`q=${"a".repeat(65)}`)).status).toBe(400);
    expect((await dir(`q=${"a".repeat(64)}`)).status).toBe(200);
    expect((await dir(`q=${enc("a b c d e f g")}`)).status).toBe(400);
    expect((await dir(`q=${enc("robo\u0000")}`)).status).toBe(400);
    expect((await dir("q=a&q=b")).status).toBe(400);
  });

  it("treats every character as text: no SQL, no full-text syntax", async () => {
    for (const q of [`' OR 1=1 --`, `"robo"`, "robo*", "NEAR(robo raid)", "robo OR austin", "name:robo", "^robo", "robo%", "1_3", "-robo", "); DROP TABLE teams; --"]) {
      const r = await dir(`q=${enc(q)}`);
      expect(r.status, q).toBe(200);
      expect(r.body.matched, q).toBeLessThanOrEqual(r.body.total);
    }
    expect(await teams(`q=${enc("' OR 1=1 --")}`)).toEqual([]); // "or" and "1" as words: no team has both
    expect(await teams(`q=${enc('"robo"')}`)).toEqual([123, 4123, 5001, 12345]);
    expect(await teams(`q=${enc("1_3")}`)).toEqual([]); // "_" is a separator, not a LIKE wildcard
    expect(await teams(`q=${enc("!!")}`)).toEqual([]); // nothing searchable matches nothing, not everything
    expect((await all<{ n: number }>("SELECT COUNT(*) n FROM teams"))[0].n).toBe(TEAMS.length);
  });

  it("follows the teams table: renames, upserts and removals", async () => {
    await run("UPDATE teams SET name = 'Kraken Crew' WHERE number = 1234");
    clearAllCaches();
    expect(await teams("q=kraken")).toEqual([1234]);
    expect(await teams("q=gear")).toEqual([]);
    await run("INSERT OR REPLACE INTO teams (number, name, city) VALUES (1234, 'Gear Heads', 'Austin')");
    clearAllCaches();
    expect(await teams("q=gear")).toEqual([1234]);
    expect(await teams("q=kraken")).toEqual([]);
    expect((await all<{ n: number }>("SELECT COUNT(*) n FROM team_search WHERE rowid = 1234"))[0].n).toBe(1);
    await run("DELETE FROM teams WHERE number = 7000");
    expect((await all<{ n: number }>("SELECT COUNT(*) n FROM team_search WHERE team_search MATCH 'paulo'"))[0].n).toBe(0);
  });

  it("reads indexes, never a scan of every team", async () => {
    const plan = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN SELECT ts.team FROM team_seasons ts
      LEFT JOIN teams t ON t.number = ts.team LEFT JOIN team_season_records r ON r.season = ts.season AND r.team = ts.team
      WHERE ts.season = ? AND (ts.team IN (SELECT rowid FROM team_search WHERE team_search MATCH ?)) AND (CAST(ts.team AS TEXT) LIKE ? OR ts.team IN (SELECT rowid FROM team_search WHERE team_search MATCH ?))`,
    [S, '"robo"*', "12%", '"12"*'])).map((r) => r.detail).join("\n");
    expect(plan).toMatch(/SEARCH ts USING (COVERING )?INDEX|SEARCH ts USING PRIMARY KEY/);
    expect(plan).toMatch(/VIRTUAL TABLE INDEX/);
    expect(plan).not.toMatch(/SCAN t\b/);
    expect(plan).not.toMatch(/SCAN teams/);
  });
});
