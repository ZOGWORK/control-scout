// The search index's in-memory rebuilds (names, typo index, spelling vocabulary) read in chunks and built in steps, so
// a rebuild never holds the event loop for its whole length: each must give exactly what the one read and the one
// synchronous build gave.
import { beforeAll, describe, expect, it } from "vitest";
import { all, allInChunks, loopTurn, migrate, openDb, run, setDb } from "../db";
import { runAll, runYielding } from "../../src/shared/steps";
import { buildNames, namesSteps } from "../../src/shared/query/names";
import { teamNameRows } from "./query/names";
import { buildFuzzyIndex, fuzzyIndexSteps } from "./search";
import { buildVocab, vocabSteps } from "./spelling";

/** The read names() made before: one query with both aggregates joined. */
const OLD_TEAM_ROWS = `SELECT t.number, t.name, t.city, t.state, t.country, p.last lastPlayed, r.strength FROM teams t
  LEFT JOIN (SELECT team, MAX(season) last FROM team_event_stats WHERE matches > 0 GROUP BY team) p ON p.team = t.number
  LEFT JOIN (SELECT team, MAX(pct) strength FROM (SELECT team, 1.0 - CAST(rank_np AS REAL) / ranked_teams pct,
      ROW_NUMBER() OVER (PARTITION BY team ORDER BY season DESC) k FROM team_season_stats WHERE rank_np IS NOT NULL AND ranked_teams > 0)
    WHERE k <= 2 GROUP BY team) r ON r.team = t.number`;

const plain = <T extends object>(rs: T[]) => rs.map((r) => ({ ...r }));
const without = (rs: Record<string, unknown>[], k: string) => rs.map(({ [k]: _, ...r }) => r);

beforeAll(async () => {
  const c = openDb(":memory:"); setDb(c); await migrate(c);
  // More teams than a chunk, in a scrambled insert order, with shared names, towns in two regions and missing fields.
  await run(`INSERT INTO teams (number, name, school, city, state, country)
    WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 6000)
    SELECT x, CASE WHEN x % 97 = 0 THEN NULL ELSE 'Team ' || (x % 700) || CASE x % 3 WHEN 0 THEN '''s Bots' WHEN 1 THEN ' I.C.E.' ELSE ' Robotics' END END,
      'School ' || (x % 50), CASE WHEN x % 11 = 0 THEN NULL ELSE 'Town' || (x % 40) END,
      CASE x % 4 WHEN 0 THEN 'MI' WHEN 1 THEN 'MN' WHEN 2 THEN 'CA' ELSE NULL END, CASE WHEN x % 13 = 0 THEN 'Romania' ELSE 'USA' END
    FROM n ORDER BY (x * 7919) % 6007`);
  // Seasons played (some only with no matches), out of team order.
  await run(`INSERT INTO team_event_stats (season, code, team, matches)
    WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 9000)
    SELECT 2019 + (x % 7), 'EV' || (x % 9), 1 + (x * 31) % 5000, CASE WHEN x % 5 = 0 THEN 0 ELSE x % 9 END FROM n WHERE true
    ON CONFLICT DO NOTHING`);
  // Rankings over several seasons (some unranked), so "its two latest ranked seasons" picks among three or more.
  await run(`INSERT INTO team_season_stats (season, team, rank_np, ranked_teams)
    WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 16000)
    SELECT 2019 + (x % 7), 1 + (x * 17) % 4500, CASE WHEN x % 6 = 0 THEN NULL ELSE 1 + (x * 13) % 900 END, CASE WHEN x % 29 = 0 THEN 0 ELSE 1000 END FROM n WHERE true
    ON CONFLICT DO NOTHING`);
  await run(`INSERT INTO events (season, code, name, source, city, state, country, venue)
    WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 3000)
    SELECT 2019 + (x % 7), 'C' || x, CASE x % 3 WHEN 0 THEN 'Michigan Tech Invitational ' || x WHEN 1 THEN 'Grand Rapids Qualifier' ELSE 'Romania Championship' END,
      'first', 'Town' || (x % 45), CASE x % 2 WHEN 0 THEN 'MI' ELSE 'MN' END, 'USA', 'Gym ' || (x % 30)
    FROM n ORDER BY (x * 389) % 3001`);
  await run("INSERT INTO search_fuzzy (kind, ref, season, weight, title, subtitle, name) SELECT 'team', number, NULL, 1, name, city, coalesce(name, '') || ' ' || coalesce(school, '') FROM teams");
  await run("INSERT INTO search_fuzzy (kind, ref, season, weight, title, subtitle, name) SELECT 'event', code, season, 2, name, city, name FROM events");
});

describe("chunked reads give the rows the one read did", () => {
  it("teamNameRows: every team, its last season played and its strength, in the same order", async () => {
    const old = plain(await all<Record<string, unknown>>(OLD_TEAM_ROWS));
    expect(old.length).toBe(6000);
    expect(old.filter((r) => r.lastPlayed != null).length).toBeGreaterThan(1000);
    expect(old.filter((r) => r.strength != null).length).toBeGreaterThan(1000);
    expect(await teamNameRows()).toEqual(old);
  });

  it("the typo index's rows and the vocabulary's rows", async () => {
    const fz = await allInChunks<Record<string, unknown>>("SELECT rowid rid, kind, ref, season, weight, title, subtitle, name FROM search_fuzzy WHERE rowid > ?", [], "rid", 2_500);
    expect(without(fz, "rid")).toEqual(plain(await all("SELECT kind, ref, season, weight, title, subtitle, name FROM search_fuzzy")));
    const ts = await allInChunks<Record<string, unknown>>("SELECT number, name, school, city, state FROM teams WHERE number > ?", [], "number", 2_500);
    expect(without(ts, "number")).toEqual(plain(await all("SELECT name, school, city, state FROM teams")));
    const es = await allInChunks<Record<string, unknown>>("SELECT rowid rid, code, name, venue, city, state FROM events WHERE rowid > ?", [], "rid", 2_500);
    expect(without(es, "rid")).toEqual(plain(await all("SELECT code, name, venue, city, state FROM events")));
  });
});

describe("builds in steps give what the one build did", () => {
  it("names: the same answers to every name, town, country and near miss", async () => {
    const teams = await teamNameRows();
    const places = await all<{ city: string | null; state: string | null; country: string | null; name: string | null; code: string | null }>("SELECT city, state, country, name, code FROM events");
    const a = buildNames(teams, places), b = await runYielding(namesSteps(teams, places), loopTurn, 0);
    const probes = [...new Set([...teams.map((t) => t.name ?? ""), ...places.flatMap((p) => [p.city ?? "", p.name ?? ""]), "team 12 robotic", "team 5 ice", "town3", "romania", "michigan tech invitatonal", "mti", "grand rapids qualifer", "the us"])];
    const ask = (n: typeof a) => probes.map((w) => [n.teamsNamed(w).map((t) => t.number), n.teamsCalled(w).map((t) => t.number), n.nearTeam(w)?.number ?? null,
      (n.nearShared?.(w) ?? []).map((t) => t.number), n.place(w), n.eventStem(w), n.initialism(w), n.eventNamed(w), n.nearEventWord?.(w) ?? null, n.team(Number(w.split(" ")[1]) || 0)?.strength ?? null]);
    expect(ask(b)).toEqual(ask(a));
    expect([b.longest, b.eventLongest]).toEqual([a.longest, a.eventLongest]);
  });

  it("the typo index: the same rows, words and word numbers", async () => {
    const rs = await all<Parameters<typeof buildFuzzyIndex>[0][number]>("SELECT kind, ref, season, weight, title, subtitle, name FROM search_fuzzy");
    const a = buildFuzzyIndex(rs), b = await runYielding(fuzzyIndexSteps(rs), loopTurn, 0);
    expect(b.rows).toEqual(a.rows);
    expect(b.words).toEqual(a.words);
    expect(b.plain).toBe(a.plain);
  });

  it("the spelling vocabulary: the same words, counts and sets", async () => {
    const teams = await all<{ name: string | null; school: string | null; city: string | null; state: string | null }>("SELECT name, school, city, state FROM teams");
    const events = await all<{ code: string; name: string | null; venue: string | null; city: string | null; state: string | null }>("SELECT code, name, venue, city, state FROM events");
    expect(await runYielding(vocabSteps(teams, events), loopTurn, 0)).toEqual(buildVocab(teams, events));
  });
});

describe("runYielding and loopTurn", () => {
  function* work(steps: number, msEach: number): Generator<void, number> {
    let n = 0;
    for (let i = 0; i < steps; i++) {
      const until = performance.now() + msEach;
      while (performance.now() < until) n++;
      yield;
    }
    return steps;
  }

  it("runAll and runYielding finish with the same value", async () => {
    expect(runAll(work(5, 0))).toBe(5);
    expect(await runYielding(work(5, 0), loopTurn)).toBe(5);
  });

  it("lets a timer in between slices, even with two long builds waking in the same turn", async () => {
    let longest = 0, last = performance.now();
    const iv = setInterval(() => { const n = performance.now(); longest = Math.max(longest, n - last); last = n; }, 1);
    // Each 120 ms of work in 4 ms steps: one call of the whole would hold the loop 240 ms.
    await Promise.all([runYielding(work(30, 4), loopTurn), runYielding(work(30, 4), loopTurn)]);
    clearInterval(iv);
    expect(longest).toBeLessThan(80);
  });
});
