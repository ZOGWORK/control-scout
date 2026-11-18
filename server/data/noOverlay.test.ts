import { describe, expect, it } from "vitest";
import { NO_OVERLAY, noOverlayFor, noOverlayReason, type NoOverlay } from "./noOverlay";

describe("recordings with no match overlay", () => {
  const list: NoOverlay[] = [{ season: 2021, code: "CABCVIS1", videoId: "OrQ_Iitlqe8", checked: "2026-11-18", seen: "no overlay" }];

  it("settles what only the frames or a clock could place, in that recording of that event", () => {
    expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", "no-clock", list)?.checked).toBe("2026-11-18");
    expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", "gap-unplaced", list)).not.toBeNull();
  });

  it("leaves a match the recording doesn't hold, another video or event, and no video at all", () => {
    expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", "no-recording-day", list)).toBeNull();
    expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", "between-recordings", list)).toBeNull();
    // Played outside the recording (a clocked video's before or after its broadcast, before it starts or after it
    // ends, outside every recording): never in it, so never settled by it.
    for (const r of ["before-broadcast", "after-broadcast", "before-cut", "past-video-end", "outside-span"] as const) expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", r, list)).toBeNull();
    expect(noOverlayFor("CABCVIS1", "otherVideo1", "no-clock", list)).toBeNull();
    expect(noOverlayFor("CABCVIS2", "OrQ_Iitlqe8", "no-clock", list)).toBeNull();
    expect(noOverlayFor("CABCVIS1", null, "no-clock", list)).toBeNull();
  });

  it("settles a stuttering recording's matches as stuttering, any other entry's as having no overlay", () => {
    const stutters: NoOverlay = { season: 2021, code: "USCANOSCQ", videoId: "eXfH6cxEfwE", kind: "stutters", checked: "2026-11-18", seen: "timer jumps" };
    expect(noOverlayReason(stutters)).toBe("video-stutters");
    expect(noOverlayReason(list[0])).toBe("video-no-overlay");
    // A stuttering recording settles the same matches a bare one does, and no others.
    expect(noOverlayFor("USCANOSCQ", "eXfH6cxEfwE", "gap-unplaced", [stutters])).toBe(stutters);
    expect(noOverlayFor("USCANOSCQ", "eXfH6cxEfwE", "no-recording-day", [stutters])).toBeNull();
  });

  it("lists each recording once, with the day its frames were looked at and what they showed", () => {
    const keys = NO_OVERLAY.map((x) => `${x.season}|${x.code}|${x.videoId}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const x of NO_OVERLAY) {
      expect(x.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(x.videoId).toMatch(/^[\w-]{11}$/);
      expect(x.seen.length).toBeGreaterThan(10);
      expect([undefined, "stutters"]).toContain(x.kind);
    }
  });
});
