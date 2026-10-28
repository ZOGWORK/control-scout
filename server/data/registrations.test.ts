// FIRST's pre-event registrations: read for upcoming events with no team list, kept apart from event_teams, and
// shown as the event's teams (ahead of a regional site's provisional list) until rankings or a schedule exist.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, get, kvSet, migrate, openDb, run, setDb, writeBatch } from "../db";
import { clearAllCaches } from "../caches";
import { eventDetail, eventSummary } from "../api/events";
import { bundleStatements } from "./bundle";
import { eventRowFromFirst } from "../sources/first";
import { syncFtcNj } from "./provisional";
import { ROSTER, sessionPairs, syncRegistrations } from "./registrations";

const S = 2026;
const NOW = new Date("2026-10-27T12:00:00Z");
const njHtml = readFileSync(fileURLToPath(new URL("../sources/fixtures/ftcnj-upcoming-2026-10-27.html", import.meta.url)), "utf8");

beforeAll(() => { process.env.FTC_EVENTS_USERNAME ??= "u"; process.env.FTC_EVENTS_TOKEN ??= "t"; }); // fetch is stubbed: no real request
afterEach(() => { vi.unstubAllGlobals(); });

const team = (n: number, name: string) => ({ teamNumber: n, nameShort: name, nameFull: `Sponsor&${name} High`, city: "Hightstown", stateProv: "NJ", country: "USA", rookieYear: 2009, homeRegion: "USNJ" });

/** FIRST answers /teams?eventCode=X from `lists` (a missing code is a 404); every requested path is recorded. */
function first(lists: Record<string, unknown[] | number>) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const u = new URL(url);
    seen.push(`${u.pathname}${u.search}`);
    const l = lists[u.searchParams.get("eventCode") ?? ""];
    if (l == null) return new Response("not found", { status: 404 });
    if (typeof l === "number") return new Response("x", { status: l });
    // "NOLIST": a 200 without a teams array; "SHORT": fewer teams than FIRST's own count.
    if (u.searchParams.get("eventCode") === "NOLIST") return Response.json({ pageCurrent: 1, pageTotal: 1 });
    if (u.searchParams.get("eventCode") === "SHORT") return Response.json({ teams: l, teamCountTotal: 5, pageCurrent: 1, pageTotal: 1 });
    // "PAGED": page 1 of 2, and page 2 is missing.
    if (u.searchParams.get("eventCode") === "PAGED") return u.searchParams.get("page") === "1" ? Response.json({ teams: l, pageCurrent: 1, pageTotal: 2 }) : new Response("gone", { status: 404 });
    return Response.json({ teams: l, teamCountTotal: l.length, teamCountPage: l.length, pageCurrent: 1, pageTotal: 1 });
  });
  return seen;
}

async function event(code: string, start: string, o: { type?: string; region?: string } = {}) {
  await run("INSERT INTO events (season, code, name, type, region, venue, city, state, start, end, remote, hybrid, source) VALUES (?, ?, ?, ?, ?, 'Gym', 'Piscataway', 'NJ', ?, ?, 0, 0, 'first')",
    [S, code, `${code} meet`, o.type ?? "LeagueMeet", o.region ?? "USGA", start, start]);
}

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  await kvSet("data:version", "v1");
  await run("INSERT INTO teams (number, name, city, state) VALUES (3944, 'Team Mercury', 'Princeton', 'NJ')");
});

describe("syncRegistrations", () => {
  it("reads only upcoming events in the window with no team list, and stores them apart from event_teams", async () => {
    await event("SOON", "2026-10-31");
    await event("TODAY", "2026-10-27");
    await event("PAST", "2026-10-20");
    await event("LATER", "2026-12-01");
    await event("KICK", "2026-10-30", { type: "Kickoff" });
    await event("RANKED", "2026-10-29");
    await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'RANKED', 1)", [S]);
    const seen = first({ SOON: [team(3944, "Team Mercury"), team(8421, "Tigers")], TODAY: [] });
    const r = await syncRegistrations(S, { now: NOW, skipTypes: ["Kickoff"] });
    expect(seen.map((p) => new URLSearchParams(p.split("?")[1]).get("eventCode")).sort()).toEqual(["SOON", "TODAY"]);
    expect(r).toEqual({ events: 2, withTeams: 1, teams: 2, failed: [] });
    expect(await all<any>("SELECT code, team FROM event_registrations ORDER BY team")).toEqual([{ code: "SOON", team: 3944 }, { code: "SOON", team: 8421 }]);
    expect(await all("SELECT * FROM event_teams WHERE code = 'SOON'")).toHaveLength(0);
    // A known team's FIRST name and home are merged in; a new one is added (with its season, so it has a team page).
    expect(await get<any>("SELECT name, city FROM teams WHERE number = 3944")).toEqual({ name: "Team Mercury", city: "Hightstown" });
    expect(await get<any>("SELECT name FROM teams WHERE number = 8421")).toEqual({ name: "Tigers" });
    expect(await get("SELECT 1 x FROM team_seasons WHERE season = ? AND team = 8421", [S])).toBeTruthy();
  });

  it("replaces an event's list on each read; a 404 or a failed read keeps it; an empty list clears it", async () => {
    await event("A", "2026-10-31");
    await event("B", "2026-10-31");
    first({ A: [team(1, "One"), team(2, "Two")], B: [team(3, "Three")] });
    await syncRegistrations(S, { now: NOW });
    first({ A: [team(2, "Two")], B: 400 }); // FIRST's "no data" errors fail at once
    const r = await syncRegistrations(S, { now: NOW, force: true });
    expect(r.failed).toHaveLength(1);
    expect(await all<any>("SELECT code, team FROM event_registrations ORDER BY code, team")).toEqual([{ code: "A", team: 2 }, { code: "B", team: 3 }]);
    first({ A: [] }); // B: 404
    await syncRegistrations(S, { now: NOW, force: true });
    expect(await all<any>("SELECT code, team FROM event_registrations ORDER BY code, team")).toEqual([{ code: "B", team: 3 }]);
  });

  it.each(["PAGED", "NOLIST", "SHORT"])("an incomplete answer (%s) keeps the stored list (never half a list)", async (code) => {
    await event(code, "2026-10-31");
    await run("INSERT INTO event_registrations (season, code, team, fetched_at) VALUES (?, ?, 1, 'x'), (?, ?, 2, 'x')", [S, code, S, code]);
    first({ [code]: [team(1, "One")] });
    const r = await syncRegistrations(S, { now: NOW });
    expect(r.failed).toHaveLength(1);
    expect(await all<any>("SELECT team FROM event_registrations ORDER BY team")).toEqual([{ team: 1 }, { team: 2 }]);
  });

  it("reads at most every 6 hours", async () => {
    await event("A", "2026-10-31");
    const seen = first({ A: [team(1, "One")] });
    await syncRegistrations(S, { now: NOW });
    expect(await syncRegistrations(S, { now: new Date(NOW.getTime() + 5 * 3600_000) })).toMatchObject({ skipped: "read recently" });
    expect(seen).toHaveLength(1);
    await syncRegistrations(S, { now: new Date(NOW.getTime() + 7 * 3600_000) });
    expect(seen).toHaveLength(2);
  });
});

describe("event page", () => {
  it("shows the registered teams as the field, counted, and marked as registrations", async () => {
    await event("SOON", "2026-10-31");
    first({ SOON: [team(3944, "Team Mercury"), team(8421, "Tigers")] });
    await syncRegistrations(S, { now: NOW });
    const d = (await eventDetail(S, "SOON"))!;
    expect(d.field.map((f) => [f.team, f.name, f.rank])).toEqual([[3944, "Team Mercury", null], [8421, "Tigers", null]]);
    expect(d.event.teams).toBe(2);
    expect(d.registered).toEqual({ fetchedAt: NOW.toISOString() });
    expect((await eventSummary(S, "SOON"))!.teams).toBe(2);
  });

  it("gives way to event_teams once rankings or a schedule arrive", async () => {
    await event("SOON", "2026-10-31");
    first({ SOON: [team(3944, "Team Mercury"), team(8421, "Tigers")] });
    await syncRegistrations(S, { now: NOW });
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, 'SOON', 3944, 1)", [S]);
    const d = (await eventDetail(S, "SOON"))!;
    expect(d.field.map((f) => f.team)).toEqual([3944]);
    expect(d.event.teams).toBe(1);
    expect(d.registered).toBeNull();
  });

  it("on an NJ event, FIRST's list takes the place of FTC New Jersey's provisional one", async () => {
    await run("INSERT INTO events (season, code, name, type, region, league, start, end, remote, hybrid, source) VALUES (?, 'USNJCENM7', 'P1-3 Central League Meet', 'LeagueMeet', 'USNJ', 'CEN', '2026-10-31', '2026-10-31', 0, 0, 'first')", [S]);
    await syncFtcNj(S, { html: njHtml, now: NOW });
    expect((await eventDetail(S, "USNJCENM7"))!.provisional).not.toBeNull();
    first({ USNJCENM7: [team(3944, "Team Mercury")] });
    await syncRegistrations(S, { now: NOW });
    const d = (await eventDetail(S, "USNJCENM7"))!;
    expect(d.provisional).toBeNull();
    expect(d.registered).not.toBeNull();
    expect(d.field.map((f) => f.team)).toEqual([3944]);
  });
});

describe("event address", () => {
  it("keeps FIRST's street address, and a list refresh without one doesn't blank it", async () => {
    const row = eventRowFromFirst(S, { code: "X", name: "X", typeName: "League Meet", venue: "Timothy Christian School", address: "13 Ethel Road", city: "Piscataway", stateprov: "NJ", dateStart: "2026-10-31T00:00:00" });
    await writeBatch(bundleStatements({ event: row, teams: [], detail: null }));
    expect((await eventDetail(S, "X"))!.event.address).toBe("13 Ethel Road");
    await writeBatch(bundleStatements({ event: { ...row, address: undefined }, teams: [], detail: null }));
    expect((await get<any>("SELECT address FROM events WHERE code = 'X'"))!.address).toBe("13 Ethel Road");
  });
});

describe("AM/PM sessions", () => {
  const nj = (code: string, name: string, start: string, league = "NE") =>
    run("INSERT INTO events (season, code, name, type, region, league, start, end, remote, hybrid, source) VALUES (?, ?, ?, 'LeagueMeet', 'USNJ', ?, ?, ?, 0, 0, 'first')", [S, code, name, league, start, start]);
  // FIRST's real answer for Nov 7 (2026-10-28): both sessions' teams under the AM code, none under the PM one.
  const BOTH = [12636, 12853, 13103, 13105, 13617, 15715, 19477, 20848, 10243, 13107, 18757, 18760, 23545, 23694, 23375, 23717, 33950];
  const PM_ON_PAGE = [10243, 13107, 18757, 18760, 23545, 23694];

  it("pairs two same-day events whose names differ only by AM/PM, one naming no session at most", () => {
    const pairs = sessionPairs([
      { code: "NEM2", name: "P1-5 AM Northeast League Meet", start: "2026-11-07" },
      { code: "NEM3", name: "P1-5 PM Northeast League Meet", start: "2026-11-07" },
      { code: "CENM2", name: "P2-4 AM Central League Meet", start: "2026-11-22" },
      { code: "CENM3", name: "P2-4 Central League Meet", start: "2026-11-22" },
      { code: "SOM2", name: "P1-6 Southern League Meet", start: "2026-11-08" },
      { code: "X1", name: "P9 Northern League Meet", start: "2026-12-01" },
      { code: "X2", name: "P9 Northern League Meet", start: "2026-12-01" },
      { code: "OTHERDAY", name: "P1-5 PM Northeast League Meet", start: "2026-11-08" },
    ]);
    expect(pairs.get("NEM2")?.code).toBe("NEM3");
    expect(pairs.get("NEM3")?.code).toBe("NEM2");
    expect(pairs.get("CENM3")?.code).toBe("CENM2");
    expect(pairs.has("SOM2") || pairs.has("X1") || pairs.has("OTHERDAY")).toBe(false);
  });

  it("never shows FIRST's list for both sessions as one session's teams; each session shows FTC New Jersey's split", async () => {
    await nj("USNJNEM2", "P1-5 AM Northeast League Meet", "2026-11-07");
    await nj("USNJNEM3", "P1-5 PM Northeast League Meet", "2026-11-07");
    await syncFtcNj(S, { html: njHtml, now: NOW });
    first({ USNJNEM2: BOTH.map((n) => team(n, `T${n}`)), USNJNEM3: [] });
    await syncRegistrations(S, { now: NOW });
    for (const code of ["USNJNEM2", "USNJNEM3"]) {
      const d = (await eventDetail(S, code))!;
      expect(d.field).toEqual([]);
      expect(d.event.teams).toBe(0);
      expect(d.registered).toBeNull();
      expect((await eventSummary(S, code))!.teams).toBe(0);
      expect(d.sharedSessions!.teams.map((t) => t.team)).toEqual([...BOTH].sort((a, b) => a - b));
      expect(d.sharedSessions!.other.code).toBe(code === "USNJNEM2" ? "USNJNEM3" : "USNJNEM2");
    }
    // The session split the NJ page gives: no PM team in the AM session, and the waitlist marked pending in both.
    const am = (await eventDetail(S, "USNJNEM2"))!.provisional!;
    expect(am.teams.filter((t) => t.status === "registered").map((t) => t.team)).toEqual([12636, 12853, 13103, 13105, 13617, 15715, 19477, 20848]);
    expect(am.teams.some((t) => PM_ON_PAGE.includes(t.team))).toBe(false);
    const pm = (await eventDetail(S, "USNJNEM3"))!.provisional!;
    expect(pm.teams.filter((t) => t.status === "registered").map((t) => t.team)).toEqual(PM_ON_PAGE);
    expect(pm.teams.filter((t) => t.status === "pending").map((t) => t.team)).toEqual([4215, 6980, 8902, 11124, 23314, 23717, 33950, 36142]);
    // Scout assignments and the share title count only a session's own list, so nothing there either.
    expect(await all(`SELECT team FROM ${ROSTER} et WHERE et.season = ? AND et.code = 'USNJNEM2'`, [S])).toEqual([]);
  });

  it("trusts FIRST once each session has its own list, and an unpaired event's list as always", async () => {
    await nj("A_AM", "P7 AM Central League Meet", "2026-10-31", "CEN");
    await nj("A_PM", "P7 PM Central League Meet", "2026-10-31", "CEN");
    await nj("SOLO", "P8 Central League Meet", "2026-10-31", "CEN");
    first({ A_AM: [team(1, "One"), team(2, "Two")], A_PM: [team(3, "Three")], SOLO: [team(4, "Four")] });
    await syncRegistrations(S, { now: NOW });
    expect((await eventDetail(S, "A_AM"))!.field.map((f) => f.team)).toEqual([1, 2]);
    expect((await eventDetail(S, "A_PM"))!.field.map((f) => f.team)).toEqual([3]);
    expect((await eventDetail(S, "A_AM"))!.sharedSessions).toBeNull();
    expect((await eventDetail(S, "SOLO"))!.field.map((f) => f.team)).toEqual([4]);
    // The same list on both sessions is the pair's, not each session's.
    first({ A_AM: [team(1, "One"), team(2, "Two")], A_PM: [team(1, "One"), team(2, "Two")] });
    await syncRegistrations(S, { now: NOW, force: true });
    expect((await eventDetail(S, "A_PM"))!.field).toEqual([]);
    expect((await eventDetail(S, "A_PM"))!.sharedSessions!.teams.map((t) => t.team)).toEqual([1, 2]);
  });
});
