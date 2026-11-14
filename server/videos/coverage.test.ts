// Clip coverage: every played match gets a clip or a reason in plain words, read off withClips' own decisions; a day
// with no video is named; an event with no recording at all is "none" (stats only).
import { describe, expect, it } from "vitest";
import { clipCoverage, span, type CoverageInput } from "./coverage";
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

  it("says spans in hours and minutes", () => {
    expect([span(900), span(4520), span(14_400)]).toEqual(["15 min", "1 h 15 min", "4 h"]);
  });
});
