// @vitest-environment jsdom
// Long lists render only the rows on screen (perf brief 2026-11-01, S2): a 1,000-row standings table and a
// 1,000-match schedule mount a window of rows, not all of them, and still render whole on the server, for
// print, and for find in page.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../../shared/api";

vi.mock("../../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("../MatchVideo", () => ({ useVideoLinkCount: () => 0 }));

const { SortTable } = await import("../SortTable");
const { MatchList } = await import("../predict");
const { TooltipProvider } = await import("./overlay");
const { useVirtualRows } = await import("./windowing");

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

// jsdom has no layout: every windowed row measures ROW_H tall (the virtualizer reads offsetHeight), and the
// window is jsdom's 1024×768. Rows not measured yet count at the table's estimate (37 px).
const ROW_H = 40, TABLE_ESTIMATE = 37;
const VIEW_H = window.innerHeight;
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute("data-index") ? ROW_H : 0; },
  });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});
afterEach(() => {
  cleanup();
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
  else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
});
const scrollPageTo = (y: number) => act(() => {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  fireEvent.scroll(window);
});

type Row = { team: number; name: string; opr: number };
const teams = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ team: i + 1, name: `Team ${i + 1}`, opr: 100 - i / 10 }));
const table = (rows: Row[]) => (
  <SortTable rows={rows} rowKey={(r) => r.team} initial={{ key: "team", dir: "asc" }}
    cols={[{ key: "team", label: "Team", value: (r) => r.team }, { key: "name", label: "Name", value: (r) => r.name }, { key: "opr", label: "OPR", value: (r) => r.opr, align: "right" }]} />
);
const bodyRows = (c: HTMLElement) => [...c.querySelectorAll("tbody tr:not([data-spacer])")];

const side = (ts: number[]) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: null });
const match = (n: number): MatchView => ({
  season: 2025, code: "RPTQ1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null, played: false,
  red: side([11, 12]), blue: side([13, 14]), video: null, prediction: null,
});
const schedule = (n: number) => <MemoryRouter><TooltipProvider><MatchList matches={Array.from({ length: n }, (_, i) => match(i + 1))} /></TooltipProvider></MemoryRouter>;

describe("a 1,000-row standings table", () => {
  it("renders only the visible window, with spacers keeping the full height", () => {
    const { container } = render(table(teams(1000)));
    const n = bodyRows(container).length;
    expect(n).toBeGreaterThanOrEqual(Math.ceil(VIEW_H / ROW_H));
    expect(n).toBeLessThan(60);
    expect(bodyRows(container)[0].textContent).toContain("Team 1");
    const spacer = container.querySelector<HTMLElement>("tbody tr[data-spacer]")!;
    expect(spacer.getAttribute("aria-hidden")).toBe("true");
    expect(parseFloat(spacer.style.height)).toBeGreaterThanOrEqual((1000 - n) * TABLE_ESTIMATE);
    // Screen readers still hear the table's full size and where each row sits in it.
    expect(container.querySelector("table")!.getAttribute("aria-rowcount")).toBe("1001");
    expect(bodyRows(container)[0].getAttribute("aria-rowindex")).toBe("2");
  });

  it("moves the window as the page scrolls", () => {
    const { container } = render(table(teams(1000)));
    scrollPageTo(500 * TABLE_ESTIMATE);
    const shown = bodyRows(container).map((r) => Number(r.children[0].textContent));
    expect(shown).toContain(501);
    expect(shown).not.toContain(1);
    expect(shown.length).toBeLessThan(60);
    // Where each row sits in the whole table (header = row 1).
    expect(bodyRows(container)[0].getAttribute("aria-rowindex")).toBe(String(shown[0] + 1));
  });

  it("a short table renders every row, as before", () => {
    const { container } = render(table(teams(40)));
    expect(bodyRows(container)).toHaveLength(40);
    expect(container.querySelector("[data-spacer]")).toBeNull();
    expect(container.querySelector("table")!.hasAttribute("aria-rowcount")).toBe(false);
  });

  it("renders every row on the server (the first-paint page)", () => {
    const html = renderToStaticMarkup(table(teams(1000)));
    expect(html.match(/<tr/g)).toHaveLength(1001);
  });
});

describe("a 1,000-match schedule", () => {
  it("renders only the visible window", () => {
    const { container } = render(schedule(1000));
    const shown = container.querySelectorAll("[data-match]");
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(60);
    expect(shown[0].textContent).toContain("Q1");
  });

  it("renders every match on the server", () => {
    const html = renderToStaticMarkup(schedule(1000));
    expect(html.match(/data-match="/g)).toHaveLength(1000);
  });
});

describe("every row when it counts", () => {
  it("find in page (Ctrl+F) renders the whole list, so the find bar searches all of it", () => {
    const { container } = render(table(teams(1000)));
    expect(bodyRows(container).length).toBeLessThan(60);
    act(() => { fireEvent.keyDown(window, { key: "f", ctrlKey: true }); });
    expect(bodyRows(container)).toHaveLength(1000);
  });

  it("find next / previous (F3, Ctrl+G, Ctrl+Shift+G) render the whole list too", () => {
    for (const k of [{ key: "F3" }, { key: "g", ctrlKey: true }, { key: "G", ctrlKey: true, shiftKey: true }, { key: "g", metaKey: true, shiftKey: true }]) {
      const { container, unmount } = render(table(teams(1000)));
      act(() => { fireEvent.keyDown(window, k); });
      expect(bodyRows(container)).toHaveLength(1000);
      unmount();
    }
  });

  it("other shortcuts leave the list windowed", () => {
    const { container } = render(table(teams(1000)));
    for (const k of [{ key: "f" }, { key: "F", ctrlKey: true, shiftKey: true }, { key: "f", ctrlKey: true, altKey: true }]) act(() => { fireEvent.keyDown(window, k); });
    expect(bodyRows(container).length).toBeLessThan(60);
  });

  it("printing renders the whole list, then windows again", () => {
    const { container } = render(table(teams(1000)));
    act(() => { window.dispatchEvent(new Event("beforeprint")); });
    expect(bodyRows(container)).toHaveLength(1000);
    act(() => { window.dispatchEvent(new Event("afterprint")); });
    expect(bodyRows(container).length).toBeLessThan(60);
  });
});

describe("keyboard focus", () => {
  function List({ n }: { n: number }) {
    const items = Array.from({ length: n }, (_, i) => `Item ${i + 1}`);
    const vr = useVirtualRows<HTMLUListElement>(n, ROW_H);
    return (
      <ul ref={vr.ref}>
        {vr.rows(items).map(({ item, rowProps, gapBefore }) => (
          <Fragment key={item}>
            {gapBefore > 0 && <li aria-hidden data-gap={gapBefore} />}
            <li {...rowProps}><button type="button">{item}</button></li>
          </Fragment>
        ))}
        {vr.paddingBottom > 0 && <li aria-hidden style={{ height: vr.paddingBottom }} />}
      </ul>
    );
  }

  it("the focused row stays rendered (and focused) when it scrolls out of the window", () => {
    const { getByText, container } = render(<List n={1000} />);
    act(() => { getByText("Item 3").focus(); });
    scrollPageTo(500 * ROW_H);
    expect(document.activeElement).toBe(getByText("Item 3"));
    // With a gap standing in for the rows between it and the window.
    const gap = container.querySelector<HTMLElement>("[data-gap]");
    expect(Number(gap?.dataset.gap)).toBeGreaterThan(400 * ROW_H);
    expect(container.textContent).toContain("Item 501");
    // Its neighbours stay too, so Tab / Shift+Tab from it go to the next and previous rows, not across the gap.
    const names = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(names.slice(0, 3)).toEqual(["Item 2", "Item 3", "Item 4"]);
    expect(names).not.toContain("Item 5");
  });
});

describe("a re-sort while a row has focus (live standings refreshing)", () => {
  function Sorted({ order }: { order: number[] }) {
    const vr = useVirtualRows<HTMLUListElement>(order.length, ROW_H, { key: (i) => order[i] });
    return (
      <ul ref={vr.ref}>
        {vr.rows(order).map(({ item, rowProps, gapBefore }) => (
          <Fragment key={item}>
            {gapBefore > 0 && <li aria-hidden />}
            <li {...rowProps}><button type="button">Team {item}</button></li>
          </Fragment>
        ))}
      </ul>
    );
  }

  it("keeps the focused row, wherever it moves", () => {
    const up = Array.from({ length: 1000 }, (_, i) => i + 1);
    const { getByText, rerender } = render(<Sorted order={up} />);
    act(() => { getByText("Team 3").focus(); });
    // Team 3 drops to the bottom of the order, far outside the window.
    act(() => rerender(<Sorted order={[...up.filter((t) => t !== 3), 3]} />));
    expect(document.activeElement).toBe(getByText("Team 3"));
    expect(getByText("Team 3").closest("li")!.getAttribute("data-index")).toBe("999");
  });
});

describe("coming back to a list", () => {
  function List({ n, cache }: { n: number; cache?: string }) {
    const items = Array.from({ length: n }, (_, i) => `Item ${i + 1}`);
    const vr = useVirtualRows<HTMLUListElement>(n, ROW_H, { cache });
    const shown = vr.rows(items);
    // The list's laid-out height: spacers plus the rows on screen (each really 100 px tall). It starts at the
    // top of the page (jsdom's getBoundingClientRect ignores the scroll).
    return (
      <ul ref={(el) => { vr.ref.current = el; if (el) el.getBoundingClientRect = () => ({ top: -window.scrollY }) as DOMRect; }} data-height={vr.paddingTop + vr.paddingBottom + shown.length * 100}>
        {shown.map(({ item, rowProps }) => <li key={item} {...rowProps}>{item}</li>)}
      </ul>
    );
  }
  // Rows really measure 100 px (more than the 40 px estimate).
  const tall = () => Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true, get(this: HTMLElement) { return this.hasAttribute("data-index") ? 100 : 0; },
  });
  const height = (c: HTMLElement) => Number(c.querySelector("ul")!.getAttribute("data-height"));

  it("places rows it measured before by those heights, not estimates (so Back lands on the same rows)", () => {
    tall();
    // The first visit measures the rows on the first screen (and the overscan), then the reader leaves.
    for (const name of ["test:a", "test:b"]) render(<List n={1000} cache={name} />).unmount();
    const measured = 28; // 768 px / 40 px estimate, plus 8 overscan
    // Back, with the page restored further down: those rows are above the window now.
    scrollPageTo(500 * ROW_H);
    const cached = height(render(<List n={1000} cache="test:a" />).container);
    cleanup();
    const fresh = height(render(<List n={1000} />).container);
    expect(cached - fresh).toBeGreaterThanOrEqual(measured * 60 - 100);
  });
});
