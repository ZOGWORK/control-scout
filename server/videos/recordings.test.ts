// Event recordings end to end on the real app: FIRST's YouTube link becomes the event's player when the owner set
// none, YouTube's timing (read in the background, here from a stand-in page) puts each played match on its second,
// the events list says what there is to watch, and a removed video, a channel page or Twitch gives nothing.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { clearAllCaches } from "../caches";
import { backfillVideoMeta, due, firstVideoId, type VideoMeta } from "./recordings";

let server: Server;
let base = "";
const S = 2025;
const DAY = "2026-05-02";
const FIRST_ID = "WQUBVjbh-hM", GONE_ID = "SXVDvK3XiOM", UPLOAD_ID = "dQw4w9WgXcQ", OWNER_ID = "9i15Y3g5BqQ", GAPPED_ID = "KjjznpzWGmo", TRIMMED_ID = "7VF5ax17flg", CHAPTERED_ID = "96RZLC94jE4", SHORT_ID = "Gh5ShortGap";

// What each video's watch page says.
const pages: Record<string, string> = {
  [FIRST_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"16541","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"${DAY}T12:58:13+00:00","endTimestamp":"${DAY}T17:33:56+00:00"}`,
  [GONE_ID]: `"playabilityStatus":{"status":"ERROR"}`,
  [UPLOAD_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"213"`,
  [GAPPED_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"30807","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"${DAY}T10:00:00+00:00","endTimestamp":"${DAY}T20:12:31+00:00"}`,
  // Left running 7 h after the event, the archive cut 10 min after the last match: 11 h broadcast, 4 h 10 min video.
  [TRIMMED_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"15000","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"${DAY}T12:00:00+00:00","endTimestamp":"${DAY}T23:00:00+00:00"}`,
  // Left running overnight, the archive kept its first 5 h: an hour after the last match, too long to tell a cut from
  // the clock alone. Its chapters ("Match one" …, a minute and a half before each match) show it's a cut.
  [CHAPTERED_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"18000","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"${DAY}T12:00:00+00:00","endTimestamp":"${DAY}T23:00:00+00:00"}`
    + ["Opening", ...["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].map((w) => `Match ${w}`)]
      .map((title, i) => `"chapterRenderer":{"title":{"simpleText":"${title}"},"timeRangeStartMillis":${i ? (1200 * i - 90) * 1000 : 0}}`).join(","),
  // A drop-out of 10 min somewhere in an 8 h broadcast, no chapters: under GAP_SLACK_MAX_S, so clips start early by all of it.
  [SHORT_ID]: `"playabilityStatus":{"status":"OK"},"lengthSeconds":"28200","liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"${DAY}T10:00:00+00:00","endTimestamp":"${DAY}T18:00:00+00:00"}`,
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
  await match("CLIPS", 5, `${DAY}T15:00:00`);          // played, but posted without a start: the schedule
  await event("ELSEWHEN", `https://www.youtube.com/watch?v=${FIRST_ID}`); // same video, matches on another day
  await match("ELSEWHEN", 1, `2026-05-01T13:00:13`);
  await event("GONE", `https://youtu.be/${GONE_ID}`);
  await event("UPLOAD", `youtube.com/live/${UPLOAD_ID}?feature=share`);
  await match("UPLOAD", 1, `${DAY}T13:00:13`);
  await event("GAPPED", `https://www.youtube.com/watch?v=${GAPPED_ID}`); // dropped out: the video is 1 h 41 min short
  await match("GAPPED", 1, `${DAY}T10:30:00`);
  await event("SHORT", `https://www.youtube.com/watch?v=${SHORT_ID}`);
  await match("SHORT", 1, `${DAY}T11:00:00.5`);         // 1 h in
  await match("SHORT", 2, `${DAY}T17:55:00.5`);         // 7 h 55 min in: past the video's length, inside its last 10 min
  await match("SHORT", 3, `${DAY}T18:20:00.5`);         // after the broadcast ended
  await match("SHORT", 4, `${DAY}T11:08:00.5`);         // 8 min after Q1: started 10 min early, its clip would open on Q1's play
  await match("SHORT", 5, `${DAY}T11:22:00.5`);         // 14 min after Q4: Q4's play is over before its early start
  await event("TRIMMED", `https://www.youtube.com/watch?v=${TRIMMED_ID}`);
  await match("TRIMMED", 1, `${DAY}T12:30:00.5`);
  await match("TRIMMED", 2, `${DAY}T16:00:00.5`);       // the last match: 4 h in, 10 min before the video ends
  await event("CHAPTERED", `https://www.youtube.com/watch?v=${CHAPTERED_ID}`);
  for (let n = 1; n <= 12; n++) await match("CHAPTERED", n, new Date(Date.parse(`${DAY}T12:00:00.5Z`) + n * 1200_000).toISOString().slice(0, 23));
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
    expect(await backfillVideoMeta(() => {}, { apiKey: null, gapMs: 0, fetchImpl: fakeFetch })).toBe(8);
    // A video far shorter than its broadcast whose page showed no chapters is read once more (YouTube now and then leaves them out).
    expect(read.sort()).toEqual([CHAPTERED_ID, FIRST_ID, GAPPED_ID, GAPPED_ID, GONE_ID, OWNER_ID, SHORT_ID, TRIMMED_ID, TRIMMED_ID, UPLOAD_ID].sort());
    expect(await backfillVideoMeta(() => {}, { apiKey: null, gapMs: 0, fetchImpl: fakeFetch })).toBe(0); // nothing due again
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
    expect(clip(5)).toBeNull(); // played, on the minute: a schedule
    const m = await getJson(`/api/events/${S}/CLIPS/matches/qual:0:1`);
    expect(m.match.clip.t).toBe(100);
  });

  it("the owner's stream wins, with its own timing", async () => {
    const d = await getJson(`/api/events/${S}/OWNER`);
    expect(d.event.stream.videoId).toBe(OWNER_ID);
    expect(d.event.stream.source).toBeUndefined();
    expect(d.matches[0].clip.t).toBe(3620 - 20);
  });

  it("a stream left running after the event, its archive cut at the end, still puts each match on its second", async () => {
    const d = await getJson(`/api/events/${S}/TRIMMED`);
    expect(d.matches.map((m: any) => m.clip?.t ?? null)).toEqual([1800 - 20, 14400 - 20]);
    // One match on its own gets the same second: the event's first and last matches are read for it.
    expect((await getJson(`/api/events/${S}/TRIMMED/matches/qual:0:1`)).match.clip.t).toBe(1800 - 20);
  });

  it("a video cut short whose chapters sit by their matches all day: each match on its second, but the last few", async () => {
    const d = await getJson(`/api/events/${S}/CHAPTERED`);
    // The last three have too few chapters after them to rule out a late gap.
    expect(d.matches.map((m: any) => m.clip?.t ?? null)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (n <= 9 ? 1200 * n - 20 : null)));
    expect((await getJson(`/api/events/${S}/CHAPTERED/matches/qual:0:3`)).match.clip.t).toBe(3600 - 20);
    expect(JSON.parse((await get<{ chapters: string }>("SELECT chapters FROM video_meta WHERE video_id = ?", [CHAPTERED_ID]))!.chapters)[1]).toEqual([1110, "Match one"]);
  });

  it("a broadcast up to 15 min short, the gap unplaced: each match starts early by all of it, marked early, but never on the match before", async () => {
    const d = await getJson(`/api/events/${S}/SHORT`);
    const t = Object.fromEntries(d.matches.map((m: any) => [m.label, m.clip?.t ?? null]));
    expect(t).toEqual({ Q1: 3600 - 600 - 20, Q2: 28500 - 600 - 20, Q3: null, Q4: null, Q5: 4920 - 600 - 20 });
    expect(d.matches[0].clip).toMatchObject({ videoId: SHORT_ID, early: 600 });
    // One match on its own gets the same second.
    expect((await getJson(`/api/events/${S}/SHORT/matches/qual:0:2`)).match.clip).toMatchObject({ t: 28500 - 600 - 20, early: 600 });
  });

  it("an upload, or a broadcast with a gap, plays but has no clips; a removed video, a channel page and Twitch give no player", async () => {
    for (const [code, id] of [["UPLOAD", UPLOAD_ID], ["GAPPED", GAPPED_ID]]) {
      const d = await getJson(`/api/events/${S}/${code}`);
      expect(d.event.stream.videoId).toBe(id);
      expect(d.matches[0].clip).toBeUndefined();
    }
    for (const code of ["GONE", "CHANNEL", "TWITCH"]) expect((await getJson(`/api/events/${S}/${code}`)).event.stream).toBeUndefined();
  });

  it("the events list says what there is to watch (match clips only when a played match gets one)", async () => {
    const { events } = await getJson(`/api/events?season=${S}`);
    const by = Object.fromEntries(events.map((e: any) => [e.code, e.video ?? null]));
    expect(by).toEqual({ CLIPS: "clips", OWNER: "clips", CHAPTERED: "clips", OFFICIAL: "clips", UPLOAD: "recording", GAPPED: "recording", TRIMMED: "clips", SHORT: "clips", ELSEWHEN: "recording", GONE: null, CHANNEL: null, TWITCH: null });
  });

  it("an event above divisions shows the best of its divisions' video (USTXCMP4 2026 had none, its divisions had video)", async () => {
    await event("CHAMP", null);
    await event("PAIR", null);
    await run("UPDATE events SET division_code = 'CHAMP' WHERE season = ? AND code IN ('UPLOAD', 'CLIPS')", [S]);
    await run("UPDATE events SET division_code = 'PAIR' WHERE season = ? AND code = 'GAPPED'", [S]);
    try {
      clearAllCaches();
      const { events } = await getJson(`/api/events?season=${S}&all=1`);
      const by = Object.fromEntries(events.map((e: any) => [e.code, e.video ?? null]));
      expect(by).toMatchObject({ CHAMP: "clips", PAIR: "recording", UPLOAD: "recording", CLIPS: "clips", GAPPED: "recording" });
    } finally {
      await run("UPDATE events SET division_code = NULL WHERE season = ? AND code IN ('UPLOAD', 'CLIPS', 'GAPPED')", [S]);
      await run("DELETE FROM events WHERE season = ? AND code IN ('CHAMP', 'PAIR')", [S]);
      clearAllCaches();
    }
  });
});

describe("a page that can't be read", () => {
  it("keeps the facts read before, a live broadcast still live, so it's read again on the live beat", async () => {
    const LIVE_ID = "LiveStream1";
    await event("LIVE", `https://www.youtube.com/watch?v=${LIVE_ID}`);
    const then = Date.parse("2026-05-02T14:00:00Z");
    const live = (async () => new Response(`"playabilityStatus":{"status":"OK"},"liveBroadcastDetails":{"isLiveNow":true,"startTimestamp":"${DAY}T12:00:00+00:00"}`)) as unknown as typeof fetch;
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await backfillVideoMeta(() => {}, { apiKey: null, gapMs: 0, fetchImpl: live, now: () => then });
    expect(await backfillVideoMeta(() => {}, { apiKey: null, gapMs: 0, fetchImpl: down, now: () => then + 6 * 60_000 })).toBe(1);
    expect(await get("SELECT status, start, live FROM video_meta WHERE video_id = ?", [LIVE_ID])).toEqual({ status: "ok", start: `${DAY}T12:00:00.000Z`, live: 1 });
    expect(await backfillVideoMeta(() => {}, { apiKey: null, gapMs: 0, fetchImpl: live, now: () => then + 12 * 60_000 })).toBe(1); // due again
  });
});

describe("when a video is read again", () => {
  const meta = (m: Partial<VideoMeta>): VideoMeta => ({ videoId: "x", status: "ok", start: null, end: null, length: 1, live: false, checkedAt: "2026-05-02T00:00:00Z", ...m });
  const t = (iso: string) => Date.parse(iso);
  it("never read: now; an error: after a day; a live broadcast: after 5 minutes; a scheduled one: after an hour", () => {
    expect(due(null, 0)).toBe(true);
    expect(due(meta({ live: true, start: null }), t("2026-05-02T00:30:00Z"))).toBe(false);
    expect(due(meta({ live: true, start: null }), t("2026-05-02T01:01:00Z"))).toBe(true);
    expect(due(meta({ status: "error" }), t("2026-05-02T23:00:00Z"))).toBe(false);
    expect(due(meta({ status: "error" }), t("2026-05-03T01:00:00Z"))).toBe(true);
    // With an API key, an error (say the watch page's sign-in wall, read before the key was set) is tried again in 15 minutes.
    expect(due(meta({ status: "error" }), t("2026-05-02T00:10:00Z"), true)).toBe(false);
    expect(due(meta({ status: "error" }), t("2026-05-02T00:16:00Z"), true)).toBe(true);
    expect(due(meta({ live: true, start: "2026-05-01T23:00:00Z" }), t("2026-05-02T00:06:00Z"))).toBe(true);
  });
  it("a fresh archive after 6 hours for 2 days, then never; an upload or removed video never", () => {
    const fresh = meta({ start: "2026-05-01T12:00:00Z", end: "2026-05-01T20:00:00Z" });
    expect(due(fresh, t("2026-05-02T07:00:00Z"))).toBe(true);
    expect(due({ ...fresh, checkedAt: "2026-05-04T00:00:00Z", length: 28800 }, t("2026-05-20T00:00:00Z"))).toBe(false);
    expect(due(meta({}), t("2027-01-01T00:00:00Z"))).toBe(false);
    expect(due(meta({ status: "unavailable" }), t("2027-01-01T00:00:00Z"))).toBe(false);
  });
  it("a video far shorter than its broadcast whose chapters were never read: after a day, then not again once read", () => {
    const cut = meta({ start: "2026-05-01T12:00:00Z", end: "2026-05-01T23:00:00Z", length: 18000, checkedAt: "2026-05-04T00:00:00Z" });
    expect(due(cut, t("2026-05-04T12:00:00Z"))).toBe(false);
    expect(due(cut, t("2026-05-05T01:00:00Z"))).toBe(true);
    expect(due({ ...cut, chapters: [[60, "Match one"]] }, t("2027-01-01T00:00:00Z"))).toBe(false);
    // Read with none: none yet, or a page served without them: weekly.
    expect(due({ ...cut, chapters: [] }, t("2026-05-10T00:00:00Z"))).toBe(false);
    expect(due({ ...cut, chapters: [] }, t("2026-05-11T01:00:00Z"))).toBe(true);
    // Short of it by 15 min or less (an early start covers that: gapSlack): chapters wouldn't be used, so never read for them.
    expect(due({ ...cut, length: 39600 - 900 }, t("2027-01-01T00:00:00Z"))).toBe(false);
    // 26 min short: read (it was left out under the old half-hour mark, with no early start either).
    expect(due({ ...cut, length: 38000 }, t("2026-05-05T01:00:00Z"))).toBe(true);
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

describe("with a YouTube API key", () => {
  it("a page served without chapters never wipes the ones read before", async () => {
    const before = await get<{ chapters: string }>("SELECT chapters FROM video_meta WHERE video_id = ?", [CHAPTERED_ID]);
    const bare = (async () => new Response(pages[CHAPTERED_ID].replace(/"chapterRenderer".*$/, ""))) as unknown as typeof fetch;
    // Due again: an archive that ended just now is read every 6 hours.
    await run("UPDATE video_meta SET end = ?, checked_at = ? WHERE video_id = ?", [new Date().toISOString(), "2026-01-01T00:00:00Z", CHAPTERED_ID]);
    await backfillVideoMeta(() => {}, { apiKey: null, gapMs: 0, fetchImpl: bare });
    expect((await get<{ chapters: string }>("SELECT chapters FROM video_meta WHERE video_id = ?", [CHAPTERED_ID]))!.chapters).toBe(before!.chapters);
  });

  it("a video the API says was cut short has its chapters read from the watch page", async () => {
    await run("DELETE FROM video_meta WHERE video_id = ?", [CHAPTERED_ID]);
    const asked: string[] = [];
    const both = (async (url: string) => {
      const u = new URL(url);
      if (u.hostname === "www.googleapis.com") {
        // Every video whole (a 5 h broadcast, 5 h of video), but this one, 5 h of an 11 h broadcast.
        const ids = u.searchParams.get("id")!.split(",");
        return Response.json({ items: ids.map((id) => ({ id, contentDetails: { duration: "PT5H" }, liveStreamingDetails: { actualStartTime: `${DAY}T12:00:00Z`, actualEndTime: `${DAY}T${id === CHAPTERED_ID ? 23 : 17}:00:00Z` } })) });
      }
      asked.push(u.searchParams.get("v")!);
      return fakeFetch(url);
    }) as unknown as typeof fetch;
    await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: both });
    expect(asked).toEqual([CHAPTERED_ID]);
    expect(await get("SELECT duration, chapters IS NOT NULL AS read FROM video_meta WHERE video_id = ?", [CHAPTERED_ID])).toEqual({ duration: 18000, read: 1 });
    clearAllCaches();
    expect((await getJson(`/api/events/${S}/CHAPTERED`)).matches[0].clip.t).toBe(1200 - 20);
  });

  it("a video cut short whose watch page is YouTube's sign-in wall still has its chapters read from that page", async () => {
    await run("DELETE FROM video_meta WHERE video_id = ?", [CHAPTERED_ID]);
    // The server is shown "Sign in to confirm you're not a bot": no facts, but the chapters are on the page.
    const wall = pages[CHAPTERED_ID].replace('"status":"OK"', '"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you’re not a bot"');
    const both = (async (url: string) => {
      const u = new URL(url);
      if (u.hostname === "www.googleapis.com") {
        const ids = u.searchParams.get("id")!.split(",");
        return Response.json({ items: ids.map((id) => ({ id, contentDetails: { duration: "PT5H" }, liveStreamingDetails: { actualStartTime: `${DAY}T12:00:00Z`, actualEndTime: `${DAY}T${id === CHAPTERED_ID ? 23 : 17}:00:00Z` } })) });
      }
      return u.searchParams.get("v") === CHAPTERED_ID ? new Response(wall) : fakeFetch(url);
    }) as unknown as typeof fetch;
    await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: both });
    const row = await get<{ status: string; duration: number; chapters: string }>("SELECT status, duration, chapters FROM video_meta WHERE video_id = ?", [CHAPTERED_ID]);
    expect(row).toMatchObject({ status: "ok", duration: 18000 });
    expect(JSON.parse(row!.chapters)[1]).toEqual([1110, "Match one"]);
    clearAllCaches();
    expect((await getJson(`/api/events/${S}/CHAPTERED`)).matches[0].clip.t).toBe(1200 - 20);
  });

  it("reads due videos 50 to a request through the API, every batch saved, never the watch page", async () => {
    await run("DELETE FROM video_meta");
    // 51 more linked videos, so the due ones need two requests.
    const extra = Array.from({ length: 51 }, (_, i) => `Batch${String(i).padStart(6, "0")}`);
    for (const [i, id] of extra.entries()) await event(`B${i}`, `https://www.youtube.com/watch?v=${id}`);
    const sizes: number[] = [];
    const api = (async (url: string) => {
      expect(url).toContain("googleapis.com/youtube/v3/videos");
      const ids = new URL(url).searchParams.get("id")!.split(",");
      sizes.push(ids.length);
      return Response.json({ items: ids.filter((id) => id !== GONE_ID).map((id) => ({ id, contentDetails: { duration: "PT4H35M41S" }, liveStreamingDetails: { actualStartTime: `${DAY}T12:58:13Z`, actualEndTime: `${DAY}T17:33:56Z` } })) });
    }) as unknown as typeof fetch;
    const n = await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: api });
    expect(sizes[0]).toBe(50);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
    expect(sizes.length).toBe(Math.ceil(n / 50));
    expect(n).toBeGreaterThan(51);
    expect(await get("SELECT status, duration FROM video_meta WHERE video_id = ?", [FIRST_ID])).toEqual({ status: "ok", duration: 16541 });
    expect(await get("SELECT status, duration FROM video_meta WHERE video_id = ?", [extra[extra.length - 1]])).toEqual({ status: "ok", duration: 16541 });
    expect(await get("SELECT status FROM video_meta WHERE video_id = ?", [GONE_ID])).toEqual({ status: "unavailable" });
  });

  it("a pass that never finishes doesn't stop the next one for good", async () => {
    await event("STUCK", "https://www.youtube.com/watch?v=Stuck000001");
    // A read that never settles: the pass waits on it for ever.
    let hung = false;
    const never = (async () => { hung = true; return new Promise<Response>(() => {}); }) as unknown as typeof fetch;
    void backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: never });
    await vi.waitFor(() => expect(hung).toBe(true));
    const api = (async (url: string) => Response.json({ items: new URL(url).searchParams.get("id")!.split(",").map((id) => ({ id, contentDetails: { duration: "PT4H35M41S" }, liveStreamingDetails: { actualStartTime: `${DAY}T12:58:13Z`, actualEndTime: `${DAY}T17:33:56Z` } })) })) as unknown as typeof fetch;
    // While it's young, runs wait for it.
    expect(await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: api })).toBe(0);
    // Once it's past its time, the next run starts anew, says so, and reads what's due.
    const said: string[] = [];
    expect(await backfillVideoMeta((s) => said.push(s), { apiKey: "KEY", gapMs: 0, fetchImpl: api, stuckMs: 0 })).toBeGreaterThan(0);
    expect(said[0]).toMatch(/never finished; starting anew/);
    expect(await get("SELECT status FROM video_meta WHERE video_id = ?", ["Stuck000001"])).toEqual({ status: "ok" });
    // And that pass's own end freed the way, though the stuck one never ended: the next run isn't held.
    await event("STUCK2", "https://www.youtube.com/watch?v=Stuck000002");
    expect(await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: api })).toBe(1);
  });

  it("a pass overtaken while it waited saves nothing of what it read", async () => {
    await event("LATE", "https://www.youtube.com/watch?v=Late0000001");
    let release!: (r: Response) => void;
    const slow = (async () => new Promise<Response>((r) => { release = r; })) as unknown as typeof fetch;
    const old = backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: slow });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    // A newer pass takes over and saves what YouTube says now.
    const now = (async (url: string) => Response.json({ items: new URL(url).searchParams.get("id")!.split(",").map((id) => ({ id, contentDetails: { duration: "PT4H35M41S" }, liveStreamingDetails: { actualStartTime: `${DAY}T12:58:13Z`, actualEndTime: `${DAY}T17:33:56Z` } })) })) as unknown as typeof fetch;
    expect(await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: now, stuckMs: 0 })).toBe(1);
    // The old pass's read comes back late, with older facts (still live, no end): it isn't saved over the newer ones.
    release(Response.json({ items: [{ id: "Late0000001", contentDetails: { duration: "PT1H" }, liveStreamingDetails: { actualStartTime: `${DAY}T12:58:13Z` } }] }));
    expect(await old).toBe(0);
    expect(await get("SELECT duration, end FROM video_meta WHERE video_id = ?", ["Late0000001"])).toEqual({ duration: 16541, end: `${DAY}T17:33:56.000Z` });
  });
});
