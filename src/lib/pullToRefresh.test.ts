// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE, PULL_DEMO_KEY, PULL_MAX, PULL_RESISTANCE, PULL_SLOP, PULL_THRESHOLD, pullBlocked, pullDistance, pullEnd, pullMove, pullStart, pullToRefreshEnabled, type PullState } from "./pullToRefresh";

/** A drag from (x0, y0) through each point, returning the last state and whether each move was claimed. */
function drag(eligible: boolean, from: [number, number], points: [number, number][], atTop = true) {
  let s: PullState = pullStart(eligible, ...from);
  const prevented: boolean[] = [];
  for (const [x, y] of points) {
    const r = pullMove(s, x, y, atTop);
    s = r.state;
    prevented.push(r.prevent);
  }
  return { s, prevented };
}

/** Enough downward drag for the indicator to pass the threshold. */
const FAR = PULL_THRESHOLD / PULL_RESISTANCE + 10;

describe("pull gesture", () => {
  it("reloads after a straight pull down past the threshold", () => {
    const { s, prevented } = drag(true, [200, 150], [[200, 160], [200, 150 + FAR / 2], [200, 150 + FAR]]);
    expect(s.phase).toBe("pulling");
    expect(s.distance).toBeGreaterThanOrEqual(PULL_THRESHOLD);
    expect(prevented.every(Boolean)).toBe(true);
    expect(pullEnd(s)).toBe(true);
  });

  it("doesn't reload when let go short of the threshold", () => {
    const { s } = drag(true, [200, 150], [[200, 170], [200, 150 + FAR / 2]]);
    expect(s.phase).toBe("pulling");
    expect(pullEnd(s)).toBe(false);
  });

  it("doesn't reload when the touch is cancelled (a call, a system gesture)", () => {
    const { s } = drag(true, [200, 150], [[200, 160], [200, 150 + FAR]]);
    expect(pullEnd(s, true)).toBe(false);
  });

  it("never starts when the touch wasn't eligible (page not at the top, in a dialog, two fingers)", () => {
    const { s, prevented } = drag(false, [200, 150], [[200, 160], [200, 150 + FAR]]);
    expect(s.phase).toBe("ignored");
    expect(prevented.some(Boolean)).toBe(false);
    expect(pullEnd(s)).toBe(false);
  });

  it("leaves a sideways swipe to the page, even if it turns downward later", () => {
    const { s, prevented } = drag(true, [200, 150], [[200 + PULL_SLOP + 4, 152], [220, 150 + FAR]]);
    expect(s.phase).toBe("ignored");
    expect(prevented.some(Boolean)).toBe(false);
    expect(pullEnd(s)).toBe(false);
  });

  it("leaves an upward drag (an ordinary scroll) alone", () => {
    const { s, prevented } = drag(true, [200, 400], [[200, 380], [200, 400 + FAR]]);
    expect(s.phase).toBe("ignored");
    expect(prevented.some(Boolean)).toBe(false);
  });

  it("doesn't decide inside the slop: tiny wobbles stay pending and unclaimed", () => {
    const { s, prevented } = drag(true, [200, 150], [[202, 153], [199, 155]]);
    expect(s.phase).toBe("pending");
    expect(prevented).toEqual([false, false]);
    expect(pullEnd(s)).toBe(false);
  });

  it("gives up when the page has moved off the top by the time the direction is known", () => {
    const { s } = drag(true, [200, 150], [[200, 170]], false);
    expect(s.phase).toBe("ignored");
  });

  it("dragging back above the start lets the page scroll and cancels the reload", () => {
    const { s, prevented } = drag(true, [200, 150], [[200, 150 + FAR], [200, 140]]);
    expect(s.phase).toBe("ignored");
    expect(s.distance).toBe(0);
    expect(prevented).toEqual([true, false]);
    expect(pullEnd(s)).toBe(false);
  });

  it("stays cancelled for the rest of the touch: coming back down after backing out doesn't reload", () => {
    const { s, prevented } = drag(true, [200, 150], [[200, 150 + FAR], [200, 140], [200, 150 + FAR]]);
    expect(s.phase).toBe("ignored");
    expect(prevented).toEqual([true, false, false]);
    expect(pullEnd(s)).toBe(false);
  });

  it("follows the finger with resistance, capped at the max", () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(40)).toBe(40 * PULL_RESISTANCE);
    expect(pullDistance(5000)).toBe(PULL_MAX);
    expect(PULL_MAX).toBeGreaterThan(PULL_THRESHOLD);
  });

  it("an idle state stays idle", () => {
    expect(pullMove(IDLE, 0, 500, true)).toEqual({ state: IDLE, prevent: false });
    expect(pullEnd(IDLE)).toBe(false);
  });
});

describe("pullBlocked", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });
  const shownBox = () => vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 300, height: 200 } as DOMRect);

  it("lets a pull start on the page itself", () => {
    document.body.innerHTML = `<main><section><p id="t">text</p></section></main>`;
    expect(pullBlocked(document.getElementById("t"))).toBe(false);
  });

  it("blocks inside dialogs, menus, listboxes and data-no-pull", () => {
    for (const wrap of ['role="dialog"', 'role="alertdialog"', 'role="menu"', 'role="listbox"', "data-no-pull"]) {
      document.body.innerHTML = `<div ${wrap}><button id="t">x</button></div>`;
      expect(pullBlocked(document.getElementById("t")), wrap).toBe(true);
    }
  });

  it("blocks everywhere while a modal is shown over the page", () => {
    shownBox();
    document.body.innerHTML = `<div aria-modal="true">sheet</div><main><p id="t">under it</p></main>`;
    expect(pullBlocked(document.getElementById("t"))).toBe(true);
  });

  it("ignores a modal left in the page but hidden", () => {
    document.body.innerHTML = `<div aria-modal="true" style="display:none">closed</div><main><p id="t">page</p></main>`;
    expect(pullBlocked(document.getElementById("t"))).toBe(false);
  });

  it("blocks inside an inner vertical scroller that has something to scroll", () => {
    document.body.innerHTML = `<div id="list" style="overflow-y:auto"><p id="t">row</p></div>`;
    const list = document.getElementById("list")!;
    Object.defineProperty(list, "scrollHeight", { value: 900 });
    Object.defineProperty(list, "clientHeight", { value: 300 });
    expect(pullBlocked(document.getElementById("t"))).toBe(true);
  });

  it("doesn't block in a horizontal strip or a box with nothing to scroll", () => {
    document.body.innerHTML = `<div id="strip" style="overflow-x:auto"><p id="t">chip</p></div>`;
    const strip = document.getElementById("strip")!;
    Object.defineProperty(strip, "scrollHeight", { value: 900 });
    Object.defineProperty(strip, "clientHeight", { value: 300 });
    expect(pullBlocked(document.getElementById("t"))).toBe(false);
  });
});

describe("pullToRefreshEnabled", () => {
  const real = window.matchMedia;
  afterEach(() => {
    window.matchMedia = real;
    Object.defineProperty(navigator, "standalone", { value: undefined, configurable: true });
    localStorage.clear();
  });
  const media = (on: string[]) => {
    window.matchMedia = ((q: string) => ({ matches: on.some((m) => q.includes(m)), media: q })) as unknown as typeof window.matchMedia;
  };
  const PHONE = ["pointer: coarse", "max-width: 1024px"];

  it("is on in the installed app on a phone", () => {
    media(["display-mode: standalone", ...PHONE]);
    expect(pullToRefreshEnabled()).toBe(true);
  });

  it("is on in iOS's home-screen app (navigator.standalone)", () => {
    media(PHONE);
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    expect(pullToRefreshEnabled()).toBe(true);
  });

  it("is off in a phone browser tab, which has its own pull-to-refresh", () => {
    media(PHONE);
    expect(pullToRefreshEnabled()).toBe(false);
  });

  it("is off on desktop, installed or not", () => {
    media(["display-mode: standalone", "max-width: 1024px"]); // a fine pointer
    expect(pullToRefreshEnabled()).toBe(false);
    media(["display-mode: standalone", "pointer: coarse"]); // a wide touch screen
    expect(pullToRefreshEnabled()).toBe(false);
  });

  it("the screenshot opt-in turns it on in a tab, still phones only", () => {
    localStorage.setItem(PULL_DEMO_KEY, "1");
    media(PHONE);
    expect(pullToRefreshEnabled()).toBe(true);
    media([]);
    expect(pullToRefreshEnabled()).toBe(false);
  });
});
