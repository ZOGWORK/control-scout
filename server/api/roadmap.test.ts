// The season road map: only an encoded region gets points and a "what's needed" figure (a neutral region never
// does, whatever data it has); FIRST's own lists decide each event's advancement state; the Competition Manual's
// rules (first three entry-level events, home region only, best 10 league meet matches) shape the next stop.
import { describe, expect, it } from "vitest";
import { qualPoints } from "@control-scout/predict-engine";
import type { TeamEventRow } from "../../src/shared/api";
import { buildRoadMap, routes, teamRoadMap, type EventFacts, type RoadMapInput } from "./roadmap";
import { advancementPointRows } from "../sources/first";
import { bundleStatements, type EventBundle } from "../data/bundle";
import { migrate, openDb, run, setDb, writeBatch } from "../db";
import { clearAllCaches } from "../caches";
import { pointsSystem, regionRuleset, REGION_RULESETS } from "../data/roadmapRules";

const row = (code: string, type: string, start: string, o: Partial<TeamEventRow> = {}): TeamEventRow => ({
  season: 2026, code, name: `${code} name`, type, start, end: start, city: null, state: null, country: null,
  rank: null, rp: null, wins: null, losses: null, ties: null, played: null, qualPlayed: null, qual: null, onField: false,
  opr: { np: null, auto: null, teleop: null, endgame: null, pen: null }, avg: { score: null, np: null, pen: null }, awards: [], alliance: null, ...o,
});
const facts = (region: string, o: Partial<EventFacts> = {}): EventFacts => ({ region, ranked: 0, roster: 0, advancement: null, points: new Map(), ...o });
const input = (o: Partial<RoadMapInput>): RoadMapInput => ({ team: 100, season: 2026, region: "USNJ", today: "2026-11-01", events: [], facts: new Map(), names: new Map(), ...o });

describe("season road map", () => {
  it("a region without an encoded ruleset gets results and FIRST's advancement only: no points, no target", () => {
    const pts = new Map([[100, { total: 80, awards: 12, playoffs: 40, alliance: 19, quals: 9 }]]);
    const m = buildRoadMap(input({
      region: "USTXNO",
      events: [row("TXQ1", "Qualifier", "2026-10-20", { wins: 5, losses: 1, ties: 0, rank: 2 }), row("TXQ2", "Qualifier", "2026-11-20")],
      facts: new Map([["TXQ1", facts("USTXNO", { ranked: 30, advancement: { slots: 5, advancesTo: "TXCMP", rows: [{ team: 100, status: "FIRST", declined: false }] }, points: pts })], ["TXQ2", facts("USTXNO")]]),
      names: new Map([["TXCMP", "North Texas Championship"]]),
    }));
    expect(m.ruleset).toBeNull();
    expect(m.need).toBeNull();
    expect(m.stage).toBeNull();
    expect(m.stops[0]).toMatchObject({ points: null, cutoff: null, counts: null, record: { wins: 5, losses: 1, ties: 0 }, advancement: { status: "advanced", to: "North Texas Championship" } });
    expect(m.next?.code).toBe("TXQ2");
    expect(m.encoded.map((e) => e.name)).toEqual(["New Jersey", "Michigan", "Iowa"]);
  });

  it("an encoded region: official points per event, the cutoff, and a qualified team aims at the championship's FIRST Championship share", () => {
    const pts = new Map([
      [100, { total: 70, awards: 0, playoffs: 40, alliance: 18, quals: 12 }],
      [200, { total: 113, awards: 60, playoffs: 20, alliance: 19, quals: 14 }],
      [300, { total: 53, awards: 12, playoffs: 10, alliance: 18, quals: 13 }],
      [400, { total: 52, awards: 12, playoffs: 10, alliance: 17, quals: 13 }],
    ]);
    const m = buildRoadMap(input({
      events: [row("USNJNEM1", "LeagueMeet", "2026-10-25", { qualPlayed: 6 }), row("USNJNELT", "LeagueTournament", "2026-10-30", { rank: 3 }), row("USNJCMP", "Championship", "2027-03-14")],
      facts: new Map([
        ["USNJNEM1", facts("USNJ")],
        ["USNJNELT", facts("USNJ", { ranked: 21, advancement: { slots: 3, advancesTo: "USNJCMP", rows: [200, 100, 300].map((team) => ({ team, status: "FIRST", declined: false })) }, points: pts })],
        ["USNJCMP", facts("USNJ", { roster: 48 })],
      ]),
      names: new Map([["USNJCMP", "New Jersey Championship"]]),
    }));
    expect(m.ruleset?.name).toBe("New Jersey");
    expect(m.ruleset?.sources.some((s) => s.url.startsWith("https://newjerseyftc.com/"))).toBe(true);
    const lt = m.stops.find((s) => s.code === "USNJNELT")!;
    expect(lt).toMatchObject({ points: { total: 70 }, cutoff: 53, counts: true, level: "League tournament", advancement: { status: "advanced", to: "New Jersey Championship" } });
    expect(m.stops[0]).toMatchObject({ level: "League meet", counts: false, advancement: null });
    expect(m.stage).toBe("regional");
    expect(m.need).toMatchObject({ event: { code: "USNJCMP" }, level: "State championship", target: 46, teams: 48, best: 70, leagueMatches: null });
    expect(m.need!.lastSeason!.fcmp!.slots).toEqual({ min: 8, max: 8 });
  });

  it("a league team before its tournament: the league's tournaments from the calendar, last season's median cutoff, meet matches counted", () => {
    const m = buildRoadMap(input({
      events: [row("USNJNEM1", "LeagueMeet", "2026-10-25", { qualPlayed: 6 }), row("USNJNEM2", "LeagueMeet", "2026-10-28", { qualPlayed: 6 })],
      facts: new Map([["USNJNEM1", facts("USNJ")], ["USNJNEM2", facts("USNJ")]]),
      leagueTournaments: [{ code: "USNJNELT", name: "A", start: "2027-02-06" }, { code: "USNJNELT2", name: "B", start: "2027-02-21" }],
    }));
    expect(m.stage).toBe("entry");
    // 2025–26 NJ league tournament cutoffs 37, 48, 51, 53, 54, 54, 55, 63: median 53.5.
    expect(m.need).toMatchObject({ event: null, options: [{ code: "USNJNELT" }, { code: "USNJNELT2" }], target: 54, leadsTo: "New Jersey Championship", leagueMatches: { played: 12, counted: 10, max: 10 }, overLimit: false });
    expect(m.need!.routes.find((r) => r.label.startsWith("Win"))?.clears).toBe(true);
    expect(m.need!.routes.find((r) => r.label.startsWith("Other judged award"))?.clears).toBe(false);
  });

  it("only a team's first three home-region entry-level events can advance it", () => {
    const m = buildRoadMap(input({
      region: "USMI", today: "2026-11-20",
      events: [
        row("USMIOUT", "Qualifier", "2026-10-01"),
        row("USMICHQ", "Qualifier", "2026-10-31"), row("USMIKEQ", "Qualifier", "2026-11-07"), row("USMICOQ", "Qualifier", "2026-11-14"),
        row("USMITEQ", "Qualifier", "2026-12-05"),
      ],
      facts: new Map([["USMIOUT", facts("USOH")], ...["USMICHQ", "USMIKEQ", "USMICOQ"].map((c) => [c, facts("USMI", { advancement: { slots: 5, advancesTo: "USMISECMP", rows: [{ team: 1, status: "FIRST", declined: false }] } })] as const), ["USMITEQ", facts("USMI", { roster: 30 })]]),
    }));
    expect(m.stops.map((s) => s.counts)).toEqual([false, true, true, true, false]);
    expect(m.stops[0].home).toBe(false);
    expect(m.stops[1].advancement?.status).toBe("missed");
    expect(m.stops[4].advancement?.to).toBe("USMISECMP");
    expect(m.need).toMatchObject({ event: null, overLimit: true });
  });

  it("a team that played its championship without advancing has no qualifying stop left, not that championship again", () => {
    const m = buildRoadMap(input({
      today: "2027-03-20",
      events: [row("USNJNELT", "LeagueTournament", "2027-02-06"), row("USNJCMP", "Championship", "2027-03-14", { rank: 30 })],
      facts: new Map([
        ["USNJNELT", facts("USNJ", { advancement: { slots: 6, advancesTo: "USNJCMP", rows: [{ team: 100, status: "FIRST", declined: false }] } })],
        ["USNJCMP", facts("USNJ", { advancement: { slots: 19, advancesTo: "FIRST Championship & Premier Events", rows: [{ team: 5, status: "FIRST", declined: false }] } })],
      ]),
    }));
    expect(m.stage).toBe("over");
    expect(m.need).toBeNull();
    expect(m.stops[1].advancement?.status).toBe("missed");
  });

  it("a played championship with no advancement list yet is waited on, never read as a miss", () => {
    const m = buildRoadMap(input({
      today: "2027-03-15",
      events: [row("USNJNELT", "LeagueTournament", "2027-02-06"), row("USNJCMP", "Championship", "2027-03-14")],
      facts: new Map([
        ["USNJNELT", facts("USNJ", { advancement: { slots: 6, advancesTo: "USNJCMP", rows: [{ team: 100, status: "FIRST", declined: false }] } })],
        ["USNJCMP", facts("USNJ")],
      ]),
    }));
    expect(m.stage).toBe("awaiting");
    expect(m.need).toBeNull();
  });

  it("an event outside the home region never names the home championship", () => {
    const m = buildRoadMap(input({
      events: [row("USOHQ1", "Qualifier", "2026-12-01")],
      facts: new Map([["USOHQ1", facts("USOH")]]),
    }));
    expect(m.stops[0]).toMatchObject({ home: false, counts: false, advancement: { status: "pending", to: null } });
  });

  it("a team past its championship needs nothing more from the road map", () => {
    const m = buildRoadMap(input({
      today: "2027-03-20",
      events: [row("USNJCMP", "Championship", "2027-03-14")],
      facts: new Map([["USNJCMP", facts("USNJ", { advancement: { slots: 19, advancesTo: "FIRST Championship & Premier Events", rows: [{ team: 100, status: "FIRST", declined: false }] } })]]),
    }));
    expect(m.stage).toBe("beyond");
    expect(m.need).toBeNull();
  });

  it("routes are the fewest points each finish guarantees under the 2026–27 table", () => {
    const ps = pointsSystem(2026)!;
    // 24 teams: 6 alliances, so the last alliance's points are 21 − 6 = 15; the worst qualification points are the
    // last rank's at a 24-team event (the 28-team sample in Table 4-3 gives its last rank 4).
    const q = qualPoints(24, 24);
    expect(q).toBeGreaterThan(ps.qualMin);
    const r = routes(ps, 24, 57);
    expect(r.find((x) => x.label.startsWith("Win"))).toMatchObject({ min: 40 + 15 + q, clears: true });
    expect(r.find((x) => x.label.startsWith("Inspire 1st"))).toMatchObject({ min: 60 + q, clears: true });
    expect(r.find((x) => x.label.startsWith("Finalist"))).toMatchObject({ min: 20 + 15 + q, clears: false });
    expect(routes(ps, 28, null).find((x) => x.label.startsWith("Inspire 1st"))!.min).toBe(64);
    expect(routes(ps, 24, null).every((x) => !x.clears)).toBe(true);
  });

  it("the qualification points formula reproduces the 2026–27 manual's Table 4-3 sample (28 teams)", () => {
    const at = (r: number) => qualPoints(r, 28);
    expect([1, 2, 3, 4].map(at)).toEqual([16, 15, 14, 14]);
    expect([12, 13, 14].map(at)).toEqual([10, 10, 10]);
    expect([25, 26, 27, 28].map(at)).toEqual([6, 5, 5, 4]);
  });

  it("every encoded ruleset names its season, sources and the date they were read", () => {
    for (const rs of REGION_RULESETS) {
      expect(rs.sources.length).toBeGreaterThan(0);
      expect(rs.sources.every((s) => /^https:\/\//.test(s.url))).toBe(true);
      expect(rs.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(pointsSystem(rs.season)).not.toBeNull();
      expect(rs.lastSeason.entry.length).toBeGreaterThan(0);
    }
    expect(regionRuleset(2026, "USTXNO")).toBeNull();
    expect(regionRuleset(2025, "USNJ")).toBeNull();
  });
});

describe("FIRST's advancement points", () => {
  it("reads the tuple in Table 4-2 order and skips malformed rows; a failed fetch keeps what's stored", () => {
    expect(advancementPointRows([
      { team: 23314, points: [113, 60, 20, 19, 14, 118.6, 39.9, 161, 147, 659090.7] },
      { team: 5, points: [1, 2] }, { points: [1, 2, 3, 4, 5] }, null,
    ])).toEqual([{ team: 23314, total: 113, awards: 60, playoffs: 20, alliance: 19, quals: 14 }]);
    expect(advancementPointRows(null)).toEqual([]);
    expect(advancementPointRows(undefined)).toBeUndefined();
  });
});

describe("road map from the database", () => {
  it("stores FIRST's points with the event and serves them on the road map of an encoded region", async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    clearAllCaches();
    await run("INSERT INTO teams (number, name, home_region) VALUES (100, 'Hundred', 'USNJ')");
    await run("INSERT INTO events (season, code, name, type, region, league, start, end, source) VALUES (2026, 'USNJNELT', 'NE League Tournament', 'LeagueTournament', 'USNJ', 'NE', '2026-10-01', '2026-10-01', 'first')");
    await run("INSERT INTO events (season, code, name, type, region, start, end, source) VALUES (2026, 'USNJCMP', 'New Jersey Championship', 'Championship', 'USNJ', '2099-03-14', '2099-03-14', 'first')");
    await run("INSERT INTO event_registrations (season, code, team, fetched_at) VALUES (2026, 'USNJCMP', 100, '2026-10-30')");
    // Registered for a qualifier whose official roster is out without the team (it skipped it): not a stop.
    await run("INSERT INTO events (season, code, name, type, region, start, end, source) VALUES (2026, 'USNJSKIP', 'Skipped', 'Qualifier', 'USNJ', '2099-01-01', '2099-01-01', 'first')");
    await run("INSERT INTO event_registrations (season, code, team, fetched_at) VALUES (2026, 'USNJSKIP', 100, '2026-10-30')");
    await run("INSERT INTO event_teams (season, code, team) VALUES (2026, 'USNJSKIP', 999)");
    const b: EventBundle = {
      event: { season: 2026, code: "USNJNELT", name: "NE League Tournament", type: "LeagueTournament", divisionCode: null, region: "USNJ", league: "NE", venue: null, address: null, city: null, state: null, country: null, start: "2026-10-01", end: "2026-10-01", timezone: null, remote: false, hybrid: false, website: null, livestream: null, source: "first", upstreamUpdated: null } as any,
      teams: [],
      detail: {
        entries: [{ team: 100, rank: 1, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null, dq: null }], matches: [], alliances: [], awards: [],
        advancement: { slots: 1, advancesTo: "USNJCMP", rows: [{ team: 100, status: "FIRST", declined: false }] },
        advancementPoints: [{ team: 100, total: 76, awards: 0, playoffs: 40, alliance: 20, quals: 16 }],
      },
    };
    await writeBatch(bundleStatements(b));
    const m = await teamRoadMap(2026, 100);
    expect(m.ruleset?.name).toBe("New Jersey");
    expect(m.stops.map((s) => s.code)).toEqual(["USNJNELT", "USNJCMP"]);
    expect(m.stops[0]).toMatchObject({ points: { total: 76, playoffs: 40 }, cutoff: 76, advancement: { status: "advanced", to: "New Jersey Championship" } });
    expect(m.stage).toBe("regional");
    expect(m.need?.event?.code).toBe("USNJCMP");
    // Registered, so a stop; and without the registration the calendar still gives its date.
    await run("DELETE FROM event_registrations WHERE code = 'USNJCMP'");
    const unregistered = await teamRoadMap(2026, 100);
    expect(unregistered.need?.event).toMatchObject({ code: "USNJCMP", start: "2099-03-14" });
    expect(unregistered.need?.fromCalendar).toBe(true);
    await run("INSERT INTO event_registrations (season, code, team, fetched_at) VALUES (2026, 'USNJCMP', 100, '2026-10-30')");
    // A re-fetch that couldn't read the points keeps them; an empty list clears them.
    await writeBatch(bundleStatements({ ...b, detail: { ...b.detail!, advancementPoints: undefined } }));
    expect((await teamRoadMap(2026, 100)).stops[0].points?.total).toBe(76);
    await writeBatch(bundleStatements({ ...b, detail: { ...b.detail!, advancementPoints: [] } }));
    expect((await teamRoadMap(2026, 100)).stops[0].points).toBeNull();
  });
});
