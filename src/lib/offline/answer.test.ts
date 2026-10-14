// @vitest-environment jsdom
// Routing an API path to the offline readers, over fixture packs.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, MatchView, SearchHit, TeamProfile } from "../../shared/api";
import { season2024, season2025 } from "./testFixture";
import type { SeasonDb } from "./readers";

let dbs: SeasonDb[] = [];
vi.mock("./seasons", () => ({ openSaved: async () => dbs }));
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
