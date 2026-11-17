// @vitest-environment jsdom
// A search that failed (server down) can be asked again: retry() repeats the same query and its answer replaces the error.
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../../shared/api";

const HIT = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics", subtitle: "Brisbane, QLD", season: 2026 } as SearchHit;
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: fetchMock }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { useSearchHits } = await import("./SearchBox");
const { ApiError } = await import("../../lib/api");
const { noteServerAnswer, resetConnection } = await import("../../lib/connection");

describe("useSearchHits retry", () => {
  it("asks the same query again and shows its answer", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Can't reach the server right now.")).mockResolvedValue({ hits: [HIT] });
    const { result } = renderHook(() => useSearchHits("4215", ["team"]));
    await waitFor(() => expect(result.current.error).toBe("Can't reach the server right now."));
    expect(result.current.hits).toEqual([]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.hits).toEqual([HIT]));
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);
  });

  // Issue #1557: "You're offline." stayed on the search page after the connection check found internet again (the
  // light-version offer, which only shows with internet, was up beside it), until Try again.
  it("asks again by itself once the connection check finds internet, after a 'no connection' error", async () => {
    resetConnection();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { checkInternet } = await import("../../lib/connection");
    await checkInternet(); // no internet
    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new ApiError(0, "You're offline.", true)).mockResolvedValue({ hits: [HIT] });
    const { result } = renderHook(() => useSearchHits("4215", ["team"]));
    await waitFor(() => expect(result.current.error).toBe("You're offline."));
    act(() => noteServerAnswer()); // internet again
    await waitFor(() => expect(result.current.hits).toEqual([HIT]));
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
    resetConnection();
  });

  it("an error from a server that answered isn't asked again when internet is confirmed", async () => {
    resetConnection();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new ApiError(400, "That isn't a search."));
    const { result } = renderHook(() => useSearchHits("4215", ["team"]));
    await waitFor(() => expect(result.current.error).toBe("That isn't a search."));
    act(() => noteServerAnswer());
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resetConnection();
  });
});
