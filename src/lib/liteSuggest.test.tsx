// @vitest-environment jsdom
// When the app offers the light version (src/lib/liteSuggest.ts): the page's own data still missing LITE_SLOW_MS
// after the visitor got there, or LITE_FAILS unreachable requests in a minute, and only while the browser says it's
// online.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { dismissLite, isPageData, noteArrived, resetLiteSuggest, useLiteSuggested, watchPage, watchRequest } from "./liteSuggest";
import { load, prime } from "./api";
import { LITE_FAILS, LITE_SLOW_MS } from "../shared/lite";
import { matchReportPath } from "./matchReport";

const setOnline = (v: boolean) => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => v });
const visit = (path: string) => window.history.replaceState(null, "", path);
/** The visitor arrives at `path` (LiteSuggest calls watchPage on every navigation). */
const arrive = (path: string) => { visit(path); const u = new URL(path, "http://x"); return watchPage(u.pathname, u.search); };

beforeEach(() => { vi.useFakeTimers(); setOnline(true); resetLiteSuggest(); visit("/"); });
afterEach(() => { vi.useRealTimers(); setOnline(true); });

describe("light version offer", () => {
  it("counts only the data of the page being read, never a prefetch or a side request", () => {
    const at: [string, string, boolean][] = [
      ["/events/2025/USNJQ1", "/api/events/2025/USNJQ1", true],
      ["/events/2025/usnjq1", "/api/events/2025/USNJQ1?x=1", true],
      ["/events/2025/USNJQ1/match/QUAL:0:01", "/api/events/2025/USNJQ1/matches/qual:0:1", true],
      ["/events/2025/USNJQ1/match/qual:0:1", matchReportPath(2025, "USNJQ1", "qual:0:1"), true],
      ["/teams/18360?season=2024", "/api/teams/18360?season=2024", true],
      ["/teams/18360", "/api/teams/18360", true],
      ["/scout?space=7&view=picklist", "/api/scout/workspaces/7/picklist?season=2025", true],
      ["/scout", "/api/scout/workspaces/7/picklist?season=2025", true],
      // A team link prefetched from an event page, a side request, another page's data.
      ["/events/2025/USNJQ1", "/api/teams/18360", false],
      ["/events/2025/USNJQ1", "/api/events/2025/USNJQ1/disagreements", false],
      ["/teams/18360", "/api/teams/4215", false],
      // Another season, another workspace.
      ["/teams/18360?season=2024", "/api/teams/18360?season=2025", false],
      ["/teams/18360", "/api/teams/18360?season=2024", false],
      ["/scout?space=7&view=picklist", "/api/scout/workspaces/8/picklist?season=2025", false],
      ["/predict", "/api/events/2025/USNJQ1", false],
    ];
    for (const [at_, req, want] of at) {
      const u = new URL(at_, "http://x");
      expect(isPageData(req, u.pathname, u.search), `${at_} ← ${req}`).toBe(want);
    }
  });

  it("offers it when the page's data is still missing after the wait, and not before", () => {
    const { result } = renderHook(() => useLiteSuggested());
    arrive("/events/2025/USNJQ1");
    watchRequest("/api/events/2025/USNJQ1");
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS - 1); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it("a page whose data arrived in time, or was prefetched before the click, offers nothing", () => {
    const { result } = renderHook(() => useLiteSuggested());
    arrive("/teams/18360");
    const w = watchRequest("/api/teams/18360");
    watchRequest("/api/predict/event?season=2025&code=X"); // slow, but not the page's data
    act(() => { vi.advanceTimersByTime(1000); w.done(); vi.advanceTimersByTime(LITE_SLOW_MS * 2); });
    expect(result.current).toBe(false);

    // Hovered on an event page, arrived, then clicked: the team page has its data.
    arrive("/events/2025/USNJQ1");
    watchRequest("/api/teams/4215").done();
    arrive("/teams/4215");
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(false);
  });

  it("a prefetch still crawling when the visitor clicks through is the page's data: the page gets the offer", () => {
    const { result } = renderHook(() => useLiteSuggested());
    arrive("/events/2025/USNJQ1");
    watchRequest("/api/events/2025/USNJQ1").done();
    const prefetch = watchRequest("/api/teams/4215"); // hover, before the click
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(false); // the event page has its data: the slow prefetch isn't its business
    arrive("/teams/4215");
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(true);
    prefetch.done();
  });

  it("another season of a team is another page: its own wait, not the last season's arrival", () => {
    const { result } = renderHook(() => useLiteSuggested());
    arrive("/teams/18360?season=2025");
    watchRequest("/api/teams/18360?season=2025").done();
    arrive("/teams/18360?season=2024");
    watchRequest("/api/teams/18360?season=2024");
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(true);
  });

  it("an answer that isn't the page's data (an error, a 'starting up' about to be retried) isn't an arrival", () => {
    const { result } = renderHook(() => useLiteSuggested());
    arrive("/teams/9");
    watchRequest("/api/teams/9").done(false);
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(true);
  });

  it("coming back to a page loaded earlier is a new wait: an old arrival doesn't count, a fresh prefetch does", () => {
    const { result } = renderHook(() => useLiteSuggested());
    arrive("/scout?space=7&view=picklist&season=2025");
    watchRequest("/api/scout/workspaces/7/picklist?season=2025").done();
    arrive("/scout?space=8&view=picklist&season=2025");
    watchRequest("/api/scout/workspaces/8/picklist?season=2025").done();
    act(() => { vi.advanceTimersByTime(60_000); });
    // Back to workspace 7: the list clears and loads again, and crawls this time.
    arrive("/scout?space=7&view=picklist&season=2025");
    watchRequest("/api/scout/workspaces/7/picklist?season=2025");
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(true);
  });

  it("a page drawn from data the app already holds isn't waiting, however long ago it arrived", async () => {
    const { result } = renderHook(() => useLiteSuggested());
    prime("/api/teams/77", { team: { number: 77 } });
    act(() => { vi.advanceTimersByTime(45_000); });
    arrive("/teams/77");
    await load("/api/teams/77");
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(false);
    noteArrived("/api/teams/78");
    arrive("/teams/78");
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(false);
  });

  it("a page's data still missing after the visitor left that page offers nothing", () => {
    const { result } = renderHook(() => useLiteSuggested());
    const stop = arrive("/teams/1");
    visit("/predict");
    act(() => { vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(false);
    stop();
  });

  it("offers it after repeated failures within a minute, never while offline (the offline pack's job)", () => {
    const { result } = renderHook(() => useLiteSuggested());
    for (let i = 0; i < LITE_FAILS - 1; i++) watchRequest("/api/meta").failed();
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(61_000); watchRequest("/api/meta").failed(); });
    expect(result.current).toBe(false); // the earlier ones aged out
    act(() => { for (let i = 0; i < LITE_FAILS; i++) watchRequest("/api/meta").failed(); });
    expect(result.current).toBe(true);

    act(() => resetLiteSuggest());
    expect(result.current).toBe(false);
    setOnline(false);
    act(() => { for (let i = 0; i < LITE_FAILS; i++) watchRequest("/api/meta").failed(); arrive("/teams/1"); vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(false);
  });

  it("quick failures of the page's own data keep the offer up (apiFetch calls failed() then done())", () => {
    const { result } = renderHook(() => useLiteSuggested());
    visit("/teams/1");
    act(() => { for (let i = 0; i < LITE_FAILS; i++) { const w = watchRequest("/api/teams/1"); w.failed(); w.done(); } });
    expect(result.current).toBe(true);
    act(() => { const w = watchRequest("/api/teams/1"); w.failed(); w.done(); });
    expect(result.current).toBe(true);
  });

  it("losing the signal hides the offer at once", () => {
    const { result } = renderHook(() => useLiteSuggested());
    act(() => { arrive("/teams/1"); vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(true);
    act(() => { setOnline(false); window.dispatchEvent(new Event("offline")); });
    expect(result.current).toBe(false);
    act(() => { setOnline(true); window.dispatchEvent(new Event("online")); });
    expect(result.current).toBe(true);
  });

  it("goes away when the page's data comes back quickly, or on the next page; Not now holds for the session", () => {
    const { result } = renderHook(() => useLiteSuggested());
    act(() => { arrive("/teams/1"); vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(true);
    act(() => { const w = watchRequest("/api/teams/1"); vi.advanceTimersByTime(100); w.done(); });
    expect(result.current).toBe(false);

    act(() => { arrive("/teams/2"); vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(true);
    act(() => { arrive("/teams/1"); });
    expect(result.current).toBe(false);

    act(() => { arrive("/teams/3"); vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(true);
    act(() => dismissLite());
    expect(result.current).toBe(false);
    act(() => { arrive("/teams/4"); vi.advanceTimersByTime(LITE_SLOW_MS); });
    expect(result.current).toBe(false);
  });
});
