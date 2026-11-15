// Clip coverage: every played match gets a clip or a reason in plain words, read off withClips' own decisions; a day
// with no video is named; an event with no recording at all is "none" (stats only).
import { afterAll, describe, expect, it } from "vitest";
import { clipCoverage, hms, span, type CoverageInput } from "./coverage";
import { FRAME_TIMINGS, setFrameTimingsForTests, type FrameTiming } from "../data/frameTimings";
import type { Recording, VideoMeta } from "./recordings";

const meta = (videoId: string, start: string, end: string, length: number, o: Partial<VideoMeta> = {}): VideoMeta =>
  ({ videoId, status: "ok", start, end, length, live: false, checkedAt: "2026-11-01T00:00:00Z", ...o });
/** A played match at a UTC time (the event's zone is UTC), FIRST's actual start (it has milliseconds). */
const m = (label: string, at: string, o: Partial<CoverageInput> = {}): CoverageInput =>
  ({ key: `qual:0:${label.slice(1)}`, label, time: `${at}.123`, startsAt: `${at}.123Z`, played: true, video: null, ...o });
const NOW = Date.parse("2026-11-13T00:00:00Z");

describe("clipCoverage", () => {
  // Friday's video follows the clock; Saturday's is 4 h short with no chapters; Sunday has no video.
  const fri = meta("FRIDAYvid01", "2026-03-06T13:00:00Z", "2026-03-06T18:00:00Z", 18_000);
  const sat = meta("SATURDAYv01", "2026-03-07T13:00:00Z", "2026-03-07T22:00:00Z", 18_000);
  const rec: Recording = { videoId: fri.videoId, meta: fri, source: "official", daily: true, more: [{ videoId: sat.videoId, meta: sat }] };
  const matches = [
    m("Q1", "2026-03-06T14:00:00"), m("Q2", "2026-03-06T14:10:00"),
    m("Q3", "2026-03-07T14:00:00"), m("Q4", "2026-03-07T14:10:00"),
    m("Q5", "2026-03-08T14:00:00"),
    // A result posted without its start: the schedule, on the minute.
    { ...m("Q6", "2026-03-06T15:00:00"), time: "2026-03-06T15:00:00", startsAt: "2026-03-06T15:00:00Z" },
    { ...m("Q7", "2026-03-08T15:00:00"), played: false },
  ];
  const c = clipCoverage(matches, rec, rec, "UTC", NOW);

  it("gives every played match a clip or a reason, and never looks fully recorded", () => {
    expect(c.state).toBe("partial");
    expect(c.played).toBe(6);
    expect(c.withClip).toBe(2);
    const by = Object.fromEntries(c.matches.map((x) => [x.label, x]));
    expect(by.Q1.clip && by.Q2.clip).toBe(true);
    expect(by.Q3).toMatchObject({ clip: false, reason: "gap-unplaced", videoId: "SATURDAYv01" });
    expect(by.Q3.why).toContain("4 h shorter than its broadcast");
    expect(by.Q5).toMatchObject({ clip: false, reason: "no-recording-day", why: "No recording for Sunday" });
    // Counted in its day: Friday is 2 of 3, never shown as fully clipped.
    expect(by.Q6).toMatchObject({ clip: false, reason: "no-start", videoId: "FRIDAYvid01" });
    expect(c.matches.some((x) => x.reason === "unexplained")).toBe(false);
  });

  it("names each day's video, what it holds, and the day with none", () => {
    expect(c.videos.map((v) => [v.label, v.matches, v.clipped])).toEqual([["Friday", 3, 2], ["Saturday", 2, 0]]);
    expect(c.videos[1].why).toMatch(/shorter than its broadcast/);
    expect(c.daysMissing).toEqual([{ date: "2026-03-08", label: "Sunday", matches: 1 }]);
  });

  it("says a video YouTube won't play is why its day has none", () => {
    const gone = { ...rec, more: [{ videoId: "GONEvideo01", meta: { ...sat, videoId: "GONEvideo01", status: "unavailable" as const }, day: "2026-03-07" }] };
    const page = { ...rec, more: [] };
    const g = clipCoverage(matches, page, gone, "UTC", NOW);
    expect(g.matches.find((x) => x.label === "Q3")).toMatchObject({ reason: "video-unavailable", videoId: "GONEvideo01" });
  });

  it("says an early start that would open on the match before is why", () => {
    // 10 min short, no chapters: clips start 10 min early; matches 5 min apart can't.
    const short = meta("SHORTgap001", "2026-03-06T13:00:00Z", "2026-03-06T18:00:00Z", 17_400);
    const s = clipCoverage([m("Q1", "2026-03-06T14:00:00"), m("Q2", "2026-03-06T14:05:00"), m("Q3", "2026-03-06T15:00:00")], { videoId: short.videoId, meta: short, source: "first" }, null, "UTC", NOW);
    expect(s.matches.map((x) => x.reason ?? "clip")).toEqual(["clip", "overlaps-previous", "clip"]);
    expect(s.matches[0].basis).toMatch(/^clock only/);
  });

  it("is none for an event with no recording and no match video", () => {
    const n = clipCoverage([m("Q1", "2026-03-06T14:00:00")], null, null, "UTC", NOW);
    expect(n).toMatchObject({ state: "none", played: 1, withClip: 0 });
    expect(n.matches[0].reason).toBe("no-first-video");
  });

  it("counts FIRST's own match video as a clip", () => {
    const f = clipCoverage([m("Q1", "2026-03-06T14:00:00", { video: "https://youtu.be/abcdefghijk" })], null, null, "UTC", NOW);
    expect(f).toMatchObject({ state: "full", withClip: 1 });
  });

  it("names a day with no video even when none of its matches has a real start", () => {
    // Sunday's results all posted without their starts (the schedule): still an unrecorded day, not counted in Friday.
    const noStart = [m("Q1", "2026-03-06T14:00:00"), { ...m("Q2", "2026-03-08T14:00:00"), time: "2026-03-08T14:00:00", startsAt: "2026-03-08T14:00:00Z" }];
    const one: Recording = { videoId: fri.videoId, meta: fri, source: "first" };
    const c2 = clipCoverage(noStart, one, one, "UTC", NOW);
    expect(c2.daysMissing).toEqual([{ date: "2026-03-08", label: "Sunday", matches: 1 }]);
    expect(c2.matches[1]).toMatchObject({ reason: "no-start", videoId: null });
    expect(c2.videos[0]).toMatchObject({ matches: 1, clipped: 1 });
  });

  it("a video with its start cut off (AUSYOS Saturday part 1): clips from the chapters' shift, a match before them said so", () => {
    const start = "2026-07-03T23:42:02.000Z", s0 = Date.parse(start);
    const clockAt = [15600, 16199, 16776, 17355, 17892, 18354, 18760, 19194, 19530, 20047, 20584, 21147, 21526, 22119, 22648, 23128, 23563, 24325, 24915, 25737];
    const chapterAt = [0, 693, 1188, 1913, 2343, 2768, 3174, 3651, 4022, 4381, 4956, 5469, 6000, 6326, 7036, 7462, 8032, 8425, 9294, 9743];
    const iso = (c: number) => new Date(s0 + c * 1000).toISOString().slice(0, 19);
    const v = meta("fBZOzjZr-60", start, "2026-07-04T07:04:47.000Z", 11120, { chapters: chapterAt.map((t, i) => [t, `Match ${i + 11} qualification`] as [number, string]) });
    // Q10 played 10 min before Q11, the first match its chapters name.
    const ms = [m("Q10", iso(15000)), ...clockAt.map((c, i) => m(`Q${i + 11}`, iso(c)))];
    const r: Recording = { videoId: v.videoId, meta: v, source: "official" };
    const cut = clipCoverage(ms, r, r, "UTC", NOW);
    expect(cut.withClip).toBe(20);
    expect(cut.matches[0]).toMatchObject({ label: "Q10", reason: "before-chapters", why: expect.stringMatching(/^Before the part of the video its chapters confirm/) });
    expect(cut.matches[1].basis).toMatch(/^clock \+ YouTube chapters \(its first 4 h \d+ min cut off\)$/);
  });

  it("a match past what was checked frame by frame is said so, never blamed on chapters (USCHSLAOS Sunday)", () => {
    const v = meta("W6ywzjs-MUM", "2026-02-15T11:55:24Z", "2026-02-16T03:15:59Z", 34_990);
    const at = (s: number) => new Date(Date.parse(v.start!) + s * 1000).toISOString().slice(0, 19);
    const r: Recording = { videoId: v.videoId, meta: v, source: "official" };
    const c = clipCoverage([m("Q49", at(401)), m("Q50", at(33_500))], r, r, "UTC", NOW);
    expect(c.matches[0].clip).toBeTruthy();
    expect(c.matches[1]).toMatchObject({ reason: "past-checked", why: expect.stringMatching(/^Past the part of the video checked frame by frame \(to 9 h 7 min/) });
  });

  it("says a finished video with no length from YouTube can't place a match", () => {
    const noLength = { ...meta("NOLENGTHv01", "2026-03-06T13:00:00Z", "2026-03-06T18:00:00Z", 0), length: null };
    const r: Recording = { videoId: noLength.videoId, meta: noLength, source: "first" };
    const c3 = clipCoverage([m("Q1", "2026-03-06T14:00:00")], r, r, "UTC", NOW);
    expect(c3.matches[0]).toMatchObject({ clip: false, reason: "video-unread", why: "YouTube didn't give the video's length", videoId: "NOLENGTHv01" });
  });

  it("counts a match with no real start in the part of its day whose broadcast holds its schedule", () => {
    const p1 = meta("PARTONEvid1", "2026-03-07T09:00:00Z", "2026-03-07T12:00:00Z", 10_800), p2 = meta("PARTTWOvid1", "2026-03-07T13:00:00Z", "2026-03-07T18:00:00Z", 18_000);
    const r: Recording = { videoId: p1.videoId, meta: p1, source: "official", daily: true, more: [{ videoId: p2.videoId, meta: p2, part: "Part 2" }] };
    const late = { ...m("Q9", "2026-03-07T15:00:00"), time: "2026-03-07T15:00:00", startsAt: "2026-03-07T15:00:00Z" };
    const c4 = clipCoverage([m("Q1", "2026-03-07T10:00:00"), late], r, r, "UTC", NOW);
    expect(c4.matches[1]).toMatchObject({ reason: "no-start", videoId: "PARTTWOvid1" });
    expect(c4.videos.map((v) => [v.videoId, v.matches, v.clipped])).toEqual([["PARTONEvid1", 1, 1], ["PARTTWOvid1", 1, 0]]);
  });

  it("never says a length matched when it couldn't be compared (still live, or no end)", () => {
    const live = { ...meta("LIVEvideo01", "2026-03-06T13:00:00Z", "", 0), end: null, length: null, live: true };
    const l = clipCoverage([m("Q1", "2026-03-06T14:00:00")], { videoId: live.videoId, meta: live, source: "first" }, null, "UTC", Date.parse("2026-03-06T16:00:00Z"));
    expect(l.matches[0]).toMatchObject({ clip: true, basis: "clock, broadcast still live" });
  });

  it("says when the event's time zone can't place a real start, never 'after the broadcast'", () => {
    const one: Recording = { videoId: fri.videoId, meta: fri, source: "first" };
    const z = clipCoverage([{ ...m("Q1", "2026-03-06T14:00:00"), startsAt: null }], one, one, null, NOW);
    expect(z.matches[0]).toMatchObject({ clip: false, reason: "no-zone", videoId: fri.videoId });
  });

  it("says spans in hours and minutes", () => {
    expect([span(900), span(4520), span(14_400), span(25), span(0.4)]).toEqual(["15 min", "1 h 15 min", "4 h", "25 s", "1 s"]);
  });
});

// Addendum §7 (2026-11-15): the stream is the truth. A match left out by the clock alone (an early start, a time before
// the broadcast) says what its video's frames showed, never "starts up to N min early" or what the clock said; the
// clock's reading is kept apart (`clock`).
describe("clipCoverage, what the video showed (Romania COANDA 2025 ROCMPCND)", () => {
  const kept: FrameTiming[] = [...FRAME_TIMINGS];
  afterAll(() => setFrameTimingsForTests(kept));
  // Friday's video 10 min short with no chapters: clips may start 10 min early, so Q2, 5 min after Q1, is held back.
  const fri = meta("pvmxbH8YW-k", "2026-03-13T07:00:00Z", "2026-03-13T12:00:00Z", 17_400);
  const rec: Recording = { videoId: fri.videoId, meta: fri, source: "official", code: "ROCMPCND" };
  const ms = [m("Q1", "2026-03-13T08:00:00"), m("Q2", "2026-03-13T08:05:00"), m("Q3", "2026-03-13T09:00:00")];
  const q2 = () => clipCoverage(ms, rec, rec, "UTC", NOW).matches.find((x) => x.label === "Q2")!;

  it("not read yet: 'Not yet checked against the video', never 'An early start would open on the match before'", () => {
    setFrameTimingsForTests([]);
    const q = q2();
    expect(q).toMatchObject({ clip: false, reason: "overlaps-previous", why: "Not yet checked against the video", video: { checked: null } });
    expect(q.why).not.toMatch(/early/i);
    expect(q.clock).toMatch(/^An early start would open on the match before \(starts up to 10 min early\)$/);
  });

  it("read, no start found for it: says so with the video's own timestamps of the matches around it", () => {
    setFrameTimingsForTests([{ videoId: fri.videoId, code: "ROCMPCND", checked: "2026-11-14", starts: { Q3: 10440 }, missing: { Q2: "no frame read of it, and no agreeing reads on both sides" } }]);
    const q = q2();
    expect(q.why).toBe("Checked in the video (2026-11-14): no start found for it (no frame read of it, and no agreeing reads on both sides); in the video, Q3 at 2:54:00");
    expect(q.video).toEqual({ checked: "2026-11-14", found: "no frame read of it, and no agreeing reads on both sides", after: { label: "Q3", at: 10440 } });
  });

  it("Early start only when the frames show it starting inside the match before, with both timestamps", () => {
    setFrameTimingsForTests([{ videoId: fri.videoId, code: "ROCMPCND", checked: "2026-11-14", starts: { Q3: 10440 }, earlyStart: { Q2: { t: 3900, previousEnds: 3960 } } }]);
    expect(q2().why).toBe("Checked in the video: it starts at 1:05:00 while the match before runs to 1:06:00, so a clip would open on that one");
  });

  it("Q19, played before Saturday's broadcast started: said as what the video showed (its first match read, Q20 at 0:03:29)", () => {
    const sat = meta("zG45zl5pcDw", "2026-03-14T07:00:00Z", "2026-03-14T15:00:00Z", 28_800);
    const r: Recording = { videoId: sat.videoId, meta: sat, source: "official", code: "ROCMPCND" };
    setFrameTimingsForTests([{ videoId: sat.videoId, code: "ROCMPCND", checked: "2026-11-14", starts: { Q20: 209 } }]);
    const c = clipCoverage([m("Q19", "2026-03-14T06:50:00"), m("Q20", "2026-03-14T07:04:00")], r, r, "UTC", NOW);
    expect(c.matches[0]).toMatchObject({ label: "Q19", reason: "before-broadcast", clock: "Played before the broadcast started",
      why: "Checked in the video (2026-11-14): no start found for it; in the video, Q20 at 0:03:29" });
  });

  it("writes a second in a video as h:mm:ss", () => {
    expect([hms(10440), hms(209), hms(0), hms(-3)]).toEqual(["2:54:00", "0:03:29", "0:00:00", "0:00:00"]);
  });
});

// FUN League Tournament 2025 USFLFNLT, 41 of 44 (owner-checked): Q1–Q3 played after Saturday's first recording ended
// and before its second started. They're in neither, so the reason names that gap, with both times, and neither
// video's count holds them.
describe("clipCoverage, a match between two of a day's recordings (USFLFNLT)", () => {
  const kept: FrameTiming[] = [...FRAME_TIMINGS];
  afterAll(() => setFrameTimingsForTests(kept));
  const first = meta("afaqqytUvDU", "2026-01-31T14:06:36Z", "2026-01-31T14:45:26Z", 2329);
  const second = meta("nm-LnMVtCJM", "2026-01-31T16:12:47Z", "2026-01-31T23:45:05Z", 27_130);
  const rec: Recording = { videoId: first.videoId, meta: first, source: "first", code: "USFLFNLT", daily: true, more: [{ videoId: second.videoId, meta: second }] };
  // FIRST's times are the venue's (New York, UTC−5 in January).
  const ny = (label: string, local: string): CoverageInput => {
    const z = new Date(Date.parse(`${local}Z`) + 5 * 3600_000).toISOString();
    return { key: `qual:0:${label.slice(1)}`, label, time: `${local}.475`, startsAt: z, played: true, video: null };
  };
  const ms = [ny("Q1", "2026-01-31T10:56:12"), ny("Q2", "2026-01-31T11:03:20"), ny("Q3", "2026-01-31T11:12:15"), ny("Q4", "2026-01-31T11:18:00")];
  const GAP = "Played between the recordings (after afaqqytUvDU ended at 9:45 AM, before nm-LnMVtCJM started at 11:12 AM)";

  it("names the gap with both times, pins it to neither video, and says neither was checked yet", () => {
    setFrameTimingsForTests([]);
    const c = clipCoverage(ms, rec, rec, "America/New_York", NOW);
    expect(c.matches.slice(0, 3).map((x) => [x.label, x.reason, x.videoId])).toEqual([["Q1", "between-recordings", null], ["Q2", "between-recordings", null], ["Q3", "between-recordings", null]]);
    expect(c.matches[0].why).toBe(`${GAP}; not yet checked against either video`);
    expect(c.matches.some((x) => /after the broadcast ended/i.test(x.why ?? ""))).toBe(false);
    // Neither video's count holds them: no "Saturday 0/3".
    expect(c.videos.map((v) => [v.videoId, v.matches, v.clipped])).toEqual([["afaqqytUvDU", 0, 0], ["nm-LnMVtCJM", 1, 1]]);
  });

  it("checked in both videos and in neither: said so (settled)", () => {
    setFrameTimingsForTests([
      { videoId: "afaqqytUvDU", code: "USFLFNLT", checked: "2026-11-15", starts: {} },
      { videoId: "nm-LnMVtCJM", code: "USFLFNLT", checked: "2026-11-15", starts: { Q4: 330 } },
    ]);
    const c = clipCoverage(ms, rec, rec, "America/New_York", NOW);
    expect(c.matches[0]).toMatchObject({ reason: "between-recordings", why: `${GAP}; checked in both videos (2026-11-15): in neither`, video: { checked: "2026-11-15", found: "in neither video" } });
  });

  it("a video its frame read couldn't play isn't checked yet", () => {
    setFrameTimingsForTests([
      { videoId: "afaqqytUvDU", code: "USFLFNLT", checked: "2026-11-15", starts: {}, missing: { Q1: "the video couldn't be played (HTTP 403)" } },
      { videoId: "nm-LnMVtCJM", code: "USFLFNLT", checked: "2026-11-15", starts: { Q4: 330 } },
    ]);
    expect(clipCoverage(ms, rec, rec, "America/New_York", NOW).matches[0].why).toBe(`${GAP}; not yet checked against either video`);
  });
});
