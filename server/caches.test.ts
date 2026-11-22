import { describe, expect, it, vi } from "vitest";
import { cacheNames, clearAllCaches, clearClipCaches, registerCache } from "./caches";

describe("caches", () => {
  it("a clip-start change keeps the clip-free caches; the owner's Clear caches empties all", () => {
    const ratings = vi.fn(), clips = vi.fn(), unmarked = vi.fn();
    registerCache("t: ratings", ratings, { clipFree: true });
    registerCache("t: clips", clips);
    registerCache("t: unmarked", unmarked, {});
    const cleared = clearClipCaches();
    expect(ratings).not.toHaveBeenCalled();
    expect(clips).toHaveBeenCalledTimes(1);
    expect(unmarked).toHaveBeenCalledTimes(1);
    expect(cleared).toContain("t: clips");
    expect(cleared).not.toContain("t: ratings");
    expect(clearAllCaches()).toEqual(expect.arrayContaining(["t: ratings", "t: clips", "t: unmarked"]));
    expect(ratings).toHaveBeenCalledTimes(1);
  });

  it("a failing clear is skipped, not fatal", () => {
    const after = vi.fn();
    registerCache("t: throws", () => { throw new Error("boom"); });
    registerCache("t: after", after);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(clearClipCaches()).not.toContain("t: throws");
    expect(after).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("the prediction ratings and the track record are clip-free, and the clip caches are not", async () => {
    await import("./predict/engine");
    await import("./api/accuracy");
    await import("./videos/recordings");
    expect(cacheNames()).toEqual(expect.arrayContaining(["Prediction ratings", "Track record", "Event recordings", "Match clip keys"]));
    const cleared = clearClipCaches();
    expect(cleared).not.toContain("Prediction ratings");
    expect(cleared).not.toContain("Track record");
    expect(cleared).toEqual(expect.arrayContaining(["Event recordings", "Match clip keys"]));
  });
});
