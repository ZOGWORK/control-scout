// The Chicago Robotics Invitational's results from its own site (real responses, read 2026-11-15): parsed into an
// ordinary event bundle under FIRST's code, shown on the event page with their source, never over FIRST's results.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { all, get, kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { eventDetail } from "../api/events";
import { bundleFromCri, criAwardType, criRanks, criSeasonNumber, venueTime, type CriRaw } from "../sources/cri";
import { syncCriResults, type CriIo } from "./criResults";
import { writeEventBundle } from "./resultChanges";
import { keepsSiteResults, syncEvent } from "../sync";
import type { EventRow } from "./bundle";

const fixture = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../sources/fixtures/${f}`, import.meta.url)), "utf8"));
const Y25: CriRaw = fixture("cri-2025-26.json");
const Y24: CriRaw = fixture("cri-2024-25.json");
const SEASONS = fixture("cri-seasons.json");

const meta = (season: number, start: string): EventRow => ({
  season, code: "FPECRI", name: "Chicago Robotics Invitational Premier Event", type: "Premier", divisionCode: null, region: "FPE", league: null,
  venue: "Francis W. Parker School", address: null, city: "Chicago", state: "IL", country: "USA", start, end: start, timezone: "America/Chicago",
  remote: false, hybrid: false, website: "https://chicagoroboticsinvitational.com/", livestream: null, source: "first", upstreamUpdated: null,
});

/** The site as read: each request counted, details served from the fixture's match pages. */
function io(): CriIo & { calls: string[] } {
  const calls: string[] = [];
  const by: Record<string, CriRaw> = { "2025-2026-cri": Y25, "2024-2025-cri": Y24 };
  return {
    calls,
    seasons: async () => { calls.push("seasons"); return SEASONS; },
    events: async (s) => { calls.push(`events ${s}`); return by[s] ? [by[s].event] : []; },
    lists: async (s) => { calls.push(`lists ${s}`); const { details: _d, ...rest } = by[s]; return rest; },
    details: async (s, _slug, matches, known) => {
      const out: Record<string, any> = {};
      for (const m of matches) if (by[s].details[m.name]) { if (!known[m.name]) calls.push(`match ${s} ${m.name}`); out[m.name] = by[s].details[m.name]; }
      return out;
    },
  };
}

async function firstEvent(season: number, start: string) {
  await run(`INSERT INTO events (season, code, name, type, region, venue, city, state, country, start, end, timezone, remote, hybrid, source, detail_synced_at)
             VALUES (?, 'FPECRI', 'Chicago Robotics Invitational Premier Event', 'Premier', 'FPE', 'Francis W. Parker School', 'Chicago', 'IL', 'USA', ?, ?, 'America/Chicago', 0, 0, 'first', '2026-10-13T00:00:00Z')`,
    [season, start, start]);
}

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  await kvSet("data:version", "v1");
  await firstEvent(2025, "2026-07-24");
  await firstEvent(2024, "2025-07-19");
  await run("INSERT INTO teams (number, name, city, state) VALUES (11329, 'I Love Robots', 'Chicago', 'IL')");
});

describe("CRI's site, parsed", () => {
  it("maps the site's CRI editions to Scout's seasons, and only those", () => {
    const got = SEASONS.map((s: any) => [s.year, criSeasonNumber(s)]).filter((x: any) => x[1] != null);
    expect(got).toEqual([["2025-2026-cri", 2025], ["2024-2025-cri", 2024], ["2023-2024-off-cri", 2023], ["2022-2023-off-cri", 2022], ["2021-2022-off-cri", 2021], ["2018-2019-off-cri", 2018]]);
  });

  it("reads 2025–26's bottom-up rank numbers best first, and leaves 2024–25's as posted", () => {
    const r25 = criRanks(Y25.rankings);
    expect(r25.get(11329)).toBe(1); // 4.5 ranking points, 7–1, the 1st alliance's captain (the site's "38")
    expect(r25.get(23644)).toBe(2);
    expect(r25.get(30686)).toBe(38); // 1.0 points, 1–7 (the site's "1")
    const r24 = criRanks(Y24.rankings);
    expect(r24.get(11260)).toBe(1);
    expect(r24.get(23778)).toBe(38);
  });

  it("turns the 2025–26 event into qualification and playoff matches, standings, alliances and awards", () => {
    const b = bundleFromCri(Y25, meta(2025, "2026-07-24"));
    const d = b.detail!;
    expect(b.event.source).toBe("cri");
    expect(d.matches.filter((m) => m.level === "qual")).toHaveLength(51);
    // Six alliances, double elimination: M1–M9, the final M10 and its replay M11 (series 1–11), as FIRST numbers them.
    expect(d.matches.filter((m) => m.level === "playoff").map((m) => m.label)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11"]);
    const q1 = d.matches.find((m) => m.label === "Q1")!;
    expect(q1.red.map((t) => t.team)).toEqual([4650, 14988, 16460]);
    expect(q1.blue.map((t) => t.team)).toEqual([22043, 10127, 30526]);
    // The match page's split: blue gave away 35, which is in red's 116.
    expect(q1.redScore).toEqual({ total: 116, np: 81, auto: 24, teleop: 57, endgame: 0, pen: 0 });
    expect(q1.blueScore).toEqual({ total: 67, np: 67, auto: 12, teleop: 55, endgame: 0, pen: 35 });
    expect(q1.breakdown).toBe(true);
    // The venue's wall clock (FIRST's format), from the site's -05:00 time.
    expect(q1.time).toBe("2026-07-25T13:23:43.197");
    expect(q1.scheduled).toBe("2026-07-25T13:20:00.000");
    // Without its page, a match has its totals and says it has no breakdown.
    const q3 = d.matches.find((m) => m.label === "Q3")!;
    expect(q3.redScore?.total).toBe(223);
    expect(q3.breakdown).toBe(false);
    const final = d.matches.find((m) => m.label === "M11")!;
    expect([final.redScore?.total, final.blueScore?.total]).toEqual([202, 443]);
    expect(final.blue.map((t) => t.team)).toEqual([11329, 18221, 22482, 31799]);
    expect(final.blue[3].station).toBeNull();
    expect(d.entries).toHaveLength(38);
    expect(d.entries.find((e) => e.team === 11329)).toMatchObject({ rank: 1, rp: 4.5, tbp: 337.625, wins: 7, losses: 1, ties: 0, qualPlayed: 8 });
    expect(d.alliances[0]).toEqual({ number: 1, name: "Alliance 1", captain: 11329, pick1: 18221, pick2: 22482, backup: 31799 });
    expect(d.alliances).toHaveLength(6);
    // FIRST's alliance awards by type (every member alike), CRI's own by name, places kept.
    expect(d.awards.filter((a) => a.type === "Winner").map((a) => [a.team, a.placement])).toEqual([[11329, 1], [18221, 1], [22482, 1], [31799, 1]]);
    expect(d.awards.filter((a) => a.type === "Finalist").map((a) => a.team)).toEqual([23644, 25650, 22131]);
    expect(d.awards.find((a) => a.type === "Star Image Award" && a.placement === 1)?.team).toBe(25538);
    expect(d.awards.some((a) => a.type === "Volunteer Award")).toBe(false); // no team
  });

  it("reads the 2024–25 event too (no match times on the site)", () => {
    const d = bundleFromCri(Y24, meta(2024, "2025-07-19")).detail!;
    expect(d.matches.filter((m) => m.level === "qual")).toHaveLength(57);
    expect(d.matches.filter((m) => m.level === "playoff")).toHaveLength(10);
    expect(d.matches[0].time).toBeNull();
    expect(d.matches[0].redScore).toEqual({ total: 591, np: 561, auto: 156, teleop: 405, endgame: 0, pen: 5 });
    expect(d.alliances.map((a) => a.captain)).toEqual([11260, 11228, 23849, 11329, 20032, 19207]);
  });

  it("files awards by FIRST's type only for the two alliance awards", () => {
    expect(criAwardType("Winning Alliance")).toBe("Winner");
    expect(criAwardType("Finalist Alliance")).toBe("Finalist");
    expect(criAwardType("The Loop Award")).toBe("Loop Award");
    expect(criAwardType("Third Place Alliance")).toBe("Third Place Alliance");
  });

  it("keeps a time it can't place as the site wrote it", () => {
    expect(venueTime("2026-07-25T13:20:00.000-05:00", null)).toBe("2026-07-25T13:20:00.000-05:00");
    expect(venueTime(null, "America/Chicago")).toBeNull();
  });
});

describe("CRI results sync", () => {
  it("writes both editions Scout has, reports the rest, and shows them with their source", async () => {
    const site = io();
    const r = await syncCriResults({ io: site, now: new Date("2026-11-15T00:00:00Z") });
    expect(r.written).toEqual([{ season: 2025, code: "FPECRI", matches: 62 }, { season: 2024, code: "FPECRI", matches: 67 }]);
    expect(r.skipped).toEqual(["2023-2024-off-cri: no CRI event in 2023", "2022-2023-off-cri: no CRI event in 2022", "2021-2022-off-cri: no CRI event in 2021", "2018-2019-off-cri: season 2018 isn't covered"]);
    expect(r.failed).toEqual([]);
    const d = (await eventDetail(2025, "FPECRI"))!;
    expect(d.event.source).toBe("cri");
    expect(d.event.teams).toBe(38);
    expect(d.matches).toHaveLength(62);
    expect(d.field[0]).toMatchObject({ team: 11329, rank: 1, name: "I Love Robots" });
    expect(d.resultsSource).toEqual({ site: "chicagoroboticsinvitational.com", url: "https://results.chicagoroboticsinvitational.com/2025-2026-cri/events/cri/quals" });
    expect(d.awards.find((a) => a.type === "Winner")?.team).toBe(11329);
  });

  it("reads at most weekly, and an unchanged site costs the lists alone", async () => {
    const site = io();
    await syncCriResults({ io: site, now: new Date("2026-11-15T00:00:00Z") });
    expect(site.calls.filter((c) => c.startsWith("match"))).toHaveLength(5);
    site.calls.length = 0;
    expect((await syncCriResults({ io: site, now: new Date("2026-11-20T00:00:00Z") })).note).toBe("read recently");
    expect(site.calls).toEqual([]);
    const again = await syncCriResults({ io: site, now: new Date("2026-11-23T00:00:00Z") });
    expect(again.unchanged).toEqual(["2025 FPECRI", "2024 FPECRI"]);
    expect(site.calls.filter((c) => c.startsWith("match"))).toEqual([]);
  });

  it("a read that fails or never finishes is tried again hours later, not a week later", async () => {
    const site = io();
    const broken: CriIo = { ...site, lists: async () => { throw new Error("HTTP 503"); } };
    expect((await syncCriResults({ io: broken, now: new Date("2026-11-15T00:00:00Z") })).failed).toHaveLength(2);
    expect((await syncCriResults({ io: site, now: new Date("2026-11-15T02:00:00Z") })).note).toBe("read recently");
    const later = await syncCriResults({ io: site, now: new Date("2026-11-15T07:00:00Z") });
    expect(later.written.map((w) => w.season)).toEqual([2025, 2024]);
    // A read the cycle was stopped in (a deploy): started, never finished.
    const stopped: CriIo = { ...site, seasons: () => new Promise(() => {}) };
    void syncCriResults({ io: stopped, now: new Date("2026-11-30T00:00:00Z") });
    await new Promise((r) => setTimeout(r, 50));
    expect((await syncCriResults({ io: site, now: new Date("2026-11-30T03:00:00Z") })).note).toBe("read recently");
    expect((await syncCriResults({ io: site, now: new Date("2026-11-30T07:00:00Z") })).note).toBeUndefined();
  });

  it("never writes over results FIRST posted", async () => {
    await writeEventBundle({
      event: meta(2025, "2026-07-24"), teams: [],
      detail: {
        entries: [{ team: 4650, rank: 1, rp: 2, tbp: 0, wins: 1, losses: 0, ties: 0, qualPlayed: 1, dq: 0 }],
        matches: [{ level: "qual", series: 0, number: 1, label: "Q1", description: null, time: null, played: true,
          red: [{ team: 4650, station: 1, surrogate: false, dq: false, onField: true }], blue: [{ team: 22043, station: 1, surrogate: false, dq: false, onField: true }],
          redScore: { total: 1, np: 1, auto: 0, teleop: 1, endgame: 0, pen: 0 }, blueScore: { total: 0, np: 0, auto: 0, teleop: 0, endgame: 0, pen: 0 } }],
        alliances: [], awards: [], advancement: undefined,
      },
    });
    const r = await syncCriResults({ io: io(), now: new Date("2026-11-15T00:00:00Z") });
    expect(r.skipped).toContain("2025 FPECRI: has results from first");
    expect((await get<any>("SELECT source FROM events WHERE season = 2025 AND code = 'FPECRI'")).source).toBe("first");
    expect(await all("SELECT * FROM matches WHERE season = 2025")).toHaveLength(1);
  });

  it("keeps them when FIRST's own read comes back empty, and FIRST's results replace them", async () => {
    await syncCriResults({ io: io(), now: new Date("2026-11-15T00:00:00Z") });
    expect(await keepsSiteResults(2025, "FPECRI")).toBe(true);
    expect(await keepsSiteResults(2024, "FPECRI")).toBe(true);
    // FIRST later posts results: its write replaces the site's, and the sync leaves it from then on.
    await writeEventBundle({ event: meta(2024, "2025-07-19"), teams: [], detail: { entries: [{ team: 1, rank: 1, rp: 0, tbp: 0, wins: 0, losses: 0, ties: 0, qualPlayed: 0, dq: 0 }],
      matches: [{ level: "qual", series: 0, number: 1, label: "Q1", description: null, time: null, played: false, red: [], blue: [], redScore: null, blueScore: null }], alliances: [], awards: [], advancement: undefined } });
    expect(await keepsSiteResults(2024, "FPECRI")).toBe(false);
    expect((await eventDetail(2024, "FPECRI"))!.resultsSource).toBeUndefined();
  });
});

describe("FIRST's sync of a CRI event (FIRST feed stubbed)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("an empty FIRST read keeps CRI's results and refreshes only the event row", async () => {
    await syncCriResults({ io: io(), now: new Date("2026-11-15T00:00:00Z") });
    vi.stubEnv("FTC_EVENTS_USERNAME", "u");
    vi.stubEnv("FTC_EVENTS_TOKEN", "t");
    // FIRST knows the event but has nothing for it.
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await syncEvent({ ...meta(2025, "2026-07-24"), venue: "Francis W. Parker School (FIRST)" });
    expect(await all("SELECT * FROM matches WHERE season = 2025 AND code = 'FPECRI'")).toHaveLength(62);
    expect(await all("SELECT * FROM event_teams WHERE season = 2025 AND code = 'FPECRI'")).toHaveLength(38);
    expect(await get<any>("SELECT source, venue FROM events WHERE season = 2025 AND code = 'FPECRI'")).toEqual({ source: "cri", venue: "Francis W. Parker School (FIRST)" });
  });
});
