// @vitest-environment jsdom
// The scouting pages' kept answers (kept.ts) and what they answer with no signal (scoutReads.ts): the server's own
// JSON, per account, marked with when it was loaded; the event list gains the events bundled on the device, and a
// team added to the shortlist offline is listed (its kept row, or who it is with no stats), never dropped.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventListItem, ShortlistTeam } from "../../shared/api";

const bundles = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./bundles", () => ({ loadBundle: async (season: number, code: string) => bundles.get(`${season}:${code}`) ?? null }));

import { answerableOffline, clearKept, keepable, keepAnswer, keptAnswer, keptAt, MAX_KEPT } from "./kept";
import { scoutReadAnswer } from "./scoutReads";
import { offlineSource } from "./saved";
import { writeBundles } from "./bundleMeta";
import { warmPaths } from "./warm";

const ev = (code: string, name: string, start: string): EventListItem => ({ season: 2026, code, name, type: "2", typeLabel: "Qualifier", city: "Brisbane", state: "QLD", country: "Australia", start, end: start, teams: 18, matchesPlayed: 0, matchesTotal: 26, status: "upcoming" });
const row = (team: number, opr: number): ShortlistTeam => ({ team, name: `T${team}`, place: "Here", opr, oprRank: 1, of: 9, rating: 1, ratingSd: 1, record: "1-0-0", lastEvent: null, nextEvent: null, breakdown: { auto: 1, teleop: 2, endgame: 3, event: null }, events: [] });
const signedIn = (id: string) => localStorage.setItem("cs-personal-owner", id);

beforeEach(async () => {
  localStorage.clear();
  bundles.clear();
  await clearKept();
});

describe("kept answers", () => {
  it("keeps only the scouting pages' reads (a season's whole event list, never a search as it's typed)", () => {
    expect(keepable("/api/events?season=2026&all=1&limit=3000")).toBe(true);
    expect(keepable("/api/events?season=2026")).toBe(true);
    expect(keepable("/api/events?season=2026&q=bris&all=1&limit=20")).toBe(false);
    expect(keepable("/api/events/2026/AUBRQ1/pick-ratings")).toBe(true);
    expect(keepable("/api/shortlist?teams=1%2C2&season=2026")).toBe(true);
    expect(keepable("/api/scout/workspaces/41/alliances?season=2026")).toBe(true);
    expect(keepable("/api/scout/workspaces/41/alliances", "POST")).toBe(false);
    expect(keepable("/api/search?q=1")).toBe(false);
  });

  it("round-trips the server's JSON, per account; another account's workspace answers go when it writes", async () => {
    signedIn("7");
    await keepAnswer("/api/scout/workspaces/41/alliances?season=2026", { links: [1] });
    await keepAnswer("/api/events/2026/AUBRQ1/pick-ratings", { teams: [] });
    expect((await keptAnswer("/api/scout/workspaces/41/alliances?season=2026"))?.data).toEqual({ links: [1] });
    signedIn("8");
    expect(keptAt("/api/scout/workspaces/41/alliances?season=2026")).toBeNull();
    expect(await keptAnswer("/api/scout/workspaces/41/alliances?season=2026")).toBeNull();
    await keepAnswer("/api/events/2026/AUBRQ1/pick-ratings", { teams: [1] });
    signedIn("7");
    expect(keptAt("/api/scout/workspaces/41/alliances?season=2026")).toBeNull(); // dropped: account 8 wrote meanwhile
    expect((await keptAnswer("/api/events/2026/AUBRQ1/pick-ratings"))?.data).toEqual({ teams: [] });
  });

  it("an answer to a request another account asked for is never kept for this one", async () => {
    signedIn("7");
    await keepAnswer("/api/scout/workspaces/41/alliances?season=2026", { links: [1] }, "8");
    expect(keptAt("/api/scout/workspaces/41/alliances?season=2026")).toBeNull();
    await keepAnswer("/api/scout/workspaces/41/alliances?season=2026", { links: [1] }, "7");
    expect(keptAt("/api/scout/workspaces/41/alliances?season=2026")).not.toBeNull();
  });

  it("a typed event search is answered offline (from the season's list) but never kept itself", () => {
    expect(answerableOffline("/api/events?season=2026&q=AUBRQ1&all=1&limit=20")).toBe(true);
    expect(keepable("/api/events?season=2026&q=AUBRQ1&all=1&limit=20")).toBe(false);
    expect(answerableOffline("/api/search?q=1")).toBe(false);
  });

  it("keeps at most MAX_KEPT, the oldest going first", async () => {
    for (let i = 0; i <= MAX_KEPT; i++) await keepAnswer(`/api/teams/${i + 1}`, { team: i + 1 });
    expect(keptAt("/api/teams/1")).toBeNull();
    expect(keptAt(`/api/teams/${MAX_KEPT + 1}`)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("cs-kept-answers")!)).toHaveLength(MAX_KEPT);
  });
});

describe("answers with no signal", () => {
  it("a kept read comes back marked with when it was loaded", async () => {
    await keepAnswer("/api/events/2026/AUBRQ1/pick-ratings", { season: 2026, teams: [{ team: 1 }] });
    const got = await scoutReadAnswer("/api/events/2026/AUBRQ1/pick-ratings");
    expect(got).toEqual({ season: 2026, teams: [{ team: 1 }] });
    expect(offlineSource(got)).toMatchObject({ season: 2026, kept: true, savedAt: keptAt("/api/events/2026/AUBRQ1/pick-ratings") });
    expect(await scoutReadAnswer("/api/events/2026/OTHER/pick-ratings")).toBeNull();
  });

  it("the event list: the kept season list plus every bundled event, narrowed as the server narrows it", async () => {
    await keepAnswer("/api/events?season=2026&all=1&limit=3000", { events: [{ ...ev("USMIQ1", "Michigan Qualifier", "2026-11-01"), city: "Detroit", state: "MI" }] });
    bundles.set("2026:AUBRQ1", { event: { event: { ...ev("AUBRQ1", "Brisbane South Qualifier", "2026-11-07"), venue: "Hall", divisionCode: null, region: "AU", remote: false, website: null, livestream: null, timezone: null, source: "first" }, field: [], matches: [] } });
    writeBundles([{ season: 2026, code: "AUBRQ1", name: "Brisbane South Qualifier", end: "2026-11-08", version: "v", sha256: "x", bytes: 1, savedAt: 1, builtAt: "b", dataAsOf: null, team: null, workspace: null, reports: 0, picklist: false }]);
    const all = await scoutReadAnswer("/api/events?season=2026&all=1&limit=3000") as { events: EventListItem[] };
    expect(all.events.map((e) => e.code)).toEqual(["USMIQ1", "AUBRQ1"]);
    expect(all.events[1]).not.toHaveProperty("venue");
    const q = await scoutReadAnswer("/api/events?season=2026&q=bris&all=1&limit=20") as { events: EventListItem[] };
    expect(q.events.map((e) => e.code)).toEqual(["AUBRQ1"]);
    // Nothing kept for the season at all: still the bundled events.
    await clearKept();
    expect(((await scoutReadAnswer("/api/events?season=2026")) as { events: EventListItem[] }).events.map((e) => e.code)).toEqual(["AUBRQ1"]);
    expect(await scoutReadAnswer("/api/events?season=2025")).toBeNull();
  });

  it("the shortlist: every team asked for, from any kept answer of the season, else who it is with no stats", async () => {
    await keepAnswer("/api/shortlist?teams=1%2C2&season=2026", { season: 2026, teams: [row(1, 10), row(2, 20)] });
    await keepAnswer("/api/shortlist?teams=3&season=2025", { season: 2025, teams: [row(3, 30)] });
    bundles.set("2026:AUBRQ1", { event: { event: ev("AUBRQ1", "B", "2026-11-07"), field: [{ team: 3, name: "Three", city: "Brisbane", state: "QLD" }], matches: [] } });
    writeBundles([{ season: 2026, code: "AUBRQ1", name: "B", end: null, version: "v", sha256: "x", bytes: 1, savedAt: 1, builtAt: "b", dataAsOf: null, team: null, workspace: null, reports: 0, picklist: false }]);
    const got = await scoutReadAnswer("/api/shortlist?teams=2%2C3%2C4&season=2026") as { teams: ShortlistTeam[] };
    expect(got.teams.map((t) => [t.team, t.name, t.opr])).toEqual([[2, "T2", 20], [3, "Three", null], [4, null, null]]);
    expect(got.teams[1].place).toBe("Brisbane, QLD");
    expect(offlineSource(got)?.kept).toBe(true);
    // Nothing known about a team and no bundle of the season: still listed, by number (added with no signal).
    const none = await scoutReadAnswer("/api/shortlist?teams=9&season=2024") as { teams: ShortlistTeam[] };
    expect(none.teams.map((t) => [t.team, t.name, t.opr])).toEqual([[9, null, null]]);
  });

  it("warms the reads Scout needs for a bundled event, in the pages' own path forms", () => {
    expect(warmPaths({ season: 2026, code: "AUBRQ1", teams: [3, 1, 2] })).toEqual([
      "/api/events?season=2026&all=1&limit=3000",
      "/api/events/2026/AUBRQ1/pick-ratings",
      "/api/projections/2026/AUBRQ1",
      "/api/shortlist?teams=1%2C2%2C3&season=2026",
    ]);
    for (const p of warmPaths({ season: 2026, code: "AUBRQ1", teams: [1] })) expect(keepable(p)).toBe(true);
  });
});
