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
const cache = vi.hoisted(() => ({ plan: async (): Promise<unknown> => ({ items: [], bytes: 2_500_000 }) }));
vi.mock("../../lib/recordings", async (orig) => ({ ...(await orig<typeof import("../../lib/recordings")>()), clearRecordings: async () => {} }));
const cleared = vi.hoisted(() => ({ next: async (): Promise<number> => 2_500_000 }));
const flags = vi.hoisted(() => ({ lite: true }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useFlag: (k: string) => (k === "venueLightMode" ? flags.lite : true) }));
vi.mock("../../lib/offline/appCache", () => ({ planAppCache: () => cache.plan(), clearAppCache: () => cleared.next() }));

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

describe("Network & offline: the real sizes", () => {
  it("a pack list that failed to load is asked again on Check again", async () => {
    let listAsks = 0;
    const manifest = { format: 1, version: "v", builtAt: "", engineVersion: "x", dataAsOf: null, full: [],
      lite: { name: "lite.json.gz", url: "/packs/lite.json.gz", bytes: 3_800_000, sha256: "a", seasons: [2025], kind: "lite", contents: "" } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/health") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url === "/packs/latest.json") { listAsks++; return listAsks === 1 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify(manifest), { status: 200 }); }
      return new Response("{}", { status: 404 });
    }));
    await act(async () => { await checkInternet(); });
    show();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(listAsks).toBe(1);
    expect(screen.queryByText(/Offline predictions use/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Check again/ })); });
    expect(await screen.findByText("Offline predictions use 3.8 MB.")).toBeTruthy();
    expect(listAsks).toBe(2);
  });

  it("one Check again after a failure asks for the pack list once", async () => {
    let listAsks = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/health") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url === "/packs/latest.json") { listAsks++; return new Response("busy", { status: 500 }); }
      return new Response("{}", { status: 404 });
    }));
    await act(async () => { await checkInternet(); });
    show();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(listAsks).toBe(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Check again/ })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(listAsks).toBe(2);
  });

  it("packs switched off, or none published: says so to someone online, never \"when you're online\"", async () => {
    for (const [res, words] of [
      [() => new Response(JSON.stringify({ error: "feature_disabled", feature: "offlinePacks", message: "Offline packs are paused right now. Packs already on this device keep working." }), { status: 403 }), "Download sizes aren't available. Offline packs are paused right now. Packs already on this device keep working."],
      [() => new Response("", { status: 404 }), "No downloads have been published yet."],
      [() => new Response("busy", { status: 500 }), "The list of downloads couldn't be read just now. Check again to try once more."],
    ] as [() => Response, string][]) {
      resetConnection();
      vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/health" ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : url === "/packs/latest.json" ? res() : new Response("{}", { status: 404 })));
      await act(async () => { await checkInternet(); });
      show();
      expect((await screen.findByText(words)).hasAttribute("data-net-sizes-missing")).toBe(true);
      expect(screen.queryByText(/when you're online/)).toBeNull();
      cleanup();
    }
  });
});

describe("Network & offline: honest words", () => {
  it("while the first check runs, the Lite row says it's checking; with none, that it needs a connection", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    show();
    expect(document.querySelector("[data-net-lite-wait]")!.textContent).toBe("Checking your connection…");
    cleanup();
    localStorage.setItem(DEMO_KEY, "portal");
    show();
    expect(document.querySelector("[data-net-lite-wait]")!.textContent).toBe("Needs a connection to switch.");
  });

  it("a browser that can't tell Wi-Fi from mobile data (every iPhone) says so instead of promising Wi-Fi only", () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    show(); // jsdom has no navigator.connection, like Safari
    const wifi = within(screen.getByRole("radiogroup", { name: "Downloads" })).getByRole("radio", { name: /Wi-Fi only/ });
    expect(wifi.textContent).toMatch(/This browser can't tell Wi-Fi from mobile data/);
    expect(wifi.textContent).not.toMatch(/Nothing downloads on mobile data/);
    const auto = within(screen.getByRole("radiogroup", { name: "Updates" })).getByRole("radio", { name: /Update packs automatically/ });
    expect(auto.textContent).toMatch(/may include mobile data/);
    cleanup();
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { connection: { type: "wifi" } }));
    show();
    const known = within(screen.getByRole("radiogroup", { name: "Downloads" })).getByRole("radio", { name: /Wi-Fi only/ });
    expect(known.textContent).toMatch(/Nothing downloads on mobile data unless you tap Download yourself/);
  });
});

describe("Network & offline: clear cache when it can't be measured", () => {
  it("says so and leaves Clear usable, never \"Nothing cached\"", async () => {
    const before = cache.plan;
    cache.plan = async () => { throw new DOMException("refused", "UnknownError"); };
    try {
      vi.stubGlobal("fetch", health({ ok: true }));
      show();
      expect(await screen.findByText("Couldn't measure the cache. Clear still works.")).toBeTruthy();
      const button = screen.getByRole("button", { name: /^Clear cache$/ }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(screen.queryByText("Nothing cached")).toBeNull();
      await act(async () => { fireEvent.click(button); });
      expect(await screen.findByText(/Freed 2\.5 MB/)).toBeTruthy();
    } finally { cache.plan = before; }
  });
});

describe("Network & offline: deleting recordings", () => {
  it("measures the site's storage again, so the figure below doesn't look stale", async () => {
    let usage = 50_000_000;
    const estimate = vi.fn(async () => ({ usage, quota: 1_000_000_000 }));
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { storage: { estimate } }));
    vi.stubGlobal("fetch", health({ ok: true }));
    show();
    expect(await screen.findByText(/^50(\.0)? MB of/)).toBeTruthy();
    usage = 10_000_000;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete all recordings" })); });
    expect(await screen.findByText(/^10(\.0)? MB of/)).toBeTruthy();
  });
});

describe("Network & offline: deleting recordings asks first", () => {
  it("one tap only asks; Cancel deletes nothing", async () => {
    const rec = await import("../../lib/recordings");
    const clear = vi.spyOn(rec, "clearRecordings");
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.stubGlobal("fetch", health({ ok: true }));
    show();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete all recordings" })); });
    expect(ask).toHaveBeenCalledWith(expect.stringMatching(/can't be undone/));
    expect(clear).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete all recordings" })); });
    expect(clear).toHaveBeenCalledTimes(1);
    ask.mockRestore(); clear.mockRestore();
  });
});

describe("Network & offline: follow-ups", () => {
  it("a second Clear that fails no longer shows the first one's freed amount", async () => {
    vi.stubGlobal("fetch", health({ ok: true }));
    show();
    const button = await screen.findByRole("button", { name: /Clear 2\.5 MB/ });
    await act(async () => { fireEvent.click(button); });
    expect(await screen.findByText(/Freed 2\.5 MB/)).toBeTruthy();
    const before = cleared.next;
    cleared.next = async () => { throw new Error("Couldn't clear the cache"); };
    try {
      await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /Clear 2\.5 MB/ })); });
      expect(screen.queryByText(/Freed 2\.5 MB/)).toBeNull();
    } finally { cleared.next = before; }
  });

  it("Lite switched off by the owner: the words never offer a Lite switch, even with the old Lite cookie", async () => {
    flags.lite = false;
    document.cookie = "cs-lite=1; path=/";
    try {
      vi.stubGlobal("fetch", health({ ok: true }));
      await act(async () => { await checkInternet(); });
      show();
      expect(document.querySelector("[data-net-advice]")!.textContent).not.toMatch(/Lite off|turn Lite/i);
    } finally { flags.lite = true; document.cookie = "cs-lite=; path=/; max-age=0"; }
  });
});
