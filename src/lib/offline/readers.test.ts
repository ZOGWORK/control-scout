import { beforeAll, describe, expect, it, vi } from "vitest";
import { OFFLINE_FORECAST, readEventDetail, readMatchViews, readProjections, readSearch, readTeamProfile, wrap, type SeasonDb } from "./readers";
import { packDb, season2024, season2025 } from "./testFixture";
import { eventTypeLabel } from "../../shared/labels";

let s25: SeasonDb, s24: SeasonDb;
beforeAll(async () => { [s25, s24] = await Promise.all([season2025(), season2024()]); });

describe("offline team profile (same shape as /api/teams/:n)", () => {
  it("defaults to the newest saved season the team entered, with stats, events, alliance seats and awards", () => {
    const p = readTeamProfile([s24, s25], 100)!;
    expect(p.season).toBe(2025);
    expect(p.seasons).toEqual([2025, 2024]);
    expect(p.team).toEqual({ number: 100, name: "Gearheads", fullName: "Gearheads Robotics", school: "Gearheads High", sponsors: ["Acme"], city: "Newark", state: "NJ", country: "USA", rookieYear: 2015, website: null, homeRegion: "USNJ" });
    expect(p.stats).toEqual({
      opr: { np: { value: 55.5, rank: 7, of: 400 }, auto: { value: 10, rank: 9, of: 400 }, teleop: { value: 30, rank: 6, of: 400 }, endgame: { value: 15.5, rank: 5, of: 400 }, pen: 2 },
      rating: { np: 50, auto: 9, teleop: 28, endgame: 13, pen: 2, sd: 6, matches: 3, rank: 8 },
      record: { wins: 2, losses: 1, ties: 0, matches: 3, events: 1 },
      avg: { np: 100, score: 105, pen: 5 },
    });
    expect(p.events.map((e) => e.code)).toEqual(["USNJQ1", "USNJQ9"]); // by start date
    expect(p.events[0]).toEqual({
      season: 2025, code: "USNJQ1", name: "New Jersey Qualifier 1", type: "Qualifier", start: "2025-11-01", end: "2025-11-01", city: "Newark", state: "NJ", country: "USA",
      rank: 2, rp: 2, wins: 1, losses: 1, ties: 0, qualPlayed: 2,
      opr: { np: 55.5, auto: 10, teleop: 30, endgame: 15.5, pen: 2 }, avg: { score: 105, np: 100, pen: 5 },
      awards: [{ type: "Winner", placement: 1, name: null }],
      alliance: { number: 1, seat: "pick1" },
    });
    expect(p.events[1].opr.np).toBeNull(); // no stats yet at the upcoming event
    expect(p.awardsAllTime).toEqual([
      { season: 2025, code: "USNJQ1", event: "New Jersey Qualifier 1", type: "Winner", placement: 1, name: null },
      { season: 2024, code: "USNJCMP", event: "New Jersey Championship", type: "Design", placement: 2, name: null },
    ]);
  });

  it("reads an older saved season when asked", () => {
    const p = readTeamProfile([s25, s24], 100, 2024)!;
    expect(p.season).toBe(2024);
    expect(p.events.map((e) => e.code)).toEqual(["USNJCMP"]);
    expect(p.stats).toBeNull();
  });

  it("falls back to the team's own season when it isn't in the newest one", () => {
    const p = readTeamProfile([s25, s24], 999)!;
    expect(p.seasons).toEqual([2024]);
    expect(p.season).toBe(2024);
  });

  it("lists only seasons the team played: a registration-only newest season isn't offered or opened", async () => {
    const { packDb } = await import("./testFixture");
    const { wrap } = await import("./readers");
    const reg = { season: 2025, db: wrap(await packDb(2025, { teams: [{ number: 999, name: "Retired", city: null, state: null, country: null }] })) };
    const p = readTeamProfile([reg, s24], 999)!;
    expect(p.seasons).toEqual([2024]);
    expect(p.season).toBe(2024);
  });

  it("drops events where a listed team never took the field once results exist", () => {
    expect(readTeamProfile([s25], 500)!.events).toEqual([]);
  });

  it("is null for a season that isn't saved, or a team in none", () => {
    expect(readTeamProfile([s25, s24], 100, 2023)).toBeNull();
    expect(readTeamProfile([s25, s24], 12345)).toBeNull();
  });
});

describe("offline event detail (same shape as /api/events/:season/:code)", () => {
  it("ranks the field, lists matches with lineups and scores, alliances, awards and advancement", () => {
    const d = readEventDetail(s25, "USNJQ1")!;
    expect(d.event).toMatchObject({
      season: 2025, code: "USNJQ1", name: "New Jersey Qualifier 1", type: "Qualifier", typeLabel: eventTypeLabel("Qualifier"), venue: "Gym",
      teams: 5, matchesPlayed: 3, matchesTotal: 3, status: "finished", timezone: "America/New_York", source: "first", website: null, livestream: null,
    });
    expect(d.field.map((f) => f.team)).toEqual([200, 100, 300, 400, 500]); // rank order, unranked last by number
    expect(d.field[0]).toEqual({
      team: 200, name: "Bolt", city: "Trenton", state: "NJ", rank: 1, rp: 2, tbp: 50, wins: 2, losses: 0, ties: 0, qualPlayed: 2,
      opr: { np: 60, auto: 12, teleop: 33, endgame: 15, pen: 1 }, avgNp: 115, rating: null, seasonOpr: null,
    });
    expect(d.matches.map((m) => m.label)).toEqual(["Q1", "Q2", "M1"]);
    expect(d.matches[0]).toEqual({
      season: 2025, code: "USNJQ1", key: "qual:0:1", level: "qual", series: 0, number: 1, label: "Q1", time: "2025-11-01T09:00:00",
      startsAt: "2025-11-01T13:00:00.000Z", played: true,
      red: { teams: [{ number: 100, surrogate: false, dq: false, onField: true }, { number: 200, surrogate: false, dq: false, onField: true }], score: { total: 120, np: 115, auto: 20, teleop: 75, endgame: 20, pen: 5 } },
      blue: { teams: [{ number: 300, surrogate: false, dq: false, onField: true }, { number: 400, surrogate: false, dq: false, onField: true }], score: { total: 80, np: 80, auto: 15, teleop: 45, endgame: 20, pen: 0 } },
      video: null, prediction: null,
    });
    expect(d.matches[2].red.teams.map((t) => [t.number, t.onField])).toEqual([[200, true], [100, true], [500, false]]);
    expect(d.alliances).toEqual([
      { number: 1, name: "Alliance 1", captain: 200, pick1: 100, pick2: null, backup: null },
      { number: 2, name: "Alliance 2", captain: 300, pick1: 400, pick2: null, backup: null },
    ]);
    expect(d.awards.map((a) => a.type)).toEqual(["Inspire", "Winner", "Think"]);
    expect(d.advancement).toEqual({ slots: 2, advancesTo: "USNJCMP", rows: [{ team: 200, status: "Inspire", declined: false }] });
    expect(d.forecastUnsupported).toBe(OFFLINE_FORECAST);
  });

  it("predicts unplayed matches (never played ones) and rates the field with what the device has", () => {
    const calls: unknown[] = [];
    const opts = {
      predict: (season: number, red: number[], blue: number[]) => { calls.push([season, red, blue]); return { pRed: 0.6, redMean: 100, blueMean: 90, tier: "moderate" as const, kind: "now" as const, predictedAt: "x" }; },
      rating: (_s: number, team: number) => (team === 100 ? { np: 48.2, sd: 5.1, matches: 3 } : null),
    };
    const up = readEventDetail(s25, "USNJQ9", opts)!;
    expect(up.event.status).toBe("upcoming");
    expect(up.matches[0].played).toBe(false);
    expect(up.matches[0].red.score).toBeNull();
    expect(up.matches[0].prediction?.pRed).toBe(0.6);
    expect(calls).toEqual([[2025, [100, 200], [300, 400]]]);
    expect(up.field.find((f) => f.team === 100)?.rating).toEqual({ np: 48.2, sd: 5.1, matches: 3 });
    // Season OPR (the At a glance card's field average): from the pack's team_season_stats, null where a team has none.
    expect(Object.fromEntries(up.field.map((f) => [f.team, f.seasonOpr]))).toEqual({ 100: 55.5, 300: null });
    expect(readEventDetail(s25, "USNJQ1", opts)!.matches.every((m) => m.prediction === null)).toBe(true);
  });

  it("is null for an event the pack doesn't have", () => {
    expect(readEventDetail(s25, "NOPE")).toBeNull();
  });
});

describe("offline team matches (same shape as /api/teams/:n/matches)", () => {
  it("lists every match the team is in, across events, by time", () => {
    const ms = readMatchViews(s25, { team: 100 });
    expect(ms.map((m) => `${m.code} ${m.label}`)).toEqual(["USNJQ1 Q1", "USNJQ1 Q2", "USNJQ1 M1", "USNJQ9 Q1"]);
    expect(ms[1].blue.teams.map((t) => t.number)).toEqual([100, 400]);
    expect(ms[1].red.score?.total).toBe(90);
  });
});

describe("offline search (same hits as /api/search)", () => {
  const dbs = () => [s24, s25];
  it("jumps to an exact team number, in the newest season that has it", () => {
    expect(readSearch(dbs(), "100")).toEqual([{ kind: "team", ref: "100", title: "100 Gearheads", subtitle: "Newark, NJ, USA", season: 2025 }]);
    expect(readSearch(dbs(), "999")[0]).toMatchObject({ ref: "999", season: 2024 });
  });

  it("matches names by prefix and with typos", () => {
    expect(readSearch(dbs(), "gear")[0]).toMatchObject({ kind: "team", ref: "100", title: "100 Gearheads" });
    expect(readSearch(dbs(), "gaerheads")[0]).toMatchObject({ kind: "team", ref: "100" });
  });

  it("finds events by name or code", () => {
    const hit = { kind: "event", ref: "2025:USNJQ1", title: "New Jersey Qualifier 1", subtitle: "USNJQ1 · 2025-11-01 · Newark, NJ, USA", season: 2025 };
    expect(readSearch(dbs(), "USNJQ1")[0]).toEqual(hit);
    expect(readSearch(dbs(), "jersey qualifier")).toContainEqual(hit);
    expect(readSearch(dbs(), "jersey championship")[0]).toMatchObject({ ref: "2024:USNJCMP", season: 2024 });
  });

  it("finds by every field the server indexes: city, state name, school, start year", () => {
    const refs = (q: string) => readSearch(dbs(), q, 25).map((h) => h.ref);
    expect(refs("Princeton")).toEqual(expect.arrayContaining(["999", "2024:USNJCMP"])); // city only
    expect(refs("Camden")).toEqual(["300"]);
    expect(refs("new jersey")).toEqual(expect.arrayContaining(["300", "500", "2025:USNJQ9"])); // NJ, by its name (regionNames)
    expect(refs("sprockets high")).toEqual(["400"]);
    expect(refs("2099")).toEqual(["2025:USNJQ9"]); // a year only in the start date
    expect(refs("2025 jersey")).toEqual(expect.arrayContaining(["2025:USNJQ1", "2024:USNJCMP"]));
    expect(refs("Newrak")).toEqual(["2025:USNJQ1"]); // typos match names only (an event's includes its city), as the server's typo index
  });

  it("resolves a match query straight to the match", () => {
    expect(readSearch(dbs(), "USNJQ1 Q2")[0]).toEqual({ kind: "match", ref: "2025:USNJQ1:qual:0:2", title: "Q2 · New Jersey Qualifier 1", subtitle: "USNJQ1 · 2025", season: 2025 });
  });

  it("ignores short numbers that aren't teams, and caps the list", () => {
    expect(readSearch(dbs(), "16")).toEqual([]);
    expect(readSearch(dbs(), "new jersey", 2)).toHaveLength(2);
  });
});

// PUB3-F01: offline, an event's status goes by its venue's calendar too, the same rule as the server's.
describe("offline event status (same as the server's, by the venue's date)", () => {
  const ev = (code: string, start: string, timezone: string | null) => ({ season: 2026, code, name: code, type: "Qualifier", start, end: start, timezone, remote: 0, source: "first" });
  const unplayed = (code: string) => ({ season: 2026, code, level: "qual", series: 0, number: 1, label: "Q1", played: 0, source: "first" });
  let pack: SeasonDb;
  beforeAll(async () => {
    pack = { season: 2026, db: wrap(await packDb(2026, {
      events: [ev("LA", "2026-10-18", "America/Los_Angeles"), ev("BNE", "2026-10-19", "Australia/Brisbane"), ev("BAD", "2026-10-18", "Not/AZone")],
      matches: [unplayed("LA"), unplayed("BNE"), unplayed("BAD")],
    })) };
  });
  const statusAt = (iso: string, code: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(iso));
    try { return readEventDetail(pack, code)!.event.status; } finally { vi.useRealTimers(); }
  };

  it("an Oct 18 Los Angeles event is live at 02:00 UTC on the 19th, an Oct 19 Brisbane one at 16:00 UTC on the 18th", () => {
    expect(statusAt("2026-10-19T02:00:00Z", "LA")).toBe("live");
    expect(statusAt("2026-10-19T07:00:00Z", "LA")).toBe("finished");
    expect(statusAt("2026-10-18T16:00:00Z", "BNE")).toBe("live");
    expect(statusAt("2026-10-18T13:59:59Z", "BNE")).toBe("upcoming");
  });

  it("an invalid zone uses the anywhere-on-Earth window", () => {
    expect(statusAt("2026-10-19T11:59:59Z", "BAD")).toBe("live");
    expect(statusAt("2026-10-19T12:00:00Z", "BAD")).toBe("finished");
  });
});

describe("offline projections (same shape as /api/projections/:season/:code)", () => {
  const row = (kind: string) => ({
    season: 2025, code: "USNJQ1", kind, state_key: "k", seed: 7, runs: 10000, target_runs: 10000, stage: "live", played: 12, scheduled: 24, through: "Q12",
    slots: 4, slots_source: "official", engine_version: "2.1.1", ms: 3000, computed_at: "2025-11-01T15:00:00Z",
    teams: JSON.stringify([{ team: 100, rank: { p10: 1, p50: 2, p90: 4, mean: 2.2 }, pPlayoff: 0.9, pCaptain: 0.6, pPicked: 0.3, pAdvance: 0.7, pWin: 0.3, pFinalist: 0.2 }]),
  });
  it("reads the saved runs", async () => {
    const sdb: SeasonDb = { season: 2025, db: wrap(await packDb(2025, { event_projections: [row("current"), row("baseline")] })) };
    const v = readProjections(sdb, "USNJQ1");
    expect(v.current).toMatchObject({ kind: "current", runs: 10000, through: "Q12", slots: 4, teams: [{ team: 100, pAdvance: 0.7 }] });
    expect(v.baseline?.kind).toBe("baseline");
    expect(v.lastOpen).toBeNull();
    expect(JSON.stringify(v)).not.toContain("state_key");
  });
  it("answers none from a pack built before projections were saved", async () => {
    const db = await packDb(2025, {});
    db.run("DROP TABLE event_projections");
    expect(readProjections({ season: 2025, db: wrap(db) }, "USNJQ1")).toEqual({ season: 2025, code: "USNJQ1", current: null, baseline: null, lastOpen: null });
  });
});
