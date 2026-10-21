// @vitest-environment jsdom
// The phone tab bar's rules (src/lib/tabBar.ts): what a stored choice turns into, the 2–5 limits, moving, and
// what happens when this device's storage can't be used.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { DEFAULT_TABS, MAX_TABS, MIN_TABS, moveTab, normalizeTabs, saveTabs, TAB_KEY, TAB_OPTIONS, toggleTab, useTabBar, type TabId } from "./tabBar";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("normalizeTabs", () => {
  it("keeps a good choice as it is", () => {
    expect(normalizeTabs(["scout", "home", "teams"])).toEqual(["scout", "home", "teams"]);
  });
  it("drops unknown ids, repeats and anything past the fifth", () => {
    expect(normalizeTabs(["home", "nope", 7, "home", "events", "teams", "rankings", "compare", "scout"])).toEqual(["home", "events", "teams", "rankings", "compare"]);
  });
  it("falls back to the default for too few, or for anything that isn't a list", () => {
    for (const raw of [[], ["home"], ["home", "home"], null, undefined, "home,events", { 0: "home" }]) expect(normalizeTabs(raw)).toEqual(DEFAULT_TABS);
  });
  it("the default puts Scout at the right end and fits the limits", () => {
    expect(DEFAULT_TABS.at(-1)).toBe("scout");
    expect(DEFAULT_TABS.length).toBeLessThanOrEqual(MAX_TABS);
    expect(DEFAULT_TABS.length).toBeGreaterThanOrEqual(MIN_TABS);
    expect(new Set(TAB_OPTIONS.map((t) => t.id)).size).toBe(TAB_OPTIONS.length);
  });
});

describe("toggleTab", () => {
  it("adds at the end and removes in place", () => {
    expect(toggleTab(["home", "events"], "scout")).toEqual(["home", "events", "scout"]);
    expect(toggleTab(["home", "events", "scout"], "events")).toEqual(["home", "scout"]);
  });
  it("refuses a sixth page and leaves the same list", () => {
    const full: TabId[] = ["home", "events", "predict", "myTeam", "scout"];
    expect(toggleTab(full, "teams")).toBe(full);
  });
  it("refuses to go below two", () => {
    const two: TabId[] = ["home", "scout"];
    expect(toggleTab(two, "home")).toBe(two);
  });
});

describe("moveTab", () => {
  it("swaps with the neighbour", () => {
    expect(moveTab(["home", "events", "scout"], "scout", -1)).toEqual(["home", "scout", "events"]);
    expect(moveTab(["home", "events", "scout"], "home", 1)).toEqual(["events", "home", "scout"]);
  });
  it("does nothing past either end or for a page not in the bar", () => {
    const t: TabId[] = ["home", "events", "scout"];
    expect(moveTab(t, "home", -1)).toBe(t);
    expect(moveTab(t, "scout", 1)).toBe(t);
    expect(moveTab(t, "teams", 1)).toBe(t);
  });
});

describe("this device's choice", () => {
  it("is the default with nothing saved, or with a damaged value", () => {
    const { result, unmount } = renderHook(() => useTabBar());
    expect(result.current).toEqual(DEFAULT_TABS);
    unmount();
    localStorage.setItem(TAB_KEY, "{not json");
    expect(renderHook(() => useTabBar()).result.current).toEqual(DEFAULT_TABS);
  });

  it("saves, and the hook follows at once; the default is stored as nothing", () => {
    const { result } = renderHook(() => useTabBar());
    act(() => saveTabs(["teams", "scout"]));
    expect(result.current).toEqual(["teams", "scout"]);
    expect(JSON.parse(localStorage.getItem(TAB_KEY)!)).toEqual(["teams", "scout"]);
    act(() => saveTabs(DEFAULT_TABS));
    expect(result.current).toEqual(DEFAULT_TABS);
    expect(localStorage.getItem(TAB_KEY)).toBeNull();
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useTabBar());
    act(() => {
      localStorage.setItem(TAB_KEY, JSON.stringify(["rankings", "compare"]));
      window.dispatchEvent(new StorageEvent("storage", { key: TAB_KEY }));
    });
    expect(result.current).toEqual(["rankings", "compare"]);
  });

  it("with storage full (readable, but writes fail), the new choice holds over the old saved one", () => {
    localStorage.setItem(TAB_KEY, JSON.stringify(["teams", "rankings"]));
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const { result } = renderHook(() => useTabBar());
    expect(result.current).toEqual(["teams", "rankings"]);
    act(() => saveTabs(["scout", "home"]));
    expect(result.current).toEqual(["scout", "home"]);
    set.mockRestore();
    act(() => {
      localStorage.setItem(TAB_KEY, JSON.stringify(["compare", "settings"]));
      window.dispatchEvent(new StorageEvent("storage", { key: TAB_KEY }));
    });
    expect(result.current).toEqual(["compare", "settings"]);
  });

  it("with storage blocked (a private window), still works for this visit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useTabBar());
    expect(result.current).toEqual(DEFAULT_TABS);
    act(() => saveTabs(["shortlist", "settings"]));
    expect(result.current).toEqual(["shortlist", "settings"]);
  });
});
