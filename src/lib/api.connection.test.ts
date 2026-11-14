// @vitest-environment jsdom
// Known offline (the connection check found no internet, src/lib/connection.ts): reads the saved data can answer are
// answered from it at once, with no network try and no timeout; other reads fail at once; and when the internet comes
// back, what's on screen from saved data refreshes in the background, keeping the page meanwhile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const offlineAnswer = vi.fn();
vi.mock("./offline/answer", () => ({ offlineAnswer: (path: string) => offlineAnswer(path) }));

import { apiFetch, useApi, useOfflineAsOf, useOfflineMode } from "./api";
import { checkInternet, connection, resetConnection } from "./connection";
import { markOffline, offlineSource, writeSaved, type SavedSeason } from "./offline/saved";
import { PACK_META_KEY } from "./packPolicy";

const saved: SavedSeason = { season: 2025, version: "v", sha256: "ab", bytes: 1000, savedAt: 1_700_000_000_000, dataAsOf: "2026-10-01T00:00:00.000Z", builtAt: "2026-10-01T01:00:00Z" };
const src = { season: 2025, savedAt: saved.savedAt, dataAsOf: saved.dataAsOf };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** The connection check finds no internet. */
async function goOffline() {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  await checkInternet();
  expect(connection().internet).toBe("no");
}

beforeEach(async () => {
  resetConnection();
  // Back online from any earlier test: a server answer ends offline mode.
  vi.stubGlobal("fetch", vi.fn(async () => ok({})));
  await apiFetch("/api/meta");
  vi.unstubAllGlobals();
  resetConnection();
  localStorage.clear();
  offlineAnswer.mockReset();
  offlineAnswer.mockImplementation(async (path: string) => markOffline({ path }, src));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); resetConnection(); });

describe("known offline: no network try, no wait", () => {
  it("a read a saved season can answer comes from it without calling fetch", async () => {
    writeSaved([saved]);
    await goOffline();
    const fetch = vi.fn(async () => ok({ from: "server" }));
    vi.stubGlobal("fetch", fetch);
    const t0 = performance.now();
    const data = await apiFetch("/api/teams/100?season=2025");
    expect(performance.now() - t0).toBeLessThan(500);
    expect(fetch).not.toHaveBeenCalled();
    expect(offlineSource(data)).toEqual(src);
  });

  it("a prediction the lite pack holds fails at once as no signal (the page runs the pack itself)", async () => {
    localStorage.setItem(PACK_META_KEY, JSON.stringify({ version: "v", builtAt: "2026-10-01T00:00:00Z", seasons: [2025] }));
    await goOffline();
    const fetch = vi.fn(async () => ok({}));
    vi.stubGlobal("fetch", fetch);
    await expect(apiFetch("/api/predict/match?season=2025&red=1,2&blue=3,4")).rejects.toMatchObject({ status: 0, offline: true, message: "You're offline." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a read nothing saved can answer fails at once with the no-signal error (the last check is fresh)", async () => {
    await goOffline();
    const fetch = vi.fn(async () => ok({}));
    vi.stubGlobal("fetch", fetch);
    await expect(apiFetch("/api/records")).rejects.toMatchObject({ offline: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an old check is redone first: back online, the read goes to the server", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await goOffline();
    vi.setSystemTime(Date.now() + 60_000);
    const fetch = vi.fn(async (p: string) => (p === "/api/health" ? ok({ ok: true }) : ok({ from: "server" })));
    vi.stubGlobal("fetch", fetch);
    expect(await apiFetch("/api/records")).toEqual({ from: "server" });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["/api/health", "/api/records"]);
  });

  it("a write still goes to the network", async () => {
    await goOffline();
    const fetch = vi.fn(async () => ok({ saved: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await apiFetch("/api/me/state", { method: "PUT", json: {} })).toEqual({ saved: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("back online", () => {
  it("what's on screen from saved data refreshes in the background, never blanking the page", async () => {
    writeSaved([saved]);
    await goOffline();
    const mode = renderHook(() => useOfflineMode());
    const asOf = renderHook(() => useOfflineAsOf());
    const page = renderHook(() => useApi<{ path?: string; from?: string }>("/api/teams/200?season=2025"));
    await waitFor(() => expect(page.result.current.data).toEqual({ path: "/api/teams/200?season=2025" }));
    expect(mode.result.current).toBe(true);
    await waitFor(() => expect(asOf.result.current).toBe(saved.dataAsOf));

    // The internet comes back: the check sees our server.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const fetch = vi.fn(async (p: string) => (p === "/api/health" ? ok({ ok: true }) : held.then(() => ok({ from: "server" }))));
    vi.stubGlobal("fetch", fetch);
    await act(async () => { await checkInternet(); });
    expect(fetch.mock.calls.map((c) => c[0])).toContain("/api/teams/200?season=2025");
    // While the refresh is out, the saved data stays on screen (never loading, never empty).
    expect(page.result.current).toMatchObject({ data: { path: "/api/teams/200?season=2025" }, loading: false });
    await act(async () => { release(); });
    await waitFor(() => expect(page.result.current.data).toEqual({ from: "server" }));
    await waitFor(() => expect(mode.result.current).toBe(false));
    await waitFor(() => expect(asOf.result.current).toBeNull());
    page.unmount(); mode.unmount(); asOf.unmount();
  });
});
