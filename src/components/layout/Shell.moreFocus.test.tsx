// @vitest-environment jsdom
// The phone's More sheet hands focus back to the More button on every way it closes: Escape, its Close
// button, and a link inside it (the page changes, the keyboard user's place in the tab bar stays).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** Open the sheet the way a keyboard does: focus More, then press it. */
async function openMore() {
  const more = screen.getByRole("button", { name: "More" });
  act(() => more.focus());
  fireEvent.click(more);
  return { more, sheet: await screen.findByRole("dialog") };
}

describe("the More sheet's focus", () => {
  it("Escape returns focus to More, every time", async () => {
    shell();
    for (let i = 0; i < 2; i++) {
      const { more, sheet } = await openMore();
      await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(more);
    }
  });

  it("the Close button returns focus to More", async () => {
    shell();
    const { more, sheet } = await openMore();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(more);
  });

  it("a link in the sheet changes the page and returns focus to More", async () => {
    shell();
    const { more, sheet } = await openMore();
    fireEvent.click(within(sheet).getByRole("link", { name: "Rankings" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(where).toBe("/rankings");
    expect(document.activeElement).toBe(more);
  });
});
