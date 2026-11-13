// A video checked by eye (server/data/checkedTimings.ts) gets its matches' clips up to the last match seen; the same video
// unchecked gets none (its length falls 5.6 hours short of the broadcast, and nothing says where).
import { describe, expect, it } from "vitest";
import { withClips, type Recording, type VideoMeta } from "../videos/recordings";
import { CHECKED_TIMINGS, checkedTo } from "./checkedTimings";

// The Multinational Tech Invitational 2026's Sunday broadcast, as YouTube gives it, and three of its matches.
const meta = (videoId: string): VideoMeta => ({ videoId, status: "ok", start: "2026-06-28T11:55:24.000Z", end: "2026-06-29T03:15:59.000Z", length: 34_990, live: false, checkedAt: "x" });
const m = (label: string, startsAt: string) => ({ label, time: startsAt.replace("Z", ""), startsAt, played: true, clip: undefined as any });
const matches = [m("Q49", "2026-06-28T12:02:05.128Z"), m("M5", "2026-06-28T18:42:42.040Z"), m("M14-2", "2026-06-28T21:02:32.860Z")];
const rec = (videoId: string): Recording => ({ videoId, meta: meta(videoId), source: "first" });

describe("checked timings", () => {
  it("gives a checked video's matches their clips, at the second each was seen starting", () => {
    const out = withClips(matches, rec("W6ywzjs-MUM"));
    // Q49 seen at 401 s, M5 at 24,438 s, M14-2 at 32,828 s (each clip opens a lead-in before).
    expect(out.map((x) => x.clip?.t)).toEqual([401 - 20, 24_438 - 20, 32_828 - 20]);
  });

  it("gives the same video unchecked no clips, and none past the last match seen", () => {
    expect(withClips(matches, rec("uncheckedxx")).some((x) => x.clip)).toBe(false);
    const later = [...matches, m("M15", "2026-06-28T21:40:00.000Z")];
    expect(withClips(later, rec("W6ywzjs-MUM")).at(-1)?.clip).toBeUndefined();
  });

  it("lists each video once, with what was seen", () => {
    expect(new Set(CHECKED_TIMINGS.map((c) => c.videoId)).size).toBe(CHECKED_TIMINGS.length);
    for (const c of CHECKED_TIMINGS) { expect(c.seen.length).toBeGreaterThanOrEqual(3); expect(checkedTo(c.videoId)).toBe(c.confirmedTo); }
  });
});
