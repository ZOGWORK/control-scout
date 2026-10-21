// @vitest-environment jsdom
// The Records views (Team-events, Team seasons, All listed, Matches) are links between addresses, not tabs: a nav with
// the current one marked aria-current, each a plain Tab stop (no half-built arrow-key tab model). On a phone
// the strip scrolls sideways, and the current view is scrolled into it on arrival and on every change.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../components/records/RecordsTable", () => ({ RecordsTable: () => null }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2025, usePredictable: () => true, useTitle: () => {} }));

const { default: RecordsPage } = await import("./RecordsPage");

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
const show = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/teams" element={<RecordsPage />} />
      <Route path="/matches" element={<RecordsPage matches />} />
    </Routes>
    <Where />
  </MemoryRouter>,
);
const strip = () => screen.getByRole("navigation", { name: "Records" });
const views = () => within(strip()).getAllByRole("link");
const current = () => within(strip()).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");

/** Lay the strip out like a phone: `stripWidth` wide from 16 (250: 16–266), three 130px links side by side, moved by scrollLeft. */
let stripWidth = 250;
function phoneLayout() {
  const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON() {} }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const nav = this.closest("nav[aria-label=Records]") as HTMLElement | null;
    if (!nav) return rect(0, 0);
    if (this === nav) return rect(16, stripWidth);
    const i = [...nav.querySelectorAll("a")].indexOf(this as HTMLAnchorElement);
    return rect(20 + i * 134 - nav.scrollLeft, 130);
  });
}
/** The strip's ResizeObservers, to fire as a browser would when it changes size. */
let resized: (() => void)[] = [];

beforeEach(() => {
  where = ""; stripWidth = 250; resized = [];
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resized.push(cb); } observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Records views", () => {
  it("are navigation links with the current one marked, never tabs", () => {
    show("/teams?season=2024&country=Canada");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(views().map((a) => a.textContent)).toEqual(["Team-events", "Team seasons", "All listed", "Matches"]);
    expect(current().map((a) => a.textContent)).toEqual(["Team-events"]);
    // Each a normal Tab stop (links), with no roving tabindex.
    for (const a of views()) expect(a.getAttribute("tabindex")).toBeNull();
    // The other views keep the season (and the atlas's country across the two team views).
    const href = (name: string) => within(strip()).getByRole("link", { name }).getAttribute("href");
    expect(href("Team seasons")).toBe("/teams?season=2024&view=season&country=Canada");
    expect(href("All listed")).toBe("/teams?season=2024&view=listed&country=Canada");
    expect(href("Matches")).toBe("/matches?season=2024");
  });

  it("the current view links to itself as it stands, its filters kept", () => {
    show("/matches?season=2024&page=3&sort=highScore");
    const here = within(strip()).getByRole("link", { name: "Matches" });
    expect(here.getAttribute("aria-current")).toBe("page");
    fireEvent.click(here);
    expect(where).toBe("/matches?season=2024&page=3&sort=highScore");
  });

  it("following a view moves aria-current with the page", () => {
    show("/teams");
    fireEvent.click(within(strip()).getByRole("link", { name: "Matches" }));
    expect(where).toBe("/matches");
    expect(current().map((a) => a.textContent)).toEqual(["Matches"]);
  });

  it("scrolls the current view into the strip on arrival (a phone)", () => {
    phoneLayout();
    show("/matches?season=2025");
    // Matches spans 422–552 against a strip ending at 266: scrolled so it ends 8px inside the strip.
    expect(strip().scrollLeft).toBe(552 - 266 + 8);
  });

  it("reveals the current view again when the strip narrows (a phone turned to portrait), without a view change", () => {
    phoneLayout();
    stripWidth = 560; // landscape: everything fits (16–576)
    show("/matches");
    expect(strip().scrollLeft).toBe(0);
    stripWidth = 250; // portrait: Matches (422–552) now runs past the strip's end (266)
    resized.forEach((cb) => cb());
    expect(strip().scrollLeft).toBe(552 - 266 + 8);
    expect(where).toBe("/matches");
  });

  it("leaves the strip alone while the current view shows, and reveals the next one after a change", () => {
    phoneLayout();
    show("/teams");
    expect(strip().scrollLeft).toBe(0);
    const nav = strip();
    fireEvent.click(within(nav).getByRole("link", { name: "Team seasons" }));
    expect(where).toBe("/teams?view=season");
    expect(strip()).toBe(nav); // the same page, a new view
    // Team seasons spans 154–284: scrolled to end 8px inside the strip.
    expect(strip().scrollLeft).toBe(284 - 266 + 8);
  });
  it("glides to the next view after a change, and the web-fonts correction doesn't turn that into a jump", async () => {
    phoneLayout();
    // Fonts long loaded: document.fonts.ready has already resolved.
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
    // A glide is on its way: the strip hasn't moved yet when the next task runs.
    const glide = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, writable: true, value: glide });
    try {
      show("/teams");
      await act(async () => { await Promise.resolve(); });
      fireEvent.click(within(strip()).getByRole("link", { name: "Team seasons" }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(glide).toHaveBeenCalledWith({ left: 284 - 266 + 8, behavior: "smooth" });
      // No instant scrollLeft write cut the glide short.
      expect(strip().scrollLeft).toBe(0);
    } finally {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
      delete (document as { fonts?: unknown }).fonts;
    }
  });
  it("still corrects for the web fonts after a view change made before they loaded, gliding (never a jump)", async () => {
    phoneLayout();
    let loaded!: () => void;
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>((r) => { loaded = r; }) } });
    const glide = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, writable: true, value: glide });
    try {
      show("/teams");
      fireEvent.click(within(strip()).getByRole("link", { name: "Team seasons" }));
      expect(glide).toHaveBeenCalledTimes(1);
      // The fonts arrive mid-glide (the strip hasn't moved yet): the new view is revealed again, gliding.
      await act(async () => { loaded(); await Promise.resolve(); await Promise.resolve(); });
      expect(glide).toHaveBeenCalledTimes(2);
      for (const call of glide.mock.calls) expect(call[0]).toEqual({ left: 284 - 266 + 8, behavior: "smooth" });
      expect(strip().scrollLeft).toBe(0);
    } finally {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
      delete (document as { fonts?: unknown }).fonts;
    }
  });
});
