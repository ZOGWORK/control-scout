// Official result changes: the diff the sync records when it writes an event
// (first postings, score revisions, schedule moves), its idempotency, the
// baseline, retention, the untouched prediction ledger, and the public API.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { CURRENT_SEASON, resultFieldLabels, type ScoreSplit } from "./seasons";
import type { EventBundle, MatchRow, MatchTeam } from "./bundle";
import { RESULT_CHANGES_PER_EVENT, diffMatches, readStored, resultChangesIo, writeEventBundle } from "./resultChanges";
import type { ResultChangesView } from "../../src/shared/api";
import { syncEvent } from "../sync";

const S = CURRENT_SEASON;

const team = (n: number, dq = false): MatchTeam => ({ team: n, station: null, surrogate: false, dq, onField: true });
const score = (total: number, o: Partial<ScoreSplit> = {}): ScoreSplit => ({ total, np: total - 5, auto: 20, teleop: total - 40, endgame: 15, pen: 5, ...o });

function m(number: number, o: Partial<MatchRow> & { r?: number; b?: number } = {}): MatchRow {
  const played = o.r != null && o.b != null;
  return {
    level: "qual", series: 0, number, label: `Q${number}`, description: null, time: `2026-11-07T09:${String(number).padStart(2, "0")}:00`,
    played, red: [team(201), team(202)], blue: [team(203), team(204)],
    redScore: played ? score(o.r!) : null, blueScore: played ? score(o.b!) : null, field: "1",
    ...o,
  };
}

function bundle(matches: MatchRow[], source: "first" | "ftc-scout" = "first", code = "EV"): EventBundle {
  return {
    event: { season: S, code, name: code, type: "Qualifier", divisionCode: null, region: null, league: null, venue: null, city: null, state: null, country: null,
      start: "2026-11-07", end: "2026-11-07", timezone: null, remote: false, hybrid: false, website: null, livestream: null, source, upstreamUpdated: null },
    teams: [],
    detail: { entries: [], matches, alliances: [], awards: [], advancement: undefined },
  };
}

const changes = () => all<any>("SELECT * FROM result_changes ORDER BY id");

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
});

describe("migration", () => {
  it("adds the change table, the watch table and the scheduled field", async () => {
    const cols = async (t: string) => (await all<any>(`PRAGMA table_info(${t})`)).map((r) => r.name);
    expect(await cols("result_changes")).toEqual(expect.arrayContaining(["season", "code", "level", "series", "number", "label", "kind", "fields", "before", "after", "source", "prev_source", "checked_at", "diff_key"]));
    expect(await cols("result_watch")).toEqual(["season", "code", "since", "pruned", "missing"]);
    expect(await cols("matches")).toContain("field");
    expect(await get("SELECT name FROM schema_version WHERE name = 'official result changes'")).toBeTruthy();
    // Applying again changes nothing.
    expect(await migrate()).toEqual([]);
  });
});

describe("recording changes", () => {
  it("treats the first write of an event as the baseline", async () => {
    expect(await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2)]), { now: "2026-11-07T15:00:00.000Z" })).toEqual({ changes: 0 });
    expect(await changes()).toEqual([]);
    expect(await get("SELECT since, pruned FROM result_watch WHERE code = 'EV'")).toEqual({ since: "2026-11-07T15:00:00.000Z", pruned: 0 });
  });

  it("records nothing when the same data is polled again", async () => {
    const b = bundle([m(1, { r: 100, b: 90 }), m(2), m(3, { r: 50, b: 60, redScore: score(50, { bonus: { movement: true, goal: false, pattern: true }, tips: 4 }) })]);
    await writeEventBundle(b);
    for (let i = 0; i < 3; i++) expect(await writeEventBundle(structuredClone(b))).toEqual({ changes: 0 });
    expect(await changes()).toEqual([]);
  });

  it("records a first posting once", async () => {
    await writeEventBundle(bundle([m(1), m(2)]));
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2)]), { now: "2026-11-07T15:05:00.000Z" });
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2)]));
    const rows = await changes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "posted", level: "qual", series: 0, number: 1, label: "Q1", before: null, source: "first", prev_source: "first", checked_at: "2026-11-07T15:05:00.000Z" });
    expect(JSON.parse(rows[0].after).red.total).toBe(100);
    expect(JSON.parse(rows[0].after).blue.total).toBe(90);
  });

  it("records a match that appears already played in a watched event as posted", async () => {
    await writeEventBundle(bundle([m(1)]));
    await writeEventBundle(bundle([m(1), m(2, { r: 70, b: 80 })]));
    expect((await changes()).map((r) => [r.kind, r.number])).toEqual([["posted", 2]]);
  });

  it("records a score revision with the real before and after values", async () => {
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 })]));
    const revised = m(1, { r: 100, b: 90, redScore: score(110, { pen: 0, np: 110 }), blue: [team(203), team(204, true)] });
    expect(await writeEventBundle(bundle([revised]))).toEqual({ changes: 1 });
    const [row] = await changes();
    expect(row.kind).toBe("revised");
    expect(JSON.parse(row.fields)).toEqual(["red.total", "red.np", "red.teleop", "red.pen", "dq"]);
    const before = JSON.parse(row.before), after = JSON.parse(row.after);
    expect([before.red.total, after.red.total]).toEqual([100, 110]);
    expect([before.red.pen, after.red.pen]).toEqual([5, 0]);
    expect([before.dq, after.dq]).toEqual([[], [204]]);
    expect(after.blue.total).toBe(90);
    // Polled again: nothing new.
    expect(await writeEventBundle(bundle([structuredClone(revised)]))).toEqual({ changes: 0 });
    expect(await changes()).toHaveLength(1);
  });

  it("records a bonus RP flip", async () => {
    await writeEventBundle(bundle([m(1, { r: 100, b: 90, blueScore: score(90, { bonus: { movement: true, goal: false, pattern: false } }) })]));
    await writeEventBundle(bundle([m(1, { r: 100, b: 90, blueScore: score(90, { bonus: { movement: true, goal: true, pattern: false } }) })]));
    expect(JSON.parse((await changes())[0].fields)).toEqual(["blue.bonus.goal"]);
  });

  it("records a value that changes back (A → B → A) as two revisions", async () => {
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 })]));
    await writeEventBundle(bundle([m(1, { r: 101, b: 90 })]));
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 })]));
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 })]));
    expect((await changes()).map((r) => [JSON.parse(r.before).red.total, JSON.parse(r.after).red.total])).toEqual([[100, 101], [101, 100]]);
  });

  it("records schedule moves: time and field before the match, lineup any time", async () => {
    await writeEventBundle(bundle([m(1), m(2)]));
    await writeEventBundle(bundle([m(1, { time: "2026-11-07T09:30:00", field: "2" }), m(2, { red: [team(201), team(205)] })]));
    const rows = await changes();
    expect(rows.map((r) => [r.kind, r.number, JSON.parse(r.fields)])).toEqual([["schedule", 1, ["time", "field"]], ["schedule", 2, ["red"]]]);
    expect(JSON.parse(rows[0].before)).toMatchObject({ time: "2026-11-07T09:01:00", field: "1" });
    expect(JSON.parse(rows[0].after)).toMatchObject({ time: "2026-11-07T09:30:00", field: "2" });
    expect([JSON.parse(rows[1].before).red, JSON.parse(rows[1].after).red]).toEqual([[201, 202], [201, 205]]);
  });

  it("doesn't call a played match's actual start time a schedule change", async () => {
    await writeEventBundle(bundle([m(1)]));
    await writeEventBundle(bundle([m(1, { r: 100, b: 90, time: "2026-11-07T09:07:31.512" })]));
    expect((await changes()).map((r) => r.kind)).toEqual(["posted"]);
  });

  it("compares only totals when the feed switches, and ignores detail one side doesn't report", async () => {
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2, { r: 60, b: 50 })]));
    // FTC Scout splits breakdowns differently and lists no field: only a changed total counts.
    const scout = bundle([m(1, { r: 100, b: 90, redScore: score(100, { auto: 30, teleop: 45 }), field: null, time: "2026-11-07T15:01:00Z" }), m(2, { r: 61, b: 50 })], "ftc-scout");
    await writeEventBundle(scout);
    const rows = await changes();
    expect(rows.map((r) => [r.kind, r.number, JSON.parse(r.fields), r.source, r.prev_source])).toEqual([["revised", 2, ["red.total"], "ftc-scout", "first"]]);
    // Tips appearing (null → 4) is added detail, not a revision.
    await writeEventBundle(bundle([m(3, { r: 10, b: 10 })], "first", "EV2"));
    await writeEventBundle(bundle([m(3, { r: 10, b: 10, redScore: score(10, { tips: 4 }) })], "first", "EV2"));
    expect(await all("SELECT 1 FROM result_changes WHERE code = 'EV2'")).toEqual([]);
  });

  it("records a withdrawn result from the same feed, and leaves matches the feed no longer lists alone", async () => {
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2, { r: 60, b: 50 })]));
    await writeEventBundle(bundle([m(1)]));
    const rows = await changes();
    expect(rows.map((r) => [r.kind, r.number, JSON.parse(r.fields), r.after])).toEqual([["revised", 1, ["result"], null]]);
  });

  it("compares a match a feed left out with what it was when it comes back", async () => {
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2, { r: 60, b: 50 }), m(3, { r: 40, b: 45 })]));
    // A fallback feed lists Q1 only: Q2 and Q3 leave the matches table but not the comparison.
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 })], "ftc-scout"));
    expect(await all("SELECT number FROM matches WHERE code = 'EV' ORDER BY number")).toEqual([{ number: 1 }]);
    expect(Object.keys(JSON.parse((await get<any>("SELECT missing FROM result_watch WHERE code = 'EV'"))!.missing))).toEqual(["qual:0:2", "qual:0:3"]);
    // FIRST lists them again: Q2 unchanged (nothing recorded, not "posted" again), Q3 corrected.
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2, { r: 60, b: 50 }), m(3, { r: 40, b: 47 })]));
    const rows = await changes();
    expect(rows.map((r) => [r.kind, r.number, JSON.parse(r.fields)])).toEqual([["revised", 3, ["blue.total", "blue.np", "blue.teleop"]]]);
    expect([JSON.parse(rows[0].before).blue.total, JSON.parse(rows[0].after).blue.total]).toEqual([45, 47]);
    expect((await get<any>("SELECT missing FROM result_watch WHERE code = 'EV'"))!.missing).toBe("{}");
  });

  it("reads and diffs again when another writer stores the event in between, so no change is lost", async () => {
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 })]), { now: "2026-11-07T15:00:00.000Z" });
    // Between this write's read and its batch, another writer (say `npm run sync`, which holds no lease) stores 105.
    let once = true;
    resultChangesIo.afterRead = async () => {
      if (!once) return;
      once = false;
      await new Promise((r) => setTimeout(r, 5)); // a later detail_synced_at
      await writeEventBundle(bundle([m(1, { r: 105, b: 90 })]), { now: "2026-11-07T15:01:00.000Z" });
    };
    try {
      await writeEventBundle(bundle([m(1, { r: 110, b: 90 })]), { now: "2026-11-07T15:02:00.000Z" });
    } finally { resultChangesIo.afterRead = async () => {}; }
    expect((await changes()).map((r) => [JSON.parse(r.before).red.total, JSON.parse(r.after).red.total])).toEqual([[100, 105], [105, 110]]);
    expect((await get<any>("SELECT red_total FROM matches WHERE code = 'EV'"))!.red_total).toBe(110);
    expect(await all("SELECT code FROM result_watch")).toEqual([{ code: "EV" }]);
  });

  it("gives up after its retries rather than saving a bundle without its changes", async () => {
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 })]));
    let n = 0;
    resultChangesIo.afterRead = async () => { n++; await new Promise((r) => setTimeout(r, 2)); await run("UPDATE events SET detail_synced_at = ? WHERE code = 'EV'", [`x${n}`]); };
    try {
      await expect(writeEventBundle(bundle([m(1, { r: 120, b: 90 })]), { attempts: 2 })).rejects.toThrow(/UNIQUE constraint failed: result_watch/);
    } finally { resultChangesIo.afterRead = async () => {}; }
    expect(n).toBe(2);
    expect((await get<any>("SELECT red_total FROM matches WHERE code = 'EV'"))!.red_total).toBe(100);
    expect(await changes()).toEqual([]);
  });

  it("keeps the newest changes per event and counts what it drops", async () => {
    await writeEventBundle(bundle([m(1, { r: 0, b: 0 })]));
    for (let i = 1; i <= RESULT_CHANGES_PER_EVENT + 3; i++) await writeEventBundle(bundle([m(1, { r: i, b: 0 })]));
    const n = await get<any>("SELECT COUNT(*) n, MIN(id) lo, MAX(id) hi FROM result_changes WHERE code = 'EV'");
    expect(n.n).toBe(RESULT_CHANGES_PER_EVENT);
    expect(n.hi - n.lo + 1).toBe(RESULT_CHANGES_PER_EVENT); // the newest ones
    expect((await get<any>("SELECT pruned FROM result_watch WHERE code = 'EV'"))!.pruned).toBe(3);
    expect(JSON.parse((await get<any>("SELECT after FROM result_changes ORDER BY id DESC LIMIT 1"))!.after).red.total).toBe(RESULT_CHANGES_PER_EVENT + 3);
  }, 60_000);

  it("never touches the pre-match prediction ledger", async () => {
    await writeEventBundle(bundle([m(1), m(2, { r: 70, b: 80 })]));
    for (const [kind, n] of [["live", 1], ["live", 2], ["backtest", 2]] as const) {
      await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time, red_score, blue_score, outcome, scored_at)
                 VALUES (?, ?, 'EV', 'qual', 0, ?, '[201,202]', '[203,204]', 0.61, 95, 85, 'moderate', '2.1.1', '2026-11-07T14:00:00.000Z', '2026-11-07T09:00:00', ?, ?, ?, ?)`,
        [kind, S, n, n === 2 ? 70 : null, n === 2 ? 80 : null, n === 2 ? 0 : null, n === 2 ? "2026-11-07T14:30:00.000Z" : null]);
    }
    const ledger = () => all("SELECT * FROM predictions ORDER BY id");
    const before = await ledger();
    // Q1 first posted, Q2 revised (the winner flips), Q1 rescheduled… none of it rewrites a logged call.
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2, { r: 90, b: 80 })]));
    await writeEventBundle(bundle([m(1, { r: 100, b: 90, blue: [team(203), team(206)] }), m(2, { r: 90, b: 80 })]));
    expect((await changes()).length).toBe(3);
    expect(await ledger()).toEqual(before);
  });

  it("reads stored matches the same way it normalises incoming ones", async () => {
    const ms = [m(1, { r: 100, b: 90, blue: [team(203, true), team(204)] }), m(2), m(3, { r: 5, b: 6, redScore: score(5, { bonus: { movement: false, goal: true, pattern: false }, tips: 2 }) })];
    await writeEventBundle(bundle(ms));
    expect(diffMatches(await readStored(S, "EV"), ms, "first", true)).toEqual([]);
  });
});

describe("through the sync (FIRST feed stubbed)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  /** FIRST's answers for one event: a two-match schedule on fields 1 and 2, Q1 scored `red`–80. */
  function feed(o: { red: number; q2Field: string }) {
    const teams = [{ teamNumber: 201, station: "Red1" }, { teamNumber: 202, station: "Red2" }, { teamNumber: 203, station: "Blue1" }, { teamNumber: 204, station: "Blue2" }];
    const body = (path: string): unknown => {
      if (path.includes("/schedule/") && path.includes("qual")) return { schedule: [
        { description: "Qualification 1", field: "1", tournamentLevel: "QUALIFICATION", startTime: "2026-11-07T09:00:00", series: 0, matchNumber: 1, teams },
        { description: "Qualification 2", field: o.q2Field, tournamentLevel: "QUALIFICATION", startTime: "2026-11-07T09:07:00", series: 0, matchNumber: 2, teams },
      ] };
      if (path.includes("/matches/")) return { matches: [{ description: "Qualification 1", tournamentLevel: "QUALIFICATION", series: 0, matchNumber: 1, actualStartTime: "2026-11-07T09:01:12", postResultTime: "2026-11-07T09:05:00",
        scoreRedFinal: o.red, scoreRedFoul: 0, scoreRedAuto: 20, scoreBlueFinal: 80, scoreBlueFoul: 0, scoreBlueAuto: 10, teams: teams.map((t) => ({ ...t, dq: false, onField: true })) }] };
      return {};
    };
    vi.stubEnv("FTC_EVENTS_USERNAME", "u");
    vi.stubEnv("FTC_EVENTS_TOKEN", "t");
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(body(String(url))), { status: 200, headers: { "content-type": "application/json" } }));
  }

  it("keeps FIRST's scheduled field and records a corrected score once", async () => {
    const meta = bundle([]).event;
    feed({ red: 100, q2Field: "2" });
    expect(await syncEvent(meta)).toBe("first");
    expect(await all("SELECT number, field FROM matches WHERE code = 'EV' ORDER BY number")).toEqual([{ number: 1, field: "1" }, { number: 2, field: "2" }]);
    await syncEvent(meta); // same answers
    expect(await changes()).toEqual([]);
    feed({ red: 95, q2Field: "1" });
    await syncEvent(meta);
    await syncEvent(meta);
    const rows = await changes();
    expect(rows.map((r) => [r.kind, r.label, JSON.parse(r.fields)])).toEqual([["revised", "Q1", ["red.total", "red.np", "red.teleop"]], ["schedule", "Q2", ["field"]]]);
    expect([JSON.parse(rows[0].before).red.total, JSON.parse(rows[0].after).red.total]).toEqual([100, 95]);
  });
});

describe("API", () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { server.close(); });

  const getJson = async (path: string) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() as any, cache: r.headers.get("cache-control") }; };

  it("says an event isn't tracked yet before its first watched write", async () => {
    await run("INSERT INTO events (season, code, name, remote, hybrid, source) VALUES (?, 'OLD', 'Old', 0, 0, 'first')", [S]);
    const { status, body } = await getJson(`/api/events/${S}/old/result-changes`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ season: S, code: "OLD", match: null, trackedSince: null, changes: [], cap: RESULT_CHANGES_PER_EVENT, pruned: 0 });
  });

  it("lists an event's changes newest first, and one match's on its own", async () => {
    await writeEventBundle(bundle([m(1), m(2, { r: 70, b: 80 })]), { now: "2026-11-07T15:00:00.000Z" });
    await writeEventBundle(bundle([m(1, { r: 100, b: 90 }), m(2, { r: 75, b: 80 })]), { now: "2026-11-07T15:05:00.000Z" });
    await writeEventBundle(bundle([m(1, { r: 100, b: 90, time: "2026-11-07T09:44:00" }), m(2, { r: 75, b: 80, field: "2" })]), { now: "2026-11-07T15:10:00.000Z" });
    const ev = await getJson(`/api/events/${S}/EV/result-changes`);
    expect(ev.status).toBe(200);
    expect(ev.cache).toBe("no-cache");
    const view = ev.body as ResultChangesView;
    expect(view.trackedSince).toBe("2026-11-07T15:00:00.000Z");
    expect(view.lastChecked).not.toBeNull();
    expect(view.labels).toEqual(resultFieldLabels(S));
    expect(view.changes.map((c) => [c.kind, c.match.key, c.match.label, c.fields])).toEqual([
      ["schedule", "qual:0:2", "Q2", ["field"]],
      ["revised", "qual:0:2", "Q2", ["red.total", "red.np", "red.teleop"]],
      ["posted", "qual:0:1", "Q1", []],
    ]);
    // Public match data only: exactly these keys, nothing else.
    for (const c of view.changes) expect(Object.keys(c).sort()).toEqual(["after", "before", "checkedAt", "fields", "id", "kind", "match", "prevSource", "source"]);
    expect(Object.keys(view).sort()).toEqual(["cap", "changes", "code", "labels", "lastChecked", "match", "pruned", "season", "trackedSince"]);
    const revised = view.changes[1];
    if (revised.kind !== "revised") throw new Error("expected a revision");
    expect([revised.before.red.total, revised.after?.red.total]).toEqual([70, 75]);
    expect(revised).toMatchObject({ source: "first", prevSource: "first", checkedAt: "2026-11-07T15:05:00.000Z" });

    const one = await getJson(`/api/events/${S}/EV/matches/qual:0:1/result-changes`);
    expect(one.status).toBe(200);
    expect(one.body.match).toBe("qual:0:1");
    expect(one.body.changes.map((c: any) => c.kind)).toEqual(["posted"]);
    const none = await getJson(`/api/events/${S}/EV/matches/qual:0:9/result-changes`);
    expect(none.status).toBe(404);
  });

  it("rejects bad keys and unknown events", async () => {
    expect((await getJson(`/api/events/${S}/EV/matches/nope/result-changes`)).status).toBe(400);
    expect((await getJson(`/api/events/${S}/NOPE/result-changes`)).status).toBe(404);
  });
});
