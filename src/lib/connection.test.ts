// @vitest-environment jsdom
// The connection check: what answered GET /api/health decides "yes", "portal" or "no"; failures and the browser's
// events start a check; a server answer elsewhere counts as "yes" at once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  CHECK_TIMEOUT_MS, DEMO_KEY, FAIL_DEBOUNCE_MS, RETRY_MS, checkInternet, classify, connection, noteRequestFailed, noteServerAnswer,
  offlineNow, resetConnection, shownOffline, startConnectionWatch, useConnection,
} from "./connection";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const html = (status = 200) => new Response("<html><body>Sign in to Venue Wi-Fi</body></html>", { status, headers: { "Content-Type": "text/html" } });
/** What fetch gives for a redirect asked with redirect: "manual". */
const opaqueRedirect = () => { const r = new Response(null, { status: 200 }); Object.defineProperty(r, "type", { value: "opaqueredirect" }); Object.defineProperty(r, "status", { value: 0 }); return r; };

let stop: () => void = () => {};
beforeEach(() => { resetConnection(); localStorage.clear(); });
afterEach(() => { stop(); stop = () => {}; resetConnection(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("classify: what answered the check", () => {
  it("our own health answer is internet", async () => {
    expect(await classify(json({ ok: true, engine: "3.4.0", release: "abc" }))).toBe("yes");
  });
  it("a page that isn't ours (a Wi-Fi sign-in page) is a portal", async () => {
    expect(await classify(html())).toBe("portal");
  });
  it("a redirect is a portal (our health check never redirects)", async () => {
    expect(await classify(opaqueRedirect())).toBe("portal");
    expect(await classify(new Response(null, { status: 302, headers: { Location: "http://login.venue.example/" } }))).toBe("portal");
  });
  it("JSON that isn't our answer, and 511, are a portal", async () => {
    expect(await classify(json({ status: "login required" }))).toBe("portal");
    expect(await classify(json({ ok: true }, 511))).toBe("portal");
  });
  it("our server erroring is still internet (the site is having trouble, not the Wi-Fi)", async () => {
    expect(await classify(html(502))).toBe("yes");
  });
});

describe("checkInternet", () => {
  it("ok JSON → yes, HTML 200 → portal, opaque redirect → portal, network error → no", async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => json({ ok: true, engine: "x", release: "y" }), "yes"],
      [async () => html(), "portal"],
      [async () => opaqueRedirect(), "portal"],
      [async () => { throw new TypeError("Failed to fetch"); }, "no"],
    ];
    for (const [answer, want] of cases) {
      const fetch = vi.fn(answer);
      vi.stubGlobal("fetch", fetch);
      expect(await checkInternet()).toBe(want);
      expect(connection().internet).toBe(want);
      expect(offlineNow()).toBe(want !== "yes");
      expect(fetch).toHaveBeenCalledWith("/api/health", expect.objectContaining({ cache: "no-store", redirect: "manual" }));
    }
  });

  it("no answer within CHECK_TIMEOUT_MS is no internet", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_p: string, init?: RequestInit) => new Promise<Response>((_r, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    })));
    const p = checkInternet();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    expect(await p).toBe("no");
  });

  it("checks one at a time", async () => {
    const fetch = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await Promise.all([checkInternet(), checkInternet(), checkInternet()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a server answer while a check waited wins over the check timing out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_p: string, init?: RequestInit) => new Promise<Response>((_r, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    })));
    const p = checkInternet();
    noteServerAnswer();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    await p;
    expect(connection().internet).toBe("yes");
  });
});

describe("watching", () => {
  it("a failed request checks once, soon (a burst of failures is one check)", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    noteRequestFailed(); noteRequestFailed(); noteRequestFailed();
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(connection().internet).toBe("no");
  });

  it("checks again every RETRY_MS while offline, and coming back is seen", async () => {
    vi.useFakeTimers();
    let up = false;
    const fetch = vi.fn(async () => { if (!up) throw new TypeError("Failed to fetch"); return json({ ok: true }); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS);
    expect(connection().internet).toBe("no");
    up = true;
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(connection().internet).toBe("yes");
  });

  it("the browser's offline event is believed at once, then checked", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    const { result } = renderHook(() => useConnection());
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(result.current.internet).toBe("no");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetch).toHaveBeenCalled();
  });

  it("a server answer counts as internet with no check", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    noteServerAnswer();
    expect(connection().internet).toBe("yes");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the demo setting (screenshots)", () => {
  it("shows offline or a portal without changing what reads do", () => {
    localStorage.setItem(DEMO_KEY, "portal");
    expect(connection().internet).toBe("portal");
    expect(shownOffline()).toBe(true);
    expect(offlineNow()).toBe(false);
    localStorage.setItem(DEMO_KEY, "offline");
    expect(connection()).toMatchObject({ internet: "no", type: "none", online: false });
  });
});
