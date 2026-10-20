// Records API end to end on an in-memory database: the stats job's records
// tables (aggregates, OPR, no-show and surrogate rules), the filter → SQL
// compiler (whitelist, bound values), and /api/records/… (FTC Scout's nested
// example, sorting, pagination, CSV, clear 400s).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, db, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { loadSeason } from "../stats/load";
import { computeRecords, fillAdvancementOdds, fillRecordPredictions } from "../stats/records";
import { forecasterFor } from "../predict/engine";
import { compileFilter, recordColumns, recordFolded, RecordsQueryError } from "./records";
import { encodeFilterText, foldText, parseFilter } from "../../src/shared/filterDsl";
import { RECORD_SCOPES, statsFor } from "../../src/shared/statCatalog";

let server: Server;
let base = "";

const S = 2024; // computed by the stats job below
const N = 2025; // rows written directly, for the API's filter tests

type Score = [total: number, np: number, auto: number, teleop: number, endgame: number, pen: number];
async function match(number: number, red: [number, boolean?, boolean?][], blue: [number, boolean?, boolean?][], r: Score, b: Score) {
  await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
    blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, 'USTST', 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')`,
    [S, number, `Q${number}`, `2024-11-02T10:0${number}:00`, ...r, ...b]);
  for (const [alliance, ts] of [["red", red], ["blue", blue]] as const)
    for (const [i, [team, surrogate, noShow]] of ts.entries())
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, on_field) VALUES (?, 'USTST', 'qual', 0, ?, ?, ?, ?, ?, ?)", [S, number, team, alliance, i + 1, surrogate ? 1 : 0, noShow ? 0 : 1]);
}

async function nestRow(team: number, code: string, v: { pen: number | null; opr: number | null; auto: number | null; name?: string; type?: string; region?: string; start?: string }) {
  const name = v.name ?? `Team ${team}`;
  await run(`INSERT INTO team_event_records (season, code, team, event_name, event_type, event_region, event_start, event_end, team_name, pen_tot, total_opr, auto_avg, team_name_fold, event_name_fold)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [N, code, team, `Event ${code}`, v.type ?? "Qualifier", v.region ?? "USTX", v.start ?? "2025-12-06", v.start ?? "2025-12-06", name, v.pen, v.opr, v.auto, foldText(name), foldText(`Event ${code}`)]);
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[1, "Alpha Bots"], [2, "Beta"], [3, "Gamma"], [4, "Delta-Drive"]] as const)
    await run("INSERT INTO teams (number, name, home_region, rookie_year, school) VALUES (?, ?, 'USTX', 2015, 'High School')", [n, name]);
  await run("INSERT INTO events (season, code, name, type, region, start, end, remote, hybrid, source) VALUES (?, 'USTST', 'Test Qualifier', 'Qualifier', 'USTX', '2024-11-02', '2024-11-02', 0, 0, 'test')", [S]);
  for (const t of [1, 2, 3, 4]) await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USTST', ?)", [S, t]);
  // Official ranking for team 2 only: it wins over counted results.
  await run("UPDATE event_teams SET rank = 1, rp = 2.5, tbp = 40, wins = 2, losses = 1, ties = 0, qual_played = 3 WHERE season = ? AND team = 2", [S]);
  // total = np + the opponent's penalties; 2024 DC (as FIRST reports it) = teleop + endgame.
  await match(1, [[1], [2]], [[3], [4]], [100, 90, 20, 50, 20, 5], [60, 55, 10, 30, 15, 10]);
  await match(2, [[1], [3]], [[2], [4]], [80, 80, 30, 40, 10, 0], [50, 50, 10, 30, 10, 0]);
  await match(3, [[1], [4, true]], [[2], [3, false, true]], [70, 70, 10, 50, 10, 0], [40, 40, 5, 25, 10, 0]); // 4 = surrogate, 3 = no-show
  await computeRecords(S, await loadSeason(S));

  // FTC Scout's marketing example: penalties < 2 AND (OPR ≥ 55 OR auto avg ≥ 30).
  await nestRow(101, "A1", { pen: 0, opr: 60, auto: 10 }); // ✓ OPR
  await nestRow(102, "A1", { pen: 1, opr: 40, auto: 35 }); // ✓ auto
  await nestRow(103, "A1", { pen: 5, opr: 80, auto: 40 }); // ✗ penalties
  await nestRow(104, "A1", { pen: 0, opr: 50, auto: 20 }); // ✗ neither
  await nestRow(105, "B2", { pen: 0, opr: null, auto: 31, type: "LeagueMeet", region: "GB", start: "2026-01-10" }); // ✓ auto (OPR missing)
  await nestRow(106, "B2", { pen: null, opr: 90, auto: 50 }); // ✗ penalties unknown
  await nestRow(107, "B2", { pen: 2, opr: 55, auto: 30, name: "Edge Case" }); // ✗ pen not < 2
  await nestRow(108, "C3", { pen: 1.99, opr: 55, auto: 0, name: "') OR 1=1 --", type: "Scrimmage" }); // ✓ OPR boundary
  await nestRow(109, "C3", { pen: 9, opr: 1, auto: 1, name: "Équipe Ñandú Robótica", type: "Scrimmage" });

  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const get = async (path: string) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() as any, headers: r.headers }; };
const NESTED = "and-penaltyPointsCommittedTot.lt.2+or-totalPointsOpr.gte.55+autoPointsAvg.gte.30--";

describe("records tables (stats job)", () => {
  it("aggregates each team's qualification matches: TOT, AVG, MIN, MAX, DEV", async () => {
    const r = (await all<any>("SELECT * FROM team_event_records WHERE season = ? AND team = 1", [S]))[0];
    expect(r).toMatchObject({ code: "USTST", event_name: "Test Qualifier", team_name: "Alpha Bots", played: 3, wins: 3, losses: 0, ties: 0 });
    expect([r.total_tot, r.total_min, r.total_max]).toEqual([250, 70, 100]);
    expect(r.total_avg).toBeCloseTo(83.333, 3);
    expect(r.total_dev).toBeCloseTo(12.472, 3); // population standard deviation
    expect(r.dc_avg).toBeCloseTo(60, 6); // 2024: teleop + endgame, as FIRST reports it
    expect(r.opp_pen_tot).toBe(10);
    expect(r.pen_tot).toBe(5);
  });
  it("counts a no-show's matches (as FIRST and FTC Scout do) but never a surrogate's", async () => {
    const byTeam = new Map((await all<any>("SELECT team, played, total_tot, wins, losses FROM team_event_records WHERE season = ?", [S])).map((r) => [Number(r.team), r]));
    expect(byTeam.get(3)).toMatchObject({ played: 3, total_tot: 180, wins: 1, losses: 2 }); // Q3 counted although not on the field
    expect(byTeam.get(4)).toMatchObject({ played: 2, total_tot: 110 }); // Q3 as a surrogate: not counted
  });
  it("keeps FIRST's published rank, ranking score and tiebreaker, but counts the record from the event's own matches", async () => {
    // League standings carry earlier meets' matches (team 2's published row says 2-1 over 3,
    // team 1's 9-3 over 12): copying them would count those matches again in every meet and the season.
    const r = (await all<any>("SELECT rank, rp, tb1, wins, losses, played FROM team_event_records WHERE season = ? AND team = 2", [S]))[0];
    expect(r).toMatchObject({ rank: 1, rp: 2.5, tb1: 40, wins: 1, losses: 2, played: 3 });
    expect((await all<any>("SELECT wins, losses, played FROM team_event_records WHERE season = ? AND team = 1", [S]))[0]).toMatchObject({ wins: 3, losses: 0, played: 3 });
    expect((await all<any>("SELECT wins, losses, played FROM team_season_records WHERE season = ? AND team = 1", [S]))[0]).toMatchObject({ wins: 3, losses: 0, played: 3 });
  });
  it("keeps the engine's numbers on rows a refresh rewrites, until the fill steps replace them", async () => {
    await run("UPDATE team_event_records SET pred_win_avg = 61.5, pred_score_avg = 88, adv_odds = 12.5 WHERE season = ? AND team = 1", [S]);
    await run("UPDATE team_season_records SET pred_win_avg = 60, pred_score_avg = 87 WHERE season = ? AND team = 1", [S]);
    await run("UPDATE match_records SET red_pred_win = 70 WHERE season = ? AND number = 1", [S]);
    await computeRecords(S, await loadSeason(S));
    expect((await all<any>("SELECT pred_win_avg, pred_score_avg, adv_odds FROM team_event_records WHERE season = ? AND team = 1", [S]))[0]).toMatchObject({ pred_win_avg: 61.5, pred_score_avg: 88, adv_odds: 12.5 });
    expect((await all<any>("SELECT pred_win_avg, pred_score_avg FROM team_season_records WHERE season = ? AND team = 1", [S]))[0]).toMatchObject({ pred_win_avg: 60, pred_score_avg: 87 });
    expect((await all<any>("SELECT red_pred_win FROM match_records WHERE season = ? AND number = 1", [S]))[0].red_pred_win).toBe(70);
    // The fill step swaps in fresh values in one transaction (no ledger here: none).
    await fillRecordPredictions(S);
    expect((await all<any>("SELECT pred_win_avg FROM team_event_records WHERE season = ? AND team = 1", [S]))[0].pred_win_avg).toBeNull();
  });
  it("stores case- and accent-folded names for text filters", async () => {
    expect((await all<any>("SELECT team_name_fold, school_fold, event_name_fold FROM team_event_records WHERE season = ? AND team = 4", [S]))[0]).toEqual({ team_name_fold: "delta-drive", school_fold: "high school", event_name_fold: "test qualifier" });
  });
  it("solves OPR for every score part (total = non-penalty + penalties received)", async () => {
    const r = (await all<any>("SELECT total_opr, np_opr, opp_pen_opr FROM team_event_records WHERE season = ? AND team = 1", [S]))[0];
    expect(r.total_opr).toBeCloseTo(r.np_opr + r.opp_pen_opr, 6);
  });
  it("fills pre-event advancement odds, identical to the one-event pre-event forecast", async () => {
    await fillAdvancementOdds(S, () => {}, 300);
    const odds = new Map((await all<any>("SELECT team, adv_odds FROM team_event_records WHERE season = ?", [S])).map((r) => [Number(r.team), r.adv_odds]));
    const f = await forecasterFor(S);
    const ev = f.seasonEvents(S).find((e) => e.code === "USTST")!;
    const fc = f.preEventForecast({
      season: S, code: ev.code, type: ev.type, start: ev.start, end: ev.end, field: ev.teams.map((t) => ({ teamNumber: t, rank: null })), alliances: [],
      matches: ev.matches.map((m) => ({ key: `${m.level}:${m.series}:${m.number}`, label: "", level: m.level, series: m.series, number: m.number, time: null, played: false,
        red: { teams: m.red.teams.map((t) => ({ number: t, surrogate: !!m.red.surrogates?.includes(t) })), score: null },
        blue: { teams: m.blue.teams.map((t) => ({ number: t, surrogate: !!m.blue.surrogates?.includes(t) })), score: null } })),
    }, null, 300)!;
    expect(fc.teams.length).toBe(4);
    for (const t of fc.teams) expect(odds.get(t.team)).toBeCloseTo(t.pAdvance * 100, 9);
  });
  it("writes team-season rows and match rows", async () => {
    expect((await all<any>("SELECT events, played, total_tot FROM team_season_records WHERE season = ? AND team = 1", [S]))[0]).toMatchObject({ events: 1, played: 3, total_tot: 250 });
    const m = await all<any>("SELECT number, red_teams, blue_teams, red_dc, margin, high, combined FROM match_records WHERE season = ? ORDER BY number", [S]);
    expect(m[0]).toMatchObject({ number: 1, red_teams: "1 2", blue_teams: "3 4", red_dc: 70, margin: 40, high: 100, combined: 160 });
    expect(m[2]).toMatchObject({ red_teams: "1 4", blue_teams: "2 3" }); // listed teams, surrogates and no-shows included
  });
});

describe("filter → SQL", () => {
  it("binds every value and only ever emits whitelisted columns", () => {
    const args: (string | number)[] = [];
    const sql = compileFilter(parseFilter(`and-teamName.contains.${encodeFilterText("') OR 1=1 --")}+or-totalPointsOpr.gte.55+autoPointsAvg.lt.-3--`, "teamEvent"), recordColumns("teamEvent"), args, recordFolded("teamEvent"));
    expect(sql).toBe("(instr(r.team_name_fold, ?) > 0 AND (r.total_opr >= ? OR r.auto_avg < ?))");
    expect(args).toEqual(["') or 1=1 --", 55, -3]);
    const a2: (string | number)[] = [];
    expect(compileFilter(parseFilter("and-eventCode.eq.ustst-", "teamEvent"), recordColumns("teamEvent"), a2, recordFolded("teamEvent"))).toBe("(lower(r.code) = ?)");
  });
  it("refuses a key that isn't in the whitelist", () => {
    for (const key of ["1=1; DROP TABLE teams", "constructor", "__proto__", "toString"])
      expect(() => compileFilter({ kind: "group", type: "and", children: [{ kind: "cond", key, op: "eq", value: 1 }] }, recordColumns("teamEvent"), [])).toThrow(RecordsQueryError);
  });
  it("has a column for every catalog stat of every record kind", () => {
    for (const scope of RECORD_SCOPES) {
      const cols = recordColumns(scope);
      for (const s of statsFor(scope)) expect(cols[s.key], `${scope}.${s.key}`).toBeTruthy();
      expect(Object.keys(cols).sort()).toEqual(statsFor(scope).map((s) => s.key).sort());
    }
  });
});

describe("GET /api/records/:season/teams", () => {
  it("answers the nested example (penalties < 2 AND (OPR ≥ 55 OR auto avg ≥ 30))", async () => {
    const r = await get(`/api/records/${N}/teams?filter=${NESTED}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("public");
    expect(r.body).toMatchObject({ season: N, scope: "teamEvent", filter: NESTED, sort: "totalPointsOpr", dir: "desc", page: 1, pageSize: 50, total: 4 });
    // Sorted by OPR, highest first; a missing OPR sorts last.
    expect(r.body.rows.map((x: any) => x.team)).toEqual([101, 108, 102, 105]);
    expect(r.body.rows[0]).toMatchObject({ season: N, team: 101, eventCode: "A1", eventName: "Event A1", eventType: "Qualifier", eventStart: "2025-12-06" });
    expect(r.body.rows[0].stats).toMatchObject({ penaltyPointsCommittedTot: 0, totalPointsOpr: 60, autoPointsAvg: 10, teamName: "Team 101" });
    expect(r.body.columns).toContain("advancementOdds");
  });
  it("takes %2B-encoded separators too (URLSearchParams)", async () => {
    const r = await get(`/api/records/${N}/teams?${new URLSearchParams({ filter: NESTED })}`);
    expect(r.body.total).toBe(4);
  });
  it("sorts either way with missing values last, and paginates", async () => {
    expect((await get(`/api/records/${N}/teams?filter=${NESTED}&dir=asc`)).body.rows.map((x: any) => x.team)).toEqual([102, 108, 101, 105]);
    const p = await get(`/api/records/${N}/teams?filter=${NESTED}&pageSize=3&page=2`);
    expect(p.body).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(p.body.rows.map((x: any) => x.team)).toEqual([105]);
    expect((await get(`/api/records/${N}/teams?sort=teamName&pageSize=2`)).body.rows.map((x: any) => x.stats.teamName)).toEqual(["') OR 1=1 --", "Edge Case"]);
  });
  it("pages deep into a big season in the same order (key-first paging past row 1000)", async () => {
    // 1500 rows with repeating values, so ties fall back to the team/event tiebreak.
    await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1500)
      INSERT INTO team_event_records (season, code, team, team_name, team_name_fold, auto_avg) SELECT 2023, 'E' || (i % 7), i, 'T' || (i % 13), 't' || (i % 13), CASE WHEN i % 11 = 0 THEN NULL ELSE i % 37 END FROM n`);
    const want = (await all<any>("SELECT team FROM team_event_records WHERE season = 2023 ORDER BY auto_avg IS NULL, auto_avg DESC, team, code")).map((r) => Number(r.team));
    const got: number[] = [];
    for (let page = 1; page <= 4; page++) got.push(...(await get(`/api/records/2023/teams?sort=autoPointsAvg&pageSize=500&page=${page}&fields=autoPointsAvg`)).body.rows.map((x: any) => x.team));
    expect(got).toEqual(want);
    const deep = await get(`/api/records/2023/teams?sort=teamName&dir=desc&pageSize=10&page=120`);
    expect(deep.body.rows.map((x: any) => x.team)).toEqual((await all<any>("SELECT team FROM team_event_records WHERE season = 2023 ORDER BY team_name IS NULL, team_name_fold DESC, team, code LIMIT 10 OFFSET 1190")).map((r) => Number(r.team)));
  });
  it("exports a big season: its rows and order fixed by one key query, then read in bounded chunks", async () => {
    const c = db();
    const realExec = c.execute.bind(c), realTx = c.transaction.bind(c);
    let keyReads = 0, rowReads = 0, txs = 0;
    (c as any).transaction = (m: any) => { txs++; return realTx(m); };
    (c as any).execute = (s: any) => {
      const sql = String(s?.sql ?? s);
      if (sql.includes("team_event_records")) { if (sql.startsWith("WITH wanted(")) rowReads++; else keyReads++; }
      return realExec(s);
    };
    try {
      const text = await (await fetch(`${base}/api/records/2023/teams?format=csv&sort=autoPointsAvg&fields=autoPointsAvg`)).text();
      const teams = text.trim().split("\r\n").slice(1).map((l) => Number(l.split(",")[1]));
      expect(keyReads).toBe(1); // which rows, in which order: one statement, so a rewrite mid-export can't skip or repeat rows
      expect(rowReads).toBeGreaterThanOrEqual(3); // 1500 rows, 500 at a time: never the whole season in memory
      expect(txs).toBe(0); // no long transaction holding the (possibly only) connection
      expect(teams).toEqual((await all<any>("SELECT team FROM team_event_records WHERE season = 2023 ORDER BY auto_avg IS NULL, auto_avg DESC, team, code")).map((r) => Number(r.team)));
      expect(new Set(teams).size).toBe(1500);
    } finally { (c as any).execute = realExec; (c as any).transaction = realTx; }
  });
  it("starts a CSV download before any query runs, through gzip, then streams every row in order", async () => {
    const c = db();
    const realExec = c.execute.bind(c);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let queries = 0;
    (c as any).execute = async (s: any) => {
      if (String(s?.sql ?? s).includes("team_event_records")) { queries++; await gate; }
      return realExec(s);
    };
    try {
      const r = await fetch(`${base}/api/records/2023/teams?format=csv&sort=teamName&fields=teamName`, { headers: { "accept-encoding": "gzip" } });
      expect(r.headers.get("content-encoding")).toBe("gzip");
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      // The header row arrives (compressed, flushed) while the key query is still held back.
      const first = dec.decode((await reader.read()).value, { stream: true });
      expect(first).toBe("Season,Team,Event Code,Event,Event Type,Event Start,Team Name\r\n");
      expect(queries).toBe(1);
      release();
      let text = first;
      for (let x = await reader.read(); !x.done; x = await reader.read()) text += dec.decode(x.value, { stream: true });
      const got = text.trim().split("\r\n").slice(1).map((l) => `${l.split(",")[1]}|${l.split(",")[2]}`);
      expect(got).toEqual((await all<any>("SELECT team, code FROM team_event_records WHERE season = 2023 ORDER BY team_name IS NULL, team_name_fold ASC, team, code")).map((x) => `${x.team}|${x.code}`));
    } finally { release(); (c as any).execute = realExec; }
  });
  it("exports match records in order, each row read by its whole key", async () => {
    // The table's own order (whole rows sorted in one query) is the reference.
    const want = (await get(`/api/records/${S}/matches?sort=combinedScore&fields=combinedScore`)).body.rows.map((x: any) => `${x.eventCode}|${x.label}|${x.level}|${x.stats.combinedScore}`);
    expect(want.length).toBe(3);
    const r = await fetch(`${base}/api/records/${S}/matches?format=csv&sort=combinedScore&fields=combinedScore`, { headers: { "accept-encoding": "identity" } });
    expect(r.headers.get("content-encoding")).toBeNull();
    expect(r.headers.get("vary")).toMatch(/accept-encoding/i); // a cache keeps the plain and gzipped copies apart
    const text = await r.text();
    expect(text.trim().split("\r\n").slice(1).map((l) => { const c = l.split(","); return `${c[1]}|${c[4]}|${c[5]}|${c[8]}`; })).toEqual(want);
  });
  it("returns only the asked-for fields", async () => {
    const r = await get(`/api/records/${N}/teams?fields=teamName,autoPointsAvg&pageSize=1`);
    expect(r.body.columns).toEqual(["teamName", "autoPointsAvg"]);
    expect(Object.keys(r.body.rows[0].stats)).toEqual(["teamName", "autoPointsAvg"]);
  });
  it("narrows by region, event type and dates", async () => {
    expect((await get(`/api/records/${N}/teams?region=gb,ustx`)).body.total).toBe(9);
    expect((await get(`/api/records/${N}/teams?region=gb`)).body.rows.map((x: any) => x.team)).toEqual([105]);
    expect((await get(`/api/records/${N}/teams?eventType=LeagueMeet`)).body.total).toBe(1);
    expect((await get(`/api/records/${N}/teams?eventType=Official`)).body.total).toBe(7); // no scrimmage
    expect((await get(`/api/records/${N}/teams?from=2026-01-01`)).body.total).toBe(1);
    expect((await get(`/api/records/${N}/teams?to=2025-12-31`)).body.total).toBe(8);
  });
  it("matches text case-insensitively and never as SQL", async () => {
    expect((await get(`/api/records/${N}/teams?filter=and-teamName.contains.EDGE-`)).body.rows.map((x: any) => x.team)).toEqual([107]);
    expect((await get(`/api/records/${N}/teams?filter=and-teamName.eq.edge%2520case-`)).body.total).toBe(1);
    const inj = await get(`/api/records/${N}/teams?${new URLSearchParams({ filter: `and-teamName.contains.${encodeFilterText("') OR 1=1 --")}-` })}`);
    expect(inj.body.rows.map((x: any) => x.team)).toEqual([108]);
  });
  it("matches accented names case- and accent-insensitively", async () => {
    for (const f of ["and-teamName.contains.equipe-", "and-teamName.contains.%C3%89QUIPE-", "and-teamName.contains.robotica-", "and-teamName.eq.%C3%A9quipe%20%C3%B1and%C3%BA%20rob%C3%B3tica-"]) {
      const r = await get(`/api/records/${N}/teams?${new URLSearchParams({ filter: f })}`);
      expect(r.body.rows.map((x: any) => x.team), f).toEqual([109]);
    }
    expect((await get(`/api/records/${N}/teams?${new URLSearchParams({ filter: "and-teamName.ne.equipe nandu robotica-".replace(/ /g, "%20") })}`)).body.rows.map((x: any) => x.team)).not.toContain(109);
  });
  it("serves team-season records with ?scope=season", async () => {
    const r = await get(`/api/records/${S}/teams?scope=season&filter=and-totalPointsTot.gte.200-`);
    expect(r.body).toMatchObject({ scope: "teamSeason", total: 1 });
    expect(r.body.rows[0]).toMatchObject({ season: S, team: 1 });
    expect(r.body.rows[0].stats.events).toBe(1);
  });
  it("explains bad requests with a 400", async () => {
    const cases: [string, RegExp][] = [
      [`filter=and-foo.lt.2-`, /unknown stat "foo"/],
      [`filter=and-autoPointsAvg.gte.30`, /never closed/],
      [`filter=and-teamName.gt.3-`, /teamName is text/],
      [`filter=and-redTotalPoints.gt.3-`, /isn't available for team-event records/],
      [`sort=nope`, /sort: unknown stat "nope"/],
      [`dir=up`, /dir must be asc or desc/],
      [`pageSize=501`, /pageSize must be a whole number from 1 to 500/],
      [`page=0`, /page must be/],
      [`fields=teamName,bogus`, /fields: unknown stat "bogus"/],
      [`eventType=Party`, /eventType must be one of/],
      [`from=yesterday`, /from must be a date/],
      [`scope=season&filter=and-rank.lt.3-`, /"rank" isn't available for team-season records/],
      [`scope=world`, /scope must be event/],
      [`format=xml`, /format must be json or csv/],
      [`filter=a&filter=b`, /filter: give it once/],
    ];
    for (const [q, re] of cases) {
      const r = await get(`/api/records/${N}/teams?${q}`);
      expect(r.status, q).toBe(400);
      expect(r.body.error, q).toMatch(re);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect((await get(`/api/records/2001/teams`)).status).toBe(404);
  });
  it("exports every filtered row as CSV", async () => {
    const r = await fetch(`${base}/api/records/${N}/teams?filter=${NESTED}&format=csv&fields=teamName,totalPointsOpr&pageSize=1`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain(`control-scout-${N}-teams.csv`);
    const lines = (await r.text()).trim().split("\r\n");
    expect(lines[0]).toBe("Season,Team,Event Code,Event,Event Type,Event Start,Team Name,Total Points OPR");
    expect(lines).toHaveLength(5); // header + all 4 rows, whatever the page size
    expect(lines[2]).toBe(`${N},108,C3,Event C3,Scrimmage,2025-12-06,') OR 1=1 --,55`);
  });
});

describe("GET /api/records/:season/matches", () => {
  it("filters and sorts match records, with lineups", async () => {
    const r = await get(`/api/records/${S}/matches?filter=and-winningMargin.gte.30+redTotalPoints.gte.80-`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ scope: "match", sort: "highScore", dir: "desc", total: 2 });
    expect(r.body.rows[0]).toMatchObject({ eventCode: "USTST", key: "qual:0:1", label: "Q1", level: "qual", red: [1, 2], blue: [3, 4] });
    expect(r.body.rows[0].stats).toMatchObject({ redTotalPoints: 100, blueTotalPoints: 60, redDcPoints: 70, winningMargin: 40, highScore: 100, combinedScore: 160 });
  });
  it("narrows by team and level, and sorts by any stat", async () => {
    expect((await get(`/api/records/${S}/matches?team=2&sort=winningMargin&dir=asc`)).body.rows.map((x: any) => x.label)).toEqual(["Q2", "Q3", "Q1"]);
    expect((await get(`/api/records/${S}/matches?team=99`)).body.total).toBe(0);
    expect((await get(`/api/records/${S}/matches?level=playoff`)).body.total).toBe(0);
  });
  it("sends each replayed call's recorded tier with its probability, read from the ledger (audit PUB3-F03)", async () => {
    const ledger = (kind: string, number: number, pRed: number, tier: string) => run(
      `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at)
       VALUES (?, ?, 'USTST', 'qual', 0, ?, '1 2', '3 4', ?, 90, 60, ?, 'test', '2024-11-01T00:00:00Z')`, [kind, S, number, pRed, tier]);
    await ledger("backtest", 1, 0.93, "confident");
    await ledger("live", 2, 0.6, "moderate"); // a live call is never the records' replayed one
    await run("UPDATE match_records SET red_pred_win = CASE number WHEN 1 THEN 93 WHEN 2 THEN 60 END WHERE season = ?", [S]);
    try {
      const r = await get(`/api/records/${S}/matches?sort=redPredictedWinPct&fields=redPredictedWinPct`);
      expect(r.body.rows.map((x: any) => [x.label, x.stats.redPredictedWinPct, x.predictionTier])).toEqual([["Q1", 93, "confident"], ["Q2", 60, null], ["Q3", null, null]]);
      // The tier is a stored fact, not worked out again: changing it in the ledger changes it here.
      await run("UPDATE predictions SET tier = 'provisional' WHERE kind = 'backtest' AND season = ? AND number = 1", [S]);
      expect((await get(`/api/records/${S}/matches?sort=redPredictedWinPct&fields=redPredictedWinPct`)).body.rows[0].predictionTier).toBe("provisional");
      // Mid-rebuild, the ledger already holds a new replay while the row still has the old percentage:
      // the new tier is never paired with the old number (no tier, so the percentage isn't shown).
      await run("UPDATE predictions SET p_red = 0.88, tier = 'moderate' WHERE kind = 'backtest' AND season = ? AND number = 1", [S]);
      expect((await get(`/api/records/${S}/matches?sort=redPredictedWinPct&fields=redPredictedWinPct`)).body.rows[0]).toMatchObject({ label: "Q1", predictionTier: null });
      await fillRecordPredictions(S); // the fill step catches up: percentage and tier from the same replay again
      expect((await get(`/api/records/${S}/matches?sort=redPredictedWinPct&fields=redPredictedWinPct`)).body.rows[0]).toMatchObject({ label: "Q1", stats: { redPredictedWinPct: 88 }, predictionTier: "moderate" });
      await run("UPDATE predictions SET p_red = 0.93, tier = 'provisional' WHERE kind = 'backtest' AND season = ? AND number = 1", [S]);
      await run("UPDATE match_records SET red_pred_win = CASE number WHEN 1 THEN 93 WHEN 2 THEN 60 END WHERE season = ?", [S]);
      // Not asked for the probability: no tier either.
      expect((await get(`/api/records/${S}/matches?fields=highScore`)).body.rows[0]).not.toHaveProperty("predictionTier");
      // The CSV carries it in its own column after the fields.
      const csv = await (await fetch(`${base}/api/records/${S}/matches?format=csv&sort=redPredictedWinPct&fields=redPredictedWinPct`)).text();
      const lines = csv.trim().split("\r\n");
      expect(lines[0].split(",").slice(-2)).toEqual(["Red Predicted Win %", "Red Predicted Win % Confidence"]);
      expect(lines[1].split(",").slice(-2)).toEqual(["93", "provisional"]);
      expect(lines[2].split(",").slice(-2)).toEqual(["60", ""]);
    } finally {
      await run("DELETE FROM predictions WHERE season = ?", [S]);
      await run("UPDATE match_records SET red_pred_win = NULL WHERE season = ?", [S]);
    }
  });
  it("rejects team-only stats and parameters", async () => {
    expect((await get(`/api/records/${S}/matches?filter=and-totalPointsOpr.gt.3-`)).body.error).toMatch(/isn't available for match records/);
    expect((await get(`/api/records/${S}/matches?scope=season`)).status).toBe(400);
    expect((await get(`/api/records/${S}/teams?team=3`)).body.error).toMatch(/team applies to match records/);
  });
});

describe("one event's records and region options", () => {
  it("narrows team-event and match records to one event with ?code (any case)", async () => {
    expect((await get(`/api/records/${N}/teams?code=b2`)).body.rows.map((x: any) => x.team).sort()).toEqual([105, 106, 107]);
    expect((await get(`/api/records/${S}/matches?code=USTST`)).body.total).toBe(3);
    expect((await get(`/api/records/${S}/matches?code=NOPE`)).body.total).toBe(0);
    expect((await get(`/api/records/${N}/teams?scope=season&code=B2`)).body.error).toMatch(/code applies to team-event and match records/);
    expect((await get(`/api/records/${N}/teams?code=a;b`)).status).toBe(400);
  });
  it("treats an empty fields= as no stat columns (identity only), in JSON and CSV", async () => {
    const j = await get(`/api/records/${S}/matches?fields=`);
    expect(j.status).toBe(200);
    expect(j.body.columns).toEqual([]);
    expect(j.body.rows[0].stats).toEqual({});
    expect(j.body.rows[0].red.length).toBeGreaterThan(0);
    const csv = await (await fetch(`${base}/api/records/${S}/matches?fields=&format=csv`)).text();
    expect(csv.split("\r\n")[0]).toBe("Season,Event Code,Event,Event Start,Match,Level,Red,Blue");
    // Without fields at all, every stat comes back as before.
    expect((await get(`/api/records/${S}/matches`)).body.columns.length).toBeGreaterThan(5);
  });
  it("lists the season's region codes with the place most of their events are in", async () => {
    const { status, body } = await get(`/api/records/${S}/regions`);
    expect(status).toBe(200);
    expect(body.regions.find((r: any) => r.code === "USTX")).toMatchObject({ events: 1 });
  });
});
