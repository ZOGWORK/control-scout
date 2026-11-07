// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PULL_RESISTANCE, PULL_THRESHOLD } from "../../lib/pullToRefresh";
import { PullToRefresh } from "./PullToRefresh";

const real = window.matchMedia;
const media = (on: string[]) => {
  window.matchMedia = ((q: string) => ({ matches: on.some((m) => q.includes(m)), media: q })) as unknown as typeof window.matchMedia;
};
const INSTALLED_PHONE = ["display-mode: standalone", "pointer: coarse", "max-width: 1024px"];

function touch(type: string, y: number | null, target: EventTarget = document.body) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: { clientX: number; clientY: number }[] };
  Object.defineProperty(ev, "touches", { value: y === null ? [] : [{ clientX: 200, clientY: y }] });
  act(() => { target.dispatchEvent(ev); });
  return ev;
}

/** A pull from y=150 down by `dy`, released unless `hold`. */
function pull(dy: number, hold = false) {
  touch("touchstart", 150);
  const moves = [touch("touchmove", 165), touch("touchmove", 150 + dy / 2), touch("touchmove", 150 + dy)];
  if (!hold) touch("touchend", null);
  return moves;
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
  vi.useFakeTimers();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); window.matchMedia = real; });

describe("PullToRefresh", () => {
  it("in the installed app on a phone: shows the icon while pulling and reloads on release past the threshold", () => {
    media(INSTALLED_PHONE);
    const reload = vi.fn();
    const { container } = render(<PullToRefresh reload={reload} />);
    const far = PULL_THRESHOLD / PULL_RESISTANCE + 20;
    const moves = pull(far, true);
    expect(moves.every((m) => m.defaultPrevented)).toBe(true);
    expect(container.querySelector("[data-pull-refresh]")).not.toBeNull();
    expect(container.textContent).toContain("Release to reload");
    touch("touchend", null);
    expect(container.textContent).toContain("Reloading");
    act(() => { vi.runAllTimers(); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a short pull shows the icon, then puts it away without reloading", () => {
    media(INSTALLED_PHONE);
    const reload = vi.fn();
    const { container } = render(<PullToRefresh reload={reload} />);
    pull(60, true);
    expect(container.textContent).toContain("Pull to reload");
    touch("touchend", null);
    act(() => { vi.runAllTimers(); });
    expect(container.querySelector("[data-pull-refresh]")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing when the page isn't at the top: the move stays the browser's", () => {
    media(INSTALLED_PHONE);
    Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
    const reload = vi.fn();
    const { container } = render(<PullToRefresh reload={reload} />);
    const moves = pull(400);
    act(() => { vi.runAllTimers(); });
    expect(moves.some((m) => m.defaultPrevented)).toBe(false);
    expect(container.querySelector("[data-pull-refresh]")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing in a phone browser tab (the browser has its own) or on desktop", () => {
    for (const on of [["pointer: coarse", "max-width: 1024px"], ["display-mode: standalone"]]) {
      media(on);
      const reload = vi.fn();
      const { container, unmount } = render(<PullToRefresh reload={reload} />);
      const moves = pull(400);
      act(() => { vi.runAllTimers(); });
      expect(moves.some((m) => m.defaultPrevented)).toBe(false);
      expect(container.querySelector("[data-pull-refresh]")).toBeNull();
      expect(reload).not.toHaveBeenCalled();
      unmount();
    }
  });
});
