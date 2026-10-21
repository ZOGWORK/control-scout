// @vitest-environment jsdom
// This device's text size (src/lib/textSize.ts): stored per device, put on <html> as data-text-size (Default is
// no attribute), followed by every open tab, and still working for the visit when storage is blocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { applyTextSize, isTextSize, setTextSize, TEXT_SIZE_KEY, useTextSize, watchTextSize } from "./textSize";

const root = () => document.documentElement;
beforeEach(() => { localStorage.clear(); root().removeAttribute("data-text-size"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("text size", () => {
  it("knows its sizes", () => {
    for (const v of ["s", "m", "l", "xl"]) expect(isTextSize(v)).toBe(true);
    for (const v of ["", "xs", null, 1, "M"]) expect(isTextSize(v)).toBe(false);
  });

  it("Default is no attribute; the others set data-text-size", () => {
    applyTextSize("l");
    expect(root().getAttribute("data-text-size")).toBe("l");
    applyTextSize("m");
    expect(root().hasAttribute("data-text-size")).toBe(false);
  });

  it("is Default with nothing saved or a bad value", () => {
    expect(renderHook(() => useTextSize()).result.current).toBe("m");
    localStorage.setItem(TEXT_SIZE_KEY, "huge");
    expect(renderHook(() => useTextSize()).result.current).toBe("m");
  });

  it("saves on this device, applies at once, and Default is stored as nothing", () => {
    const { result } = renderHook(() => useTextSize());
    act(() => setTextSize("xl"));
    expect(result.current).toBe("xl");
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBe("xl");
    expect(root().getAttribute("data-text-size")).toBe("xl");
    act(() => setTextSize("m"));
    expect(result.current).toBe("m");
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBeNull();
    expect(root().hasAttribute("data-text-size")).toBe(false);
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useTextSize());
    act(() => {
      localStorage.setItem(TEXT_SIZE_KEY, "s");
      window.dispatchEvent(new StorageEvent("storage", { key: TEXT_SIZE_KEY }));
    });
    expect(result.current).toBe("s");
    expect(root().getAttribute("data-text-size")).toBe("s");
  });

  it("with storage full (readable, but writes fail), the new choice holds over the old saved one", () => {
    localStorage.setItem(TEXT_SIZE_KEY, "s");
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("quota"); });
    const { result } = renderHook(() => useTextSize());
    act(() => setTextSize("xl"));
    expect(result.current).toBe("xl");
    expect(root().getAttribute("data-text-size")).toBe("xl");
    // Another tab's change (storage works again there) replaces it.
    set.mockRestore();
    act(() => {
      localStorage.setItem(TEXT_SIZE_KEY, "l");
      window.dispatchEvent(new StorageEvent("storage", { key: TEXT_SIZE_KEY }));
    });
    expect(result.current).toBe("l");
  });

  it("the app-wide watch applies the saved size now, and another tab's change with no Settings open", () => {
    localStorage.setItem(TEXT_SIZE_KEY, "s");
    const stop = watchTextSize();
    expect(root().getAttribute("data-text-size")).toBe("s");
    localStorage.setItem(TEXT_SIZE_KEY, "xl");
    window.dispatchEvent(new StorageEvent("storage", { key: TEXT_SIZE_KEY }));
    expect(root().getAttribute("data-text-size")).toBe("xl");
    stop();
    localStorage.removeItem(TEXT_SIZE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: TEXT_SIZE_KEY }));
    expect(root().getAttribute("data-text-size")).toBe("xl");
  });

  it("with storage blocked, still holds the choice for this visit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useTextSize());
    act(() => setTextSize("l"));
    expect(result.current).toBe("l");
    expect(root().getAttribute("data-text-size")).toBe("l");
  });
});
