// Search reads made faster for the event pack's builds (and every search): each must give exactly the old answer.
//  - namesFrom: two binary searches instead of a pass over every team's name (teamsNamed).
//  - NEWEST_MATCH_SEASON: a code's newest season with matches, by key, instead of a scan of every match.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { SEASON_NUMBERS } from "../data/seasons";
import { namesFrom } from "./searchLayers";
import { NEWEST_MATCH_SEASON } from "./search";

/** What teamsNamed did before: every name, in list order. */
const scan = (list: [string, string][], n: string) => list.filter(([name]) => name === n || name.startsWith(`${n} `));
const sortedOf = (list: [string, string][]) => [...list].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const asSet = (xs: [string, string][]) => xs.map(([n, t]) => `${n}|${t}`).sort();

describe("namesFrom (teamsNamed's whole-word prefix)", () => {
  const list: [string, string][] = [
    ["hypnotic robotics", "4215"], ["hypnotic", "1"], ["hypnotic", "2"], ["hypnotics", "3"], ["hypnotic!", "4"],
    ["hypnotic robotics jr", "5"], ["hypnotic  robotics", "6"], ["hypnoti", "7"], ["robotics", "8"], ["", "9"],
    ["a", "10"], ["a b", "11"], ["a!", "12"], ["a b c", "13"], ["ab", "14"], ["a\u0000", "15"], ["a ", "16"],
    ["team calamari", "17"], ["team", "18"], ["teams", "19"], ["über bots", "20"], ["uber bots", "21"], ["zz top", "22"],
  ];
  const sorted = sortedOf(list);

  it("finds the same teams as the scan for every name, prefix and near miss", () => {
    const asks = new Set<string>([...list.map(([n]) => n), "hypnotic robotics", "hypnotic", "hypnoti", "a", "a b", "team", "über", "uber", "z", "zz", "zzz", "nothing", " "]);
    for (const [n] of list) for (let i = 1; i <= n.length; i++) asks.add(n.slice(0, i));
    for (const n of asks) expect(asSet(namesFrom(sorted, n)), JSON.stringify(n)).toEqual(asSet(scan(list, n)));
  });

  it("matches the scan on random names (the count and, when one, the team)", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const word = () => Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => "abc é!"[Math.floor(rnd() * 6)]).join("");
    const big: [string, string][] = Array.from({ length: 3000 }, (_, i) => [Array.from({ length: 1 + Math.floor(rnd() * 3) }, word).join(" "), String(i)]);
    const s = sortedOf(big);
    for (let i = 0; i < 2000; i++) {
      const n = i % 2 ? big[Math.floor(rnd() * big.length)][0].split(" ").slice(0, 1 + Math.floor(rnd() * 2)).join(" ") : word();
      const a = namesFrom(s, n), b = scan(big, n);
      expect(a.length, n).toBe(b.length);
      if (b.length === 1) expect(a[0][1]).toBe(b[0][1]);
    }
  });
});

describe("NEWEST_MATCH_SEASON", () => {
  const OLD = "SELECT MAX(season) s FROM matches WHERE code = ? OR code IN (SELECT d.code FROM events d JOIN events e ON e.season = d.season AND e.code = ? WHERE d.code LIKE e.code || '_%' AND d.name LIKE e.name || ' - %')";
  beforeAll(async () => {
    const c = openDb(":memory:"); setDb(c); await migrate(c);
    const [a, b, cur] = [SEASON_NUMBERS[0], SEASON_NUMBERS[1], SEASON_NUMBERS.at(-1)!];
    const ev = (s: number, code: string, name: string) => run("INSERT INTO events (season, code, name, source) VALUES (?, ?, ?, 'first')", [s, code, name]);
    const m = (s: number, code: string, n: number) => run("INSERT INTO matches (season, code, level, series, number, label, source) VALUES (?, ?, 'qual', 0, ?, ?, 'first')", [s, code, n, `Q${n}`]);
    // A plain event over two seasons; one listed this season but not played yet.
    await ev(a, "USNJQ1", "NJ Qualifier 1"); await m(a, "USNJQ1", 1);
    await ev(b, "USNJQ1", "NJ Qualifier 1"); await m(b, "USNJQ1", 1);
    await ev(cur, "USNJQ1", "NJ Qualifier 1");
    // An event split in divisions: its matches are the divisions' (codes and names that extend the event's).
    await ev(cur, "FTCCMP1", "World Championship"); await ev(cur, "FTCCMP1EDIS", "World Championship - Edison Division"); await m(cur, "FTCCMP1EDIS", 3);
    await ev(b, "FTCCMP1", "World Championship"); await ev(b, "FTCCMP1FRAN", "World Championship - Franklin Division"); await m(b, "FTCCMP1FRAN", 2);
    // Not a division: the code extends it but the name doesn't, and one whose name does but code doesn't.
    await ev(cur, "USTXQ", "Texas Qualifier"); await ev(cur, "USTXQ2", "Another Event"); await m(cur, "USTXQ2", 1);
    await ev(a, "USTXQX", "Texas Qualifier - North"); await m(a, "USTXQX", 1);
    await ev(cur, "OTHER", "Texas Qualifier - South"); await m(cur, "OTHER", 1);
    // Case: LIKE folds it, = doesn't.
    await ev(a, "lowerq", "Lower"); await m(a, "lowerq", 1);
  });

  it("gives the old scan's answer for own codes, divisions, near misses, case and unknown codes", async () => {
    const codes = (await all<{ code: string }>("SELECT DISTINCT code FROM events")).map((r) => r.code);
    for (const code of [...codes, "NOPE", "usnjq1", "LOWERQ", "lowerq", "FTCCMP", "", "USTX", "%", "_"]) {
      const [want] = await all<{ s: number | null }>(OLD, [code, code]);
      const [got] = await all<{ s: number | null }>(NEWEST_MATCH_SEASON, [code, code]);
      expect(got.s, code).toBe(want.s);
    }
    const [cmp] = await all<{ s: number }>(NEWEST_MATCH_SEASON, ["FTCCMP1", "FTCCMP1"]);
    expect(cmp.s).toBe(SEASON_NUMBERS.at(-1)); // the division's matches, this season
  });

  it("finds the code by key, season by season, never by reading every match", async () => {
    const plan = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${NEWEST_MATCH_SEASON}`, ["X", "X"])).map((r) => r.detail);
    expect(plan.filter((d) => /^SEARCH matches/.test(d)).every((d) => /season=\? AND code=\?/.test(d))).toBe(true);
    expect(plan.some((d) => /^SCAN (matches|e)\b/.test(d))).toBe(false);
  });
});
