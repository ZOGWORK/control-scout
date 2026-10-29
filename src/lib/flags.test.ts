// @vitest-environment jsdom
// The flags client never asks while the browser knows it's offline (that request
// can only fail, and logs a console error on the venue/offline flows), and asks
// again once back online.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flagOn, refreshFlags, workspaceFlagOn } from "./flags";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("refreshFlags", () => {
  it("asks even when the browser says offline, and keeps the last known flags if that fails", async () => {
    const fetchSpy = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await refreshFlags();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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

  it("keeps the signed-in account's own workspace settings: a workspace's value, else the flag's", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ flags: { workspaceScouting: true }, workspaces: { a: { workspaceScouting: false }, b: { workspaceScouting: true }, c: "nonsense" } }), { status: 200 })));
    await refreshFlags();
    expect(workspaceFlagOn("workspaceScouting", "a")).toBe(false);
    expect(workspaceFlagOn("workspaceScouting", "b")).toBe(true);
    expect(workspaceFlagOn("workspaceScouting", "c")).toBe(true); // unreadable: the flag's value
    expect(workspaceFlagOn("workspaceScouting", "elsewhere")).toBe(true);
    expect(workspaceFlagOn("workspaceScouting", null)).toBe(true);
    // An answer without them (no overrides any more) forgets them.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ flags: { workspaceScouting: true } }), { status: 200 })));
    await refreshFlags();
    expect(workspaceFlagOn("workspaceScouting", "a")).toBe(true);
  });
});
