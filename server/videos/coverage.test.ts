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

  it("says spans in hours and minutes", () => {
    expect([span(900), span(4520), span(14_400)]).toEqual(["15 min", "1 h 15 min", "4 h"]);
  });
});
