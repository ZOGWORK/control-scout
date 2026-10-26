// @vitest-environment jsdom
// The phone's menu: the top-left button opens the sheet with every page, and the sheet hands focus back to that
// button on every way it closes: Escape, its Close button, and a link inside it (the page changes, the keyboard
// user's place stays). The bottom tab bar is the pages this device picked (src/lib/tabBar.ts). The account controls
// sit at the foot of the sidebar and of the sheet (Control Point's footer), never in the top bar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TAB_KEY } from "../../lib/tabBar";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const personal = vi.hoisted(() => ({ user: null as null | { id: number; email: string; displayName: string | null; createdAt: string }, sync: "local", offlineAccount: false, signOut: vi.fn(async () => {}) }));
vi.mock("../../lib/personal", () => ({ SIGNED_IN: "cs-signed-in", usePersonal: () => ({ ...personal, providers: {}, state: { myTeam: null }, syncReady: false }) }));
vi.mock("./Search", () => ({ GlobalSearch: () => null }));
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
  personal.user = null;
  personal.sync = "local";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const shell = (at = "/") => render(<MemoryRouter initialEntries={[at]}><Shell><Routes><Route path="*" element={<Where />} /></Routes></Shell></MemoryRouter>);

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
    const pages = within(sheet).getByRole("navigation", { name: "All pages" });
    for (const name of ["Home", "Events", "Teams", "Rankings", "Power rankings", "Predict", "Compare", "Shortlist", "Scout", "Download", "How it works", "Settings"]) expect(within(pages).getByRole("link", { name })).toBeTruthy();
  });

  it("the logo in the top bar goes home", () => {
    shell();
    const home = within(screen.getByRole("banner")).getByRole("link", { name: "Control Scout home" });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("by default: Home, Events, Predict, My team, Scout, with no More tab", () => {
    shell();
    expect(tabNames()).toEqual(["Home", "Events", "Predict", "My team", "Scout"]);
    expect(within(tabBar()).queryByRole("button", { name: "More" })).toBeNull();
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

describe("the desktop sidebar", () => {
  const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });
  const moreButton = () => within(sidebar()).getByRole("button", { name: "More" });
  // The group its toggle controls (looked up by id: a hidden element has no role to query by).
  const morePages = () => document.getElementById(moreButton().getAttribute("aria-controls")!)!;
  const wide = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("min-width: 1280px"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

  it("shows only the everyday pages and folds the rest under More, which says whether it is open", () => {
    wide(true);
    shell();
    const nav = within(sidebar()).getByRole("navigation", { name: "Main" });
    const always = ["Home", "Events", "Teams", "Rankings", "Predict", "My team", "Scout"];
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(always);
    const more = moreButton();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(morePages().hidden).toBe(true);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(morePages().hidden).toBe(false);
    for (const name of ["Power rankings", "Compare", "Shortlist", "Download", "How it works", "Settings"]) expect(within(morePages()).getByRole("link", { name })).toBeTruthy();
    expect(localStorage.getItem("cs-nav-more")).toBe("1");
  });

  it("Escape inside the open More group folds it and returns focus to its toggle", () => {
    wide(true);
    shell();
    fireEvent.click(moreButton());
    const settings = within(morePages()).getByRole("link", { name: "Settings" });
    act(() => settings.focus());
    fireEvent.keyDown(settings, { key: "Escape" });
    expect(moreButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(moreButton());
    expect(localStorage.getItem("cs-nav-more")).toBe("0");
  });

  it("closed by hand on one of its pages, opens again on the way to another of them", async () => {
    wide(true);
    shell("/settings");
    fireEvent.click(moreButton());
    expect(moreButton().getAttribute("aria-expanded")).toBe("false");
    // A link to another of its pages from elsewhere (the folded group's own row stands in for it).
    fireEvent.click(within(morePages()).getByRole("link", { name: "Download", hidden: true }));
    await waitFor(() => expect(where).toBe("/download"));
    expect(moreButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("opens More by itself on one of its pages, so the lit row shows", () => {
    wide(true);
    shell("/settings");
    expect(moreButton().getAttribute("aria-expanded")).toBe("true");
    expect(within(morePages()).getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  });

  it("is an icon rail under 1280 px whose rows keep their names, and its button opens the labelled menu", async () => {
    wide(false);
    shell();
    expect(within(sidebar()).queryByText("Control Scout")).toBeNull();
    // Styled as a rail row (a tooltip trigger once turned NavLink's className function into text).
    expect(within(sidebar()).getByRole("link", { name: "Rankings" }).className).toContain("justify-center");
    expect(within(sidebar()).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    const open = within(sidebar()).getByRole("button", { name: "Show page names" });
    act(() => open.focus());
    fireEvent.click(open);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("link", { name: "How it works" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(open);
  });

  it("folds in and out by hand on a wide screen, remembered", () => {
    wide(true);
    shell();
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Collapse sidebar" }));
    expect(localStorage.getItem("cs-sidebar")).toBe("1");
    expect(within(sidebar()).getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });
});

describe("the account footer", () => {
  const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });
  const wide = () => vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const signIn = (sync = "synced") => { personal.user = { id: 7, email: "sushil@example.test", displayName: "Sushil", createdAt: "2026-01-01" }; personal.sync = sync; };

  it("the top bar has no account button or Sign in, signed in or out", () => {
    shell();
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: /Sign in|Account/ })).toBeNull();
    cleanup();
    signIn();
    shell();
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: /Sign in|Account/ })).toBeNull();
  });

  it("signed out: a Sign in button that opens the sign-in panel, and Settings", () => {
    wide();
    shell();
    const signInButton = within(sidebar()).getByRole("button", { name: "Sign in" });
    expect(within(sidebar()).getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(within(sidebar()).queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.click(signInButton);
    expect(signInButton.getAttribute("aria-expanded")).toBe("true");
    expect(within(sidebar()).getByRole("region", { name: "Sign in" })).toBeTruthy();
  });

  it("signed in: name, Online, Settings and Sign out; the avatar opens the account panel and Escape closes it", async () => {
    wide();
    signIn();
    shell();
    const account = within(sidebar()).getByRole("button", { name: "Account: Sushil" });
    expect(account.textContent).toContain("Sushil");
    expect(account.textContent).toContain("Online");
    expect(within(sidebar()).getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    act(() => account.focus());
    fireEvent.click(account);
    const panel = within(sidebar()).getByRole("region", { name: "Your account" });
    expect(within(panel).getByRole("link", { name: /Account settings/ })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(within(sidebar()).queryByRole("region", { name: "Your account" })).toBeNull());
    expect(document.activeElement).toBe(account);
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(personal.signOut).toHaveBeenCalled());
  });

  it("never says Online while sync is offline", () => {
    wide();
    signIn("offline");
    shell();
    const account = within(sidebar()).getByRole("button", { name: "Account: Sushil" });
    expect(account.textContent).toContain("Offline");
    expect(account.textContent).not.toContain("Online");
  });

  it("the phone's menu sheet has the same footer", async () => {
    signIn();
    shell();
    const { sheet } = await openMenu();
    expect(within(sheet).getByRole("button", { name: "Account: Sushil" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("Escape in the sheet's account panel closes the panel, not the sheet", async () => {
    signIn();
    shell();
    const { sheet } = await openMenu();
    const account = within(sheet).getByRole("button", { name: "Account: Sushil" });
    act(() => account.focus());
    fireEvent.click(account);
    expect(within(sheet).getByRole("region", { name: "Your account" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(within(sheet).queryByRole("region", { name: "Your account" })).toBeNull());
    expect(screen.getByRole("dialog")).toBe(sheet);
  });
});
