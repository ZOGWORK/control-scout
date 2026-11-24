// @vitest-environment jsdom
// Home's tips line (./HomeTips.tsx, src/shared/homeTips.ts): one tip shown at a time, a new one every TIP_MS, still
// while hovered, focused or the tab is hidden; every tip in the same cell (no layout shift); never announced.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { HOME_ABOUT } from "../../shared/boot";
import { HOME_TIPS, TIP_MS, tipsFor } from "../../shared/homeTips";

let personal: { user: unknown } = { user: null };
vi.mock("../../lib/personal", () => ({ usePersonal: () => personal }));
const { HomeTips } = await import("./HomeTips");

const mount = () => render(<MemoryRouter><HomeTips /></MemoryRouter>);
const shown = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-tip][data-shown]")].map((p) => p.dataset.tip);
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  personal = { user: null };
  hidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("the tips", () => {
  it("keep the free, no-account line, and are short, plain and unique", () => {
    expect(HOME_TIPS.some((t) => t.text === HOME_ABOUT)).toBe(true);
    expect(HOME_TIPS.length).toBeGreaterThanOrEqual(15);
    expect(HOME_TIPS.length).toBeLessThanOrEqual(21);
    expect(new Set(HOME_TIPS.map((t) => t.id)).size).toBe(HOME_TIPS.length);
    for (const t of HOME_TIPS) {
      const words = t.text + (t.link ? t.link.label + (t.link.after ?? "") : "");
      // One line on a desktop: the free line is the longest.
      expect(words.length, t.id).toBeLessThanOrEqual(HOME_ABOUT.length);
      expect(words, t.id).not.toMatch(/\b(AI|best in|better than|FTC ?Scout|#1)\b/);
    }
  });

  it("ask for an account only while signed out", () => {
    expect(tipsFor(false).some((t) => t.id === "account")).toBe(true);
    expect(tipsFor(true).some((t) => t.id === "account")).toBe(false);
  });
});

describe("HomeTips", () => {
  it("shows one tip, every tip in the same cell, the rest hidden from reading and focus; never announced", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = mount();
    const line = container.querySelector<HTMLElement>("[data-home-tips]")!;
    expect(line.getAttribute("aria-live")).toBe("off");
    const all = [...line.querySelectorAll<HTMLElement>("[data-tip]")];
    expect(all).toHaveLength(tipsFor(false).length);
    expect(all.every((p) => p.className.includes("[grid-area:1/1]"))).toBe(true);
    expect(shown(container)).toEqual([HOME_TIPS[0].id]);
    for (const p of all.filter((p) => !("shown" in p.dataset))) {
      expect(p.getAttribute("aria-hidden")).toBe("true");
      expect(p.className).toContain("invisible");
    }
  });

  it("starts on a random tip and moves on every TIP_MS", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { container } = mount();
    const tips = tipsFor(false);
    const first = Math.floor(0.5 * tips.length);
    expect(shown(container)).toEqual([tips[first].id]);
    act(() => { vi.advanceTimersByTime(TIP_MS - 1); });
    expect(shown(container)).toEqual([tips[first].id]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(shown(container)).toEqual([tips[(first + 1) % tips.length].id]);
  });

  it("stays still while hovered or focused, and while the tab is hidden", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = mount();
    const line = container.querySelector<HTMLElement>("[data-home-tips]")!;
    const tips = tipsFor(false);
    fireEvent.pointerEnter(line);
    act(() => { vi.advanceTimersByTime(TIP_MS * 3); });
    expect(shown(container)).toEqual([tips[0].id]);
    fireEvent.pointerLeave(line);
    fireEvent.focus(line);
    act(() => { vi.advanceTimersByTime(TIP_MS * 3); });
    expect(shown(container)).toEqual([tips[0].id]);
    fireEvent.blur(line);
    hidden = true;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    act(() => { vi.advanceTimersByTime(TIP_MS * 3); });
    expect(shown(container)).toEqual([tips[0].id]);
    hidden = false;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    act(() => { vi.advanceTimersByTime(TIP_MS); });
    expect(shown(container)).toEqual([tips[1].id]);
  });

  it("links a tip's page, and leaves the account tip out once signed in", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container, unmount } = mount();
    const appearance = container.querySelector("[data-tip='appearance'] a")!;
    expect(appearance.getAttribute("href")).toBe("/settings#appearance");
    expect(container.querySelector("[data-tip='account']")).toBeTruthy();
    unmount();
    personal = { user: { id: 1 } };
    const again = mount();
    expect(again.container.querySelector("[data-tip='account']")).toBeNull();
  });
});
