// @vitest-environment jsdom
// The records table's second scrollbar, above the table: there only when the table is wider than its
// box, its thumb sized and placed like the table's view, and dragging it scrolls the table.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TopScrollbar } from "./RecordsTable";

afterEach(cleanup);

const size = (el: HTMLElement | null, w: Record<string, number>) => { if (el) for (const [k, v] of Object.entries(w)) Object.defineProperty(el, k, { configurable: true, value: v }); };
// The track is measured from its own box: jsdom has none, so give every track 400 px.
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get(this: HTMLElement) { return this.hasAttribute("data-records-topbar") ? 400 : 0; } });

function Harness({ inner, outer }: { inner: number; outer: number }) {
  const table = useRef<HTMLTableElement>(null), scroller = useRef<HTMLDivElement>(null);
  return (
    <>
      <TopScrollbar table={table} scroller={scroller} />
      <div data-testid="scroller" ref={(el) => { scroller.current = el; size(el, { clientWidth: outer }); }}>
        <table ref={(el) => { table.current = el; size(el, { scrollWidth: inner }); }}><tbody><tr><td>x</td></tr></tbody></table>
      </div>
    </>
  );
}

const bar = () => document.querySelector<HTMLDivElement>("[data-records-topbar]")!;
const thumb = () => document.querySelector<HTMLDivElement>("[data-records-thumb]")!;

describe("TopScrollbar", () => {
  it("shows above a table wider than its box, the thumb as wide as the share in view", () => {
    render(<Harness inner={2000} outer={800} />);
    expect(bar().classList.contains("invisible")).toBe(false);
    expect(thumb().style.width).toBe("160px"); // 800 / 2000 of the 400 px track
  });

  it("isn't there when the whole table fits", () => {
    render(<Harness inner={800} outer={800} />);
    expect(bar().classList.contains("invisible")).toBe(true);
  });

  it("follows the table's scroll, and dragging it scrolls the table", async () => {
    const { getByTestId } = render(<Harness inner={2000} outer={800} />);
    const table = getByTestId("scroller");
    await act(async () => { table.scrollLeft = 600; table.dispatchEvent(new Event("scroll")); });
    expect(thumb().style.transform).toBe("translateX(120px)"); // halfway: 600 / 1200 of 240 px of travel
    // Drag the thumb 60 px right: a quarter of its 240 px travel, so 300 px of table.
    fireEvent.pointerDown(bar(), { clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(bar(), { clientX: 210, pointerId: 1 });
    expect(table.scrollLeft).toBe(900);
    fireEvent.pointerUp(bar(), { pointerId: 1 });
  });
});
