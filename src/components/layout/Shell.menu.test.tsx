// @vitest-environment jsdom
// The phone's menu: the top-left button opens the sheet with every page, and the sheet hands focus back to that
// button on every way it closes: Escape, its Close button, and a link inside it (the page changes, the keyboard
// user's place stays). The bottom tab bar is the pages this device picked (src/lib/tabBar.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TAB_KEY } from "../../lib/tabBar";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null }, syncReady: false }) }));
vi.mock("./Search", () => ({ GlobalSearch: () => null }));
vi.mock("./AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("./TopBarExtras", () => ({ ClockWeather: () => null, ThemeToggle: () => null }));
vi.mock("./InboxBell", () => ({ InboxBell: () => null }));
vi.mock("./Ambient", () => ({ Ambient: () => null }));
vi.mock("./SiteFooter", () => ({ SiteFooter: () => null }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { Shell } = await import("./Shell");

let where = "";
function Where() { const l = useLocation(); where = l.pathname; return null; }

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("EventSource", undefined);
  localStorage.clear();
  where = "";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const shell = () => render(<MemoryRouter initialEntries={["/"]}><Shell><Routes><Route path="*" element={<Where />} /></Routes></Shell></MemoryRouter>);

const menuButton = () => screen.getByRole("button", { name: "Open menu" });

/** Open the sheet the way a keyboard does: focus the menu button, then press it. */
async function openMenu() {
  const more = menuButton();
  act(() => more.focus());
  fireEvent.click(more);
  return { more, sheet: await screen.findByRole("dialog") };
}

describe("the menu sheet's focus", () => {
  it("Escape returns focus to the menu button, every time", async () => {
    shell();
    for (let i = 0; i < 2; i++) {
      const { more, sheet } = await openMenu();
      await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(more);
    }
  });

  it("the Close button returns focus to the menu button", async () => {
    shell();
    const { more, sheet } = await openMenu();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(more);
  });

  it("a link in the sheet changes the page and returns focus to the menu button", async () => {
    shell();
    const { more, sheet } = await openMenu();
    fireEvent.click(within(sheet).getByRole("link", { name: "Rankings" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(where).toBe("/rankings");
    expect(document.activeElement).toBe(more);
  });

  it("opened by a tap that leaves focus on the page (Safari), Escape still lands on the menu button", async () => {
    shell();
    const more = menuButton();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(more);
    const sheet = await screen.findByRole("dialog");
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(more);
  });

  // The sheet closes as What's new opens, taking the row that opened it along: closing What's new lands on the menu button.
  it.each(["keyboard", "tap"])("What's new from the sheet (%s) returns focus to the menu button when it closes", async (how) => {
    shell();
    const more = menuButton();
    if (how === "keyboard") act(() => more.focus()); else (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(more);
    const sheet = await screen.findByRole("dialog");
    const row = within(sheet).getByRole("button", { name: /What's new/ });
    if (how === "keyboard") act(() => row.focus());
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog", { name: /What's new/ });
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more));
  });
});

describe("the phone's top bar and tab bar", () => {
  // The bottom bar: the "Main" navigation outside the sidebar.
  const tabBar = () => screen.getAllByRole("navigation", { name: "Main" }).find((n) => !n.closest("aside"))!;
  const tabNames = () => within(tabBar()).getAllByRole("link").map((l) => l.textContent);

  it("the menu button sits in the top bar, says whether the sheet is open, and the sheet holds every page", async () => {
    shell();
    const button = menuButton();
    expect(button.closest("header")).toBe(screen.getByRole("banner"));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const { sheet } = await openMenu();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    for (const name of ["Home", "Events", "Teams", "Rankings", "Predict", "Compare", "Shortlist", "Scout", "Settings"]) expect(within(sheet).getByRole("link", { name })).toBeTruthy();
  });

  it("the logo in the top bar goes home", () => {
    shell();
    const home = within(screen.getByRole("banner")).getByRole("link", { name: "Control Scout home" });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("by default: Home, Events, Predict, My team, Scout, with no More tab", () => {
    shell();
    expect(tabNames()).toEqual(["Home", "Events", "Predict", "My team", "Scout"]);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("follows this device's saved choice, and a change made while open", () => {
    localStorage.setItem(TAB_KEY, JSON.stringify(["scout", "rankings", "settings"]));
    shell();
    expect(tabNames()).toEqual(["Scout", "Rankings", "Settings"]);
    act(() => {
      localStorage.setItem(TAB_KEY, JSON.stringify(["teams", "myTeam"]));
      window.dispatchEvent(new StorageEvent("storage", { key: TAB_KEY }));
    });
    expect(tabNames()).toEqual(["Teams", "My team"]);
  });
});
