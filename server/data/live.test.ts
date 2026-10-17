// The live fast lane and "Refresh results", on an in-memory database with the
// clock pinned and the network stubbed (liveIo): which events count as live
// (in their own time zone), the incremental follow-up after new results, the
// per-event rate limit, 409 for events that aren't on, and the writer lease
// that keeps the fast lane and the background cycle from writing at once.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbm from "../db";
import { all, get, kvGet, migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON } from "./seasons";
import { resetForecasters } from "../predict/engine";
import { loadSeason } from "../stats/load";
import { computeSeasonStats } from "../stats/job";
import { createApp } from "../app";
import type { EventRow } from "./bundle";
import { LockBusy, lockHolder, release, renew, tryAcquire, withDataLock } from "./lock";
import { MANUAL_REFRESH_MS, isEventDay, liveEvents, liveIo, liveTick, manualRefresh, refreshEvents, resetLiveState } from "./live";

const S = CURRENT_SEASON;
const TEAMS = [201, 202, 203, 204, 205, 206];
const CHICAGO = "America/Chicago"; // CST (UTC−6) on 2026-11-07
const SYDNEY = "Australia/Sydney"; // AEDT (UTC+11)
const NOW = Date.parse("2026-11-07T15:00:00Z"); // 09:00 in Chicago, 02:00 on the 8th in Sydney

async function event(code: string, start: string, timezone: string | null, o: { end?: string; type?: string } = {}) {
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'test')",
    [S, code, code, o.type ?? "Qualifier", start, o.end ?? start, timezone]);
  for (const t of TEAMS) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, code, t]);
}

async function match(code: string, number: number, time: string | null, red: number[], blue: number[], score?: [number, number]) {
  await run(
    `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
       blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, 10, ?, 5, 0, ?, ?, 10, ?, 5, 0, 'test')`,
    [S, code, number, `Q${number}`, time, score ? 1 : 0, score?.[0] ?? null, score?.[0] ?? null, score ? score[0] - 15 : null, score?.[1] ?? null, score?.[1] ?? null, score ? score[1] - 15 : null],
  );
  for (const [alliance, ts] of [["red", red], ["blue", blue]] as const) for (const t of ts)
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [S, code, number, t, alliance]);
}

/** A sync landing a result: what syncEvent's bundle write does to one match. */
async function postResult(code: string, number: number, red: number, blue: number) {
  await run("UPDATE matches SET played = 1, red_total = ?, red_np = ?, red_teleop = ?, blue_total = ?, blue_np = ?, blue_teleop = ? WHERE season = ? AND code = ? AND number = ?",
    [red, red, red - 15, blue, blue, blue - 15, S, code, number]);
}

const row = async (code: string): Promise<EventRow> => {
  const r = await get<any>("SELECT * FROM events WHERE season = ? AND code = ?", [S, code]);
  return { season: S, code: r.code, name: r.name, type: r.type, divisionCode: null, region: null, league: null, venue: null, city: null, state: null, country: null,
    start: r.start, end: r.end, timezone: r.timezone, remote: false, hybrid: false, website: null, livestream: null, source: r.source, upstreamUpdated: null };
};

// Network stubs: count calls, and let each test decide what FIRST "says".
let probeSays = true;
let fetches: string[] = [];
let onFetch: (e: EventRow) => Promise<void> = async () => {};
const realIo = { ...liveIo };

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterAll(() => { vi.useRealTimers(); Object.assign(liveIo, realIo); });

beforeEach(async () => {
  vi.setSystemTime(NOW);
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  resetForecasters();
  resetLiveState();
  probeSays = true; fetches = []; onFetch = async () => {};
  liveIo.canProbe = () => true;
  liveIo.probe = async () => probeSays;
  liveIo.fetch = async (e) => { fetches.push(e.code); await onFetch(e); return "first"; };

  // Two weeks earlier: a played event, so the ratings know these teams.
  await event("PRIOR", "2026-10-24", CHICAGO);
  let n = 0;
  for (let i = 0; i < TEAMS.length; i++) for (let j = 0; j < TEAMS.length; j++) {
    const red = [TEAMS[i], TEAMS[(i + 1) % 6]], blue = [TEAMS[j], TEAMS[(j + 2) % 6]];
    if (i === j || new Set([...red, ...blue]).size < 4) continue;
    n++;
    const strength = (ts: number[]) => 40 + ts.reduce((s, t) => s + (t - 200) * 4, 0);
    await match("PRIOR", n, `2026-10-24T${String(9 + Math.floor(n / 8)).padStart(2, "0")}:${String((n % 8) * 7).padStart(2, "0")}:00`, red, blue, [strength(red), strength(blue)]);
  }
  // On today in Chicago (09:00 there): Q1 started at 08:30 (no result yet), Q2 at 10:30.
  await event("LIVE", "2026-11-07", CHICAGO);
  await match("LIVE", 1, "2026-11-07T08:30:00", [201, 202], [203, 204]);
  await match("LIVE", 2, "2026-11-07T10:30:00", [205, 206], [201, 203]);
});

afterEach(async () => { await run("DELETE FROM kv WHERE key = 'lock:data-writer'").catch(() => {}); });

describe("which events are live", () => {
  const ev = (start: string, timezone: string | null, o: { end?: string; type?: string } = {}) => ({ start, end: o.end ?? start, timezone, type: o.type ?? "Qualifier" });

  it("goes by the event's own calendar date, not UTC's", () => {
    const t = Date.parse("2026-11-07T05:30:00Z"); // 23:30 on the 6th in Chicago, 16:30 on the 7th in Sydney
    expect(isEventDay(ev("2026-11-07", CHICAGO), t)).toBe(false); // not started there yet
    expect(isEventDay(ev("2026-11-06", CHICAGO), t)).toBe(true); // still the 6th there
    expect(isEventDay(ev("2026-11-07", SYDNEY), t)).toBe(true);
    expect(isEventDay(ev("2026-11-06", SYDNEY), t)).toBe(false); // over there
    // Sydney's day starts first: 13:00Z on the 7th is 00:00 on the 8th there.
    expect(isEventDay(ev("2026-11-08", SYDNEY), Date.parse("2026-11-07T13:00:00Z"))).toBe(true);
    expect(isEventDay(ev("2026-11-08", SYDNEY), Date.parse("2026-11-07T12:59:00Z"))).toBe(false);
  });

  it("counts every day of a multi-day event, and never event types without matches", () => {
    expect(isEventDay(ev("2026-11-06", CHICAGO, { end: "2026-11-08" }), NOW)).toBe(true);
    expect(isEventDay(ev("2026-11-07", CHICAGO, { type: "Kickoff" }), NOW)).toBe(false);
    expect(isEventDay(ev("2026-11-07", CHICAGO, { type: "Workshop" }), NOW)).toBe(false);
  });

  it("without a zone, counts while it's that date anywhere on Earth", () => {
    const t = Date.parse("2026-11-07T05:30:00Z");
    expect(isEventDay(ev("2026-11-07", null), t)).toBe(true);
    expect(isEventDay(ev("2026-11-06", null), t)).toBe(true); // still the 6th at UTC−12
    expect(isEventDay(ev("2026-11-08", null), t)).toBe(false); // 19:30 on the 7th at UTC+14
    expect(isEventDay(ev("2026-11-05", null), t)).toBe(false);
  });

  it("polls events on today until every match has a result and the awards are out", async () => {
    await event("NOSCHED", "2026-11-07", CHICAGO); // schedule not published yet: poll for it
    await event("QUALSDONE", "2026-11-07", CHICAGO); // all quals played, playoffs may follow
    await match("QUALSDONE", 1, "2026-11-07T08:00:00", [201, 202], [203, 204], [50, 40]);
    await event("OVER", "2026-11-07", CHICAGO);
    await match("OVER", 1, "2026-11-07T08:00:00", [201, 202], [203, 204], [50, 40]);
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, 'OVER', 'Winner', 1, 201)", [S]);
    await event("TOMORROW", "2026-11-08", CHICAGO);
    await event("KICK", "2026-11-07", CHICAGO, { type: "Kickoff" });
    await event("SYD", "2026-11-07", SYDNEY); // 02:00 on the 8th there: over
    expect((await liveEvents(NOW)).map((e) => e.code).sort()).toEqual(["LIVE", "NOSCHED", "QUALSDONE"]);
  });
});

describe("refreshing live events", () => {
  it("applies new results incrementally: event OPR, its teams' season rows, data version, live calls", async () => {
    await computeSeasonStats(S, await loadSeason(S)); // the last full run: ranks included
    const before = await get<any>("SELECT * FROM team_season_stats WHERE season = ? AND team = 201", [S]);
    expect(before.rank_np).not.toBeNull();
    expect(await all("SELECT * FROM team_event_stats WHERE season = ? AND code = 'LIVE'", [S])).toEqual([]);
    const version = await kvGet<string>("data:version");

    onFetch = async () => postResult("LIVE", 1, 90, 30); // FIRST published Q1
    const r = await refreshEvents([await row("LIVE")]);
    expect(r).toMatchObject({ checked: ["LIVE"], fetched: ["LIVE"], failed: [] });

    const tes = await all<any>("SELECT team, matches, wins, losses FROM team_event_stats WHERE season = ? AND code = 'LIVE' ORDER BY team", [S]);
    expect(tes.filter((t) => t.matches > 0).map((t) => [t.team, t.wins, t.losses])).toEqual([[201, 1, 0], [202, 1, 0], [203, 0, 1], [204, 0, 1]]);
    const after = await get<any>("SELECT * FROM team_season_stats WHERE season = ? AND team = 201", [S]);
    expect(after.matches).toBe(before.matches + 1);
    expect(after.events).toBe(before.events + 1);
    expect(after.rank_np).toBe(before.rank_np); // world ranks: left to the full run
    expect(after.rating_np).not.toBe(before.rating_np); // ratings moved with the new result
    expect(await kvGet<string>("data:version")).not.toBe(version);
    expect(await kvGet<string>("data:settled")).toBe(new Date(NOW).toISOString()); // the follow-up's writes are done
    expect(Date.parse((await get<any>("SELECT live_checked_at FROM events WHERE season = ? AND code = 'LIVE'", [S])).live_checked_at)).toBe(NOW);

    // Q2 (10:30 there) gets its pre-match call now, from ratings that include Q1.
    expect(r.logged).toBe(1);
    const call = await get<any>("SELECT * FROM predictions WHERE kind = 'live' AND code = 'LIVE'");
    expect(call).toMatchObject({ number: 2, red: "[205,206]", blue: "[201,203]", outcome: null });
    expect(Date.parse(call.predicted_at)).toBe(NOW);

    // After Q2 plays: the result is attached to the call.
    vi.setSystemTime(Date.parse("2026-11-07T16:40:00Z"));
    onFetch = async () => postResult("LIVE", 2, 20, 70);
    const r2 = await refreshEvents([await row("LIVE")]);
    expect(r2.scored).toBe(1);
    expect(await get<any>("SELECT outcome, red_score, blue_score FROM predictions WHERE kind = 'live' AND code = 'LIVE'")).toMatchObject({ outcome: 0, red_score: 20, blue_score: 70 });
  });

  it("asks FIRST cheaply when nothing moved, and fetches in full only on a change or every few minutes", async () => {
    await refreshEvents([await row("LIVE")]); // first sight: full fetch
    expect(fetches).toEqual(["LIVE"]);
    const v = await kvGet<string>("data:version");
    probeSays = false;
    vi.setSystemTime(NOW + 60_000);
    const r = await refreshEvents([await row("LIVE")]);
    expect(r.fetched).toEqual([]);
    expect(fetches).toHaveLength(1);
    expect(await kvGet<string>("data:version")).toBe(v); // nothing new: pages and ratings left alone
    expect(Date.parse((await get<any>("SELECT live_checked_at FROM events WHERE code = 'LIVE'")).live_checked_at)).toBe(NOW + 60_000); // but "checked just now"
    probeSays = true;
    vi.setSystemTime(NOW + 120_000);
    await refreshEvents([await row("LIVE")]);
    expect(fetches).toHaveLength(2);
    probeSays = false;
    vi.setSystemTime(NOW + 120_000 + 5 * 60_000); // rankings/awards have no change marker: full fetch every 5 min
    await refreshEvents([await row("LIVE")]);
    expect(fetches).toHaveLength(3);
  });

  it("a failed fetch keeps the change for the next tick (markers don't move until it's stored)", async () => {
    // FIRST-like probe: "changed" only when the marker differs from the last one recorded.
    liveIo.probe = async (_e, st) => { const prev = st.marks.get("m"); st.marks.set("m", "v2"); return prev !== "v2"; };
    let fail = true;
    liveIo.fetch = async (e) => { if (fail) throw new Error("FIRST 500"); fetches.push(e.code); return "first"; };
    vi.setSystemTime(NOW);
    expect((await refreshEvents([await row("LIVE")], { minFullMs: 3600_000 })).failed).toHaveLength(1);
    fail = false;
    vi.setSystemTime(NOW + 60_000);
    expect((await refreshEvents([await row("LIVE")], { minFullMs: 3600_000 })).fetched).toEqual(["LIVE"]); // retried at once, not after 5 min
  });

  it("a failed probe doesn't block a due full fetch; when nothing is due it fails without claiming a check", async () => {
    liveIo.probe = async () => { throw new Error("schedule 500"); };
    const r = await refreshEvents([await row("LIVE")]); // first sight: due
    expect(r).toMatchObject({ fetched: ["LIVE"], checked: ["LIVE"], failed: [] });
    vi.setSystemTime(NOW + 60_000);
    const r2 = await refreshEvents([await row("LIVE")]); // not due, probe fails
    expect(r2.failed).toEqual([{ code: "LIVE", error: "schedule 500" }]);
    expect(Date.parse((await get<any>("SELECT live_checked_at FROM events WHERE code = 'LIVE'")).live_checked_at)).toBe(NOW);
  });

  it("without FIRST credentials, 'updated' moves only when FTC Scout is actually fetched", async () => {
    liveIo.canProbe = () => false;
    await refreshEvents([await row("LIVE")]);
    vi.setSystemTime(NOW + 60_000);
    const r = await refreshEvents([await row("LIVE")]); // between the 5-minute fetches: nothing asked
    expect(r).toMatchObject({ fetched: [], checked: [], failed: [] });
    expect(Date.parse((await get<any>("SELECT live_checked_at FROM events WHERE code = 'LIVE'")).live_checked_at)).toBe(NOW);
  });

  it("a team dropped by a corrected lineup loses those matches from its season totals", async () => {
    // FIRST first lists 299 in Q1 (in place of 201), and the result lands.
    await run("UPDATE match_teams SET team = 299 WHERE season = ? AND code = 'LIVE' AND number = 1 AND team = 201", [S]);
    onFetch = async () => postResult("LIVE", 1, 90, 30);
    await refreshEvents([await row("LIVE")]);
    expect((await get<any>("SELECT matches FROM team_season_stats WHERE season = ? AND team = 299", [S]))?.matches).toBe(1);
    // The corrected lineup: it was 201 after all. 299 played nothing else this season.
    onFetch = async () => { await run("UPDATE match_teams SET team = 201 WHERE season = ? AND code = 'LIVE' AND number = 1 AND team = 299", [S]); };
    vi.setSystemTime(NOW + 6 * 60_000);
    await refreshEvents([await row("LIVE")]);
    expect(await get("SELECT matches FROM team_season_stats WHERE season = ? AND team = 299", [S])).toBeFalsy();
  });

  it("a probe that fails after another one wrote its marker leaves the old markers (the change is seen again)", async () => {
    let fail = true;
    liveIo.probe = async (_e, st) => { const prev = st.marks.get("m"); st.marks.set("m", "v2"); if (fail) throw new Error("schedule 500"); return prev !== "v2"; };
    await refreshEvents([await row("LIVE")]); // first sight: full fetch (due), probe failed
    fail = false;
    vi.setSystemTime(NOW + 60_000);
    const r = await refreshEvents([await row("LIVE")], { minFullMs: 3600_000 });
    expect(r.fetched).toEqual(["LIVE"]); // "v2" was never committed: still a change
  });

  it("rewrites the season's record tables with new results at most every 5 minutes", async () => {
    onFetch = async () => postResult("LIVE", 1, 90, 30);
    await refreshEvents([await row("LIVE")]);
    expect((await get<any>("SELECT played FROM team_event_records WHERE season = ? AND code = 'LIVE' AND team = 201", [S]))?.played).toBe(1);
    onFetch = async () => postResult("LIVE", 2, 20, 70);
    vi.setSystemTime(NOW + 60_000);
    await refreshEvents([await row("LIVE")], { minFullMs: 0 });
    expect((await get<any>("SELECT played FROM team_event_records WHERE season = ? AND code = 'LIVE' AND team = 201", [S]))?.played).toBe(1); // within 5 min: not yet
    vi.setSystemTime(NOW + 6 * 60_000);
    onFetch = async () => {};
    await refreshEvents([await row("LIVE")], { minFullMs: 0 });
    expect((await get<any>("SELECT played FROM team_event_records WHERE season = ? AND code = 'LIVE' AND team = 201", [S]))?.played).toBe(2);
  });

  it("a failing event doesn't stop the others", async () => {
    await event("OTHER", "2026-11-07", CHICAGO);
    liveIo.fetch = async (e) => { if (e.code === "LIVE") throw new Error("FIRST 500"); fetches.push(e.code); return "first"; };
    const r = await refreshEvents([await row("LIVE"), await row("OTHER")]);
    expect(r.fetched).toEqual(["OTHER"]);
    expect(r.failed).toEqual([{ code: "LIVE", error: "FIRST 500" }]);
  });
});

describe("Refresh results (manual)", () => {
  it("does one real refresh per event per 20 s; extra clicks get the latest state", async () => {
    expect(await manualRefresh(S, "LIVE")).toEqual({ status: "refreshed", fetched: true });
    vi.setSystemTime(NOW + 5_000);
    expect(await manualRefresh(S, "LIVE")).toEqual({ status: "recent" });
    vi.setSystemTime(NOW + MANUAL_REFRESH_MS - 1);
    expect(await manualRefresh(S, "LIVE")).toEqual({ status: "recent" });
    expect(fetches).toHaveLength(1);
    vi.setSystemTime(NOW + MANUAL_REFRESH_MS);
    expect((await manualRefresh(S, "LIVE")).status).toBe("refreshed");
    expect(fetches).toHaveLength(2);
  });

  it("clicks that arrive while a refresh is running share it", async () => {
    let finish!: () => void;
    onFetch = () => new Promise<void>((r) => { finish = r; });
    const a = manualRefresh(S, "LIVE"), b = manualRefresh(S, "LIVE");
    await vi.waitFor(() => expect(fetches).toHaveLength(1));
    finish();
    expect(await a).toEqual({ status: "refreshed", fetched: true });
    expect(await b).toEqual({ status: "refreshed", fetched: true });
    expect(fetches).toHaveLength(1);
  });

  it("only for events on today", async () => {
    expect(await manualRefresh(S, "PRIOR")).toEqual({ status: "not-live" });
    expect(await manualRefresh(S, "NOPE")).toEqual({ status: "not-found" });
    expect(fetches).toEqual([]);
  });

  describe("over HTTP", () => {
    let server: Server;
    let base = "";
    beforeEach(async () => {
      server = createApp().listen(0);
      await new Promise((r) => server.once("listening", r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(() => { server.close(); });
    const post = (path: string) => fetch(base + path, { method: "POST" });

    it("409 for an event that isn't on, 404 for none", async () => {
      const r = await post(`/api/events/${S}/PRIOR/refresh`);
      expect(r.status).toBe(409);
      expect((await r.json()).error).toMatch(/on today/);
      expect((await post(`/api/events/${S}/NOPE/refresh`)).status).toBe(404);
    });

    it("returns the fresh event, with when FIRST was last checked", async () => {
      onFetch = async () => postResult("LIVE", 1, 90, 30);
      const r = await post(`/api/events/${S}/LIVE/refresh`);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      const body = await r.json();
      expect(body.outcome).toBe("refreshed");
      expect(body.message).toMatch(/Updated from FIRST/);
      expect(body.detail.event.matchesPlayed).toBe(1);
      expect(Date.parse(body.detail.live.checkedAt)).toBe(NOW);
      expect(body.detail.live.everySeconds).toBe(60);
      expect(typeof body.detail.live.auto).toBe("boolean");
      const again = await (await post(`/api/events/${S}/LIVE/refresh`)).json();
      expect(again.outcome).toBe("recent");
      expect(again.detail.event.matchesPlayed).toBe(1);
    });

    it("live event pages revalidate on every load; other days keep the normal cache", async () => {
      const live = await fetch(`${base}/api/events/${S}/LIVE`);
      expect(live.headers.get("cache-control")).toBe("no-cache");
      expect((await live.json()).live).not.toBeNull();
      const past = await fetch(`${base}/api/events/${S}/PRIOR`);
      expect(past.headers.get("cache-control")).toContain("max-age=60");
      expect((await past.json()).live).toBeNull();
    });
  });
});

describe("one writer at a time", () => {
  it("a held lease can't be taken; released, it can", async () => {
    const a = await tryAcquire("cycle", 60_000);
    expect(a).toBeTruthy();
    expect(await tryAcquire("live", 60_000)).toBeNull();
    expect((await lockHolder())?.what).toBe("cycle");
    await release(a!);
    expect(await lockHolder()).toBeNull();
    expect(await tryAcquire("live", 60_000)).toBeTruthy();
  });

  it("while the lease is held, trying for it only reads (no write to queue behind the holder's long transactions)", async () => {
    const a = await tryAcquire("cycle", 60_000);
    const c = dbm.db();
    const real = c.execute.bind(c);
    const writes: string[] = [];
    (c as any).execute = (s: any) => { const sql = String(s?.sql ?? s); if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql); return real(s); };
    try { expect(await tryAcquire("live", 60_000)).toBeNull(); }
    finally { (c as any).execute = real; }
    expect(writes).toEqual([]);
    await release(a!);
  });

  it("a database busy past its timeout counts as held, not as a failure", async () => {
    const c = dbm.db();
    const real = c.execute.bind(c);
    (c as any).execute = (s: any) => { if (/INSERT INTO kv/.test(String(s?.sql ?? s))) return Promise.reject(Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" })); return real(s); };
    try { expect(await tryAcquire("live", 60_000)).toBeNull(); }
    finally { (c as any).execute = real; }
  });

  it("a tick cut short by a busy database is quiet, and the next one finishes the follow-up", async () => {
    // Q1's result arrives; storing the new data version then hits a busy database.
    onFetch = async () => postResult("LIVE", 1, 90, 30);
    const c = dbm.db();
    const real = c.execute.bind(c);
    let busy = true;
    (c as any).execute = (st: any) => {
      const sql = String(st?.sql ?? st), args = (st?.args ?? []) as unknown[];
      if (busy && /^INSERT INTO kv/.test(sql) && args[0] === "data:version") return Promise.reject(Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" }));
      return real(st);
    };
    try {
      const v0 = await kvGet<string>("data:version");
      await expect(liveTick()).resolves.toBeNull(); // no "live sync failed"
      expect(await kvGet<string>("data:version")).toBe(v0);
      expect(await get("SELECT 1 FROM team_event_stats WHERE season = ? AND code = 'LIVE' AND matches > 0", [S])).toBeFalsy();
      // Next tick: FIRST reports nothing new (the result is already stored) and no full fetch is due…
      busy = false; probeSays = false; onFetch = async () => {};
      vi.setSystemTime(NOW + 60_000);
      await liveTick();
      // …but the follow-up is made up: new data version, stats with Q1.
      expect(await kvGet<string>("data:version")).not.toBe(v0);
      expect((await get<any>("SELECT wins FROM team_event_stats WHERE season = ? AND code = 'LIVE' AND team = 201", [S]))?.wins).toBe(1);
    } finally { (c as any).execute = real; }
  });

  it("an expired lease (crashed holder) is taken over, and the old holder can't renew or release it", async () => {
    const old = await tryAcquire("cycle", 1000);
    vi.setSystemTime(NOW + 1001);
    const fresh = await tryAcquire("live", 60_000);
    expect(fresh).toBeTruthy();
    expect(await renew(old!, 60_000)).toBe(false);
    await release(old!);
    expect((await lockHolder())?.what).toBe("live");
  });

  it("the fast lane skips its tick while the cycle writes", async () => {
    const t = await tryAcquire("cycle", 60_000);
    expect(await liveTick()).toBeNull();
    expect(fetches).toEqual([]);
    await release(t!);
    expect((await liveTick())?.fetched).toEqual(["LIVE"]);
    expect(await lockHolder()).toBeNull(); // released after the tick
  });

  it("a manual refresh waits briefly for the lease, then says the cycle is on it", async () => {
    const t = await tryAcquire("cycle", 60_000);
    expect(await manualRefresh(S, "LIVE", { waitMs: 50 })).toEqual({ status: "busy" });
    expect(fetches).toEqual([]);
    await release(t!);
    expect((await manualRefresh(S, "LIVE")).status).toBe("refreshed"); // busy didn't count against the 20 s limit
  });

  it("withDataLock waits for the holder to finish, and never runs two writers at once", async () => {
    let active = 0, peak = 0;
    const job = (ms: number) => async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, ms)); active--; };
    await Promise.all([
      withDataLock("cycle", job(60), { waitMs: 2000, pollMs: 5 }),
      withDataLock("live", job(10), { waitMs: 2000, pollMs: 5 }),
      withDataLock("manual", job(10), { waitMs: 2000, pollMs: 5 }),
    ]);
    expect(peak).toBe(1);
    const t = await tryAcquire("cycle", 60_000);
    await expect(withDataLock("live", job(1))).rejects.toBeInstanceOf(LockBusy);
    await release(t!);
  });
});
