// @vitest-environment jsdom
// Settings › Network & offline (/settings#network): the status sentence for each connection state, Check again, the
// Lite advice, what's downloaded, each choice saying what it does before it's picked, and the settings written to the
// same personal fields as before (offlineNetwork / offlineUpdates).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "../../shared/personal";
import { DEMO_KEY, checkInternet, resetConnection } from "../../lib/connection";
import { writeSaved } from "../../lib/offline/saved";
import { TooltipProvider } from "../ui/overlay";

const h = vi.hoisted(() => ({ personal: {} as Record<string, unknown>, settings: {} as Record<string, unknown> }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../../lib/offline/appCache", () => ({ planAppCache: async () => ({ items: [], bytes: 2_500_000 }), clearAppCache: async () => 2_500_000 }));

const { default: SettingsPage } = await import("../../pages/SettingsPage");

const health = (body: unknown) => vi.fn(async (url: string) => url === "/api/health" ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 404 }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  resetConnection();
  h.settings = { ...DEFAULT_SETTINGS };
  const update = vi.fn((key: string, f: (x: unknown) => unknown) => { if (key === "settings") h.settings = f(h.settings) as Record<string, unknown>; });
  h.personal = { user: null, providers: { email: true, google: false }, sync: "local", get state() { return { ...EMPTY_STATE, settings: h.settings }; }, update, set: vi.fn(), refreshUser: vi.fn(async () => {}) };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetConnection(); });

const show = (at = "/settings#network") => render(<TooltipProvider><MemoryRouter initialEntries={[at]}><SettingsPage /></MemoryRouter></TooltipProvider>);
const status = () => document.querySelector("[data-net-status]")!;

describe("Network & offline: the status", () => {
  it("online: says so, when it was checked, and that the full app is best", async () => {
    vi.stubGlobal("fetch", health({ ok: true }));
    await act(async () => { await checkInternet(); });
    show();
    expect(screen.getByRole("heading", { name: "You're online" })).toBeTruthy();
    expect(status().textContent).toMatch(/Checked just now/);
    expect(document.querySelector("[data-net-advice]")!.textContent).toBe("Your connection is fine: the full app is best.");
  });

  it("offline: says so, and that downloads work while Lite needs a connection", () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    localStorage.setItem(DEMO_KEY, "offline");
    show();
    expect(screen.getByRole("heading", { name: "You're offline" })).toBeTruthy();
    expect(document.querySelector("[data-net-type]")!.textContent).toBe("None");
    expect(document.querySelector("[data-net-advice]")!.textContent).toBe("You're offline: your downloaded packs work; Lite needs a connection.");
    expect(screen.getByText("Needs a connection to switch.")).toBeTruthy();
  });

  it("a Wi-Fi sign-in page: says the Wi-Fi isn't giving internet", () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    localStorage.setItem(DEMO_KEY, "portal");
    show();
    expect(screen.getByRole("heading", { name: "This Wi-Fi isn't giving internet (it may need a sign-in page)" })).toBeTruthy();
  });

  it("Check again asks the server, and the sentence follows the answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await act(async () => { await checkInternet(); });
    show();
    expect(screen.getByRole("heading", { name: "You're offline" })).toBeTruthy();
    vi.stubGlobal("fetch", health({ ok: true }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Check again/ })); });
    expect(await screen.findByRole("heading", { name: "You're online" })).toBeTruthy();
  });

  it("the old Offline data addresses open it too", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    show("/settings?section=offline");
    expect(document.querySelector("[data-network-section]")).toBeTruthy();
    cleanup();
    show("/settings#offline");
    expect(document.querySelector("[data-network-section]")).toBeTruthy();
  });
});

describe("Network & offline: downloads and controls", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); })); });

  it("lists what's downloaded with its size, and links to the Download page", () => {
    writeSaved([{ season: 2025, version: "v", sha256: "s", bytes: 41_900_000, savedAt: Date.now(), dataAsOf: "2026-11-12T20:09:00Z", builtAt: "2026-11-12T21:00:00Z" }]);
    show();
    const list = screen.getByRole("list", { name: "Downloads on this device" });
    expect(within(list).getByText("2025–26 season")).toBeTruthy();
    expect(within(list).getByText("41.9 MB")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Manage downloads/ })[0].getAttribute("href")).toBe("/download");
  });

  it("every choice says what it does before it's picked, and writes the same settings as before", () => {
    show();
    const downloads = screen.getByRole("radiogroup", { name: "Downloads" });
    const mobile = within(downloads).getByRole("radio", { name: /Wi-Fi and mobile data/ });
    expect(mobile.getAttribute("aria-checked")).toBe("false");
    expect(mobile.textContent).toMatch(/Mobile data counts against your plan/);
    fireEvent.click(mobile);
    expect(h.settings.offlineNetwork).toBe("any");
    const updates = screen.getByRole("radiogroup", { name: "Updates" });
    const never = within(updates).getByRole("radio", { name: /Never update automatically/ });
    expect(never.textContent).toMatch(/nothing downloads until you tap Update/);
    fireEvent.click(never);
    expect(h.settings.offlineUpdates).toBe("ask");
  });

  it("Clear cache says how much it will free, then how much it freed", async () => {
    show();
    const button = await screen.findByRole("button", { name: /Clear 2\.5 MB/ });
    await act(async () => { fireEvent.click(button); });
    expect(await screen.findByText(/Freed 2\.5 MB/)).toBeTruthy();
  });
});
