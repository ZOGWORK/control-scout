import { describe, expect, it } from "vitest";
import { actualStart, chapterLabel, chaptersConfirm, CHAPTER_MIN_ANCHORS, CHAPTER_MIN_GAP_S, CHAPTER_TAIL, CLIP_LEAD_S, clipSecond, clipTime, timingTrusted, watchUrl, type Chapter } from "./recording";

const rec = { start: "2026-05-02T12:58:13Z", length: 4 * 3600, live: false };

describe("a match's second in the recording", () => {
  it("is the match's start less the lead-in", () => {
    expect(clipSecond("2026-05-02T16:55:18.162Z", rec)).toBe(14225 - CLIP_LEAD_S); // Edison M14, 3:57:05 in
    expect(clipSecond("2026-05-02T13:00:13Z", rec)).toBe(120 - CLIP_LEAD_S);
  });
  it("starts at 0 for a match right after the broadcast began", () => {
    expect(clipSecond("2026-05-02T12:58:23Z", rec)).toBe(0);
  });
  it("is null outside the video: before the broadcast, after its end, on another day", () => {
    expect(clipSecond("2026-05-02T12:50:00Z", rec)).toBeNull();
    expect(clipSecond("2026-05-02T17:00:00Z", rec)).toBeNull(); // 4 h 1 min in, video is 4 h
    expect(clipSecond("2026-05-01T14:00:00Z", rec)).toBeNull();
  });
  it("is null with no broadcast start, no match start, or no length", () => {
    expect(clipSecond("2026-05-02T13:00:13Z", { ...rec, start: null })).toBeNull();
    expect(clipSecond(null, rec)).toBeNull();
    expect(clipSecond("2026-05-02T13:00:13Z", { ...rec, length: null })).toBeNull();
  });
  it("while live, reaches up to now", () => {
    const now = Date.parse("2026-05-02T14:00:00Z");
    expect(clipSecond("2026-05-02T13:30:00Z", { ...rec, length: null, live: true }, now)).toBe(1907 - CLIP_LEAD_S);
    expect(clipSecond("2026-05-02T14:30:00Z", { ...rec, length: null, live: true }, now)).toBeNull();
  });
});

describe("a video with a gap", () => {
  // Western Edge Sand 2026: broadcast 15:02 to 01:14 (10 h 12 min) but the video is 8 h 33 min; after the drop-out
  // "Q70" landed on Qualification 81. Edison 2026: 4 h 35 min 43 s both ways.
  const gapped = { start: "2026-05-30T15:02:06Z", end: "2026-05-31T01:14:37Z", length: 30807, live: false };
  const whole = { start: "2026-05-02T12:58:13Z", end: "2026-05-02T17:33:56Z", length: 16541, live: false };
  it("isn't trusted, so no match gets a second in it", () => {
    expect(timingTrusted(gapped)).toBe(false);
    expect(clipSecond("2026-05-30T15:21:09Z", gapped)).toBeNull();
  });
  it("a whole one is, and so is one still live or with no end given", () => {
    expect(timingTrusted(whole)).toBe(true);
    expect(timingTrusted({ ...whole, end: null })).toBe(true);
    expect(timingTrusted({ ...gapped, live: true })).toBe(true);
    expect(timingTrusted({ ...whole, length: 16541 - 170 })).toBe(true); // a few minutes trimmed off the end
    expect(timingTrusted({ ...whole, start: null })).toBe(false);
  });
});

describe("a stream left running after the event, its archive cut at the event's end", () => {
  // Salk League Meet 2026: broadcast 17:36:05 to 04:02:03 (10 h 26 min), video 5 h 10 min 9 s; Q23 started 22:40:22,
  // 6 min before the video ends. The missing 5 h 16 min is all after the last match.
  const salk = { start: "2026-10-31T17:36:05Z", end: "2026-11-01T04:02:03Z", length: 18609, live: false };
  const Q1 = "2026-10-31T18:18:14.130Z", Q23 = "2026-10-31T22:40:22.552Z";
  const cut = { ...salk, firstMatch: Q1, lastMatch: Q23 };
  it("is trusted once the event's matches show the cut is at the end", () => {
    expect(timingTrusted(salk)).toBe(false); // no matches known: could be a gap
    expect(timingTrusted(cut)).toBe(true);
    expect(clipSecond(Q1, cut)).toBe(2529 - CLIP_LEAD_S);
    expect(clipSecond(Q23, cut)).toBe(18257 - CLIP_LEAD_S);
  });
  it("a drop-out during the event still isn't: the last match lands past the video's end, or far from it", () => {
    // The same broadcast, but 2 h missing mid-event: the last match would be 2 h past where the video ends.
    expect(timingTrusted({ ...cut, length: 16258, end: "2026-10-31T23:00:00Z" })).toBe(false);
    // Western Edge: a match early in a video that runs on for hours more is no sign of where the gap is.
    expect(timingTrusted({ start: "2026-05-30T15:02:06Z", end: "2026-05-31T01:14:37Z", length: 30807, live: false, firstMatch: "2026-05-30T15:10:00Z", lastMatch: "2026-05-30T15:21:09Z" })).toBe(false);
    // 10 h broadcast, 1 h dropped mid-event, 9 h video, matches 0:30 to 8:50: ends 10 min after the last match by the
    // clock, but the stream ran on only 1 h 10 min after 8 h 20 min of matches, so it's a gap, not a cut.
    const t0 = Date.parse("2026-10-31T08:00:00Z"), at = (s: number) => new Date(t0 + s * 1000).toISOString();
    expect(timingTrusted({ start: at(0), end: at(36000), length: 32400, live: false, firstMatch: at(1800), lastMatch: at(31801) })).toBe(false);
    // Without the event's first match (a single match on its own), no exception.
    expect(timingTrusted({ ...salk, lastMatch: Q23 })).toBe(false);
  });
});

describe("a real start or a schedule", () => {
  it("a start with seconds or milliseconds is real; one on the minute is the schedule", () => {
    expect(actualStart("2026-05-02T11:55:18.162")).toBe(true);
    expect(actualStart("2026-05-02T11:55:00.162")).toBe(true);
    expect(actualStart("2026-05-02T11:55:07")).toBe(true);
    expect(actualStart("2026-05-02T16:55:18.162Z")).toBe(true);
    expect(actualStart("2026-05-02T09:00:00")).toBe(false);
    expect(actualStart("2026-05-02T09:00:00.000")).toBe(false);
    expect(actualStart("2026-05-02T09:00:00Z")).toBe(false);
    expect(actualStart(null)).toBe(false);
  });
});

describe("labels and links", () => {
  it("formats h:mm:ss and m:ss", () => {
    expect(clipTime(3725)).toBe("1:02:05");
    expect(clipTime(125)).toBe("2:05");
    expect(clipTime(0)).toBe("0:00");
  });
  it("links to YouTube at the second", () => {
    expect(watchUrl("WQUBVjbh-hM", 90)).toBe("https://www.youtube.com/watch?v=WQUBVjbh-hM&t=90s");
    expect(watchUrl("WQUBVjbh-hM", 0)).toBe("https://www.youtube.com/watch?v=WQUBVjbh-hM");
  });
});

describe("a recording cut short, its chapters checked", () => {
  // DECODE Preview Event (USTXFMS1) 2025: broadcast 15:49:45 to 06:32:37 (14 h 43 min), video 8 h 10 min 49 s; the
  // stream ran on overnight and the archive kept its first part. YouTube's generated chapters ("Match five" …) sit a
  // minute or two before each match, all day.
  const preview = { start: "2025-10-18T15:49:45.000Z", end: "2025-10-19T06:32:37.000Z", length: 29449, live: false };
  const t0 = Date.parse(preview.start), at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const quals = Array.from({ length: 30 }, (_, i) => ({ label: `Q${i + 1}`, startsAt: at(1100 + i * 500) }));
  const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
    "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const word = (n: number) => (n <= 20 ? words[n - 1] : n === 30 ? "thirty" : `twenty-${words[n - 21]}`);
  const chapters: Chapter[] = [[0, "Opening remarks"], ...quals.map((_, i): Chapter => [1000 + i * 500, `Match ${word(i + 1)}`]), [16000, "Awards ceremony"]];
  const timing = { ...preview, firstMatch: quals[0].startsAt, lastMatch: quals.at(-1)!.startsAt };

  it("reads the match a chapter names", () => {
    expect(["Match five", "Match twenty-one", "Qualification 12", "Q7", "Playoff match three", "Match 40"].map(chapterLabel)).toEqual(["Q5", "Q21", "Q12", "Q7", "M3", "Q40"]);
    expect(["Match seven and eight", "Lunch break", "Showcase match", "Match zero"].map(chapterLabel)).toEqual([null, null, null, null]);
  });
  const clock = (n: number) => 1100 + (n - 1) * 500; // Qn's second by the clock
  const shift = (from: number, by: number) => chapters.map(([t, title], i): Chapter => [i >= from && i <= 30 ? t - by : t, title]);
  const clips = (rec: typeof timing & { confirmedTo?: number | null }) => quals.map((q) => clipSecond(q.startsAt, rec) != null);

  it("chapters near their matches all day vouch for the clock up to the last match with enough chapters after it", () => {
    expect(timingTrusted(timing)).toBe(false); // the length alone can't tell a cut from a drop-out
    const confirmedTo = chaptersConfirm(timing, chapters, quals);
    expect(confirmedTo).toBe(clock(30 - CHAPTER_TAIL + 1));
    expect(clipSecond(quals[4].startsAt, { ...timing, confirmedTo })).toBe(3100 - CLIP_LEAD_S);
    // The last few, too few to tell from a late gap: none.
    expect(clips({ ...timing, confirmedTo })).toEqual(quals.map((_, i) => i < 30 - CHAPTER_TAIL + 1));
  });
  it("a numbering that drifts and comes back is no gap", () => {
    // Chapters 12 min early for Q12 to Q15, then back: as USTXFMS1's generated ones do late in the quals.
    const drift = chapters.map(([t, title], i): Chapter => [i >= 12 && i <= 15 ? t - 720 : t, title]);
    expect(chaptersConfirm(timing, drift, quals)).toBe(clock(27));
  });
  it("one stray early chapter is no gap after it, but a gap among the first few still is", () => {
    // Only Q1's chapter 12 min early: the rest agree.
    const stray = chapters.map(([t, title], i): Chapter => [i === 1 ? t - 720 : t, title]);
    expect(chaptersConfirm(timing, stray, quals)).toBe(clock(27));
    // 40 min lost after Q4: too little before it to vouch for.
    expect(chaptersConfirm(timing, shift(5, 2400), quals)).toBeNull();
  });
  it("a drop-out stops it at the match before, wherever it falls, however much a cut at the end also took", () => {
    // 40 min lost after Q15, in this video that's also 6 h short at the end: in the video, Q16 on come that much sooner.
    const mid = chaptersConfirm(timing, shift(16, 2400), quals)!;
    expect(mid).toBeGreaterThanOrEqual(clock(13));
    expect(mid).toBeLessThan(clock(16));
    expect(clips({ ...timing, confirmedTo: mid }).slice(15).some(Boolean)).toBe(false);
    // Lost late, after Q25: the five after it are shifted, though the later half's chapters mostly aren't.
    const late = chaptersConfirm(timing, shift(26, 1200), quals)!;
    expect(late).toBeLessThan(clock(26));
    expect(late).toBeGreaterThanOrEqual(clock(22));
    // A stream that ended soon after, its 40 min lost after Q15: the same.
    const ended = { ...timing, length: 17000, end: at(17000 + 2400) };
    expect(chaptersConfirm(ended, shift(16, 2400), quals)!).toBeLessThan(clock(16));
    // Lost before the first match: every match that far from its chapter.
    expect(chaptersConfirm(timing, chapters.map(([t, x]): Chapter => [Math.max(0, t - 2400), x]), quals)).toBeNull();
  });
  it("says nothing without enough chapters naming matches, or for a small shortfall", () => {
    expect(chaptersConfirm(timing, chapters.slice(0, CHAPTER_MIN_ANCHORS + CHAPTER_TAIL - 1), quals)).toBeNull(); // one short
    expect(chaptersConfirm(timing, [], quals)).toBeNull();
    expect(chaptersConfirm(timing, undefined, quals)).toBeNull();
    expect(chaptersConfirm({ ...timing, length: 52972 - CHAPTER_MIN_GAP_S + 1 }, chapters, quals)).toBeNull();
    expect(chaptersConfirm({ ...timing, end: null }, chapters, quals)).toBeNull();
  });
});
