import { describe, expect, it } from "vitest";
import { actualStart, CLIP_LEAD_S, clipSecond, clipTime, timingTrusted, watchUrl } from "./recording";

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
  const Q23 = "2026-10-31T22:40:22.552Z";
  it("is trusted once the event's last match shows the cut is at the end", () => {
    expect(timingTrusted(salk)).toBe(false); // no last match known: could be a gap
    expect(timingTrusted({ ...salk, lastMatch: Q23 })).toBe(true);
    expect(clipSecond("2026-10-31T18:18:14.130Z", { ...salk, lastMatch: Q23 })).toBe(2529 - CLIP_LEAD_S); // Q1
    expect(clipSecond(Q23, { ...salk, lastMatch: Q23 })).toBe(18257 - CLIP_LEAD_S);
  });
  it("a drop-out during the event still isn't: the last match lands past the video's end, or far from it", () => {
    // The same broadcast, but 2 h missing mid-event: the last match would be 2 h past where the video ends.
    expect(timingTrusted({ ...salk, length: 16258, end: "2026-10-31T23:00:00Z", lastMatch: Q23 })).toBe(false);
    // Western Edge: a match early in a video that runs on for hours more is no sign of where the gap is.
    expect(timingTrusted({ start: "2026-05-30T15:02:06Z", end: "2026-05-31T01:14:37Z", length: 30807, live: false, lastMatch: "2026-05-30T15:21:09Z" })).toBe(false);
    // The broadcast stopped soon after the last match: more is missing than it ran on for, so some is mid-event.
    expect(timingTrusted({ ...salk, end: "2026-10-31T23:00:00Z", length: 18609 - 1500, lastMatch: "2026-10-31T21:50:16Z" })).toBe(false);
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
