// A recording no one can play here (unavailable on YouTube, or its owner turned off playing it on other sites), as the
// YouTube facts read records it per video (migration 96, video_meta.unplayable_since): first seen kept while it stays
// so, read again weekly, cleared the first read it plays again; and Clip coverage gives its matches that settled reason
// with the date, never "missing".
import { beforeAll, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../db";
import { backfillVideoMeta, type Recording, type VideoMeta } from "./recordings";
import { clipCoverage, FRAME_SETTLES, UNPLAYABLE } from "./coverage";
import { setFrameTimingsForTests } from "../data/frameTimings";

const S = 2025, DAY = 86_400_000;
const ID = "Cg6mn3kNrtE";
const T0 = Date.parse("2026-11-01T00:00:00Z");
const ok = (embed: boolean) => `"playabilityStatus":{"status":"OK","playableInEmbed":${embed}},"lengthSeconds":"26185","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-03-07T13:00:00+00:00","endTimestamp":"2026-03-07T20:16:25+00:00"}`;
let page = "";
const fetchImpl = (async () => new Response(page)) as unknown as typeof fetch;
const read = (at: number) => backfillVideoMeta(() => {}, { apiKey: null, gapMs: 0, fetchImpl, now: () => at });
const row = () => get<{ status: string; embeddable: number | null; unplayable_since: string | null }>("SELECT status, embeddable, unplayable_since FROM video_meta WHERE video_id = ?", [ID]);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'DESTQ', 'Stuttgart', 'Qualifier', '2026-03-07', '2026-03-07', 'UTC', 0, 0, ?, 'test')", [S, `https://www.youtube.com/watch?v=${ID}`]);
});

describe("a video that can't be played here, per video", () => {
  it("first seen is kept while it stays unplayable, read again weekly, and cleared once it plays again", async () => {
    page = ok(false); // embedding off: plays on youtube.com only
    expect(await read(T0)).toBe(1);
    expect(await row()).toEqual({ status: "ok", embeddable: 0, unplayable_since: new Date(T0).toISOString() });
    // Not due within the week; due after it, with or without an API key.
    expect(await read(T0 + 6 * DAY)).toBe(0);
    page = `"playabilityStatus":{"status":"ERROR"}`; // made private since
    expect(await read(T0 + 8 * DAY)).toBe(1);
    expect(await row()).toEqual({ status: "unavailable", embeddable: 0, unplayable_since: new Date(T0).toISOString() });
    page = ok(true); // public again, embedding on
    expect(await read(T0 + 16 * DAY)).toBe(1);
    expect(await row()).toEqual({ status: "ok", embeddable: 1, unplayable_since: null });
  });
});

describe("Clip coverage for a recording that can't be played", () => {
  const meta = (m: Partial<VideoMeta>): VideoMeta => ({ videoId: ID, status: "ok", start: "2026-03-07T13:00:00.000Z", end: "2026-03-07T20:16:25.000Z", length: 26185, live: false, checkedAt: "2026-11-17T10:41:46.213Z", ...m });
  // FIRST's actual start (it has milliseconds), at the venue (UTC here).
  const match = (n: number, at: string) => ({ key: `qual:0:${n}`, label: `Q${n}`, time: `${at}.123`, startsAt: `${at}.123Z`, played: true });
  const NOW = Date.parse("2026-11-17T12:00:00Z");
  // 10 min short, no chapters: clips start up to 10 min early, so matches 5 min apart can't be placed from the clock.
  const short = meta({ length: 26185 - 600 });
  const ms = [match(1, "2026-03-07T14:00:00"), match(2, "2026-03-07T14:05:00")];

  it("embedding off and never frame-read: what a frame read would settle is settled as can't be read, with the date first seen", () => {
    setFrameTimingsForTests([]);
    const r: Recording = { videoId: ID, meta: { ...short, embeddable: false, unplayableSince: "2026-11-15T09:00:00.000Z" }, source: "official" };
    const c = clipCoverage(ms, r, r, "UTC", NOW);
    expect(c.matches.find((m) => m.label === "Q2")).toMatchObject({
      clip: false, reason: "video-no-embed", videoId: ID,
      why: "Recording can't be read: its owner turned off playing it on other sites, so its frames can't be read since 2026-11-15; checked again weekly (last 2026-11-17)",
    });
  });

  it("the same video with embedding on stays a pending video check (nothing readable is hidden)", () => {
    const r: Recording = { videoId: ID, meta: { ...short, embeddable: true }, source: "official" };
    expect(clipCoverage(ms, r, r, "UTC", NOW).matches.find((m) => m.label === "Q2")?.reason).toBe("overlaps-previous");
  });

  it("embedding off but its frames were read anyway: what the video showed is kept", () => {
    setFrameTimingsForTests([{ videoId: ID, code: "DESTQ", checked: "2026-11-16", starts: {} }]);
    const r: Recording = { videoId: ID, code: "DESTQ", meta: { ...short, embeddable: false }, source: "official" };
    expect(clipCoverage(ms, r, r, "UTC", NOW).matches.find((m) => m.label === "Q2")).toMatchObject({ reason: "overlaps-previous", video: { checked: "2026-11-16" } });
    setFrameTimingsForTests([]);
  });

  it("embedding off: only what a frame read alone would settle becomes can't be read; no reason found stays To review", () => {
    // "unexplained" (the clock places it, clear of the one before, yet no clip) is a coverage gap: its clock clip may
    // still be owed (embedding off, clips open on youtube.com), so it's never settled as can't be read.
    expect(FRAME_SETTLES.has("unexplained")).toBe(false);
    expect(FRAME_SETTLES.has("gap-unplaced")).toBe(true);
    expect(FRAME_SETTLES.has("overlaps-previous")).toBe(true);
    expect(UNPLAYABLE.has("unexplained")).toBe(false);
  });

  it("an unavailable video: settled, with since when and its last read", () => {
    const r: Recording = { videoId: ID, meta: meta({ status: "unavailable", unplayableSince: "2026-10-24T00:00:00.000Z" }), source: "official" };
    expect(clipCoverage(ms, r, r, "UTC", NOW).matches[0]).toMatchObject({
      reason: "video-unavailable", why: "Recording can't be played: unavailable on YouTube (private or removed) since 2026-10-24; checked again weekly (last 2026-11-17)",
    });
  });
});
