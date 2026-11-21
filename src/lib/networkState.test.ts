// @vitest-environment jsdom
// The three connection states (lib/connection.ts networkState) as the app lives them (owner report, 2026-11-21: "it
// says I'm offline when I'm not", on a phone with weak signal and a laptop using a lot of bandwidth):
//   - online: answers arrive;
//   - slow: a request has waited longer than SLOW_MS. It is still waited for, nothing is refused or held, and it is
//     never "offline";
//   - offline: only once a real check (GET /api/health) failed, never from slowness or navigator.onLine alone.
// And leaving offline: one answer is enough, with no "online" event (iOS sends none).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { FAIL_DEBOUNCE_MS, SLOW_MS, connection, networkState, noteWaiting, offlineNow, onBackOnline, resetConnection, slowNow, startConnectionWatch } from "./connection";
import { knownOffline } from "./pendingWork";

/** An answer from our server, sent just now (its Date header: lib/api.ts answeredNow). */
const ours = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", Date: new Date(Date.now()).toUTCString() } });
/** Every request answers after `ms` (a weak phone signal: 2 to 6 s a request). */
const slowNet = (ms: number) => vi.fn((path: string, init?: RequestInit) => new Promise<Response>((ok, fail) => {
  init?.signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")));
  setTimeout(() => ok(ours(path === "/api/health" ? { ok: true } : { path, method: init?.method ?? "GET" })), ms);
}));
const noNet = () => vi.fn(async () => { throw new TypeError("Failed to fetch"); });

let stop: () => void = () => {};
beforeEach(() => { vi.useFakeTimers(); resetConnection(); localStorage.clear(); });
afterEach(() => { stop(); stop = () => {}; resetConnection(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("networkState", () => {
  it("is offline only for a check that found no internet (or a sign-in page)", () => {
    expect(networkState({ internet: "yes" }, false)).toBe("online");
    expect(networkState({ internet: "unknown" }, false)).toBe("online");
    expect(networkState({ internet: "yes" }, true)).toBe("slow");
    expect(networkState({ internet: "unknown" }, true)).toBe("slow");
    expect(networkState({ internet: "no" }, true)).toBe("offline");
    expect(networkState({ internet: "portal" }, false)).toBe("offline");
  });

  it("noteWaiting: slow after SLOW_MS unanswered, online again once every slow request settles", () => {
    const a = noteWaiting();
    vi.advanceTimersByTime(SLOW_MS - 1);
    expect(slowNow()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(slowNow()).toBe(true);
    const b = noteWaiting(0);
    vi.advanceTimersByTime(0);
    a();
    expect(slowNow()).toBe(true); // b still waits
    b();
    b(); // settling twice counts once
    expect(slowNow()).toBe(false);
    const quick = noteWaiting();
    quick(); // answered in time: never slow
    vi.advanceTimersByTime(SLOW_MS * 2);
    expect(slowNow()).toBe(false);
  });
});

describe("a slow connection is slow, not offline", () => {
  it("a 6 s answer: slow while it waits, never offline, and a save sent meanwhile goes through", async () => {
    const fetch = slowNet(6000);
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    const read = apiFetch<{ path: string }>("/api/teams/100");
    await vi.advanceTimersByTimeAsync(SLOW_MS + 500);
    expect(networkState()).toBe("slow");
    expect(offlineNow()).toBe(false);
    expect(knownOffline()).toBe(false);
    // An action while it's slow: sent at once, never held or refused.
    const save = apiFetch<{ method: string }>("/api/scout/entries", { method: "POST", json: { note: "fast auto" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls.some(([p, init]) => p === "/api/scout/entries" && (init as RequestInit).method === "POST")).toBe(true);
    await vi.advanceTimersByTimeAsync(1500); // 6 s in all for the read
    expect(await read).toEqual({ path: "/api/teams/100", method: "GET" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(await save).toMatchObject({ method: "POST" });
    // The health check the slow read started answered too (in about 6 s, well inside its 15 s): still online.
    await vi.advanceTimersByTimeAsync(6000);
    expect(connection().internet).toBe("yes");
    expect(networkState()).toBe("online");
  });

  it("navigator.onLine false (iOS) with a working network: online, and actions go", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    resetConnection(); // a page opened while the browser says offline
    const fetch = vi.fn(async (path: string, init?: RequestInit) => ours(path === "/api/health" ? { ok: true } : { path, method: init?.method ?? "GET" }));
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    expect(networkState()).toBe("online");
    expect(knownOffline()).toBe(false);
    window.dispatchEvent(new Event("offline")); // and it says so again
    await vi.advanceTimersByTimeAsync(0);
    expect(connection().internet).toBe("yes");
    expect(networkState()).toBe("online");
    expect(await apiFetch("/api/comments", { method: "POST", json: { body: "hi" } })).toEqual({ path: "/api/comments", method: "POST" });
    expect(await apiFetch("/api/teams/100")).toEqual({ path: "/api/teams/100", method: "GET" });
    expect(offlineNow()).toBe(false);
  });
});

describe("offline is a failed request confirmed by a failed check", () => {
  it("a request failing for want of a network, then the check failing: offline", async () => {
    vi.stubGlobal("fetch", noNet());
    stop = startConnectionWatch();
    await expect(apiFetch("/api/teams/100")).rejects.toMatchObject({ status: 0, offline: true });
    // Not yet decided by the failure alone: the check decides.
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS + 10);
    expect(connection().internet).toBe("no");
    expect(networkState()).toBe("offline");
    expect(knownOffline()).toBe(true);
  });

  it("a request failing while the check answers: not offline (the server, not the line)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => { if (path === "/api/health") return ours({ ok: true }); throw new TypeError("Failed to fetch"); }));
    stop = startConnectionWatch();
    await expect(apiFetch("/api/teams/100")).rejects.toMatchObject({ offline: true, message: "Can't reach the server right now." });
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS + 10);
    expect(networkState()).not.toBe("offline");
  });

  it("recovery with no online event: any answer ends it at once, and work waiting for the line goes", async () => {
    vi.stubGlobal("fetch", noNet());
    stop = startConnectionWatch();
    await apiFetch("/api/teams/100").catch(() => {});
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS + 10);
    expect(networkState()).toBe("offline");
    const back = vi.fn();
    const off = onBackOnline(back);
    // The line returns; the browser never says so. A save is still tried (never held while "offline") and answers.
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => ours(path === "/api/health" ? { ok: true } : { path, method: init?.method ?? "GET" })));
    expect(await apiFetch("/api/scout/entries", { method: "POST", json: {} })).toMatchObject({ method: "POST" });
    expect(networkState()).toBe("online");
    expect(back).toHaveBeenCalledTimes(1);
    off();
  });

  it("recovery by the check alone (nothing else asked): the back-off check finds the line", async () => {
    vi.stubGlobal("fetch", noNet());
    stop = startConnectionWatch();
    await apiFetch("/api/teams/100").catch(() => {});
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS + 10);
    expect(networkState()).toBe("offline");
    vi.stubGlobal("fetch", vi.fn(async () => ours({ ok: true })));
    await vi.advanceTimersByTimeAsync(3000); // the first back-off step
    expect(networkState()).toBe("online");
  });
});
