// A finished touch drag as a swipe: far enough sideways, and more sideways than up or down.
import { describe, expect, it } from "vitest";
import { SWIPE_PX, swipeOf } from "./PhoneTeamActions";

describe("swipeOf", () => {
  it("reads a long sideways drag as a swipe, a short or steep one as nothing", () => {
    expect(swipeOf(SWIPE_PX, 0)).toBe("right");
    expect(swipeOf(-SWIPE_PX - 10, 8)).toBe("left");
    expect(swipeOf(SWIPE_PX - 1, 0)).toBeNull();
    expect(swipeOf(90, 80)).toBeNull();
  });
});
