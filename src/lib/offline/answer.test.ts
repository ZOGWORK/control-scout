// @vitest-environment jsdom
// Routing an API path to the offline readers, over fixture packs.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, MatchView, SearchHit, TeamProfile } from "../../shared/api";
import { season2024, season2025 } from "./testFixture";
import type { SeasonDb } from "./readers";
import { gzipSync } from "node:zlib";
import { BOARDS_TABLE, RANKING_TABLES } from "../../shared/packSchema";
import type { RankingsResponse } from "../../shared/rankings";

let dbs: SeasonDb[] = [];
const reads: (number | undefined)[] = [];
vi.mock("./seasons", () => ({ readSaved: async (only: number | undefined, read: (d: SeasonDb[]) => unknown) => { reads.push(only); return read(dbs.filter((d) => only === undefined || d.season === only)); } }));
vi.mock("../packs", () => ({ loadLite: async () => null }));

import { offlineAnswer } from "./answer";
import { offlineSource, writeSaved, type SavedSeason } from "./saved";

const meta = (season: number): SavedSeason => ({ season, version: "v", sha256: String(season), bytes: 1, savedAt: season, dataAsOf: `${season}-12-01T00:00:00Z`, builtAt: "b" });

beforeAll(async () => { dbs = [await season2025(), await season2024()]; });
beforeEach(() => writeSaved([meta(2024), meta(2025)]));

describe("offlineAnswer", () => {
  it("answers team profiles, marked with the season they came from", async () => {
    const p = await offlineAnswer("/api/teams/100") as TeamProfile;
    expect(p.season).toBe(2025);
    expect(offlineSource(p)).toEqual({ season: 2025, savedAt: 2025, dataAsOf: "2025-12-01T00:00:00Z" });
    const old = await offlineAnswer("/api/teams/100?season=2024") as TeamProfile;
    expect(old.season).toBe(2024);
    expect(offlineSource(old)?.season).toBe(2024);
  });

  it("answers team matches, events (any code case) and search", async () => {
    const tm = await offlineAnswer("/api/teams/100/matches?season=2025") as { team: number; season: number; matches: MatchView[] };
    expect(tm.team).toBe(100);
    expect(tm.matches).toHaveLength(4);
    expect(tm.matches.find((m) => !m.played)?.prediction).toBeNull(); // no lite pack on this device
    const ev = await offlineAnswer("/api/events/2025/usnjq1") as EventDetail;
    expect(ev.event.code).toBe("USNJQ1");
    expect(offlineSource(ev)?.season).toBe(2025);
    const s = await offlineAnswer("/api/search?q=gear&limit=15&prefer=team%3A100") as { q: string; hits: SearchHit[] };
    expect(s.q).toBe("gear");
    expect(s.hits[0].ref).toBe("100");
    expect(offlineSource(s)).not.toBeNull();
    const ev2 = await offlineAnswer("/api/search?q=newark&limit=1&kinds=event%2Cplace") as { hits: SearchHit[] };
    expect(ev2.hits.map((h) => h.kind)).toEqual(["event"]);
  });

  it("opens only the season a season's page asks for", async () => {
    reads.length = 0;
    await offlineAnswer("/api/events/2025/USNJQ1");
    await offlineAnswer("/api/teams/100/matches?season=2024");
    await offlineAnswer("/api/teams/100/matches"); // the newest saved
    expect(reads).toEqual([2025, 2024, 2025]);
  });

  it("is null for what the saved seasons can't answer", async () => {
    expect(await offlineAnswer("/api/teams/100?season=2023")).toBeNull();
    expect(await offlineAnswer("/api/events/2023/USNJQ1")).toBeNull();
    expect(await offlineAnswer("/api/events/2025/NOPE")).toBeNull();
    expect(await offlineAnswer("/api/meta")).toBeNull();
    writeSaved([meta(2024)]); // 2025's bytes may be open, but it's no longer saved
    expect(await offlineAnswer("/api/events/2025/USNJQ1")).toBeNull();
  });
});

describe("offlineAnswer: leaderboards (lib/offline/boards.ts)", () => {
  beforeAll(() => {
    // 2025's pack has the world ranking's tables and boards (2024's is an older pack without them).
    const db = dbs[0].db;
    for (const t of RANKING_TABLES) db.all(t.ddl);
    db.all(BOARDS_TABLE.ddl);
    db.all("INSERT INTO ranking_weeks VALUES (2025, '2025-12-01')");
    db.all("INSERT INTO pack_info VALUES ('current_season', '2025'), ('data_version', '2025-12-02T03:04:05.000Z')");
    const board = (path: string, body: unknown) => db.all("INSERT INTO pack_boards VALUES (?, ?)", [path, gzipSync(Buffer.from(JSON.stringify(body)))]);
    board("/api/records/2025/high-score", { line: { text: "240, Q12", results: ["Not an official record: the event did not play by the game's usual rules"] } });
    board("/api/events?season=2025", { events: [{ code: "USNJQ1" }] });
  });

  it("answers the world ranking from the pack's tables, marked with its season", async () => {
    const r = await offlineAnswer("/api/rankings?season=2025") as RankingsResponse;
    expect(r).toMatchObject({ season: 2025, ranked: 1, asOf: "2025-12-02T03:04:05.000Z", weeks: ["2025-12-01"] });
    expect(r.rows[0]).toMatchObject({ team: 100, rank: 1, rating: 50 });
    expect(offlineSource(r)?.season).toBe(2025);
    // No season asked: the newest saved season that ranks anyone.
    expect((await offlineAnswer("/api/rankings") as RankingsResponse).season).toBe(2025);
    expect(await offlineAnswer("/api/rankings/places?season=2025&team=100")).toMatchObject({ countries: [{ country: "USA", teams: 1 }], mine: "USA:NJ" });
  });

  it("says an older pack without the ranking needs saving again", async () => {
    await expect(offlineAnswer("/api/rankings?season=2024")).rejects.toMatchObject({ offlineAnswer: true, status: 0, message: expect.stringMatching(/Save it again/) });
  });

  it("answers boards as stored (an unofficial record stays marked), and a path with no season from the current season", async () => {
    const hs = await offlineAnswer("/api/records/2025/high-score") as { line: { results: string[] } };
    expect(hs.line.results[0]).toMatch(/^Not an official record/);
    expect(offlineSource(hs)?.season).toBe(2025);
    expect(await offlineAnswer("/api/events")).toEqual({ events: [{ code: "USNJQ1" }] });
    expect(await offlineAnswer("/api/events?season=2025&from=2025-12-01")).toBeNull();
    await expect(offlineAnswer("/api/records/2025/teams?sort=autoPointsOpr&dir=desc&fields=teamName&page=1&pageSize=50")).rejects.toMatchObject({ offlineAnswer: true, status: 0 });
  });
});
