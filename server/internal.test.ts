// GET /internal/teams/:n/videos (server/internal.ts, server/videos/teamVideos.ts): Control Point's team dashboard reads
// a team's Behind the Bot episodes and latest match clips here, with the shared key. Off (404) without a key, 401 on a
// wrong one; clips are the team's own matches only, newest first, FIRST's video before the recording's place.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recs = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock("./videos/recordings.js", async (orig) => {
  const real = await orig<typeof import("./videos/recordings.js")>();
  return {
    ...real,
    seasonRecordings: async () => recs.map,
    // The recording places each match at its number × 100 s (the real placing has its own tests).
    withClips: (ms: { label: string; clip?: unknown }[], r: { videoId: string } | null) =>
      r ? ms.map((m) => ({ ...m, clip: { videoId: r.videoId, t: Number(m.label.slice(1)) * 100, url: "", end: Number(m.label.slice(1)) * 100 + 160 } })) : ms,
    eventMatchSpan: async () => ({ firstMatch: null, lastMatch: null, starts: [] }),
  };
});

import { kvSet, migrate, openDb, run, setDb } from "./db";
import { clearAllCaches } from "./caches";
import { createApp } from "./app";
import { setFeaturedFor, MAX_CLIPS } from "./videos/teamVideos";

const KEY = "k".repeat(40);
const S = 2025;
let server: Server | null = null;

async function event(code: string, start: string, name = `${code} Qualifier`) {
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 'America/New_York', 0, 0, 'test')", [S, code, name, start, start]);
}
async function match(code: string, n: number, teams: number[], o: { video?: string; level?: string; played?: number } = {}) {
  const level = o.level ?? "qual";
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, video, source) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 'test')",
    [S, code, level, n, `${level === "qual" ? "Q" : "P"}${n}`, `2025-11-01T${String(9 + n).padStart(2, "0")}:00:00`, o.played ?? 1, o.video ?? null]);
  for (const [i, t] of teams.entries()) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, ?, 0, ?, ?, ?)", [S, code, level, n, t, i < 2 ? "red" : "blue"]);
}

async function get(path: string, key?: string) {
  if (!server) { server = createApp().listen(0); await new Promise((r) => server!.once("listening", r)); }
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { headers: key ? { "X-Internal-Key": key } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  await kvSet("data:version", "v1");
  recs.map = new Map();
  process.env.CONTROL_POINT_INTERNAL_KEY = KEY;
  setFeaturedFor(async () => []);
});
afterEach(async () => {
  delete process.env.CONTROL_POINT_INTERNAL_KEY;
  setFeaturedFor(null);
  if (server) { await new Promise((r) => server!.close(r)); server = null; }
});

describe("/internal auth", () => {
  it("is off (404) without a key, or with one shorter than 32 characters", async () => {
    delete process.env.CONTROL_POINT_INTERNAL_KEY;
    expect((await get("/internal/teams/1/videos", KEY)).status).toBe(404);
    process.env.CONTROL_POINT_INTERNAL_KEY = "short";
    expect((await get("/internal/teams/1/videos", "short")).status).toBe(404);
  });
  it("answers 401 to a missing or wrong key", async () => {
    expect((await get("/internal/teams/1/videos")).status).toBe(401);
    expect((await get("/internal/teams/1/videos", "x".repeat(40))).status).toBe(401);
    expect((await get("/internal/teams/1/videos", KEY.slice(1))).status).toBe(401);
  });
  it("answers 400 to a team that isn't a number, and 404 to an unknown path", async () => {
    expect((await get("/internal/teams/abc/videos", KEY)).status).toBe(400);
    expect((await get("/internal/teams/0/videos", KEY)).status).toBe(400);
    expect((await get("/internal/nope", KEY)).status).toBe(404);
  });
});

describe("GET /internal/teams/:n/videos", () => {
  it("a team with no matches: nothing", async () => {
    expect(await get("/internal/teams/12345/videos", KEY)).toEqual({ status: 200, body: { featured: [], clips: [] } });
  });

  it("clips are the team's own played matches, newest event first, FIRST's video before the recording", async () => {
    await event("OLD", "2025-10-01");
    await event("NEW", "2025-11-01", "New Jersey Championship");
    await match("OLD", 1, [100, 2, 3, 4], { video: "https://www.youtube.com/watch?v=aaaaaaaaaaa&t=42" });
    await match("NEW", 1, [100, 2, 3, 4]);
    await match("NEW", 2, [5, 6, 7, 8]); // not the team's
    await match("NEW", 3, [9, 100, 7, 8]);
    await match("NEW", 4, [100, 6, 7, 8], { played: 0 }); // still to play
    await match("NEW", 1, [100, 2, 3, 4], { level: "playoff", video: "https://youtu.be/bbbbbbbbbbb?t=7" });
    recs.map.set("NEW", { videoId: "ccccccccccc", meta: null });
    const { status, body } = await get("/internal/teams/100/videos", KEY);
    expect(status).toBe(200);
    expect(body.clips).toEqual([
      { videoId: "bbbbbbbbbbb", start: 7, end: null, event: "New Jersey Championship", match: "P1", title: "P1 · New Jersey Championship" },
      { videoId: "ccccccccccc", start: 300, end: 460, event: "New Jersey Championship", match: "Q3", title: "Q3 · New Jersey Championship" },
      { videoId: "ccccccccccc", start: 100, end: 260, event: "New Jersey Championship", match: "Q1", title: "Q1 · New Jersey Championship" },
      { videoId: "aaaaaaaaaaa", start: 42, end: null, event: "OLD Qualifier", match: "Q1", title: "Q1 · OLD Qualifier" },
    ]);
  });

  it("a match with no video and no recording has no clip; at most six are sent", async () => {
    await event("E", "2025-11-01");
    for (let n = 1; n <= 9; n++) await match("E", n, [100, 2, 3, 4]);
    expect((await get("/internal/teams/100/videos", KEY)).body.clips).toEqual([]);
    recs.map.set("E", { videoId: "ccccccccccc", meta: null });
    const clips = (await get("/internal/teams/100/videos", KEY)).body.clips;
    expect(clips).toHaveLength(MAX_CLIPS);
    expect(clips.map((c: { match: string }) => c.match)).toEqual(["Q9", "Q8", "Q7", "Q6", "Q5", "Q4"]);
  });

  it("featured: creatorVideos' episodes, only the contract's fields, malformed rows dropped", async () => {
    setFeaturedFor(async (t) => (t === 100 ? [
      { series: "behind-the-bot", videoId: "ddddddddddd", season: 2025, title: "Behind the Bot: 100", description: "dropped" },
      { series: "behind-the-bot", videoId: "not-an-id", season: 2025, title: "bad id" },
      { series: "behind-the-bot", videoId: "eeeeeeeeeee", season: "2024", title: "Season unknown" },
      null,
    ] : []));
    expect((await get("/internal/teams/100/videos", KEY)).body.featured).toEqual([
      { series: "behind-the-bot", videoId: "ddddddddddd", season: 2025, title: "Behind the Bot: 100" },
      { series: "behind-the-bot", videoId: "eeeeeeeeeee", season: null, title: "Season unknown" },
    ]);
    expect((await get("/internal/teams/7/videos", KEY)).body.featured).toEqual([]);
  });

  it("featured: none (never an error) when creatorVideos throws, e.g. its tables are missing", async () => {
    setFeaturedFor(async () => { throw new Error("no such table: creator_videos"); });
    expect(await get("/internal/teams/100/videos", KEY)).toEqual({ status: 200, body: { featured: [], clips: [] } });
  });
});
