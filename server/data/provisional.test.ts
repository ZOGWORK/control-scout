// FTC New Jersey's registered teams and details: stored under FIRST's event codes without touching FIRST's
// fields, shown on the event page only until FIRST posts a team list or a schedule.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { all, get, kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { eventDetail } from "../api/events";
import { syncFtcNj } from "./provisional";

const html = readFileSync(fileURLToPath(new URL("../sources/fixtures/ftcnj-upcoming-2026-10-27.html", import.meta.url)), "utf8");
const S = 2026;

async function firstEvent(code: string, name: string, league: string, start: string) {
  await run("INSERT INTO events (season, code, name, type, region, league, venue, city, state, start, end, remote, hybrid, source) VALUES (?, ?, ?, 'LeagueMeet', 'USNJ', ?, 'FIRST venue', 'Piscataway', 'NJ', ?, ?, 0, 0, 'first')",
    [S, code, name, league, start, start]);
}

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  await kvSet("data:version", "v1");
  await firstEvent("USNJCENM7", "P1-3 Central League Meet", "CEN", "2026-10-31");
  await firstEvent("USNJNEM2", "P1-5 AM Northeast League Meet", "NE", "2026-11-07");
  await firstEvent("USNJNEM3", "P1-5 PM Northeast League Meet", "NE", "2026-11-07");
  await run("INSERT INTO teams (number, name, city, state) VALUES (3944, 'Team Mercury (FIRST)', 'Princeton', 'NJ')");
});

describe("FTC NJ sync", () => {
  it("stores each matched event's details and teams, and leaves FIRST's event row alone", async () => {
    const before = await get<any>("SELECT * FROM events WHERE season = ? AND code = 'USNJCENM7'", [S]);
    const r = await syncFtcNj(S, { html });
    expect(r).toMatchObject({ events: 30, matched: 3 });
    expect(r.unmatched).toHaveLength(28);
    expect(await get<any>("SELECT * FROM events WHERE season = ? AND code = 'USNJCENM7'", [S])).toEqual(before);
    expect(await all("SELECT * FROM event_teams")).toHaveLength(0);
    const rows = await all<any>("SELECT code, address, json_array_length(teams) n FROM event_provisional ORDER BY code");
    expect(rows).toEqual([
      { code: "USNJCENM7", address: "13 Ethel Road, Piscataway, NJ 08854", n: 16 },
      { code: "USNJNEM2", address: "492 Franklin Turnpike, Ramsey, NJ", n: 16 },
      { code: "USNJNEM3", address: "492 Franklin Turnpike, Ramsey, NJ", n: 14 },
    ]);
  });

  it("skips another season's page and keeps the last good copy", async () => {
    await syncFtcNj(S, { html });
    expect(await syncFtcNj(S, { html: html.replaceAll("2026/2027", "2027/2028") })).toMatchObject({ skipped: "page is for 2027" });
    expect(await syncFtcNj(S, { html: "<p>Under construction for 2026/2027 season</p>" })).toMatchObject({ skipped: "no events on the page" });
    expect(await all("SELECT code FROM event_provisional")).toHaveLength(3);
  });

  it("a page cut short keeps the events it no longer shows", async () => {
    await syncFtcNj(S, { html });
    const cut = html.slice(0, html.indexOf("Nov. 1, 2026"));
    expect(await syncFtcNj(S, { html: cut })).toMatchObject({ events: 1, matched: 1 });
    expect((await all<any>("SELECT code FROM event_provisional ORDER BY code")).map((r) => r.code)).toEqual(["USNJCENM7", "USNJNEM2", "USNJNEM3"]);
  });

  it("reads the page once a day, failed reads included", async () => {
    await kvSet("sync:ftcnj:2026", new Date().toISOString());
    expect(await syncFtcNj(S, { now: new Date() })).toMatchObject({ skipped: "read recently" });
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response("down", { status: 503 }); }) as typeof fetch;
    try {
      const later = new Date(Date.now() + 25 * 3600_000);
      await expect(syncFtcNj(S, { now: later })).rejects.toThrow("HTTP 503");
      expect(await syncFtcNj(S, { now: new Date(later.getTime() + 60_000) })).toMatchObject({ skipped: "read recently" });
      expect(calls).toBe(1);
    } finally { globalThis.fetch = realFetch; }
  });
});

describe("event page", () => {
  it("shows the NJ list, with FIRST's names, while FIRST has no team list or schedule", async () => {
    await syncFtcNj(S, { html });
    const p = (await eventDetail(S, "USNJCENM7"))!.provisional!;
    expect(p).toMatchObject({ sourceName: "FTC New Jersey", url: "https://www.newjerseyftc.com/upcoming-events.html", capacity: "24", closed: false, sessionUnknown: false });
    expect(p.teams[0]).toEqual({ team: 3944, name: "Team Mercury (FIRST)", city: "Princeton", state: "NJ", status: "registered", session: null, known: true });
    expect(p.teams[1]).toMatchObject({ team: 8421, name: "Tigers", city: null, known: false });
  });

  it("drops it once FIRST has a team list", async () => {
    await syncFtcNj(S, { html });
    await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USNJCENM7', 3944)", [S]);
    expect((await eventDetail(S, "USNJCENM7"))!.provisional).toBeNull();
  });

  it("drops it once FIRST has a schedule", async () => {
    await syncFtcNj(S, { html });
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'USNJCENM7', 'qual', 0, 1, 'Q1', 0, 'first')", [S]);
    expect((await eventDetail(S, "USNJCENM7"))!.provisional).toBeNull();
  });
});
