// The frame-read queue (server/videos/frameQueue.ts): which events the automatic reader reads next. Pure rules first
// (what's due, what waits, what no read can fix, the order), then the whole path: a recording the official-videos
// watcher links becomes due at the next coverage check, leaves the queue once its frames are read after the event, and
// comes back once when it was read before the event finished.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { forgetRecordings } from "./recordings";
import { forgetOfficial } from "./officialVideos";
import { currentSeason } from "../api/answers/season";
import { FRAME_TIMINGS, setAutoFrameRows, setFrameTimingsForTests, type FrameTiming } from "../data/frameTimings";
import { checkClipCoverage, ownerClipCoverage } from "./coverageCheck";
import { QUIET_MS, READER_SINCE, eventOver, frameQueue, frameStatus, queueSummary, rankQueue, type QueueEvent } from "./frameQueue";
import type { CoverageMatch } from "../../src/shared/api";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const miss = (label: string, o: Partial<CoverageMatch> = {}): CoverageMatch =>
  ({ key: label, label, date: "2026-11-14", clip: false, videoId: "VIDEOaaaaa1", reason: "gap-unplaced", video: { checked: null }, ...o });
// A season READER_SINCE doesn't list, so a read after the event settles as it always did (2019–2026 are listed).
const ev = (missing: CoverageMatch[], o: Partial<QueueEvent> = {}): QueueEvent => ({ season: 2018, code: "USXXQ", name: "X Qualifier", end: "2026-11-14", timezone: "UTC", missing, ...o });

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
    // Los Angeles, last day the 16th: its 23:59 there is 07:59 UTC on the 17th, so it's over from then.
    const la = (now: string) => frameStatus(ev([miss("Q1")], { end: "2026-11-16", timezone: "America/Los_Angeles" }), Date.parse(now)).state;
    expect(la("2026-11-17T03:00:00Z")).toBe("waiting"); // 19:00 on the 16th there: finals on
    expect(la("2026-11-17T07:30:00Z")).toBe("waiting");
    expect(la("2026-11-17T08:30:00Z")).toBe("queued");
    // A read dated the UTC 16th or 17th that didn't look at Q1 (played after it): read again once; one dated the 18th settles.
    const read = (checked: string) => frameStatus(ev([miss("Q1", readOn(checked))], { end: "2026-11-16", timezone: "America/Los_Angeles" }), Date.parse("2026-11-19T12:00:00Z")).state;
    expect([read("2026-11-16"), read("2026-11-17"), read("2026-11-18")]).toEqual(["queued", "queued", "read"]);
    // No zone known: taken as the latest on earth, so never called over early.
    expect(frameStatus(ev([miss("Q1")], { end: "2026-11-16", timezone: null }), Date.parse("2026-11-17T11:30:00Z")).state).toBe("waiting");
    expect(frameStatus(ev([miss("Q1")], { end: "2026-11-16", timezone: null }), Date.parse("2026-11-17T12:30:00Z")).state).toBe("queued");
  });

  it("reads again, once, a video read on or before the event's last day; a read after it settles", () => {
    expect(frameStatus(ev([miss("Q9", readOn("2026-11-14"))]), NOW)).toMatchObject({ state: "queued", due: 1, why: "Queued for a frame read: 1 match, read before the event finished" });
    // No last day stored: the latest missing match's date stands in for it here too.
    expect(frameStatus(ev([miss("Q9", { date: "2026-11-15", ...readOn("2026-11-14") })], { end: null }), NOW).state).toBe("queued");
    expect(frameStatus(ev([miss("Q9", readOn("2026-11-15"))]), NOW))
      .toMatchObject({ state: "read", due: 0, at: "2026-11-15", why: "Read 2026-11-15: 1 match still without a clip, as the video shows (see each match)" });
  });

  it("takes the last day as done once every match has a result, quiet for QUIET_MS, no video on air", () => {
    // Saturday 2026-11-21 in Michigan, finals at 18:35 there (23:35 UTC): read that evening, not the UTC 23rd.
    const day = { timezone: "America/Detroit", lastPlayed: "2026-11-21T18:35:41.442", unplayed: 0, onAir: false };
    const at = (iso: string, o: Partial<QueueEvent> = {}) => eventOver({ ...day, ...o }, "2026-11-21", Date.parse(iso));
    expect(at("2026-11-22T01:00:00Z")).toBe(false); // 85 min after the finals
    expect(at("2026-11-22T01:40:00Z")).toBe(true); // 2 h 5 min after
    expect(Date.parse("2026-11-22T01:35:41.442Z") - Date.parse("2026-11-21T23:35:41.442Z")).toBe(QUIET_MS);
    // A match still without a result, a video still broadcasting, or a latest match on an earlier day: not before the day ends.
    expect(at("2026-11-22T01:40:00Z", { unplayed: 1 })).toBe(false);
    expect(at("2026-11-22T01:40:00Z", { onAir: true })).toBe(false);
    expect(at("2026-11-22T01:40:00Z", { lastPlayed: "2026-11-20T18:35:00" })).toBe(false);
    expect(at("2026-11-22T01:40:00Z", { timezone: null })).toBe(false);
    // The venue's day over: done whatever the rest says.
    expect(at("2026-11-22T05:00:01Z", { unplayed: 3, onAir: true })).toBe(true);
    // In frameStatus: queued that evening, saying nothing else.
    expect(frameStatus(ev([miss("Q1", { date: "2026-11-21" })], { end: "2026-11-21", ...day }), Date.parse("2026-11-22T01:40:00Z")))
      .toMatchObject({ state: "queued", due: 1, why: "Queued for a frame read: 1 match" });
  });

  it("settles a read on the last day that looked at the match; reads again one that didn't (played after it)", () => {
    const evening = Date.parse("2026-11-22T02:00:00Z");
    const day = { end: "2026-11-21", timezone: "America/Detroit", lastPlayed: "2026-11-21T18:35:00", unplayed: 0 };
    ROWS.push({ videoId: "EVENINGaaa1", code: "USXXQ", checked: "2026-11-22", starts: { Q1: 600 }, missing: { Q2: "its frames didn't confirm a start" }, opensOn: { at: 20, label: "Q1", underway: true }, endsOn: { at: 9000, label: "F2", fromEnd: 3 } });
    setFrameTimingsForTests(ROWS);
    // Q2 was looked at (said why not), so it's read; Q3 isn't in the read at all, so it's read again once.
    expect(frameStatus(ev([miss("Q2", { videoId: "EVENINGaaa1" })], day), evening).state).toBe("read");
    expect(frameStatus(ev([miss("Q3", { videoId: "EVENINGaaa1" })], day), evening)).toMatchObject({ state: "queued", due: 1, why: "Queued for a frame read: 1 match, read before the event finished" });
    // Between two recordings (no video of its own): its check of both, made on the last day, settles it.
    const between = (checked: string) => frameStatus(ev([miss("Q4", { videoId: null, reason: "between-recordings", video: { checked } })], day), evening).state;
    expect([between("2026-11-22"), between("2026-11-21"), between("2026-11-20")]).toEqual(["read", "read", "queued"]);
    // A read from a day before the last day settles nothing, whatever it looked at.
    ROWS.push({ videoId: "FRIDAYaaaa1", code: "USXXQ", checked: "2026-11-20", starts: {}, missing: { Q2: "its frames didn't confirm a start" } });
    setFrameTimingsForTests(ROWS);
    expect(frameStatus(ev([miss("Q2", { videoId: "FRIDAYaaaa1" })], day), evening).state).toBe("queued");
  });

  it("reads again a video whose live row saw matches at its edges yet placed none: a failed read, not a read", () => {
    // 2025 FRCMP's kind: opens on Q1, ends on M10, 0 of 55 placed. Read after the event, yet still to read.
    const R = "no frame read of it, and no agreeing reads on both sides";
    const missing = Object.fromEntries(["Q1", "Q2", "Q3", "Q4", "Q5"].map((l) => [l, R]));
    ROWS.push({ videoId: "BLINDaaaaa1", code: "USXXQ", checked: "2026-11-16", starts: {}, missing, opensOn: { at: 2390, label: "Q1", clear: true } });
    setFrameTimingsForTests(ROWS);
    expect(frameStatus(ev([miss("Q1", { videoId: "BLINDaaaaa1" })]), NOW)).toMatchObject({ state: "queued", due: 1 });
    // The same read with its edges showing no match: what the video shows, settled.
    ROWS.push({ videoId: "BLANKaaaaa1", code: "USXXQ", checked: "2026-11-16", starts: {}, missing, opensOn: { at: 3, played: 0, of: 40 } });
    setFrameTimingsForTests(ROWS);
    expect(frameStatus(ev([miss("Q1", { videoId: "BLANKaaaaa1" })]), NOW).state).toBe("read");
  });

  it("reads again a match whose row's latest read played no frame of the video, though the row keeps live starts", () => {
    // 2022 USTXSOBEOS: Q34, Q35 and the playoffs live from an earlier read; the latest read played nothing, so its other
    // matches say "no frame of the video could be read". Those weren't read; a match the read did look at is.
    ROWS.push({ videoId: "KEPTaaaaaa1", code: "USXXQ", checked: "2026-11-16", starts: { Q34: 254, Q35: 536 }, missing: { Q1: "no frame of the video could be read", Q2: "its frames didn't confirm a start" }, opensOn: { at: 20, label: "Q33", underway: true }, endsOn: { at: 9000, label: "F2", fromEnd: 3 } });
    setFrameTimingsForTests(ROWS);
    expect(frameStatus(ev([miss("Q1", { videoId: "KEPTaaaaaa1" })]), NOW)).toMatchObject({ state: "queued", due: 1 });
    expect(frameStatus(ev([miss("Q2", { videoId: "KEPTaaaaaa1" })]), NOW).state).toBe("read");
  });

  it("lists every season the reader has outgrown, 2019 on, the current season with them", () => {
    for (const season of [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]) expect(READER_SINCE[season]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A new season unlisted would never have its events read again by a better reader.
    expect(READER_SINCE[currentSeason()]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reads once more a match a reader older than its season's READER_SINCE missed; today's read settles it", () => {
    const since = READER_SINCE[2025];
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const before = new Date(Date.parse(since) - 86_400_000).toISOString().slice(0, 10);
    const later = Date.parse(since) + 2 * 86_400_000;
    // Read after the event (it ended the 14th), but before the season's reader day: due again, said why.
    expect(frameStatus(ev([miss("Q9", readOn(before))], { season: 2025 }), later))
      .toMatchObject({ state: "queued", due: 1, why: "Queued for a frame read: 1 match, read by an older reader" });
    // Read on the reader's day or after: settled, as before.
    expect(frameStatus(ev([miss("Q9", readOn(since))], { season: 2025 }), later)).toMatchObject({ state: "read", due: 0, at: since });
    // The same old read in a season READER_SINCE doesn't list: never read again for this.
    expect(frameStatus(ev([miss("Q9", readOn(before))]), later).state).toBe("read");
    // Beside other reasons it's due for, named with them.
    expect(frameStatus(ev([miss("Q1", readOn(before)), miss("Q2", { ...readOn("2026-11-14") })], { season: 2025 }), later).why)
      .toBe("Queued for a frame read: 2 matches (1 read before the event finished; 1 read by an older reader)");
  });

  it("dates a read by the matches it read, never by a match it can't place whose video was read another day", () => {
    const f = frameStatus(ev([miss("Q1", readOn("2026-11-15")), miss("Q2", { reason: "video-unavailable", ...readOn("2026-11-20") })]), NOW);
    expect(f).toMatchObject({ state: "read", at: "2026-11-15", why: "Read 2026-11-15: 1 match still without a clip, as the video shows (see each match)" });
  });

  it("never queues what no frame read can place: no video, a private one", () => {
    for (const o of [{ videoId: null, reason: "no-recording-day" as const }, { reason: "video-unavailable" as const }, { reason: "video-no-embed" as const }, { reason: "no-start" as const, videoId: null }, { reason: "no-first-video" as const, videoId: null }]) {
      expect(frameStatus(ev([miss("Q1", o)]), NOW)).toMatchObject({ state: "unreadable", due: 0 });
    }
    expect(frameStatus(ev([miss("Q1", { reason: "video-unavailable" })]), NOW).why).toBe("Nothing a frame read can place: Recording can't be played: unavailable on YouTube (private or removed)");
  });

  it("queues a match with no real start time from FIRST in a video not read yet: the reader walks it for the bar (2019)", () => {
    // 2019 NYCCHAMP, 20MOMT9: no real start times at all, videos never read, so never queued before.
    expect(frameStatus(ev([miss("Q1", { reason: "no-start" }), miss("Q2", { reason: "no-start" })]), NOW)).toMatchObject({ state: "queued", due: 2 });
    // Read after the event: settled, as any read is (2019MOQ6: its one video holds the playoffs only).
    expect(frameStatus(ev([miss("Q1", { reason: "no-start", ...readOn("2026-11-16") })]), NOW)).toMatchObject({ state: "read", at: "2026-11-16" });
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

  it("queues a video read after the event with starts but no edges for a --bounds read; one with both edges is read", () => {
    const row = (o: Partial<FrameTiming> = {}): FrameTiming => ({ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-16", starts: { Q2: 400 }, missing: { Q1: "no frame read of it" }, ...o });
    const status = () => frameStatus(ev([miss("Q1")]), NOW);
    // Starts placed, no edges read: due, so the autopilot's --bounds pass reads its first and last frames.
    setFrameTimingsForTests([row()]);
    expect(status()).toMatchObject({ state: "queued", due: 1, why: "Queued for a frame read: 1 match, its video's first and last frames not read yet" });
    // One edge only: still due for the other.
    setFrameTimingsForTests([row({ opensOn: { at: 3, label: "Q2" } })]);
    expect(status().state).toBe("queued");
    // Both edges in: read, never queued again for them.
    setFrameTimingsForTests([row({ opensOn: { at: 3, label: "Q2" }, endsOn: { at: 9000, fromEnd: 20, label: "Q40" } })]);
    expect(status()).toMatchObject({ state: "read", due: 0 });
    // No starts at all (none of this event's matches are in it): nothing for edges to prove, read.
    setFrameTimingsForTests([row({ starts: {} })]);
    expect(status().state).toBe("read");
    // Beside a match read before the event finished: both counted, each said.
    setFrameTimingsForTests([row(), { videoId: "READ20261114", code: "USXXQ", checked: "2026-11-14", starts: {}, missing: {} }]);
    expect(frameStatus(ev([miss("Q1"), miss("Q9", { videoId: "READ20261114" })]), NOW).why)
      .toBe("Queued for a frame read: 2 matches (1 read before the event finished; 1 in a video whose first and last frames aren't read yet)");
  });

  it("queues a review entry not yet given its second look, for that look alone, once; never one the owner rejected", () => {
    const edges = { opensOn: { at: 3, label: "Q2" }, endsOn: { at: 9000, fromEnd: 20, label: "Q40" } };
    const row = (review: FrameTiming["review"]): FrameTiming => ({ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-16", starts: { Q2: 400 }, review, ...edges });
    const status = (rejected?: Parameters<typeof frameStatus>[2]) => frameStatus(ev([miss("Q1")]), NOW, rejected);
    // Held for review, not looked at again: due, and only for the second look (the autopilot reads nothing else of it).
    setFrameTimingsForTests([row({ Q1: { t: 200, why: "one frame read, and nothing else agrees where the video sits" } })]);
    expect(status()).toMatchObject({ state: "queued", due: 1, recheck: 1, why: "Queued for a frame read: 1 match, held for review: a second look at the frames after each" });
    // Looked at again and not settled (`again`): read, left for the owner; never queued for it again.
    setFrameTimingsForTests([row({ Q1: { t: 200, why: "one frame read, and nothing else agrees where the video sits", again: { on: "2026-11-17", saw: "2 s on: nothing" } } })]);
    expect(status()).toMatchObject({ state: "read", due: 0 });
    expect(status().recheck).toBeUndefined();
    // Rejected by the owner at that second: not queued; at another second (a re-read placed it elsewhere): queued.
    setFrameTimingsForTests([row({ Q1: { t: 200, why: "one frame read, and nothing else agrees where the video sits" } })]);
    expect(status((v, c, l, t) => v === "VIDEOaaaaa1" && c === "USXXQ" && l === "Q1" && Math.abs(t - 202) <= 6).state).toBe("read");
    expect(status((v, c, l, t) => l === "Q1" && Math.abs(t - 900) <= 6).state).toBe("queued");
    // Beside a match read before the event finished: both counted, the event read whole (not a look alone).
    setFrameTimingsForTests([row({ Q1: { t: 200, why: "x" } }), { videoId: "READ20261114", code: "USXXQ", checked: "2026-11-14", starts: {}, missing: {} }]);
    expect(frameStatus(ev([miss("Q1"), miss("Q9", { videoId: "READ20261114" })]), NOW))
      .toMatchObject({ due: 2, recheck: 1, why: "Queued for a frame read: 2 matches (1 read before the event finished; 1 held for review, not looked at again yet)" });
  });

  it("sees the edges of the database's live rows laid over the code's (auto_reads)", () => {
    setFrameTimingsForTests([{ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-16", starts: { Q2: 400 }, missing: { Q1: "no frame read of it" } }]);
    try {
      // The autopilot's --bounds read went live from the database: its edges count, the code's row without them doesn't.
      setAutoFrameRows([{ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-17", starts: { Q2: 400 }, missing: { Q1: "no frame read of it" }, opensOn: { at: 3, label: "Q2" }, endsOn: { at: 9000, fromEnd: 20, label: "Q40" } }], [2025]);
      expect(frameStatus(ev([miss("Q1")]), NOW).state).toBe("read");
      // And a database row with starts and no edges over a code row with none: due.
      setFrameTimingsForTests([{ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-16", starts: {}, missing: {} }]);
      setAutoFrameRows([{ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-17", starts: { Q2: 400 }, missing: { Q1: "no frame read of it" } }], [2025]);
      expect(frameStatus(ev([miss("Q1")]), NOW).state).toBe("queued");
    } finally { setAutoFrameRows([]); }
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
  // After the current season's READER_SINCE, so a read the day after counts as today's reader's.
  const S = currentSeason(), SAT = "2026-11-27", VID = "UPLOADvid01", AT = Date.parse("2026-11-30T12:00:00Z");
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
    expect((await frameQueue(AT)).map((q) => q.code)).toEqual([]);
  });

  it("is queued at the next coverage check once the watcher links an upload the clock can't place", async () => {
    // What the official-videos watcher writes for a recording it found (server/videos/officialWatch.ts), and YouTube's
    // facts for it: an upload, no broadcast clock.
    await run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, added_at) VALUES (?, ?, 'UPLOADQ', 'recording', ?, NULL, 'UCtest', 'Upload Qualifier', 'watcher', ?)",
      [VID, S, SAT, new Date(AT).toISOString()]);
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', NULL, NULL, 14400, 0, ?)", [VID, new Date(AT).toISOString()]);
    forgetOfficial();
    forgetRecordings();
    expect(await checkClipCoverage(() => {})).toBe(1);
    const q = await frameQueue(AT);
    expect(q).toEqual([expect.objectContaining({ code: "UPLOADQ", frames: expect.objectContaining({ state: "queued", due: 3, rank: 1 }) })]);
    // The owner console carries it: the event's place, and the queue's numbers.
    const o = await ownerClipCoverage({ list: "unchecked" });
    const all = [...o.events, ...(await ownerClipCoverage({ list: "no-timing" })).events, ...(await ownerClipCoverage()).events];
    expect(all.find((e) => e.code === "UPLOADQ")?.frames).toMatchObject({ state: "queued", rank: 1, matches: 3 });
    expect(all.find((e) => e.code === "UPLOADQ")?.frames).not.toHaveProperty("due");
    expect(o.frameQueue).toMatchObject({ queued: 1, matches: 3, next: [{ season: S, code: "UPLOADQ", name: "Upload Qualifier", matches: 3 }] });
  });

  it("leaves the queue once its frames are read after the event; comes back for what a read on the event's day didn't see", async () => {
    setFrameTimingsForTests([{ videoId: VID, code: "UPLOADQ", checked: "2026-11-28", starts: {}, missing: { Q1: "no frame read of it", Q2: "no frame read of it", Q3: "no frame read of it" } }]);
    // Read straight off the frame rows: no coverage check needed for a row merged since.
    expect((await frameQueue(AT)).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "read", at: "2026-11-28" });
    // Read on the day, after all three were played: settled. Read before Q3 was played: Q3 is read again.
    setFrameTimingsForTests([{ videoId: VID, code: "UPLOADQ", checked: SAT, starts: {}, missing: { Q1: "no frame read of it", Q2: "no frame read of it", Q3: "no frame read of it" } }]);
    expect((await frameQueue(AT)).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "read", at: SAT });
    setFrameTimingsForTests([{ videoId: VID, code: "UPLOADQ", checked: SAT, starts: {}, missing: { Q1: "no frame read of it", Q2: "no frame read of it" } }]);
    expect((await frameQueue(AT)).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "queued", due: 1, why: "Queued for a frame read: 1 match, read before the event finished · 1st in line" });
  });

  it("is due the evening of its last day once every match has a result and none of its videos is on air", async () => {
    setFrameTimingsForTests([]);
    // 13:00 UTC is Q3's start; 15:30 is 2.5 h after it, the venue's day still on.
    const evening = Date.parse(`${SAT}T15:30:00Z`);
    expect((await frameQueue(evening)).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "queued", due: 3 });
    expect((await frameQueue(Date.parse(`${SAT}T14:30:00Z`))).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "waiting" });
    // Its video still broadcasting: it waits for the day to end.
    await run("UPDATE video_meta SET live = 1 WHERE video_id = ?", [VID]);
    expect((await frameQueue(evening)).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "waiting" });
    await run("UPDATE video_meta SET live = 0 WHERE video_id = ?", [VID]);
    // A match still without a result: the same.
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, 'UPLOADQ', 'qual', 0, 4, 'Q4', ?, 0, 'test')", [S, `${SAT}T16:00:00`]);
    expect((await frameQueue(evening)).find((q) => q.code === "UPLOADQ")?.frames).toMatchObject({ state: "waiting" });
    await run("DELETE FROM matches WHERE season = ? AND code = 'UPLOADQ' AND label = 'Q4'", [S]);
  });
});
