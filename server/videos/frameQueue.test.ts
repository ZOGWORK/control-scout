// The frame-read queue (server/videos/frameQueue.ts): which events the automatic reader reads next. Pure rules first
// (what's due, what waits, what no read can fix, the order), then the whole path: a recording the official-videos
// watcher links becomes due at the next coverage check, leaves the queue once its frames are read after the event, and
// comes back once when it was read before the event finished.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { forgetRecordings } from "./recordings";
import { forgetOfficial } from "./officialVideos";
import { currentSeason } from "../api/answers/season";
import { FRAME_TIMINGS, setFrameTimingsForTests, type FrameTiming } from "../data/frameTimings";
import { checkClipCoverage, ownerClipCoverage } from "./coverageCheck";
import { frameQueue, frameStatus, queueSummary, rankQueue, type QueueEvent } from "./frameQueue";
import type { CoverageMatch } from "../../src/shared/api";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const miss = (label: string, o: Partial<CoverageMatch> = {}): CoverageMatch =>
  ({ key: label, label, date: "2026-11-14", clip: false, videoId: "VIDEOaaaaa1", reason: "gap-unplaced", video: { checked: null }, ...o });
const ev = (missing: CoverageMatch[], o: Partial<QueueEvent> = {}): QueueEvent => ({ season: 2025, code: "USXXQ", name: "X Qualifier", end: "2026-11-14", timezone: "UTC", missing, ...o });

// A video of the event read on `checked` (a frame row for it, as the reader writes one): its id, for a missing match.
const ROWS: FrameTiming[] = [];
const readOn = (checked: string) => {
  const videoId = `READ${checked.replace(/-/g, "")}`;
  if (!ROWS.some((r) => r.videoId === videoId)) { ROWS.push({ videoId, code: "USXXQ", checked, starts: {}, missing: {} }); setFrameTimingsForTests(ROWS); }
  return { videoId };
};

describe("frameStatus", () => {
  const KEPT = [...FRAME_TIMINGS];
  beforeAll(() => setFrameTimingsForTests(ROWS));
  afterAll(() => setFrameTimingsForTests(KEPT));
  it("queues an event that's over with a match in a video not read yet", () => {
    const f = frameStatus(ev([miss("Q1"), miss("Q2")]), NOW);
    expect(f).toMatchObject({ state: "queued", due: 2, matches: 2, why: "Queued for a frame read: 2 matches" });
  });

  it("waits while the event is still on (its last day today or later), saying what it'll read then", () => {
    expect(frameStatus(ev([miss("Q1")], { end: "2026-11-17" }), NOW)).toMatchObject({ state: "waiting", due: 0, why: "Waits for the event to finish (last day 2026-11-17): 1 match to read then" });
    // No last day known: the latest missing match's date stands in.
    expect(frameStatus(ev([miss("Q1", { date: "2026-11-18" })], { end: null }), NOW).state).toBe("waiting");
    expect(frameStatus(ev([miss("Q1", { date: "2026-11-15" })], { end: null }), NOW).state).toBe("queued");
    // No last day at all (no end, no match dated): it may still be on, so it waits, and a read of it doesn't settle it.
    expect(frameStatus(ev([miss("Q1", { date: null })], { end: null }), NOW))
      .toMatchObject({ state: "waiting", due: 0, why: "Waits for the event's last day to be known: 1 match to read then" });
    expect(frameStatus(ev([miss("Q1", { date: null, ...readOn("2026-11-16") })], { end: null }), NOW).state).toBe("waiting");
  });

  it("counts the venue's last day to its end there: an American evening is the next UTC day", () => {
    // Los Angeles, last day the 16th: its 23:59 there is 07:59 UTC on the 17th, so it's over from the UTC 18th.
    const la = (now: string) => frameStatus(ev([miss("Q1")], { end: "2026-11-16", timezone: "America/Los_Angeles" }), Date.parse(now)).state;
    expect(la("2026-11-17T03:00:00Z")).toBe("waiting"); // 19:00 on the 16th there: finals on
    expect(la("2026-11-17T23:00:00Z")).toBe("waiting");
    expect(la("2026-11-18T00:30:00Z")).toBe("queued");
    // A read dated the UTC 17th may have been that evening: read again once; one dated the 18th, after, settles.
    const read = (checked: string) => frameStatus(ev([miss("Q1", readOn(checked))], { end: "2026-11-16", timezone: "America/Los_Angeles" }), Date.parse("2026-11-19T12:00:00Z")).state;
    expect([read("2026-11-17"), read("2026-11-18")]).toEqual(["queued", "read"]);
    // No zone known: taken as the latest on earth, so never called over early.
    expect(frameStatus(ev([miss("Q1")], { end: "2026-11-16", timezone: null }), Date.parse("2026-11-17T20:00:00Z")).state).toBe("waiting");
  });

  it("reads again, once, a video read on or before the event's last day; a read after it settles", () => {
    expect(frameStatus(ev([miss("Q9", readOn("2026-11-14"))]), NOW)).toMatchObject({ state: "queued", due: 1, why: "Queued for a frame read: 1 match, read before the event finished" });
    // No last day stored: the latest missing match's date stands in for it here too.
    expect(frameStatus(ev([miss("Q9", { date: "2026-11-15", ...readOn("2026-11-14") })], { end: null }), NOW).state).toBe("queued");
    expect(frameStatus(ev([miss("Q9", readOn("2026-11-15"))]), NOW))
      .toMatchObject({ state: "read", due: 0, at: "2026-11-15", why: "Read 2026-11-15: 1 match still without a clip, as the video shows (see each match)" });
  });

  it("dates a read by the matches it read, never by a match it can't place whose video was read another day", () => {
    const f = frameStatus(ev([miss("Q1", readOn("2026-11-15")), miss("Q2", { reason: "no-start", ...readOn("2026-11-20") })]), NOW);
    expect(f).toMatchObject({ state: "read", at: "2026-11-15", why: "Read 2026-11-15: 1 match still without a clip, as the video shows (see each match)" });
  });

  it("never queues what no frame read can place: no video, a private one, no start time", () => {
    for (const o of [{ videoId: null, reason: "no-recording-day" as const }, { reason: "video-unavailable" as const }, { reason: "video-no-embed" as const }, { reason: "no-start" as const }, { reason: "no-first-video" as const, videoId: null }]) {
      expect(frameStatus(ev([miss("Q1", o)]), NOW)).toMatchObject({ state: "unreadable", due: 0 });
    }
    expect(frameStatus(ev([miss("Q1", { reason: "video-unavailable" })]), NOW).why).toBe("Nothing a frame read can place: Recording can't be played: unavailable on YouTube (private or removed)");
  });

  it("waits for a video's YouTube facts before reading it", () => {
    expect(frameStatus(ev([miss("Q1", { reason: "video-unread" })]), NOW)).toMatchObject({ state: "waiting", why: "Waits for YouTube's facts for its video: 1 match" });
    // Beside a video already read after the event: still waiting, never "read".
    expect(frameStatus(ev([miss("Q1", { reason: "video-unread" }), miss("Q2", readOn("2026-11-16"))]), NOW))
      .toMatchObject({ state: "waiting", matches: 1, why: "Waits for YouTube's facts for its video: 1 match (1 more read, no clip)" });
  });

  it("counts only the matches a read could place, beside ones it can't", () => {
    const f = frameStatus(ev([miss("Q1"), miss("Q2", { reason: "video-unavailable" }), miss("Q3", readOn("2026-11-16"))]), NOW);
    expect([f.state, f.due]).toEqual(["queued", 1]);
  });
});

describe("frameStatus against frame rows merged since the coverage check", () => {
  const KEPT = [...FRAME_TIMINGS];
  afterAll(() => setFrameTimingsForTests(KEPT));
  it("reads the frame rows themselves, even where coverage stored a video check (a clock-only reason)", () => {
    setFrameTimingsForTests([{ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-16", starts: {}, missing: { Q1: "no frame read of it" } }]);
    // Coverage last checked it before the row was merged: its stored check says unread.
    expect(frameStatus(ev([miss("Q1", { reason: "before-broadcast", video: { checked: null } })]), NOW)).toMatchObject({ state: "read", at: "2026-11-16" });
    // Between two recordings, no video of its own: its stored check of both stands.
    expect(frameStatus(ev([miss("Q2", { reason: "between-recordings", videoId: null, video: { checked: null } })]), NOW).state).toBe("queued");
  });
});

describe("rankQueue", () => {
  it("puts the most missing first, then the newest season, then the code; only queued events get a place", () => {
    const e = (season: number, code: string, n: number, state = "queued") =>
      ({ season, code, frames: { state, matches: n, due: state === "queued" ? n : 0, why: "w" } as any });
    const list = [e(2024, "B", 5), e(2025, "C", 5), e(2025, "A", 5), e(2023, "Z", 40), e(2025, "W", 99, "waiting")];
    expect(rankQueue(list).map((x) => `${x.season}/${x.code}#${x.frames.rank}`)).toEqual(["2023/Z#1", "2025/A#2", "2025/C#3", "2024/B#4"]);
    expect(list[0].frames.why).toBe("w · 4th in line");
    expect(list[3].frames.why).toBe("w · 1st in line");
    expect(list[4].frames.rank).toBeUndefined();
    // Ranked again (as the runner does after filtering): one place each, and none on an event left out of the queue.
    list[3].frames.state = "read";
    expect(rankQueue(list).map((x) => `${x.code}#${x.frames.rank}`)).toEqual(["A#1", "C#2", "B#3"]);
    expect([list[0].frames.why, list[3].frames.why, list[3].frames.rank]).toEqual(["w · 3rd in line", "w", undefined]);
    list[3].frames.state = "queued";
    rankQueue(list);
    const s = queueSummary(list.map((x) => ({ ...x, name: x.code })), 2);
    expect(s).toEqual({ queued: 4, matches: 55, waiting: 1, next: [{ season: 2023, code: "Z", name: "Z", matches: 40 }, { season: 2025, code: "A", name: "A", matches: 5 }] });
  });

  it("reads the current season first, then a video added this week, then the backlog, however much the backlog misses", () => {
    // 2026-11-18: USPAKSN (21 due) sat 247th, behind hundreds of past-season events with more missing.
    const e = (season: number, code: string, n: number, added: string | null = null) =>
      ({ season, code, added, frames: { state: "queued", matches: n, due: n, why: "w" } as any });
    const list = [e(2022, "OLD", 91), e(2024, "NEWVID", 3, "2026-11-15T10:00:00Z"), e(2026, "PAKSN", 21, "2026-11-13T00:00:00Z"),
      e(2023, "STALEVID", 60, "2026-11-01T00:00:00Z"), e(2026, "NODT", 25), e(2025, "MID", 40)];
    expect(rankQueue(list, NOW, 2026).map((x) => `${x.code}#${x.frames.rank}`))
      .toEqual(["NODT#1", "PAKSN#2", "NEWVID#3", "OLD#4", "STALEVID#5", "MID#6"]);
  });
});

describe("a recording the watcher links becomes due", () => {
  const S = currentSeason(), SAT = "2026-03-07", VID = "UPLOADvid01";
  const KEPT = [...FRAME_TIMINGS];
  beforeAll(async () => {
    setFrameTimingsForTests([]);
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'UPLOADQ', 'Upload Qualifier', 'Qualifier', ?, ?, 'UTC', 0, 0, NULL, 'test')", [S, SAT, SAT]);
    for (const n of [1, 2, 3]) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'UPLOADQ', 'qual', 0, ?, ?, ?, 1, 50, 50, 40, 40, 'test')",
        [S, n, `Q${n}`, `${SAT}T1${n}:00:00.5`]);
    }
    forgetRecordings();
  });
  afterAll(() => setFrameTimingsForTests(KEPT));

  it("isn't in the queue before it has a recording (stats only)", async () => {
    await checkClipCoverage(() => {});
    expect((await frameQueue(NOW)).map((q) => q.code)).toEqual([]);
  });

  it("is queued at the next coverage check once the watcher links an upload the clock can't place", async () => {
    // What the official-videos watcher writes for a recording it found (server/videos/officialWatch.ts), and YouTube's
    // facts for it: an upload, no broadcast clock.
    await run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, added_at) VALUES (?, ?, 'UPLOADQ', 'recording', ?, NULL, 'UCtest', 'Upload Qualifier', 'watcher', ?)",
      [VID, S, SAT, new Date(NOW).toISOString()]);
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', NULL, NULL, 14400, 0, ?)", [VID, new Date(NOW).toISOString()]);
    forgetOfficial();
    forgetRecordings();
    expect(await checkClipCoverage(() => {})).toBe(1);
    const q = await frameQueue(NOW);
    expect(q).toEqual([expect.objectContaining({ code: "UPLOADQ", frames: expect.objectContaining({ state: "queued", due: 3, rank: 1 }) })]);
    // The owner console carries it: the event's place, and the queue's numbers.
    const o = await ownerClipCoverage({ list: "unchecked" });
    const all = [...o.events, ...(await ownerClipCoverage({ list: "no-timing" })).events, ...(await ownerClipCoverage()).events];
    expect(all.find((e) => e.code === "UPLOADQ")?.frames).toMatchObject({ state: "queued", rank: 1, matches: 3 });
    expect(all.find((e) => e.code === "UPLOADQ")?.frames).not.toHaveProperty("due");
    expect(o.frameQueue).toMatchObject({ queued: 1, matches: 3, next: [{ season: S, code: "UPLOADQ", name: "Upload Qualifier", matches: 3 }] });
  });

  it("leaves the queue once its frames are read after the event; comes back when the read was on the event's day", async () => {
    setFrameTimingsForTests([{ videoId: VID, code: "UPLOADQ", checked: "2026-03-08", starts: {}, missing: { Q1: "no frame read of it", Q2: "no frame read of it", Q3: "no frame read of it" } }]);
    // Read straight off the frame rows: no coverage check needed for a row merged since.
    expect((await frameQueue(NOW)).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "read", at: "2026-03-08" });
    setFrameTimingsForTests([{ videoId: VID, code: "UPLOADQ", checked: SAT, starts: {}, missing: { Q1: "no frame read of it", Q2: "no frame read of it", Q3: "no frame read of it" } }]);
    expect((await frameQueue(NOW)).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "queued", due: 3, why: "Queued for a frame read: 3 matches, read before the event finished · 1st in line" });
  });
});
