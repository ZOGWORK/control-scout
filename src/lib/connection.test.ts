// @vitest-environment jsdom
// The connection check: what answered GET /api/health decides "yes", "portal" or "no"; failures and the browser's
// events start a check; a server answer elsewhere counts as "yes" at once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  CARRY_MS, CHECK_TIMEOUT_MS, DEMO_KEY, EVENT_GAP_MS, FAIL_DEBOUNCE_MS, IDLE_MS, LAST_KEY, ONLINE_RETRY_MS, ONLINE_WINDOW_MS, RETRY_MS, RETRY_STEPS_MS, WAITING_RETRY_MS, WAITING_WINDOW_MS, checkInternet, classify, connection, noteDownloadWaiting, noteRequestFailed, noteServerAnswer,
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
  it("headers in but the body never arrives (timed out, stalled) is no answer, not a sign-in page", async () => {
    const stalled = new Response(new ReadableStream({ start(c) { c.error(new DOMException("aborted", "AbortError")); } }), { status: 200, headers: { "Content-Type": "application/json" } });
    expect(await classify(stalled)).toBe("no");
  });
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
  it("a sign-in page answer that lands after a server answer doesn't undo it (signed in meanwhile)", async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { answer = r; })));
    const p = checkInternet();
    noteServerAnswer(); // signed in to the Wi-Fi; a read got our own JSON
    answer(new Response("<html>Sign in</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    await p;
    expect(connection().internet).toBe("yes");
  });
});

describe("watching", () => {
  it("a check whose answer is set aside (a server answer came first) still keeps the clock checking", async () => {
    vi.useFakeTimers();
    let answer: ((r: Response) => void) | null = null;
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(() => { calls++; return calls === 2 ? new Promise<Response>((r) => { answer = r; }) : Promise.resolve(json({ ok: true })); }));
    stop = startConnectionWatch();
    await vi.advanceTimersByTimeAsync(2000); // the first check: internet
    expect(connection().internet).toBe("yes");
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(IDLE_MS); // the clock's check starts and waits
    expect(calls).toBe(2);
    noteServerAnswer(); // already "yes": nothing changes, nothing re-armed there
    answer!(html()); // lands late: set aside
    await vi.advanceTimersByTimeAsync(0);
    expect(connection().internet).toBe("yes");
    await vi.advanceTimersByTimeAsync(IDLE_MS + 1000);
    expect(calls).toBe(3);
  });

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

  it("while offline, checks after 3 s, 5 s, 10 s, 20 s, then every 30 s", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(0); // the first failure, before any answer: checked at once
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(RETRY_STEPS_MS).toEqual([3000, 5000, 10_000, 20_000]);
    let calls = 1;
    for (const wait of [...RETRY_STEPS_MS, RETRY_MS, RETRY_MS]) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(fetch).toHaveBeenCalledTimes(calls); // not a moment early
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(++calls);
    }
    expect(connection().internet).toBe("no");
  });

  it("the back-off starts over once there's internet again", async () => {
    vi.useFakeTimers();
    let up = false;
    const fetch = vi.fn(async () => { if (!up) throw new TypeError("Failed to fetch"); return json({ ok: true }); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS.reduce((a, b) => a + b, 0)); // down to the 30 s cadence
    expect(fetch).toHaveBeenCalledTimes(1 + RETRY_STEPS_MS.length);
    up = true;
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(connection().internet).toBe("yes");
    // Online again: the IDLE_MS cadence is untouched.
    const atYes = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(atYes);
    // A new outage: back to 3 s first.
    up = false;
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS);
    expect(connection().internet).toBe("no");
    const atNo = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS[0]);
    expect(fetch).toHaveBeenCalledTimes(atNo + 1);
  });

  it("a server answer while offline also starts the back-off over", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS.reduce((a, b) => a + b, 0));
    noteServerAnswer();
    expect(connection().internet).toBe("yes");
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS);
    const atNo = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS[0]);
    expect(fetch).toHaveBeenCalledTimes(atNo + 1);
  });

  /** Offline long enough to be on the RETRY_MS cadence, with the last check more than EVENT_GAP_MS ago. */
  async function offlineOnSlowCadence(isUp: () => boolean) {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { if (!isUp()) throw new TypeError("Failed to fetch"); return json({ ok: true }); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS.reduce((a, b) => a + b, 0) + EVENT_GAP_MS + 1);
    expect(fetch).toHaveBeenCalledTimes(1 + RETRY_STEPS_MS.length);
    return fetch;
  }

  it.each([
    ["focus", () => window.dispatchEvent(new Event("focus"))],
    ["the tab coming into view", () => document.dispatchEvent(new Event("visibilitychange"))],
  ])("%s while offline checks at once and starts the back-off over", async (_name, fire) => {
    const fetch = await offlineOnSlowCadence(() => false);
    const before = fetch.mock.calls.length;
    fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(before + 1); // at once
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS[0]);
    expect(fetch).toHaveBeenCalledTimes(before + 2); // then 3 s, not 30 s
  });

  it("the online event while offline checks at once, then every ONLINE_RETRY_MS for ONLINE_WINDOW_MS, then the back-off from 3 s", async () => {
    const fetch = await offlineOnSlowCadence(() => false);
    const before = fetch.mock.calls.length;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(before + 1); // at once
    const quick = ONLINE_WINDOW_MS / ONLINE_RETRY_MS; // the quick tries armed inside the window
    for (let i = 1; i <= quick; i++) {
      await vi.advanceTimersByTimeAsync(ONLINE_RETRY_MS);
      expect(fetch).toHaveBeenCalledTimes(before + 1 + i);
    }
    // The window is over: 3 s, then 5 s, as after any other outage.
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS[0] - 1);
    expect(fetch).toHaveBeenCalledTimes(before + 1 + quick);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(before + 2 + quick);
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS[1]);
    expect(fetch).toHaveBeenCalledTimes(before + 3 + quick);
    expect(connection().internet).toBe("no");
  });

  describe("the line coming back (the browser's offline, then online event)", () => {
    /** A fetch whose answers the test hands out one by one; `hang` ones only end on the check's own timeout. */
    function scripted() {
      const pending: { ok: (r: Response) => void; fail: (e: unknown) => void }[] = [];
      const fetch = vi.fn((_p: string, init?: RequestInit) => new Promise<Response>((ok, fail) => {
        init?.signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")));
        pending.push({ ok, fail });
      }));
      vi.stubGlobal("fetch", fetch);
      return { fetch, last: () => pending[pending.length - 1] };
    }

    it("online within EVENT_GAP_MS of a failed check still checks at once, and the pill goes within one check", async () => {
      vi.useFakeTimers();
      const net = scripted();
      stop = startConnectionWatch();
      window.dispatchEvent(new Event("offline"));
      expect(connection().internet).toBe("no");
      await vi.advanceTimersByTimeAsync(0);
      expect(net.fetch).toHaveBeenCalledTimes(1);
      net.last().fail(new TypeError("Failed to fetch")); // the offline event's check fails
      await vi.advanceTimersByTimeAsync(1000); // the online event comes 1 s later: well inside EVENT_GAP_MS
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
      expect(net.fetch).toHaveBeenCalledTimes(2); // at once, not on the 3 s step
      await vi.advanceTimersByTimeAsync(100); // the check takes 100 ms
      net.last().ok(json({ ok: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(connection().internet).toBe("yes");
    });

    it("a check still running from while offline doesn't hide the online event: another runs right after it", async () => {
      vi.useFakeTimers();
      const net = scripted();
      stop = startConnectionWatch();
      window.dispatchEvent(new Event("offline"));
      await vi.advanceTimersByTimeAsync(0);
      expect(net.fetch).toHaveBeenCalledTimes(1); // started offline, still waiting
      await vi.advanceTimersByTimeAsync(1000);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
      net.last().fail(new TypeError("Failed to fetch")); // the old check fails, as it was always going to
      await vi.advanceTimersByTimeAsync(0);
      expect(net.fetch).toHaveBeenCalledTimes(2); // checked again right after it, not on the 3 s step
      await vi.advanceTimersByTimeAsync(100);
      net.last().ok(json({ ok: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(connection().internet).toBe("yes");
    });

    it("a check that hangs right after the online event is tried again within ONLINE_RETRY_MS of its timeout", async () => {
      vi.useFakeTimers();
      const net = scripted();
      stop = startConnectionWatch();
      window.dispatchEvent(new Event("offline"));
      await vi.advanceTimersByTimeAsync(0);
      net.last().fail(new TypeError("Failed to fetch"));
      await vi.advanceTimersByTimeAsync(1000);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
      expect(net.fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS); // no answer: the check gives up
      expect(connection().internet).toBe("no");
      await vi.advanceTimersByTimeAsync(ONLINE_RETRY_MS);
      expect(net.fetch).toHaveBeenCalledTimes(3); // not 3 s later
      net.last().ok(json({ ok: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(connection().internet).toBe("yes");
    });

    it("an offline event during the quick tries cancels the rest: back to the 3 s step", async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
      vi.stubGlobal("fetch", fetch);
      stop = startConnectionWatch();
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event("offline")); // gone again before the quick tries ran
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS[0] - 1);
      expect(fetch).toHaveBeenCalledTimes(2); // no 500 ms tries
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("every online event checks at once, however recent the last check", async () => {
      vi.useFakeTimers();
      const net = scripted();
      stop = startConnectionWatch();
      for (let round = 0; round < 3; round++) {
        window.dispatchEvent(new Event("offline"));
        await vi.advanceTimersByTimeAsync(0);
        net.last().fail(new TypeError("Failed to fetch"));
        await vi.advanceTimersByTimeAsync(200);
        const before = net.fetch.mock.calls.length;
        window.dispatchEvent(new Event("online"));
        await vi.advanceTimersByTimeAsync(0);
        expect(net.fetch).toHaveBeenCalledTimes(before + 1);
        net.last().ok(json({ ok: true }));
        await vi.advanceTimersByTimeAsync(0);
        expect(connection().internet).toBe("yes");
      }
    });
  });

  it("focus moments after a check doesn't check again then, but the next check comes by the first step", async () => {
    let up = false;
    const fetch = await offlineOnSlowCadence(() => up);
    window.dispatchEvent(new Event("focus")); // checks: the last was over EVENT_GAP_MS ago
    await vi.advanceTimersByTimeAsync(0);
    const settled = fetch.mock.calls.length;
    up = true;
    window.dispatchEvent(new Event("focus")); // moments later: no check now
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(settled);
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS[0]);
    expect(fetch).toHaveBeenCalledTimes(settled + 1);
    expect(connection().internet).toBe("yes");
  });

  it("focus with internet doesn't check (the IDLE_MS cadence stays as it was)", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection().internet).toBe("yes");
    await vi.advanceTimersByTimeAsync(EVENT_GAP_MS + 1);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
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

describe("a paused download waiting for the line", () => {
  it("checks every WAITING_RETRY_MS instead of the back-off, so the line coming back is seen in seconds", async () => {
    vi.useFakeTimers();
    let up = false;
    const fetch = vi.fn(async () => { if (!up) throw new TypeError("Failed to fetch"); return json({ ok: true }); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS.reduce((a, b) => a + b, 0)); // down to the 30 s cadence
    const before = fetch.mock.calls.length;
    noteDownloadWaiting();
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS); // checked soon
    expect(fetch).toHaveBeenCalledTimes(before + 1);
    for (let i = 2; i <= 5; i++) {
      await vi.advanceTimersByTimeAsync(WAITING_RETRY_MS);
      expect(fetch).toHaveBeenCalledTimes(before + i); // every 2 s, never 30 s
    }
    up = true;
    await vi.advanceTimersByTimeAsync(WAITING_RETRY_MS);
    expect(connection().internet).toBe("yes");
  });

  it("is over once there's internet, and after WAITING_WINDOW_MS the back-off is back", async () => {
    vi.useFakeTimers();
    let up = false;
    const fetch = vi.fn(async () => { if (!up) throw new TypeError("Failed to fetch"); return json({ ok: true }); });
    vi.stubGlobal("fetch", fetch);
    stop = startConnectionWatch();
    noteDownloadWaiting();
    await vi.advanceTimersByTimeAsync(WAITING_WINDOW_MS + RETRY_MS);
    // Past the window: the back-off's own cadence.
    let at = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(WAITING_RETRY_MS * 3);
    expect(fetch.mock.calls.length - at).toBeLessThanOrEqual(1);
    up = true;
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(connection().internet).toBe("yes");
    // Waiting again, then internet: an outage after that backs off as usual (3 s first, then 5 s).
    noteDownloadWaiting();
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS);
    expect(connection().internet).toBe("yes");
    up = false;
    noteRequestFailed();
    await vi.advanceTimersByTimeAsync(FAIL_DEBOUNCE_MS);
    expect(connection().internet).toBe("no");
    at = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(WAITING_RETRY_MS);
    expect(fetch).toHaveBeenCalledTimes(at);
    await vi.advanceTimersByTimeAsync(RETRY_STEPS_MS[0] - WAITING_RETRY_MS);
    expect(fetch).toHaveBeenCalledTimes(at + 1);
  });
});

describe("the next page load", () => {
  it("starts from this tab's last 'no internet' answer (for a while), and checks again at once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await checkInternet();
    expect(JSON.parse(sessionStorage.getItem(LAST_KEY)!)).toMatchObject({ internet: "no" });
    // A new page: the module's state starts over from what this tab saw.
    const raw = sessionStorage.getItem(LAST_KEY);
    resetConnection(); // clears it, as a test reset
    sessionStorage.setItem(LAST_KEY, raw!);
    vi.resetModules();
    const again = await import("./connection");
    expect(again.connection().internet).toBe("no");
    expect(again.offlineNow()).toBe(true);
    // Too old: forgotten.
    sessionStorage.setItem(LAST_KEY, JSON.stringify({ internet: "no", at: Date.now() - CARRY_MS - 1 }));
    vi.resetModules();
    expect((await import("./connection")).connection().internet).toBe("unknown");
    sessionStorage.removeItem(LAST_KEY);
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
