// @vitest-environment jsdom
// apiFetch's offline fallback: a GET that fails for want of a network is
// answered from the seasons saved on this device; an HTTP error never is.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const offlineAnswer = vi.fn();
vi.mock("./offline/answer", () => ({ offlineAnswer: (path: string) => offlineAnswer(path) }));

import { ApiError, apiFetch } from "./api";
import { markOffline, offlineSource, writeSaved, type SavedSeason } from "./offline/saved";

const saved: SavedSeason = { season: 2025, version: "2026-10-01.1", sha256: "ab", bytes: 1000, savedAt: 1_700_000_000_000, dataAsOf: "2026-10-01T00:00:00Z", builtAt: "2026-10-01T01:00:00Z" };
const src = { season: 2025, savedAt: saved.savedAt, dataAsOf: saved.dataAsOf };

beforeEach(() => {
  localStorage.clear();
  offlineAnswer.mockReset();
  offlineAnswer.mockImplementation(async (path: string) => markOffline({ path }, src));
});
afterEach(() => { vi.unstubAllGlobals(); });

const networkDown = () => vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

describe("apiFetch offline fallback", () => {
  it("answers a failed GET from a saved season, marked as offline", async () => {
    writeSaved([saved]);
    networkDown();
    const data = await apiFetch<{ path: string }>("/api/teams/100?season=2025");
    expect(data).toEqual({ path: "/api/teams/100?season=2025" }); // the marker isn't part of the shape
    expect(offlineSource(data)).toEqual(src);
    await apiFetch("/api/events/2025/USNJQ1");
    await apiFetch("/api/teams/100/matches?season=2025");
    await apiFetch("/api/search?q=gear&limit=15");
    expect(offlineAnswer).toHaveBeenCalledTimes(4);
  });

  it("answers at once when the browser knows it's offline", async () => {
    writeSaved([saved]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      expect(offlineSource(await apiFetch("/api/teams/100"))).toEqual(src);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });

  it("never replaces an HTTP error", async () => {
    writeSaved([saved]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    await expect(apiFetch("/api/teams/100")).rejects.toMatchObject({ status: 500, message: "boom", offline: false });
    expect(offlineAnswer).not.toHaveBeenCalled();
  });

  it("keeps the network error with no saved season, for other paths, for writes, and when the season can't answer", async () => {
    networkDown();
    await expect(apiFetch("/api/teams/100")).rejects.toMatchObject({ status: 0, offline: true });
    writeSaved([saved]);
    await expect(apiFetch("/api/meta")).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch("/api/teams/100", { method: "POST", json: {} })).rejects.toMatchObject({ offline: true });
    expect(offlineAnswer).not.toHaveBeenCalled();
    offlineAnswer.mockResolvedValueOnce(null);
    await expect(apiFetch("/api/teams/4242")).rejects.toMatchObject({ status: 0, offline: true });
  });
});
