// @vitest-environment jsdom
// apiFetch's offline fallback: a GET that fails for want of a network (an
// error, or no answer within the timeout) is answered from the data saved on
// this device; an HTTP error never is. Online, none of the offline code even
// loads: the packs only ever run with no signal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Which offline modules got imported (a vi.mock factory runs on the module's first import).
const loaded = vi.hoisted(() => [] as string[]);
const offlineAnswer = vi.fn();
vi.mock("./offline/answer", () => { loaded.push("answer"); return { offlineAnswer: (path: string) => offlineAnswer(path) }; });
vi.mock("./offline/seasons", () => { loaded.push("seasons"); return {}; });
vi.mock("./offline/predict", () => { loaded.push("predict"); return {}; });
vi.mock("./packs", () => { loaded.push("packs"); return {}; });
vi.mock("sql.js/dist/sql-wasm-browser.js", () => { loaded.push("sql.js"); return {}; });

import { ApiError, OFFLINE_TIMEOUT_MS, apiFetch, load, noteOfflineAnswer, useApi, useOfflineMode } from "./api";
import { markOffline, offlineSource, writeSaved, type SavedSeason } from "./offline/saved";
import { PACK_META_KEY } from "./packPolicy";

const saved: SavedSeason = { season: 2025, version: "2026-10-01.1", sha256: "ab", bytes: 1000, savedAt: 1_700_000_000_000, dataAsOf: "2026-10-01T00:00:00Z", builtAt: "2026-10-01T01:00:00Z" };
const src = { season: 2025, savedAt: saved.savedAt, dataAsOf: saved.dataAsOf };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** A request that never answers (venue wifi that carries nothing) until it's aborted. */
const hanging = () => vi.fn((_p: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
  init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
}));
const networkDown = () => vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
// The header badge's state, mounted fresh for every test.
let mode: ReturnType<typeof renderHook<boolean, unknown>>;

beforeEach(async () => {
  vi.useRealTimers();
  // Back online from any earlier test: a server answer ends offline mode.
  vi.stubGlobal("fetch", vi.fn(async () => ok({})));
  await apiFetch("/api/meta");
  vi.unstubAllGlobals();
  localStorage.clear();
  offlineAnswer.mockReset();
  offlineAnswer.mockImplementation(async (path: string) => markOffline({ path }, src));
  mode = renderHook(() => useOfflineMode());
});
afterEach(() => { mode.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("online: the packs never run", () => {
  it("answers from the server and loads none of the offline code, with seasons and a lite pack saved", async () => {
    writeSaved([saved]);
    localStorage.setItem(PACK_META_KEY, JSON.stringify({ version: "v", seasons: [2025] }));
    const fetch = vi.fn(async (p: string) => ok({ from: "server", p }));
    vi.stubGlobal("fetch", fetch);
    for (const p of ["/api/teams/100?season=2025", "/api/teams/100/matches", "/api/events/2025/USNJQ1", "/api/search?q=gear", "/api/predict/match?season=2025&red=1,2&blue=3,4"]) {
      const data = await apiFetch(p);
      expect(data).toEqual({ from: "server", p });
      expect(offlineSource(data)).toBeNull();
    }
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(offlineAnswer).not.toHaveBeenCalled();
    expect(loaded).toEqual([]);
    expect(mode.result.current).toBe(false);
  });

  it("an HTTP error from a server that answered is never replaced", async () => {
    writeSaved([saved]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    await expect(apiFetch("/api/teams/100")).rejects.toMatchObject({ status: 500, message: "boom", offline: false });
    expect(offlineAnswer).not.toHaveBeenCalled();
    expect(mode.result.current).toBe(false);
  });

  it("a slow server isn't 'offline' for a read the device can't answer: no timeout", async () => {
    vi.useFakeTimers();
    writeSaved([saved]);
    vi.stubGlobal("fetch", vi.fn((_p: string, init?: RequestInit) => new Promise<Response>((res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      setTimeout(() => res(ok({ slow: true })), OFFLINE_TIMEOUT_MS * 3);
    })));
    const meta = apiFetch("/api/meta");
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS * 3);
    expect(await meta).toEqual({ slow: true });
    expect(offlineAnswer).not.toHaveBeenCalled();
  });

  it("no timeout for a prediction the lite pack isn't known to hold (another season, or an older pack that doesn't say)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => setTimeout(() => res(ok({ slow: true })), OFFLINE_TIMEOUT_MS * 2))));
    localStorage.setItem(PACK_META_KEY, JSON.stringify({ version: "v", seasons: [2025] }));
    const other = apiFetch("/api/predict/match?season=2024&red=1,2&blue=3,4");
    localStorage.setItem(PACK_META_KEY, JSON.stringify({ version: "v" }));
    const older = apiFetch("/api/predict/match?season=2025&red=1,2&blue=3,4");
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS * 2);
    expect(await other).toEqual({ slow: true });
    expect(await older).toEqual({ slow: true });
  });

  it("no timeout for a season that isn't saved: a slow server still answers", async () => {
    vi.useFakeTimers();
    writeSaved([saved]); // 2025 only
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => setTimeout(() => res(ok({ slow: true })), OFFLINE_TIMEOUT_MS * 2))));
    const a = apiFetch("/api/teams/100/matches?season=2024");
    const b = apiFetch("/api/events/2024/USNJQ1");
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS * 2);
    expect(await a).toEqual({ slow: true });
    expect(await b).toEqual({ slow: true });
    expect(offlineAnswer).not.toHaveBeenCalled();
  });

  it("past the timeout, a saved season that can't answer keeps waiting for the server", async () => {
    vi.useFakeTimers();
    writeSaved([saved]);
    offlineAnswer.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => setTimeout(() => res(ok({ slow: true })), OFFLINE_TIMEOUT_MS * 2))));
    const p = apiFetch("/api/teams/4242");
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS * 2);
    expect(await p).toEqual({ slow: true });
    expect(offlineAnswer).toHaveBeenCalledTimes(1);
    expect(mode.result.current).toBe(false);
  });

  it("an HTTP error whose body is slow keeps its status (headers arrived: the server answered)", async () => {
    vi.useFakeTimers();
    writeSaved([saved]);
    const body = new ReadableStream({ start(c) { setTimeout(() => { c.enqueue(new TextEncoder().encode(JSON.stringify({ error: "nope" }))); c.close(); }, OFFLINE_TIMEOUT_MS * 2); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 404 })));
    const p = apiFetch("/api/teams/100");
    const done = expect(p).rejects.toMatchObject({ status: 404, message: "nope", offline: false });
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS * 2);
    await done;
    expect(offlineAnswer).not.toHaveBeenCalled();
  });

  it("a cold start (503 + Retry-After) still waits for the server, even with a season saved", async () => {
    vi.useFakeTimers();
    writeSaved([saved]);
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++ < 2 ? new Response("{}", { status: 503, headers: { "Retry-After": "5" } }) : ok({ warm: true }))));
    const p = apiFetch("/api/teams/100");
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await p).toEqual({ warm: true });
    expect(offlineAnswer).not.toHaveBeenCalled();
  });
});

describe("no signal: the packs answer", () => {
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
    expect(mode.result.current).toBe(true);
  });

  it("answers at once when the browser knows it's offline", async () => {
    writeSaved([saved]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(offlineSource(await apiFetch("/api/teams/100"))).toEqual(src);
    expect(fetch).not.toHaveBeenCalled();
    expect(mode.result.current).toBe(true);
  });

  it("no answer within the timeout counts as no signal, for a read a saved season can answer", async () => {
    vi.useFakeTimers();
    writeSaved([saved]);
    vi.stubGlobal("fetch", hanging());
    const p = apiFetch("/api/teams/100");
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS - 1);
    expect(offlineAnswer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(offlineSource(await p)).toEqual(src);
    expect(mode.result.current).toBe(true);
  });

  it("a prediction that times out with a lite pack saved fails as offline (the Predict page then runs the pack)", async () => {
    vi.useFakeTimers();
    localStorage.setItem(PACK_META_KEY, JSON.stringify({ version: "v", seasons: [2024, 2025] }));
    vi.stubGlobal("fetch", hanging());
    const p = apiFetch("/api/predict/match?season=2025&red=1,2&blue=3,4");
    const done = expect(p).rejects.toMatchObject({ status: 0, offline: true });
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS);
    await done;
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
    expect(mode.result.current).toBe(false); // nothing was shown from saved data
  });
});

describe("recovery: back to the server", () => {
  it("after a timeout, the next server answer switches back and refetches what's on screen", async () => {
    vi.useFakeTimers();
    writeSaved([saved]);
    vi.stubGlobal("fetch", hanging());
    const path = "/api/teams/777";
    const view = renderHook(() => useApi<{ path?: string; from?: string }>(path));
    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS));
    expect(offlineSource(view.result.current.data)).toEqual(src);
    expect(mode.result.current).toBe(true);
    // Signal's back (the browser never said it was gone): the next retry gets the server's answer.
    vi.stubGlobal("fetch", vi.fn(async () => ok({ from: "server" })));
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(view.result.current.data).toEqual({ from: "server" });
    expect(offlineSource(view.result.current.data)).toBeNull();
    expect(mode.result.current).toBe(false);
    view.unmount();
  });

  it("background retries keep an offline error on screen (the Predict page's lite-pack answer stays) until the server answers", async () => {
    vi.useFakeTimers();
    localStorage.setItem(PACK_META_KEY, JSON.stringify({ version: "v", seasons: [2025] }));
    vi.stubGlobal("fetch", hanging());
    const path = "/api/predict/match?season=2025&red=1,2&blue=3,4";
    const view = renderHook(() => useApi(path));
    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS));
    expect(view.result.current.error?.offline).toBe(true);
    act(() => noteOfflineAnswer()); // what the page does once it shows the lite pack's prediction
    const seen: boolean[] = [];
    view.rerender();
    await act(() => vi.advanceTimersByTimeAsync(15_000)); // a retry goes out (and hangs)
    seen.push(!!view.result.current.error?.offline, view.result.current.loading);
    expect(seen).toEqual([true, false]); // still the offline error, never a loading block
    vi.stubGlobal("fetch", vi.fn(async () => ok({ pRed: 0.5 })));
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(view.result.current.data).toEqual({ pRed: 0.5 });
    expect(mode.result.current).toBe(false);
    view.unmount();
  });

  it("an unrelated answer mid-retry doesn't stop the retries: the offline prediction still recovers", async () => {
    vi.useFakeTimers();
    localStorage.setItem(PACK_META_KEY, JSON.stringify({ version: "v", seasons: [2025] }));
    const fetch = vi.fn(hanging());
    vi.stubGlobal("fetch", fetch);
    const path = "/api/predict/match?season=2025&red=5,6&blue=7,8";
    const view = renderHook(() => useApi(path));
    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS));
    act(() => noteOfflineAnswer());
    await act(() => vi.advanceTimersByTimeAsync(15_000)); // a quiet retry goes out and hangs
    // Meanwhile an unrelated request gets an answer: offline mode ends while the retry is still out.
    vi.stubGlobal("fetch", vi.fn(async (p: string) => (p === "/api/meta" ? ok({}) : fetch(p, { signal: new AbortController().signal }))));
    await act(async () => { await apiFetch("/api/meta"); });
    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS)); // that retry times out again
    expect(view.result.current.error?.offline).toBe(true);
    // The connection really comes back: the next retry still happens and gets the answer.
    vi.stubGlobal("fetch", vi.fn(async () => ok({ pRed: 0.4 })));
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(view.result.current.data).toEqual({ pRed: 0.4 });
    view.unmount();
  });

  it("returning to a view whose refresh failed for want of a network restarts the retries", async () => {
    vi.useFakeTimers();
    const path = "/api/events/2025/BACK";
    vi.stubGlobal("fetch", vi.fn(async () => ok({ v: 1 })));
    const first = renderHook(() => useApi(path));
    await act(() => vi.advanceTimersByTimeAsync(0));
    networkDown();
    await act(async () => { await load(path, true).catch(() => {}); }); // a refresh fails: server data kept, offline error noted
    first.unmount(); // leaving stops the retries
    const back = renderHook(() => useApi(path)); // back within the minute: the cached answer counts as fresh
    vi.stubGlobal("fetch", vi.fn(async () => ok({ v: 2 })));
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(back.result.current.data).toEqual({ v: 2 });
    back.unmount();
  });

  it("coming back online refetches what's on screen from saved data", async () => {
    writeSaved([saved]);
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const path = "/api/events/2025/RECOVER";
    const view = renderHook(() => useApi(path));
    await act(async () => { await load(path).catch(() => {}); });
    expect(offlineSource(view.result.current.data)).toEqual(src);
    expect(mode.result.current).toBe(true);
    onLine.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => ok({ live: true })));
    await act(async () => { window.dispatchEvent(new Event("online")); await new Promise((r) => setTimeout(r, 0)); });
    expect(view.result.current.data).toEqual({ live: true });
    expect(mode.result.current).toBe(false);
    view.unmount();
  });

  it("coming back online with nothing from saved data on screen just ends offline mode", async () => {
    writeSaved([saved]);
    networkDown();
    await apiFetch("/api/teams/100");
    expect(mode.result.current).toBe(true);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(mode.result.current).toBe(false);
  });
});
