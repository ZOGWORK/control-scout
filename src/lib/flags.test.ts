// @vitest-environment jsdom
// The flags client never asks while the browser knows it's offline (that request
// can only fail, and logs a console error on the venue/offline flows), and asks
// again once back online.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flagOn, refreshFlags } from "./flags";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("refreshFlags", () => {
  it("skips the request while offline, keeping the last known flags", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await refreshFlags();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(flagOn("photos")).toBe(true);
  });

  it("asks once online", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ flags: { photos: false } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await refreshFlags();
    expect(fetchSpy).toHaveBeenCalledWith("/api/flags", { credentials: "same-origin" });
    expect(flagOn("photos")).toBe(false);
  });
});
