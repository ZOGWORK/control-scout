import { describe, expect, it } from "vitest";
import { NO_OVERLAY, noOverlayFor, type NoOverlay } from "./noOverlay";

describe("recordings with no match overlay", () => {
  const list: NoOverlay[] = [{ season: 2021, code: "CABCVIS1", videoId: "OrQ_Iitlqe8", checked: "2026-11-18", seen: "no overlay" }];

  it("settles what only the frames or a clock could place, in that recording of that event", () => {
    expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", "no-clock", list)?.checked).toBe("2026-11-18");
    expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", "gap-unplaced", list)).not.toBeNull();
  });

  it("leaves a match the recording doesn't hold, another video or event, and no video at all", () => {
    expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", "no-recording-day", list)).toBeNull();
    expect(noOverlayFor("CABCVIS1", "OrQ_Iitlqe8", "between-recordings", list)).toBeNull();
    expect(noOverlayFor("CABCVIS1", "otherVideo1", "no-clock", list)).toBeNull();
    expect(noOverlayFor("CABCVIS2", "OrQ_Iitlqe8", "no-clock", list)).toBeNull();
    expect(noOverlayFor("CABCVIS1", null, "no-clock", list)).toBeNull();
  });

  it("lists each recording once, with the day its frames were looked at and what they showed", () => {
    const keys = NO_OVERLAY.map((x) => `${x.season}|${x.code}|${x.videoId}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const x of NO_OVERLAY) {
      expect(x.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(x.videoId).toMatch(/^[\w-]{11}$/);
      expect(x.seen.length).toBeGreaterThan(10);
    }
  });
});
