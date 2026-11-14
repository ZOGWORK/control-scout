import { describe, expect, it } from "vitest";
import { actualStart, chapterLabel, chaptersConfirm, CHAPTER_MIN_ANCHORS, CHAPTER_MIN_GAP_S, CHAPTER_TAIL, CLIP_LEAD_S, clearOfPrevious, clipEnd, clipSecond, CLIP_TAIL_S, LIVE_DELAY_MAX_S, LIVE_DELAY_MIN_S, clipTime, FRAME_TAIL_S, frameClipEnd, gapSlack, GAP_SLACK_MAX_S, MATCH_PLAY_S, timingTrusted, watchUrl, type Chapter } from "./recording";

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

describe("where a match's clip stops", () => {
  // Edison M14 at 14,225 s into a 5 h video, on a trusted clock.
  const M14 = "2026-05-02T16:55:18.162Z";
  const long = { ...rec, length: 5 * 3600 };
  it("at the match's own second, plus its play and the tail (the live delay and the final score)", () => {
    expect(clipEnd(M14, long)).toBe(14225 + MATCH_PLAY_S + CLIP_TAIL_S);
    expect(MATCH_PLAY_S + CLIP_TAIL_S).toBe(220);
    // A clip that starts at 0 (a match right after the broadcast began) still ends from the match's own second.
    expect(clipEnd("2026-05-02T12:58:23Z", rec)).toBe(10 + 220);
  });
  it("never past the video's end", () => {
    expect(clipEnd(M14, rec)).toBe(4 * 3600); // in the 4 h video: 14,445 would be past 14,400
  });
  it("none where there's no clip: outside the video, no start, a gap it can't place", () => {
    expect(clipEnd("2026-05-02T17:00:00Z", rec)).toBeNull();
    expect(clipEnd(null, rec)).toBeNull();
    expect(clipEnd("2026-05-02T13:00:13Z", { ...rec, start: null })).toBeNull();
    const gapped = { start: "2026-05-30T15:02:06Z", end: "2026-05-31T01:14:37Z", length: 30807, live: false };
    expect(clipEnd("2026-05-30T15:21:09Z", gapped)).toBeNull();
  });
  it("an early start (gapSlack) never moves it earlier: the match may sit before its clock second, never after", () => {
    const short13 = { start: "2026-11-07T12:57:06Z", end: "2026-11-08T00:00:35Z", length: 39013, live: false, firstMatch: "2026-11-07T16:15:45Z", lastMatch: "2026-11-07T23:23:13Z" };
    expect(clipSecond("2026-11-07T22:21:39Z", short13)).toBe(33873 - 796 - CLIP_LEAD_S);
    expect(clipEnd("2026-11-07T22:21:39Z", short13)).toBe(33873 + 220);
  });
  it("a start cut off the video (shift): from the match's place in the video, as its clip's start", () => {
    // AUSYOS Saturday part 1 kind: 15,445 s cut off the start, the chapters agreeing.
    const cut = { ...long, confirmedTo: 6 * 3600, shift: 3600 };
    expect(clipEnd(M14, cut)).toBe(14225 - 3600 + 220);
  });
  it("before the next match's timer shows, though never before its own play is over", () => {
    // The next match 3 min on (two fields): the clip stops as that one's timer could first show.
    expect(clipEnd(M14, long, "2026-05-02T16:58:30Z")).toBe(14225 + 192 + LIVE_DELAY_MIN_S);
    // 1 min on: its own play first, at the latest it may show.
    expect(clipEnd(M14, long, "2026-05-02T16:56:18Z")).toBe(14225 + MATCH_PLAY_S + LIVE_DELAY_MAX_S);
    // Far off: the whole tail.
    expect(clipEnd(M14, long, "2026-05-02T17:05:00Z")).toBe(14225 + 220);
  });
  it("while live, isn't held to a length", () => {
    const now = Date.parse("2026-05-02T14:00:00Z");
    expect(clipEnd("2026-05-02T13:30:00Z", { ...rec, length: null, live: true }, null, now)).toBe(1907 + 220);
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

  // Royal Oak Qualifier 2026: broadcast 12:57:06 to 00:00:35, video 10 h 50 min 13 s: 796 s missing, no chapters,
  // matches 16:15 to 23:23, so neither a trimmed tail nor trusted.
  const short13 = { start: "2026-11-07T12:57:06Z", end: "2026-11-08T00:00:35Z", length: 39013, live: false, firstMatch: "2026-11-07T16:15:45Z", lastMatch: "2026-11-07T23:23:13Z" };
  it("a gap of at most 15 min that can't be placed: each match starts early by all of it, never after its start", () => {
    expect(timingTrusted(short13)).toBe(false);
    expect(gapSlack(short13)).toBe(796);
    // A match at 22:21:39 by the clock: 33873 s in, so between 33077 and 33873 in the video; it starts before both.
    expect(clipSecond("2026-11-07T22:21:39Z", short13)).toBe(33873 - 796 - CLIP_LEAD_S);
    expect(clipSecond("2026-11-07T12:58:00Z", short13)).toBe(0);
    // A trusted video starts on time; more missing, or a big gap, none.
    expect(gapSlack(whole)).toBe(0);
    expect(gapSlack({ ...short13, length: 39809 - GAP_SLACK_MAX_S - 1 })).toBeNull();
    expect(gapSlack(gapped)).toBeNull();
    expect(clipSecond("2026-05-30T15:21:09Z", gapped)).toBeNull();
  });
  it("its ends: a match in the broadcast's last `slack` seconds gets one; one past its end, none; exactly the most missing counts", () => {
    // The broadcast ran 39809 s; the video is 39013 s long.
    expect(clipSecond("2026-11-08T00:00:00Z", short13)).toBe(39774 - 796 - CLIP_LEAD_S);
    expect(clipSecond("2026-11-08T00:00:36Z", short13)).toBeNull();
    expect(gapSlack({ ...short13, length: 39809 - GAP_SLACK_MAX_S })).toBe(GAP_SLACK_MAX_S);
  });
  it("an early start never reaches back into the match before's play (Glen Allen VA #1 Qualifier 2024: Q10 played Q8 and Q9 first)", () => {
    // 532 s missing; Q9 started 4 min 18 s before Q10 by the clock, so Q10's clip, 552 s early, opened on Q8's play.
    expect(clearOfPrevious("2024-12-14T16:22:18.606Z", "2024-12-14T16:18:00.862Z", 532)).toBe(false);
    // Far enough after the one before: its play is over when the clip starts (its results, the field reset).
    expect(clearOfPrevious("2024-12-14T16:30:00Z", "2024-12-14T16:15:00Z", 532)).toBe(true);
    const at = Date.parse("2024-12-14T16:30:00Z"), edge = (s: number) => new Date(at - s * 1000).toISOString();
    expect(clearOfPrevious("2024-12-14T16:30:00Z", edge(532 + CLIP_LEAD_S + MATCH_PLAY_S), 532)).toBe(true);
    expect(clearOfPrevious("2024-12-14T16:30:00Z", edge(532 + CLIP_LEAD_S + MATCH_PLAY_S - 1), 532)).toBe(false);
    // On time (a trusted video), or the video's first match: nothing before it to reach.
    expect(clearOfPrevious("2024-12-14T16:22:18.606Z", "2024-12-14T16:18:00.862Z", 0)).toBe(true);
    expect(clearOfPrevious("2024-12-14T16:22:18.606Z", null, 532)).toBe(true);
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
  it("reads a match whose chapter goes on after its number (YouTube's generated words, an organiser's team list)", () => {
    // Seen on 2025–26 recordings: Match 16 analysis (USTXDASQ), Match one gameplay (NLZEQ), Qualification match 1
    // (USIAMPM11), Match 1 Highlights (USTXNIM2), Q1 with its teams (USORRCLT).
    expect(["Match 16 analysis", "Match one gameplay", "Qualification match 1", "Match 1 Highlights", "Q1 🔵20288 Mechanical Mages 🔵 7604 DWAI",
      "Qualification match twenty one recap", "Playoff Match 7 - upper bracket"].map(chapterLabel)).toEqual(["Q16", "Q1", "Q1", "Q1", "Q1", "Q21", "M7"]);
    // Two matches, or no number of its own.
    expect(["Match 7 and 8", "Match 7 & 8", "Match 7-8", "Match 7, 8", "Matches 7 to 9", "Match 7 then Match 8", "Match setup and team intro",
      "Match announcement", "Q&A Session", "Meeting setup", "Match 123456", "Match 12b", "Q1 Q2", "M3 / M4", "Qualification 5 / Qualification 6", "Match 7 and 12", "Match 7 - 112", "Match 7 then match 12"].map(chapterLabel)).toEqual(Array(18).fill(null));
  });
  const clock = (n: number) => 1100 + (n - 1) * 500; // Qn's second by the clock
  const shift = (from: number, by: number) => chapters.map(([t, title], i): Chapter => [i >= from && i <= 30 ? t - by : t, title]);
  /** How far the chapters vouch for the clock, as the tests before the shift was kept read it. */
  const confirm = (...a: Parameters<typeof chaptersConfirm>) => chaptersConfirm(...a)?.to ?? null;
  const clips = (rec: typeof timing & { confirmedTo?: number | null; shift?: number | null }) => quals.map((q) => clipSecond(q.startsAt, rec) != null);

  it("chapters near their matches all day vouch for the clock up to the last match with enough chapters after it", () => {
    expect(timingTrusted(timing)).toBe(false); // the length alone can't tell a cut from a drop-out
    const confirmedTo = confirm(timing, chapters, quals);
    expect(confirmedTo).toBe(clock(30 - CHAPTER_TAIL + 1));
    expect(clipSecond(quals[4].startsAt, { ...timing, confirmedTo })).toBe(3100 - CLIP_LEAD_S);
    // The last few, too few to tell from a late gap: none.
    expect(clips({ ...timing, confirmedTo })).toEqual(quals.map((_, i) => i < 30 - CHAPTER_TAIL + 1));
  });
  it("a numbering that drifts and comes back is no gap", () => {
    // Chapters 12 min early for Q12 to Q15, then back: as USTXFMS1's generated ones do late in the quals.
    const drift = chapters.map(([t, title], i): Chapter => [i >= 12 && i <= 15 ? t - 720 : t, title]);
    expect(confirm(timing, drift, quals)).toBe(clock(27));
  });
  it("one stray early chapter is no gap after it, but a gap among the first few still is", () => {
    // Only Q1's chapter 12 min early: the rest agree.
    const stray = chapters.map(([t, title], i): Chapter => [i === 1 ? t - 720 : t, title]);
    expect(confirm(timing, stray, quals)).toBe(clock(27));
    // 40 min lost after Q4: too little before it to vouch for.
    expect(confirm(timing, shift(5, 2400), quals)).toBeNull();
  });
  it("a drop-out stops it at the match before, wherever it falls, however much a cut at the end also took", () => {
    // 40 min lost after Q15, in this video that's also 6 h short at the end: in the video, Q16 on come that much sooner.
    const mid = confirm(timing, shift(16, 2400), quals)!;
    expect(mid).toBeGreaterThanOrEqual(clock(13));
    expect(mid).toBeLessThan(clock(16));
    expect(clips({ ...timing, confirmedTo: mid }).slice(15).some(Boolean)).toBe(false);
    // Lost late, after Q25: the five after it are shifted, though the later half's chapters mostly aren't.
    const late = confirm(timing, shift(26, 1200), quals)!;
    expect(late).toBeLessThan(clock(26));
    expect(late).toBeGreaterThanOrEqual(clock(22));
    // A stream that ended soon after, its 40 min lost after Q15: the same.
    const ended = { ...timing, length: 17000, end: at(17000 + 2400) };
    expect(confirm(ended, shift(16, 2400), quals)!).toBeLessThan(clock(16));
  });
  // 40 min cut off the video's start, and nothing else lost: the broadcast ran 40 min longer than the video holds.
  const cutRec = { ...timing, end: at(29449 + 2400) };
  // Its chapters 2400 s sooner; those of matches before the cut (Q1 to Q3) aren't in the video.
  const cut = chapters.filter(([t], i) => i === 0 || t - 2400 >= 0).map(([t, x], i): Chapter => [i === 0 ? 0 : t - 2400, x]);
  it("time cut off the start is a shift the clock and chapters agree on: every match placed that far back", () => {
    expect(timingTrusted(cutRec)).toBe(false);
    const c = chaptersConfirm(cutRec, cut, quals)!;
    // The chapters say 2500 s (each sits 100 s before its match), but a video never lost more than it's missing: 2400.
    expect(c.shift).toBe(2400);
    const rec = { ...cutRec, confirmedTo: c.to, shift: c.shift };
    // Q10, 5600 s by the clock: 3200 s into the video, less the lead-in.
    expect(clipSecond(quals[9].startsAt, rec)).toBe(clock(10) - 2400 - CLIP_LEAD_S);
    // Q1 to Q3 began before the cut: none, never a clip at the video's start in their place. Every match after, the
    // last few too: the cut is all the time missing, so no gap can follow it.
    expect(clips(rec)).toEqual(quals.map((_, i) => i >= 3));
  });
  it("no cut where the chapters say otherwise", () => {
    // Chapters later than their matches: a video never holds more than its broadcast.
    expect(chaptersConfirm(cutRec, chapters.map(([t, x]): Chapter => [t + 2400, x]), quals)).toBeNull();
    // A shift larger than the time missing (and past the chapters' drift).
    expect(chaptersConfirm({ ...cutRec, end: at(29449 + 1200) }, cut, quals)).toBeNull();
    // Time still missing beyond the cut: a drop-out could hide anywhere after it (frames showed Qualifier Hasselt's
    // Q5 placed on Q1 that way), so none.
    expect(chaptersConfirm(timing, cut, quals)).toBeNull();
    expect(chaptersConfirm({ ...cutRec, end: at(29449 + 2400 + 600) }, cut, quals)).toBeNull();
    // One match at its own clock time, the rest shifted: a video that began with its broadcast and lost time after
    // it (Qualifier Hasselt 2026, NLHAQ: Q1 in place, a drop-out over lunch), not a cut.
    const gapAfterQ1 = chapters.map(([t, x], i): Chapter => [i >= 2 && i <= 30 ? t - 2400 : t, x]);
    expect(chaptersConfirm(cutRec, gapAfterQ1, quals)).toBeNull();
  });
  it("a cut, then a gap under the chapters' drift: none (the matches before the gap would open early)", () => {
    // 2400 s cut off, then 500 s lost after Q6: Q4 to Q6 sit 2400 s from their chapters, the rest 2900, and the video
    // is missing 2900. The median says 2900, which would put Q4 to Q6 500 s early.
    const gapRec = { ...timing, end: at(29449 + 2900) };
    const cutThenGap = chapters.filter(([t], i) => i === 0 || t - 2400 >= 0).map(([t, x], i): Chapter => {
      const n = /^Match (four|five|six)$/.test(x) ? 2400 : 2900;
      return [i === 0 ? 0 : Math.max(0, t - n), x];
    });
    expect(chaptersConfirm(gapRec, cutThenGap, quals)).toBeNull();
  });
  it("matches before the first chapter-named one get no shifted clip: a gap after them looks like a cut", () => {
    // Q1 to Q4 in place with no chapters, then 40 min lost: the later chapters all agree on the shift, but Q1 to Q4
    // shifted would land 40 min early, on other matches. Only from Q5, the first a chapter names.
    const noEarly = chapters.filter(([, x]) => !/^Match (one|two|three|four)$/.test(x)).map(([t, x]): Chapter => [x.startsWith("Match") ? t - 2400 : t, x]);
    const c = chaptersConfirm(cutRec, noEarly, quals)!;
    expect(c.from).toBe(clock(5));
    // The first named match itself keeps its clip (its clock to the second, as clipSecond reads it).
    expect(clipSecond(quals[4].startsAt, { ...cutRec, confirmedTo: c.to, shift: c.shift, confirmedFrom: c.from })).toBe(clock(5) - 2400 - CLIP_LEAD_S);
    const rec = { ...cutRec, confirmedTo: c.to, shift: c.shift, confirmedFrom: c.from };
    expect(clips(rec)).toEqual(quals.map((_, i) => i >= 4));
  });
  it("APOC 2026 Saturday part 1 (AUSYOS): 4 h 20 min cut off its start, Q11 to Q30 named by their chapters", () => {
    // Its broadcast and video as YouTube gives them; each match's real start (FIRST), and its chapter.
    const sat = { start: "2026-07-03T23:42:02.000Z", end: "2026-07-04T07:04:47.000Z", length: 11120, live: false };
    const clockAt = [15600, 16199, 16776, 17355, 17892, 18354, 18760, 19194, 19530, 20047, 20584, 21147, 21526, 22119, 22648, 23128, 23563, 24325, 24915, 25737];
    const chapterAt = [0, 693, 1188, 1913, 2343, 2768, 3174, 3651, 4022, 4381, 4956, 5469, 6000, 6326, 7036, 7462, 8032, 8425, 9294, 9743];
    const s0 = Date.parse(sat.start);
    const qs = clockAt.map((c, i) => ({ label: `Q${i + 11}`, startsAt: new Date(s0 + c * 1000).toISOString() }));
    const ch: Chapter[] = chapterAt.flatMap((t, i): Chapter[] => [[t, `Match ${i + 11} qualification`], [t + 300, `Match ${i + 11} results`]]);
    const rec = { ...sat, firstMatch: qs[0].startsAt, lastMatch: qs.at(-1)!.startsAt };
    expect(timingTrusted(rec)).toBe(false);
    const c = chaptersConfirm(rec, ch, qs)!;
    expect(c.shift).toBeGreaterThanOrEqual(15442);
    expect(c.shift).toBeLessThanOrEqual(15994);
    const placed = qs.map((q) => clipSecond(q.startsAt, { ...rec, confirmedTo: c.to, shift: c.shift }));
    // The cut is all the time missing (15,445 s): no gap can follow it, so every match gets its clip, the last few too.
    expect(c.shift).toBe(15445);
    expect(placed.every((t) => t != null)).toBe(true);
    // Checked by eye on the video (its overlay naming the match, its timer 3 s in, 30 s after the clip's start).
    expect([placed[0], placed[9], placed[19]]).toEqual([135, 4582, 10272]);
    // In order, each within its chapter's drift of its own chapter.
    placed.forEach((t, i) => { if (t != null) expect(Math.abs(t - chapterAt[i])).toBeLessThan(600); });
    expect(placed.filter((t): t is number => t != null)).toEqual([...placed.filter((t): t is number => t != null)].sort((a, b) => a - b));
    // Each clip stops at its match's end in the video, the shift taken off too: its clip's start + the lead-in + 220 s.
    // Checked by eye: Q11, Q20 and Q30 each show their own match at 0:00 with its final score at that second.
    const shifted = { ...rec, confirmedTo: c.to, shift: c.shift };
    const ends = qs.map((q, i) => clipEnd(q.startsAt, shifted, qs[i + 1]?.startsAt));
    expect([ends[0], ends[9], ends[19]]).toEqual([375, 4822, 10512]);
    ends.forEach((e, i) => expect(e).toBe(placed[i]! + CLIP_LEAD_S + 220));
    // Never past the video (11,120 s).
    expect(Math.max(...ends.map(Number))).toBeLessThanOrEqual(sat.length);
  });
  it("says nothing without enough chapters naming matches, or for a small shortfall", () => {
    expect(confirm(timing, chapters.slice(0, CHAPTER_MIN_ANCHORS + CHAPTER_TAIL - 1), quals)).toBeNull(); // one short
    expect(confirm(timing, [], quals)).toBeNull();
    expect(confirm(timing, undefined, quals)).toBeNull();
    expect(confirm({ ...timing, length: 52972 - CHAPTER_MIN_GAP_S + 1 }, chapters, quals)).toBeNull();
    expect(confirm({ ...timing, end: null }, chapters, quals)).toBeNull();
  });
  it("chapters count from where an early start stops covering, so no shortfall is left with neither", () => {
    expect(CHAPTER_MIN_GAP_S).toBe(GAP_SLACK_MAX_S);
    // 21 min short (Minnesota Championship Nano 2026): more than an early start covers, and the chapters are heard.
    const nano = { ...timing, length: 52972 - 21 * 60 };
    expect(gapSlack(nano)).toBeNull();
    expect(confirm(nano, chapters, quals)).toBe(clock(30 - CHAPTER_TAIL + 1));
  });
});

describe("frameClipEnd (a clip placed from the recording's frames)", () => {
  it("stops once the match's final score is up: its timer's start + play + the score settling", () => {
    expect(frameClipEnd(8674, null, 30807)).toBe(8674 + MATCH_PLAY_S + FRAME_TAIL_S);
    expect(frameClipEnd(8674, null, null)).toBe(8884);
  });
  it("stops when the next match's timer starts, but never before its own play is over", () => {
    expect(frameClipEnd(1000, 1180, null)).toBe(1180);
    expect(frameClipEnd(1000, 1100, null)).toBe(1000 + MATCH_PLAY_S);
    // A start before this one (another event's, or a misread) doesn't cut it.
    expect(frameClipEnd(1000, 900, null)).toBe(1210);
  });
  it("never runs past the video's end", () => {
    expect(frameClipEnd(100, null, 213)).toBe(213);
  });
});
