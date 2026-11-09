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

/** The indicator's state: null when it isn't in the page at all (the feature is off). */
const view = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-pull-refresh]")?.dataset.state ?? null;
/** Out of sight: off, or on and idle. */
const hidden = (c: HTMLElement) => view(c) === null || view(c) === "idle";

beforeEach(() => {
  // Fake timers first: they bring their own requestAnimationFrame, which the stub then replaces (frames run at once).
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
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
    expect(view(container)).toBe("armed");
    expect(container.textContent).toContain("Release to reload");
    // It follows the finger by transform alone (no re-render per move), capped at the max travel.
    expect(container.querySelector<HTMLElement>("[data-pull-refresh]")!.style.transform).toMatch(/translate3d\(0, \d+(\.\d+)?px, 0\)/);
    touch("touchend", null);
    expect(view(container)).toBe("refreshing");
    expect(container.textContent).toContain("Reloading");
    act(() => { vi.runAllTimers(); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a short pull shows the icon, then springs it back up without reloading", () => {
    media(INSTALLED_PHONE);
    const reload = vi.fn();
    const { container } = render(<PullToRefresh reload={reload} />);
    pull(60, true);
    expect(view(container)).toBe("pulling");
    expect(container.textContent).toContain("Pull to reload");
    touch("touchend", null);
    expect(view(container)).toBe("returning");
    const el = container.querySelector<HTMLElement>("[data-pull-refresh]")!;
    expect(el.style.transform).toBe("translate3d(0, -44px, 0)");
    const done = Object.assign(new Event("transitionend"), { propertyName: "transform" });
    act(() => { el.dispatchEvent(done); });
    expect(view(container)).toBe("idle");
    act(() => { vi.runAllTimers(); });
    expect(reload).not.toHaveBeenCalled();
  });

  it("under reduced motion a short pull just goes, with no spring", () => {
    media([...INSTALLED_PHONE, "prefers-reduced-motion: reduce"]);
    const { container } = render(<PullToRefresh reload={vi.fn()} />);
    pull(60, true);
    touch("touchend", null);
    expect(view(container)).toBe("idle");
  });

  it("leaves a move another control already claimed (its own drag) alone", () => {
    media(INSTALLED_PHONE);
    const reload = vi.fn();
    const grab = (e: Event) => e.preventDefault();
    document.body.addEventListener("touchmove", grab, { passive: false });
    const { container } = render(<PullToRefresh reload={reload} />);
    pull(400);
    act(() => { vi.runAllTimers(); });
    document.body.removeEventListener("touchmove", grab);
    expect(hidden(container)).toBe(true);
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
    expect(hidden(container)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("follows a rotation across the phone width: off when wide, on once narrow, off again", () => {
    let on = ["display-mode: standalone", "pointer: coarse"]; // installed, but wider than a phone
    const listeners = new Set<() => void>();
    window.matchMedia = ((q: string) => ({
      matches: on.some((m) => q.includes(m)), media: q,
      addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    })) as unknown as typeof window.matchMedia;
    const rotate = (next: string[]) => { on = next; act(() => { for (const f of [...listeners]) f(); }); };
    const reload = vi.fn();
    const { container } = render(<PullToRefresh reload={reload} />);
    expect(pull(400, true).some((m) => m.defaultPrevented)).toBe(false);
    touch("touchend", null);
    rotate([...on, "max-width: 1024px"]);
    expect(pull(400, true).every((m) => m.defaultPrevented)).toBe(true);
    expect(view(container)).toBe("armed");
    rotate(["display-mode: standalone", "pointer: coarse"]); // turned back mid-pull: the icon goes, nothing reloads
    expect(container.querySelector("[data-pull-refresh]")).toBeNull();
    touch("touchend", null);
    act(() => { vi.runAllTimers(); });
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
      expect(view(container)).toBeNull();
      expect(reload).not.toHaveBeenCalled();
      unmount();
    }
  });
});
