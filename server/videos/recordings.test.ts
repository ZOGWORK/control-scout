// Event recordings end to end on the real app: FIRST's YouTube link becomes the event's player when the owner set
// none, YouTube's timing (read in the background, here from a stand-in page) puts each played match on its second,
// the events list says what there is to watch, and a removed video, a channel page or Twitch gives nothing.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { clearAllCaches } from "../caches";
import { backfillVideoMeta, due, firstVideoId, type VideoMeta } from "./recordings";

let server: Server;
let base = "";
const S = 2025;
const DAY = "2026-05-02";
const FIRST_ID = "WQUBVjbh-hM", GONE_ID = "SXVDvK3XiOM", UPLOAD_ID = "dQw4w9WgXcQ", OWNER_ID = "9i15Y3g5BqQ", GAPPED_ID = "KjjznpzWGmo";

// What each video's watch page says.
const pages: Record<string, string> = {
  [FIRST_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"16541","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"${DAY}T12:58:13+00:00","endTimestamp":"${DAY}T17:33:56+00:00"}`,
  [GONE_ID]: `"playabilityStatus":{"status":"ERROR"}`,
  [UPLOAD_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"213"`,
  [GAPPED_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"30807","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"${DAY}T10:00:00+00:00","endTimestamp":"${DAY}T20:12:31+00:00"}`,
  [OWNER_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"30807","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"${DAY}T12:00:00+00:00","endTimestamp":"${DAY}T20:33:00+00:00"}`,
};
const read: string[] = [];
const fakeFetch = (async (url: string) => {
  const id = new URL(url).searchParams.get("v")!;
  read.push(id);
  return new Response(pages[id] ?? "", { status: pages[id] ? 200 : 404 });
}) as unknown as typeof fetch;

async function event(code: string, livestream: string | null) {
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 'UTC', 0, 0, ?, 'test')", [S, code, `Event ${code}`, DAY, DAY, livestream]);
}
async function match(code: string, n: number, time: string, played = true, video: string | null = null) {
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, video, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')",
    [S, code, n, `Q${n}`, time, played ? 1 : 0, played ? 50 : null, played ? 50 : null, played ? 40 : null, played ? 40 : null, video]);
}
const getJson = async (path: string) => (await fetch(`${base}${path}`)).json() as Promise<any>;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
  await event("CLIPS", `https://www.youtube.com/watch?v=${FIRST_ID}`);
  await match("CLIPS", 1, `${DAY}T13:00:13`);          // 2 min in
  await match("CLIPS", 2, `${DAY}T16:55:18`);          // 3:57:05 in
  await match("CLIPS", 3, `${DAY}T18:00:00`);          // after the video ends
  await match("CLIPS", 4, `${DAY}T14:00:00`, false);   // not played: its time is a schedule
  await event("GONE", `https://youtu.be/${GONE_ID}`);
  await event("UPLOAD", `youtube.com/live/${UPLOAD_ID}?feature=share`);
  await match("UPLOAD", 1, `${DAY}T13:00:13`);
  await event("GAPPED", `https://www.youtube.com/watch?v=${GAPPED_ID}`); // dropped out: the video is 1 h 41 min short
  await match("GAPPED", 1, `${DAY}T10:30:00`);
  await event("CHANNEL", "https://www.youtube.com/@XPR-v4m/streams");
  await event("TWITCH", "https://twitch.tv/tbtaonline");
  await event("OWNER", `https://www.youtube.com/watch?v=${FIRST_ID}`); // the owner's stream wins over FIRST's
  await run("INSERT INTO event_streams (season, code, url, video_id, updated_at, updated_by) VALUES (?, 'OWNER', ?, ?, ?, 'owner@test')", [S, `https://www.youtube.com/watch?v=${OWNER_ID}`, OWNER_ID, new Date().toISOString()]);
  await match("OWNER", 1, `${DAY}T13:00:20`);
  await event("OFFICIAL", null);
  await match("OFFICIAL", 1, `${DAY}T13:00:00`, true, "https://www.youtube.com/watch?v=DXkaHI2j1_I");
  await kvSet("data:version", "v1");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("event recordings", () => {
  it("before YouTube is read: FIRST's video is the player, no match clips yet", async () => {
    const d = await getJson(`/api/events/${S}/CLIPS`);
    expect(d.event.stream).toEqual({ videoId: FIRST_ID, streamUrl: `https://www.youtube-nocookie.com/embed/${FIRST_ID}`, source: "first" });
    expect(d.matches.some((m: any) => m.clip)).toBe(false);
  });

  it("reads each linked YouTube video once, and nothing for channel pages or Twitch", async () => {
    expect(await backfillVideoMeta(() => {}, { gapMs: 0, fetchImpl: fakeFetch })).toBe(5);
    expect(read.sort()).toEqual([FIRST_ID, GAPPED_ID, GONE_ID, OWNER_ID, UPLOAD_ID].sort());
    expect(await backfillVideoMeta(() => {}, { gapMs: 0, fetchImpl: fakeFetch })).toBe(0); // nothing due again
    expect(await get("SELECT status FROM video_meta WHERE video_id = ?", [GONE_ID])).toEqual({ status: "unavailable" });
    clearAllCaches();
  });

  it("puts each played match inside the video on its second, with a lead-in", async () => {
    const d = await getJson(`/api/events/${S}/CLIPS`);
    const clip = (n: number) => d.matches.find((m: any) => m.number === n).clip ?? null;
    expect(clip(1)).toEqual({ videoId: FIRST_ID, t: 100, url: `https://www.youtube.com/watch?v=${FIRST_ID}&t=100s` });
    expect(clip(2).t).toBe(14205);
    expect(clip(3)).toBeNull(); // after the video ends
    expect(clip(4)).toBeNull(); // not played
    const m = await getJson(`/api/events/${S}/CLIPS/matches/qual:0:1`);
    expect(m.match.clip.t).toBe(100);
  });

  it("the owner's stream wins, with its own timing", async () => {
    const d = await getJson(`/api/events/${S}/OWNER`);
    expect(d.event.stream.videoId).toBe(OWNER_ID);
    expect(d.event.stream.source).toBeUndefined();
    expect(d.matches[0].clip.t).toBe(3620 - 20);
  });

  it("an upload, or a broadcast with a gap, plays but has no clips; a removed video, a channel page and Twitch give no player", async () => {
    for (const [code, id] of [["UPLOAD", UPLOAD_ID], ["GAPPED", GAPPED_ID]]) {
      const d = await getJson(`/api/events/${S}/${code}`);
      expect(d.event.stream.videoId).toBe(id);
      expect(d.matches[0].clip).toBeUndefined();
    }
    for (const code of ["GONE", "CHANNEL", "TWITCH"]) expect((await getJson(`/api/events/${S}/${code}`)).event.stream).toBeUndefined();
  });

  it("the events list says what there is to watch", async () => {
    const { events } = await getJson(`/api/events?season=${S}`);
    const by = Object.fromEntries(events.map((e: any) => [e.code, e.video ?? null]));
    expect(by).toEqual({ CLIPS: "clips", OWNER: "clips", OFFICIAL: "clips", UPLOAD: "recording", GAPPED: "recording", GONE: null, CHANNEL: null, TWITCH: null });
  });
});

describe("when a video is read again", () => {
  const meta = (m: Partial<VideoMeta>): VideoMeta => ({ videoId: "x", status: "ok", start: null, end: null, length: 1, live: false, checkedAt: "2026-05-02T00:00:00Z", ...m });
  const t = (iso: string) => Date.parse(iso);
  it("never read: now; an error: after a day; a live broadcast: after 5 minutes", () => {
    expect(due(null, 0)).toBe(true);
    expect(due(meta({ status: "error" }), t("2026-05-02T23:00:00Z"))).toBe(false);
    expect(due(meta({ status: "error" }), t("2026-05-03T01:00:00Z"))).toBe(true);
    expect(due(meta({ live: true }), t("2026-05-02T00:06:00Z"))).toBe(true);
  });
  it("a fresh archive after 6 hours for 2 days, then never; an upload or removed video never", () => {
    const fresh = meta({ start: "2026-05-01T12:00:00Z", end: "2026-05-01T20:00:00Z" });
    expect(due(fresh, t("2026-05-02T07:00:00Z"))).toBe(true);
    expect(due({ ...fresh, checkedAt: "2026-05-04T00:00:00Z" }, t("2026-05-20T00:00:00Z"))).toBe(false);
    expect(due(meta({}), t("2027-01-01T00:00:00Z"))).toBe(false);
    expect(due(meta({ status: "unavailable" }), t("2027-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("FIRST's link to a YouTube video", () => {
  it("takes video links, leaves channel pages and other sites", () => {
    expect(firstVideoId("https://youtube.com/live/qMxXAQ7rBXc?feature=share")).toBe("qMxXAQ7rBXc");
    expect(firstVideoId("https://www.youtube.com/live/9i15Y3g5BqQ?si=DHtV0yMHF2hHCJfJ")).toBe("9i15Y3g5BqQ");
    expect(firstVideoId("https://youtube.com/@funroboticsnetwork/streams")).toBeNull();
    expect(firstVideoId("https://twitch.tv/tbtaonline")).toBeNull();
    expect(firstVideoId(null)).toBeNull();
  });
});
