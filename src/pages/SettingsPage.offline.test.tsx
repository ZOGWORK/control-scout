// @vitest-environment jsdom
// Settings › Offline data: the pack row's button names the page it opens, the Offline page (it was "Download").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "../shared/personal";
import { TooltipProvider } from "../components/ui/overlay";
import { PACK_META_KEY } from "../lib/packPolicy";

const h = vi.hoisted(() => ({ personal: {} as Record<string, unknown> }));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));

const { default: SettingsPage } = await import("./SettingsPage");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "offline in tests" }), { status: 500 })));
  localStorage.clear();
  h.personal = { user: null, providers: { email: true, google: false }, sync: "local", state: { ...EMPTY_STATE, settings: DEFAULT_SETTINGS }, update: vi.fn(), set: vi.fn(), refreshUser: vi.fn(async () => {}) };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe("Settings: offline pack", () => {
  it("with a pack saved, the button says Open Offline and goes to the Offline page", () => {
    localStorage.setItem(PACK_META_KEY, JSON.stringify({ version: "2026-11-13.1", bytes: 2_400_000, savedAt: Date.now() }));
    render(<TooltipProvider><MemoryRouter initialEntries={["/settings?section=offline"]}><SettingsPage /></MemoryRouter></TooltipProvider>);
    const link = screen.getByRole("link", { name: /Open Offline/ });
    expect(link.getAttribute("href")).toBe("/download");
    expect(screen.queryByText(/Open Download/)).toBeNull();
  });
});
