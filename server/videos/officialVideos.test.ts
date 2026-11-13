// Official event videos: the checked list is written once (an event missing from the database, a video it already
// plays, and a day it already has a video for are skipped; a removed row never comes back), and each day's official
// broadcast joins the event's player a day at a time, in broadcast order, next to FIRST's own link. Highlights never
// join the player. The shipped list itself: every row well-formed, one row per video, no highlight as a recording.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { eventRecording, recordingStream } from "./recordings";
import { eventHighlightVideos, localDate, seedOfficialVideos, type OfficialList } from "./officialVideos";
import shipped from "../data/officialVideos.json" with { type: "json" };

const S = 2025;
const CH = "UCBWrlxpmYKv4b_jE5mDsckw";
const D1 = "pvmxbH8YW-k", D2 = "zG45zl5pcDw", D3 = "AMgGg3Hfzxs", AW = "mvYjbQmqoJc", HL = "criv3nMj_Kg";
const W1 = "76X4pB5eljY", W4 = "iCMhB5nhEZU", W4B = "aaaaaaaaaaa", GONE = "bbbbbbbbbbb", NOEV = "ccccccccccc";
const v = (code: string, videoId: string, day: string | null, extra: Partial<OfficialList["videos"][number]> = {}) =>
  ({ season: S, code, videoId, kind: "recording" as const, day, channelId: CH, title: `t ${videoId}`, ...extra });

describe("official videos", () => {
  beforeAll(async () => {
    setDb(openDb(":memory:"));
    await migrate();
    const ev = "INSERT INTO events (season, code, name, type, city, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'Championship', ?, ?, ?, ?, 0, 0, ?, 'test')";
    await run(ev, [S, "ROCMPCND", "Romania Championship - COANDA Division", "Bucharest", "2026-03-13", "2026-03-15", "Europe/Bucharest", null]);
    await run(ev, [S, "ROCMP", "Romania Championship", "Bucharest", "2026-03-13", "2026-03-15", "Europe/Bucharest", null]);
    // FIRST's own link is the division's last day (Worlds 2026: each division's Day 4).
    await run(ev, [S, "FTCCMP1FRAN", "FIRST Championship - Franklin Division", "Houston", "2026-04-29", "2026-05-02", "America/Chicago", `https://www.youtube.com/watch?v=${W4}`]);
    const meta = "INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, ?, ?, 0, '2026-11-12T00:00:00Z')";
    await run(meta, [W4, "2026-05-02T13:00:00Z", "2026-05-02T18:00:00Z", 16_000]);
    await run(meta, [D1, "2026-03-13T07:00:00Z", "2026-03-13T13:00:00Z", 20_000]);
    await run(meta, [D2, "2026-03-14T06:00:00Z", "2026-03-14T16:00:00Z", 34_000]);
    await run(meta, [D3, "2026-03-15T06:30:00Z", "2026-03-15T11:00:00Z", 14_000]);
    await run(meta, [W1, "2026-04-29T19:00:00Z", "2026-04-29T22:30:00Z", 12_000]);
    // Removed once: it must stay out.
    await run("INSERT INTO official_videos (video_id, season, code, kind, day, channel_id, title, source, added_at, removed_at) VALUES (?, ?, 'ROCMPCND', 'recording', '2026-03-13', ?, 'x', 'list', 'a', 'b')", [GONE, S, CH]);
    clearAllCaches();
  });

  const list: OfficialList = {
    channels: { [CH]: "Nație Prin Educație" },
    videos: [
      v("ROCMPCND", D3, "2026-03-15"), v("ROCMPCND", D1, "2026-03-13"), v("ROCMPCND", D2, "2026-03-14"),
      v("ROCMP", AW, "2026-03-15", { part: "Finals & awards" }),
      v("ROCMP", HL, null, { kind: "highlight" }),
      v("FTCCMP1FRAN", W1, "2026-04-29"),
      v("FTCCMP1FRAN", W4, "2026-05-02"), // FIRST's link already: skipped
      v("FTCCMP1FRAN", W4B, "2026-05-02"), // another video for a day FIRST's link covers: skipped
      v("ROCMPCND", GONE, "2026-03-13"), // removed before: never written again
      v("NOPE", NOEV, "2026-03-13"), // no such event here
    ],
  };

  it("writes each checked video once, and skips what the event already plays", async () => {
    const logs: string[] = [];
    expect(await seedOfficialVideos((s) => logs.push(s), list, Date.parse("2026-11-12T00:00:00Z"), true)).toBe(6);
    const rows = await all<{ video_id: string; removed_at: string | null }>("SELECT video_id, removed_at FROM official_videos ORDER BY video_id");
    expect(rows.map((r) => r.video_id).sort()).toEqual([AW, D1, D2, D3, GONE, HL, W1].sort());
    expect(rows.find((r) => r.video_id === GONE)?.removed_at).toBe("b");
    expect(logs[0]).toMatch(/6 added from the checked list, 3 skipped/);
    // Again: nothing new.
    expect(await seedOfficialVideos(() => {}, list, Date.now(), true)).toBe(0);
  });

  it("waits while a video the event plays has no timing yet, then decides on a later run", async () => {
    const ev = "INSERT INTO events (season, code, name, type, city, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'Qualifier', 'Iasi', '2026-02-07', '2026-02-08', 'Europe/Bucharest', 0, 0, ?, 'test')";
    const L = "ddddddddddd", SAT = "eeeeeeeeeee", SUN = "fffffffffff";
    await run(ev, [S, "ROWAIT", "Iasi Qualifier", `https://youtu.be/${L}`]);
    const later: OfficialList = { channels: list.channels, videos: [v("ROWAIT", SAT, "2026-02-07"), v("ROWAIT", SUN, "2026-02-08")] };
    const logs: string[] = [];
    // FIRST's link isn't timed yet: either day could be its, so nothing is written.
    expect(await seedOfficialVideos((x) => logs.push(x), later, Date.now(), true)).toBe(0);
    expect(logs.at(-1)).toMatch(/2 waiting for a video's timing/);
    // A read that failed (no start): its day still can't be told.
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'error', NULL, NULL, NULL, 0, '2026-11-12T00:00:00Z')", [L]);
    expect(await seedOfficialVideos(() => {}, later, Date.now(), true)).toBe(0);
    // Once the backfill has read it (Saturday's broadcast), Sunday is added and Saturday stays FIRST's.
    await run("UPDATE video_meta SET status = 'ok', start = '2026-02-07T07:00:00Z', end = '2026-02-07T15:00:00Z', duration = 28800 WHERE video_id = ?", [L]);
    expect(await seedOfficialVideos(() => {}, later, Date.now(), true)).toBe(1);
    expect((await all<{ video_id: string }>("SELECT video_id FROM official_videos WHERE code = 'ROWAIT'")).map((r) => r.video_id)).toEqual([SUN]);
  });

  it("plays an event's official days a day at a time, in broadcast order", async () => {
    clearAllCaches();
    const r = await eventRecording(S, "ROCMPCND");
    expect(r?.videoId).toBe(D1);
    expect(r?.more?.map((d) => d.videoId)).toEqual([D2, D3]);
    expect(r?.daily).toBe(true);
    // The organiser's video, never labelled FIRST's.
    expect(r?.source).toBe("official");
    expect(recordingStream(r!, "Europe/Bucharest").source).toBe("official");
    expect(recordingStream(r!, "Europe/Bucharest").days?.map((d) => d.label)).toEqual(["Friday", "Saturday", "Sunday"]);
  });

  it("puts FIRST's link among the official days by its broadcast date", async () => {
    const r = await eventRecording(S, "FTCCMP1FRAN");
    expect([r!.videoId, ...(r!.more ?? []).map((d) => d.videoId)]).toEqual([W1, W4]);
    // An official day sorted first is still the organiser's, not FIRST's link.
    expect(r?.source).toBe("official");
    expect(recordingStream(r!, "America/Chicago").days?.map((d) => d.label)).toEqual(["Wednesday", "Saturday"]);
  });

  it("a parent event's one official video plays alone; its highlight is never the recording", async () => {
    const r = await eventRecording(S, "ROCMP");
    expect(r?.videoId).toBe(AW);
    expect(r?.more).toBeUndefined();
    expect(await eventHighlightVideos(S, "ROCMP")).toEqual([{ videoId: HL, title: `t ${HL}` }]);
    expect(await eventHighlightVideos(S, "ROCMPCND")).toEqual([]);
  });

  it("dates a broadcast at the venue", () => {
    expect(localDate("2026-05-03T03:00:00Z", "America/Chicago")).toBe("2026-05-02");
    expect(localDate("2026-03-13T23:30:00Z", "Europe/Bucharest")).toBe("2026-03-14");
    expect(localDate("2026-03-13T23:30:00Z", "Not/AZone")).toBe("2026-03-13");
  });
});

describe("the shipped list", () => {
  const data = shipped as OfficialList;
  it("is well-formed: YouTube ids, known channels, a day on every recording, one row per video", () => {
    const seen = new Set<string>();
    for (const x of data.videos) {
      expect(x.videoId, x.title).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(seen.has(x.videoId), x.videoId).toBe(false);
      seen.add(x.videoId);
      expect(data.channels[x.channelId], x.videoId).toBeTruthy();
      expect(["recording", "highlight"]).toContain(x.kind);
      if (x.kind === "recording") expect(x.day, x.videoId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(x.season).toBeGreaterThanOrEqual(2019);
    }
  });
  it("keeps one video per event, day and part", () => {
    const k = new Set<string>();
    for (const x of data.videos.filter((y) => y.kind === "recording")) {
      const key = `${x.season}/${x.code}/${x.day}/${x.part ?? ""}`;
      expect(k.has(key), key).toBe(false);
      k.add(key);
    }
  });
  it("leaves out what the brief rules out", () => {
    const ids = new Set(data.videos.map((x) => x.videoId));
    // Ambiguous, unofficial, a different broadcaster, or blocked (docs/official-videos.md).
    for (const no of ["DIRpIQ4tX9M", "58cbWg355qs", "Hy1RhXR5m_E", "h8YcLrHi-wQ", "-BTNpJ2X1nE", "_HSS2tVlaew", "be0ahU8Eqz8", "cqdU1OSkirQ", "p01TnRl7nvQ", "q7CZqGeJvLo", "trBIleY7mMk", "C7gP557UknQ"]) expect(ids.has(no), no).toBe(false);
    // No Houston highlight from the Romania channel.
    for (const no of ["ftRnZIOtgTQ", "b_Ab_UpLkWo", "NnInm3IP2Ko", "1ZeVXfwUcNo", "8EUpGcyY8vY"]) expect(ids.has(no), no).toBe(false);
  });
});
