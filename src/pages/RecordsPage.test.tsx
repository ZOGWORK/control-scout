// @vitest-environment jsdom
// The Records views (Team-events, Team seasons, Matches) are links between addresses, not tabs: a nav with
// the current one marked aria-current, each a plain Tab stop (no half-built arrow-key tab model). On a phone
// the strip scrolls sideways, and the current view is scrolled into it on arrival and on every change.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

/** Lay the strip out like a phone: 250px wide (16–266), three 130px links side by side, moved by scrollLeft. */
function phoneLayout() {
  const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON() {} }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const nav = this.closest("nav[aria-label=Records]") as HTMLElement | null;
    if (!nav) return rect(0, 0);
    if (this === nav) return rect(16, 250);
    const i = [...nav.querySelectorAll("a")].indexOf(this as HTMLAnchorElement);
    return rect(20 + i * 134 - nav.scrollLeft, 130);
  });
}

beforeEach(() => { where = ""; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Records views", () => {
  it("are navigation links with the current one marked, never tabs", () => {
    show("/teams?season=2024&country=Canada");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(views().map((a) => a.textContent)).toEqual(["Team-events", "Team seasons", "Matches"]);
    expect(current().map((a) => a.textContent)).toEqual(["Team-events"]);
    // Each a normal Tab stop (links), with no roving tabindex.
    for (const a of views()) expect(a.getAttribute("tabindex")).toBeNull();
    // The other views keep the season (and the atlas's country across the two team views).
    const href = (name: string) => within(strip()).getByRole("link", { name }).getAttribute("href");
    expect(href("Team seasons")).toBe("/teams?season=2024&view=season&country=Canada");
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
    // Matches spans 288–418 against a strip ending at 266: scrolled so it ends 8px inside the strip.
    expect(strip().scrollLeft).toBe(418 - 266 + 8);
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
});
