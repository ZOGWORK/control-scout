// @vitest-environment jsdom
// The phone action bar shows once the page header has scrolled away. That flag flips mid-scroll, so the
// bar watches the marker itself: as the page's own state, each flip re-rendered the whole page (on a big
// event, every match row) in the middle of the scroll.
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../lib/consent", () => ({ useConsent: () => ({ decided: true }) }));
const { StickyActions } = await import("./StickyActions");

let fire: ((isIntersecting: boolean, top: number) => void) | null = null;
class FakeIO {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) { fire = (isIntersecting, top) => this.cb([{ isIntersecting, target: el, boundingClientRect: { top } } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  disconnect() { fire = null; }
  unobserve() {}
  takeRecords() { return []; }
}
beforeEach(() => { vi.stubGlobal("IntersectionObserver", FakeIO); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the bar once the header has scrolled past, without re-rendering the page", () => {
  let renders = 0;
  function Page() {
    renders++;
    const [end, setEnd] = useState<HTMLDivElement | null>(null);
    return <><div ref={setEnd} /><StickyActions after={end} label="Page actions"><button>Act</button></StickyActions></>;
  }
  render(<Page />);
  const bar = screen.getByRole("region", { name: "Page actions", hidden: true });
  expect(bar.hasAttribute("inert")).toBe(true);
  const settled = renders;
  act(() => fire!(false, -40));
  expect(bar.hasAttribute("inert")).toBe(false);
  act(() => fire!(true, 200));
  expect(bar.hasAttribute("inert")).toBe(true);
  // Below the screen and not reached yet is not "scrolled past".
  act(() => fire!(false, 5000));
  expect(bar.hasAttribute("inert")).toBe(true);
  expect(renders).toBe(settled);
});
