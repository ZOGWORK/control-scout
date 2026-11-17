// Event recordings end to end on the real app: FIRST's YouTube link becomes the event's player when the owner set
// none, YouTube's timing (read in the background, here from a stand-in page) puts each played match on its second,
// the events list says what there is to watch, and a removed video, a channel page or Twitch gives nothing.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { clearAllCaches } from "../caches";
import { backfillVideoMeta, due, firstVideoId, inOrder, seasonClipKeys, seasonRecordings, withClips, type VideoMeta } from "./recordings";
import { setFrameTimingsForTests } from "../data/frameTimings";
import { setClipChecksForTests } from "../data/clipChecks";
import type { MatchView } from "../../src/shared/api";

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
  await match("GAPPED", 1, `${DAY}T10:30:13`);
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
    // It stops at the match's end: its second (120) + its play (160) + the live delay and final score (60).
    expect(clip(1)).toEqual({ videoId: FIRST_ID, t: 100, url: `https://www.youtube.com/watch?v=${FIRST_ID}&t=100s`, end: 340 });
    expect(clip(2)).toMatchObject({ t: 14205, end: 14445 });
    expect(clip(3)).toBeNull(); // after the video ends
    expect(clip(4)).toBeNull(); // not played
    expect(clip(5)).toBeNull(); // played, on the minute: a schedule
    const m = await getJson(`/api/events/${S}/CLIPS/matches/qual:0:1`);
    expect(m.match.clip).toMatchObject({ t: 100, end: 340 }); // the match's own route: the same end
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
    // Each stops from its own place by the clock, never moved earlier by the early start: Q5 at 4,920 s + 220 s.
    // Q1's next match (Q4, 8 min on) may sit 10 min early: it stops once its own play is over at the latest (+174 s).
    const end = Object.fromEntries(d.matches.map((m: any) => [m.label, m.clip?.end ?? null]));
    expect(end).toMatchObject({ Q1: 3600 + 174, Q5: 4920 + 220 });
    // One match on its own gets the same second.
    // Its end is never past the video's (28,200 s), though its own place (28,500 s) is.
    expect((await getJson(`/api/events/${S}/SHORT/matches/qual:0:2`)).match.clip).toMatchObject({ t: 28500 - 600 - 20, early: 600, end: 28200 });
  });

  it("an upload, or a broadcast with a gap, plays but has no clips; a removed video, a channel page and Twitch give no player", async () => {
    for (const [code, id] of [["UPLOAD", UPLOAD_ID], ["GAPPED", GAPPED_ID]]) {
      const d = await getJson(`/api/events/${S}/${code}`);
      expect(d.event.stream.videoId).toBe(id);
      expect(d.matches[0].clip).toBeUndefined();
    }
    for (const code of ["GONE", "CHANNEL", "TWITCH"]) expect((await getJson(`/api/events/${S}/${code}`)).event.stream).toBeUndefined();
    // A linked video YouTube won't play is still named, so the page can say why its matches have no clip; no link, nothing.
    expect((await getJson(`/api/events/${S}/GONE`)).event.recordingUnavailable).toEqual([GONE_ID]);
    expect((await getJson(`/api/events/${S}/TWITCH`)).event.recordingUnavailable).toBeUndefined();
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

describe("matches read off a recording's own frames", () => {
  it("play from there, for an upload and for a video with a gap the clock can't place", async () => {
    setFrameTimingsForTests([
      { videoId: UPLOAD_ID, code: "UPLOAD", checked: "2026-11-13", starts: { Q1: 100 } },
      { videoId: GAPPED_ID, code: "GAPPED", checked: "2026-11-13", starts: { Q1: 1500 } },
      // Another event's timings on the same video are never this event's: ELSEWHEN's Q1 never moves CLIPS's Q1.
      { videoId: FIRST_ID, code: "ELSEWHEN", checked: "2026-11-13", starts: { Q1: 50 } },
    ]);
    try {
      clearAllCaches();
      // A 213 s upload: the clip stops at the video's end.
      expect((await getJson(`/api/events/${S}/UPLOAD`)).matches[0].clip).toEqual({ videoId: UPLOAD_ID, t: 80, url: `https://www.youtube.com/watch?v=${UPLOAD_ID}&t=80s`, end: 213 });
      // Its timer starts at 1500 s: the clip stops at 1710 s, its play over (+160) and its final score up (+50).
      expect((await getJson(`/api/events/${S}/GAPPED`)).matches[0].clip).toMatchObject({ videoId: GAPPED_ID, t: 1480, end: 1710 });
      // A match's own page: the same second.
      expect((await getJson(`/api/events/${S}/UPLOAD/matches/qual:0:1`)).match.clip.t).toBe(80);
      // The clock's clips elsewhere are untouched.
      expect((await getJson(`/api/events/${S}/CLIPS`)).matches[0].clip.t).toBe(120 - 20);
      const { events } = await getJson(`/api/events?season=${S}`);
      const by = Object.fromEntries(events.map((e: any) => [e.code, e.video ?? null]));
      expect(by).toMatchObject({ UPLOAD: "clips", GAPPED: "clips", ELSEWHEN: "clips" });
    } finally {
      setFrameTimingsForTests([]);
      clearAllCaches();
    }
  });
  it("leave out a start that breaks the order the matches were played in (a replay in a break, an older misread)", async () => {
    // USMNCMPGLXY's older read: Q19 at the lunch break, after Q20 and Q21. On the 8.5 h gapped video, Q3 starts 180 s
    // after Q1, before Q1's clip would end on its own (+210 s).
    setFrameTimingsForTests([{ videoId: GAPPED_ID, code: "GAPPED", checked: "2026-11-14", starts: { Q1: 1000, Q2: 9000, Q3: 1180, Q4: 1600 } }]);
    try {
      const rec = (await seasonRecordings(S)).get("GAPPED")!;
      const m: Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip">[] = [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, time: `${DAY}T10:3${n}:13`, startsAt: `${DAY}T10:3${n}:13.000Z`, played: true, clip: undefined }));
      const clips = withClips(m, rec);
      expect(clips.map((x) => x.clip?.t ?? null)).toEqual([980, null, 1160, 1580]);
      // Q1's clip stops where Q3's timer starts (1180), the next start that plays, not at the left-out Q2's 9000.
      expect(clips[0].clip?.end).toBe(1180);
    } finally {
      setFrameTimingsForTests([]);
    }
  });
  it("open a checked frame clip where its first frame names the match, and play no unchecked start of that row", async () => {
    // Q1's overlay named it 12 s before its start (1000 → opens at 988); Q3's opening couldn't be checked.
    setFrameTimingsForTests([{ videoId: GAPPED_ID, code: "GAPPED", checked: "2026-11-15", starts: { Q1: 1000, Q3: 1600 }, opens: { Q1: 988 } }]);
    try {
      const rec = (await seasonRecordings(S)).get("GAPPED")!;
      const m: Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip">[] = [1, 3].map((n) => ({ label: `Q${n}`, time: `${DAY}T10:3${n}:13`, startsAt: `${DAY}T10:3${n}:13.000Z`, played: true, clip: undefined }));
      const clips = withClips(m, rec);
      expect(clips[0].clip?.t).toBe(988);
      expect(clips[1].clip?.t ?? null).not.toBe(1580);
    } finally {
      setFrameTimingsForTests([]);
    }
  });
  it("never serve a clock clip whose first frame names another match; one that named nothing stays", async () => {
    setClipChecksForTests([{ videoId: FIRST_ID, code: "CLIPS", season: S, checked: "2026-11-15", pulled: { Q1: { t: 100, showed: "Q7" } }, unconfirmed: { Q2: { t: 14205, why: "no overlay at its first frame" } } }]);
    try {
      clearAllCaches();
      const ms = (await getJson(`/api/events/${S}/CLIPS`)).matches;
      expect(ms.find((m: any) => m.label === "Q1").clip).toBeUndefined();
      expect(ms.find((m: any) => m.label === "Q2").clip?.videoId).toBe(FIRST_ID);
      // Another event's check on the same video never pulls this event's clip.
      setClipChecksForTests([{ videoId: FIRST_ID, code: "ELSEWHEN", season: S, checked: "2026-11-15", pulled: { Q1: { t: 100, showed: "Q7" } } }]);
      clearAllCaches();
      expect((await getJson(`/api/events/${S}/CLIPS`)).matches[0].clip.t).toBe(100);
    } finally {
      setClipChecksForTests([]);
      clearAllCaches();
    }
  });
  it("count for search's With video, an upload's framed matches too", async () => {
    clearAllCaches();
    expect((await seasonClipKeys(S)).has("UPLOAD|qual|0|1")).toBe(false);
    setFrameTimingsForTests([{ videoId: UPLOAD_ID, code: "UPLOAD", checked: "2026-11-14", starts: { Q1: 100 } }]);
    try {
      clearAllCaches();
      expect((await seasonClipKeys(S)).has("UPLOAD|qual|0|1")).toBe(true);
    } finally {
      setFrameTimingsForTests([]);
      clearAllCaches();
    }
  });
  it("keep the longest run of starts in played order", () => {
    const at = (n: number) => Date.parse(`${DAY}T13:0${n}:00Z`);
    expect(Object.fromEntries(inOrder([{ label: "Q1", at: at(1), t: 100 }, { label: "Q2", at: at(2), t: 5000 }, { label: "Q3", at: at(3), t: 400 }, { label: "Q4", at: at(4), t: 700 }, { label: "Q5", at: NaN, t: 900 }, { label: "Q6", at: at(6), t: null }])))
      .toEqual({ Q1: 100, Q3: 400, Q4: 700 });
  });
  it("order a match with no time after the timed ones, by its label (best-of-three series turn about)", () => {
    const at = (n: number) => Date.parse(`${DAY}T13:0${n}:00Z`);
    // Each start rises in played order (Q1, Q2, M1-1, M2-1, M1-2, F1), so every one is kept; ordered by number alone
    // (M1-1, M1-2, M2-1) M2-1's 700 would come after M1-2's 800 and be dropped.
    expect(Object.fromEntries(inOrder([
      { label: "F1", at: Infinity, t: 900 }, { label: "M2-1", at: Infinity, t: 700 }, { label: "M1-2", at: Infinity, t: 800 },
      { label: "M1-1", at: Infinity, t: 600 }, { label: "Q2", at: at(2), t: 200 }, { label: "Q1", at: at(1), t: 100 },
    ]))).toEqual({ Q1: 100, Q2: 200, "M1-1": 600, "M2-1": 700, "M1-2": 800, F1: 900 });
  });
  it("place matches FIRST gives no real start for by their frames: none at all (Chicago Robotics Invitational), or a schedule's", async () => {
    // Q3's read sits before Q1's: out of the order they were played, so it's left out, as for timed matches.
    setFrameTimingsForTests([{ videoId: GAPPED_ID, code: "GAPPED", checked: "2026-11-17", starts: { Q1: 1000, Q2: 1400, Q3: 300, M1: 2000 } }]);
    try {
      const rec = (await seasonRecordings(S)).get("GAPPED")!;
      const none: Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip">[] = ["Q1", "Q2", "Q3", "M1"].map((label) => ({ label, time: null, startsAt: null, played: true, clip: undefined }));
      expect(withClips(none, rec).map((x) => x.clip?.t ?? null)).toEqual([980, 1380, null, 1980]);
      // A match's own page: the event's other matches come in the span (eventMatchSpan's untimed), so the same order holds.
      const span = { firstMatch: null, lastMatch: null, starts: [], untimed: none.map(({ label }) => ({ label, startsAt: null })) };
      expect(withClips([none[1]], rec, Date.now(), span)[0].clip?.t).toBe(1380);
      expect(withClips([none[2]], rec, Date.now(), span)[0].clip).toBeUndefined();
      // On the minute: the schedule's time, not when it was played. It orders the match; its frames place it.
      const scheduled: Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip">[] = ["Q1", "Q2", "Q3", "M1"].map((label, n) => ({ label, time: `${DAY}T10:3${n}:00`, startsAt: `${DAY}T10:3${n}:00.000Z`, played: true, clip: undefined }));
      expect(withClips(scheduled, rec).map((x) => x.clip?.t ?? null)).toEqual([980, 1380, null, 1980]);
    } finally {
      setFrameTimingsForTests([]);
    }
  });
  it("leave a match out when they weren't read for it, and are left out on request (what YouTube's facts alone give)", async () => {
    setFrameTimingsForTests([{ videoId: UPLOAD_ID, code: "UPLOAD", checked: "2026-11-13", starts: { Q7: 100 } }]);
    try {
      clearAllCaches();
      expect((await getJson(`/api/events/${S}/UPLOAD`)).matches[0].clip).toBeUndefined();
      setFrameTimingsForTests([{ videoId: UPLOAD_ID, code: "UPLOAD", checked: "2026-11-13", starts: { Q1: 100 } }]);
      const rec = (await seasonRecordings(S)).get("UPLOAD")!;
      const m: Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip">[] = [{ label: "Q1", time: `${DAY}T13:00:13`, startsAt: `${DAY}T13:00:13.000Z`, played: true, clip: undefined }];
      expect(withClips(m, rec)[0].clip?.t).toBe(80);
      expect(withClips(m, rec, Date.now(), undefined, { frames: false })[0].clip).toBeUndefined();
    } finally {
      setFrameTimingsForTests([]);
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
  it("a fresh archive after 6 hours for 2 days, then never; an upload never", () => {
    const fresh = meta({ start: "2026-05-01T12:00:00Z", end: "2026-05-01T20:00:00Z" });
    expect(due(fresh, t("2026-05-02T07:00:00Z"))).toBe(true);
    expect(due({ ...fresh, checkedAt: "2026-05-04T00:00:00Z", length: 28800 }, t("2026-05-20T00:00:00Z"))).toBe(false);
    expect(due(meta({}), t("2027-01-01T00:00:00Z"))).toBe(false);
  });
  it("a live or just-archived stream with embedding off is read as often as any other (its clock clips open on youtube.com)", () => {
    const off = { embeddable: false };
    expect(due(meta({ ...off, live: true, start: "2026-05-01T23:00:00Z" }), t("2026-05-02T00:06:00Z"))).toBe(true);
    expect(due(meta({ ...off, live: true, start: "2026-05-01T23:00:00Z" }), t("2026-05-02T00:06:00Z"), true)).toBe(true);
    expect(due(meta({ ...off, live: true, start: null }), t("2026-05-02T01:01:00Z"))).toBe(true);
    // Archived an hour before its last read: its length still settling, so every 6 hours, not weekly.
    const archived = meta({ ...off, start: "2026-05-01T15:00:00Z", end: "2026-05-01T23:00:00Z", length: 28800 });
    expect(due(archived, t("2026-05-02T05:00:00Z"))).toBe(false);
    expect(due(archived, t("2026-05-02T07:00:00Z"))).toBe(true);
    // Settled (archived over 2 days ago): weekly.
    expect(due(archived, t("2026-05-04T01:00:00Z"))).toBe(false);
  });
  it("an unavailable video (private, removed, embedding off) after a week: an owner can make it public again", () => {
    // Embedding off: weekly too, with or without the API key, so one whose owner turns it back on is read again.
    expect(due(meta({ embeddable: false }), t("2026-05-08T23:00:00Z"))).toBe(false);
    expect(due(meta({ embeddable: false }), t("2026-05-09T01:00:00Z"))).toBe(true);
    expect(due(meta({ embeddable: true }), t("2026-05-09T01:00:00Z"))).toBe(false);
    expect(due(meta({ status: "unavailable" }), t("2026-05-08T23:00:00Z"))).toBe(false);
    expect(due(meta({ status: "unavailable" }), t("2026-05-09T01:00:00Z"))).toBe(true);
    expect(due(meta({ status: "unavailable" }), t("2026-05-09T01:00:00Z"), true)).toBe(true);
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
  it("with a key, a video that plays weekly: one deleted or blocked everywhere since is seen within a week", () => {
    // Live: five recordings read "ok" once are blocked in every country now (the watch page: "Video unavailable").
    const settled = meta({ start: "2026-04-01T12:00:00Z", end: "2026-04-01T20:00:00Z", length: 28800, embeddable: true });
    expect(due(settled, t("2026-05-08T23:00:00Z"), true)).toBe(false);
    expect(due(settled, t("2026-05-09T01:00:00Z"), true)).toBe(true);
    expect(due(settled, t("2027-01-01T00:00:00Z"))).toBe(false);
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

  it("reads a region block against the event's own country: blocked there, unavailable; blocked in 60 others, it keeps its clips", async () => {
    await run("DELETE FROM video_meta");
    const HOME = "BlockedHome", ELSE = "BlockedElse";
    await event("REGHOME", `https://www.youtube.com/watch?v=${HOME}`);
    await event("REGELSE", `https://www.youtube.com/watch?v=${ELSE}`);
    await run("UPDATE events SET country = 'USA' WHERE season = ? AND code IN ('REGHOME', 'REGELSE')", [S]);
    const sixty = Array.from({ length: 60 }, (_, i) => `X${i}`);
    const api = (async (url: string) => {
      const ids = new URL(url).searchParams.get("id")!.split(",");
      return Response.json({ items: ids.map((id) => ({ id, contentDetails: { duration: "PT4H", ...(id === HOME ? { regionRestriction: { blocked: ["US"] } } : id === ELSE ? { regionRestriction: { blocked: sixty } } : {}) },
        liveStreamingDetails: { actualStartTime: `${DAY}T12:00:00Z`, actualEndTime: `${DAY}T16:00:00Z` } })) });
    }) as unknown as typeof fetch;
    await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: api });
    expect(await get("SELECT status FROM video_meta WHERE video_id = ?", [HOME])).toEqual({ status: "unavailable" });
    expect(await get("SELECT status, duration FROM video_meta WHERE video_id = ?", [ELSE])).toEqual({ status: "ok", duration: 14400 });
  });

  it("a weekly read that fails keeps the time of the last real read, so it's tried again soon, not a week on", async () => {
    await run("DELETE FROM video_meta");
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, ?, 16541, 0, '2026-01-01T00:00:00.000Z')", [FIRST_ID, `${DAY}T12:58:13Z`, `${DAY}T17:33:56Z`]);
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: down, now: () => Date.parse("2026-02-01T00:00:00Z") });
    expect(await get("SELECT status, checked_at FROM video_meta WHERE video_id = ?", [FIRST_ID])).toEqual({ status: "ok", checked_at: "2026-01-01T00:00:00.000Z" });
  });

  it("keeps whether a video may be embedded, and reads it once, with the key, for a video read before it was kept", async () => {
    await run("DELETE FROM video_meta");
    // Read before embedding was kept: due once with the key.
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, ?, 16541, 0, ?)", [FIRST_ID, `${DAY}T12:58:13Z`, `${DAY}T17:33:56Z`, new Date().toISOString()]);
    const api = (embeddable?: boolean) => (async (url: string) => {
      const ids = new URL(url).searchParams.get("id")!.split(",");
      expect(new URL(url).searchParams.get("part")).toContain("status");
      return Response.json({ items: ids.map((id) => ({ id, contentDetails: { duration: "PT4H35M41S" }, ...(embeddable == null ? {} : { status: { embeddable: id === FIRST_ID ? embeddable : true } }),
        liveStreamingDetails: { actualStartTime: `${DAY}T12:58:13Z`, actualEndTime: `${DAY}T17:33:56Z` } })) });
    }) as unknown as typeof fetch;
    await backfillVideoMeta(() => {}, { apiKey: "KEY", gapMs: 0, fetchImpl: api(false) });
    expect(await get("SELECT status, embeddable FROM video_meta WHERE video_id = ?", [FIRST_ID])).toEqual({ status: "ok", embeddable: 0 });
    expect(due({ videoId: "x", status: "ok", start: null, end: null, length: 1, live: false, checkedAt: new Date().toISOString() }, Date.now(), true)).toBe(true);
    expect(due({ videoId: "x", status: "ok", start: null, end: null, length: 1, live: false, checkedAt: new Date().toISOString(), embeddable: false }, Date.now(), true)).toBe(false);
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

describe("FIRST's link to a video broadcast on another date", () => {
  // 2024 USORSOM3 (2025-01-11): FIRST's livestream link was USORSOM2's stream of 2024-12-14.
  it("isn't the event's video; the event whose date it fits keeps it", async () => {
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'SOM2', 'Meet 2', 'LeagueMeet', '2026-04-11', '2026-04-11', 'America/Los_Angeles', 0, 0, 'https://www.youtube.com/watch?v=OtherDay001', 'test')", [S]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'SOM3', 'Meet 3', 'LeagueMeet', ?, ?, 'America/Los_Angeles', 0, 0, 'https://www.youtube.com/watch?v=OtherDay001', 'test')", [S, DAY, DAY]);
    // A link YouTube hasn't given a broadcast start for yet is kept: nothing says it's off.
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'NOTREAD', 'Meet 4', 'LeagueMeet', ?, ?, 'UTC', 0, 0, 'https://www.youtube.com/watch?v=NotRead0001', 'test')", [S, DAY, DAY]);
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES ('OtherDay001', 'ok', '2026-04-11T17:15:03Z', '2026-04-11T22:33:58Z', 18884, 0, 'x')");
    clearAllCaches();
    const recs = await seasonRecordings(S);
    expect(recs.get("SOM2")?.videoId).toBe("OtherDay001");
    expect(recs.has("SOM3")).toBe(false);
    expect(recs.get("NOTREAD")?.videoId).toBe("NotRead0001");
  });
});
