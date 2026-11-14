// @vitest-environment jsdom
// The Download page's seasons: one list (updates, then saved, then not saved), with Download all saving
// every unsaved season and Update all every outdated one, one at a time, carrying on past a failure.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PackFile, PackManifest } from "../lib/packs";
import type { SavedSeason } from "../lib/offline/seasons";

const file = (season: number, sha: string): PackFile => ({ name: `full-${season}.db`, url: `/packs/full-${season}.db`, bytes: 10_000_000, sha256: sha, seasons: [season], kind: "full", contents: "" });
const MANIFEST: PackManifest = { format: 1, version: "2026-10-17.2", builtAt: "2026-10-17T00:00:00Z", engineVersion: "2.1.1", dataAsOf: null, lite: null, full: [file(2026, "a"), file(2025, "b"), file(2024, "c"), file(2023, "d")] };
let saved: SavedSeason[] = [];
const order: number[] = [];
let failSeason: number | null = null;
// While set, each save waits here until the test lets it finish.
let gate: Promise<void> | null = null;
const toastErr = vi.fn(), toastOk = vi.fn();

vi.mock("../lib/packs", async (orig) => ({ ...(await orig<typeof import("../lib/packs")>()), fetchManifest: async () => MANIFEST, packStatus: () => null, syncLite: async () => null }));
vi.mock("../lib/offline/seasons", () => ({
  useSavedSeasons: () => saved,
  saveSeason: async (f: PackFile, _m: PackManifest, onProgress?: (d: number, t: number) => void) => {
    order.push(f.seasons[0]);
    onProgress?.(5, 10);
    if (gate) await gate;
    await Promise.resolve();
    if (f.seasons[0] === failSeason) throw new Error("network");
    return { season: f.seasons[0] };
  },
  removeSeason: async () => {},
  SeasonGone: class extends Error {},
}));
vi.mock("../components/ui/sonner", () => ({ toast: Object.assign(vi.fn(), { success: (...a: unknown[]) => toastOk(...a), error: (...a: unknown[]) => toastErr(...a) }) }));
// The update settings read personal state: the defaults (ask first, Wi-Fi only), no account.
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { settings: {} }, update: vi.fn() }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));

const { default: DownloadPage, seasonSpan } = await import("./DownloadPage");
const { resetSeasonBatch, runSeasonBatch } = await import("../lib/offline/seasonBatch");
const { TooltipProvider } = await import("../components/ui/overlay");
const mount = (url = "/download?pick=season") => render(<MemoryRouter initialEntries={[url]}><TooltipProvider><DownloadPage /></TooltipProvider></MemoryRouter>);
const sv = (season: number, sha: string) => ({ season, sha256: sha, version: "2026-09-01.1", bytes: 9_000_000, savedAt: 1 }) as unknown as SavedSeason;

beforeEach(() => { saved = []; order.length = 0; failSeason = null; gate = null; resetSeasonBatch(); toastErr.mockClear(); toastOk.mockClear(); });
afterEach(cleanup);

describe("Download page seasons", () => {
  it("lists updates first, then saved, then not saved, and counts them", async () => {
    saved = [sv(2024, "old"), sv(2023, "d")];
    mount();
    const rows = within(await screen.findByRole("list", { name: "Seasons" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent?.slice(0, 7))).toEqual(["2024–25", "2023–24", "2026–27", "2025–26"]);
    expect(screen.getByText("Update available")).toBeTruthy();
    expect(screen.getByText(/1 update available/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Update all \(1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download all · 20\.0 MB/ })).toBeTruthy();
  });

  it("gives each season the pack's version, and its full SHA-256 on a tap", async () => {
    mount();
    const rows = within(await screen.findByRole("list", { name: "Seasons" })).getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Version 2026-10-17.2");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "SHA-256 a" }));
    expect((await screen.findAllByText("SHA-256 a")).length).toBeGreaterThan(0);
  });

  it("Download all saves every unsaved season, one at a time, newest first", async () => {
    saved = [sv(2023, "d")];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Download all/ }));
    await waitFor(() => expect(toastOk).toHaveBeenCalled());
    expect(order).toEqual([2026, 2025, 2024]);
    expect(toastOk.mock.calls[0][0]).toBe("Download all: 3 seasons saved on this device");
  });

  it("Update all saves only the outdated ones, and carries on past a failure", async () => {
    saved = [sv(2026, "old"), sv(2025, "old"), sv(2024, "c")];
    failSeason = 2026;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Update all \(2\)/ }));
    await waitFor(() => expect(toastErr).toHaveBeenCalled());
    expect(order).toEqual([2026, 2025]);
    expect(toastErr.mock.calls[0][0]).toBe("Update all: 1 of 2 saved. Couldn't save 2026–27; try again.");
  });

  it("says when everything is saved and current", async () => {
    saved = [sv(2026, "a"), sv(2025, "b"), sv(2024, "c"), sv(2023, "d")];
    mount();
    expect(await screen.findByText("Every season is saved and current")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download all|Update all/ })).toBeNull();
    await act(async () => {});
  });

  it("keeps Delete off while a run is saving, so a waiting season can't be removed and then saved again", async () => {
    saved = [sv(2026, "old"), sv(2025, "old")];
    let open!: () => void;
    gate = new Promise((r) => { open = r; });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Update all \(2\)/ }));
    await waitFor(() => expect(screen.getByText("Waiting to save…")).toBeTruthy());
    for (const b of screen.getAllByRole("button", { name: /^Delete/ })) expect((b as HTMLButtonElement).disabled).toBe(true);
    open();
    await waitFor(() => expect(toastOk).toHaveBeenCalled());
  });

  it("is one run for the app: leaving and coming back shows its progress, and a second can't start", async () => {
    saved = [];
    let open!: () => void;
    gate = new Promise((r) => { open = r; });
    const first = mount();
    fireEvent.click(await screen.findByRole("button", { name: /Download all/ }));
    await waitFor(() => expect(screen.getByRole("status", { name: "" })).toBeTruthy());
    first.unmount();
    mount();
    expect(await screen.findByText(/Saving 2026–27…/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Download all/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(await runSeasonBatch(MANIFEST.full, MANIFEST)).toBeNull();
    open();
    await waitFor(() => expect(toastOk).toHaveBeenCalled());
    expect(order).toEqual([2026, 2025, 2024, 2023]);
  });
});

describe("the lite pack's seasons", () => {
  it("says the span, one season, or nothing for a pack with none", () => {
    expect(seasonSpan([2023, 2026, 2024])).toBe(", 2023–24 to 2026–27");
    expect(seasonSpan([2025])).toBe(", 2025–26");
    expect(seasonSpan([])).toBe("");
  });
});

describe("the Offline page's layout", () => {
  it("offers three choices, each with its download size", async () => {
    mount("/download");
    const group = await screen.findByRole("radiogroup", { name: "What to save" });
    const radios = within(group).getAllByRole("radio");
    expect(radios[0].textContent).toContain("This event");
    expect(radios[1].textContent).toMatch(/A season.*10\.0 MB/);
    expect(radios[2].textContent).toMatch(/Whole current season.*10\.0 MB/);
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radios[1]);
    expect(await screen.findByRole("list", { name: "Seasons" })).toBeTruthy();
  });

  it("lists a half download as paused (never as saved), and Delete frees it", async () => {
    const { download, partialDownloads } = await import("../lib/offline/download");
    const data = new Uint8Array(4000).fill(7);
    const dying = vi.fn(async () => new Response(new ReadableStream({ n: 0, pull(c) { if ((this as { n: number }).n++) c.error(new TypeError("network")); else c.enqueue(data.slice(0, 1000)); } } as UnderlyingDefaultSource<Uint8Array>)));
    await download({ url: "/packs/x.db.gz", bytes: 4000, sha256: "f".repeat(64) }, { owner: { kind: "season", id: "2026", label: "2026–27 season" }, fetch: dying as unknown as typeof fetch }).catch(() => {});
    mount("/download");
    const row = await screen.findByText(/Paused at 25%/);
    expect(row.textContent).toContain("not saved yet");
    expect(screen.queryByRole("button", { name: "Delete 2026–27 season" })).toBeNull(); // not listed as a saved pack
    fireEvent.click(screen.getByRole("button", { name: "Delete the paused 2026–27 season download" }));
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Freed 1 KB", expect.anything()));
    expect(await partialDownloads()).toEqual([]);
  });

  it("Resume on a paused predictions pack that still can't finish says so (syncLite itself stays quiet)", async () => {
    const { download, finishDownload } = await import("../lib/offline/download");
    const data = new Uint8Array(4000).fill(9);
    const dying = vi.fn(async () => new Response(new ReadableStream({ n: 0, pull(c) { if ((this as { n: number }).n++) c.error(new TypeError("network")); else c.enqueue(data.slice(0, 2000)); } } as UnderlyingDefaultSource<Uint8Array>)));
    await download({ url: "/packs/lite.json.gz", bytes: 4000, sha256: "e".repeat(64) }, { owner: { kind: "lite", id: "lite", label: "Predictions for every team" }, fetch: dying as unknown as typeof fetch }).catch(() => {});
    mount("/download");
    await screen.findByText(/Paused at 50%/);
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("Couldn't finish downloading the predictions pack. Try again in a moment."));
    await finishDownload("e".repeat(64));
  });

  it("every saved pack shows its size and one total; Delete says how much it freed", async () => {
    saved = [sv(2025, "b"), sv(2024, "old")];
    mount("/download");
    const list = await screen.findByRole("list", { name: "Saved on this device" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((li) => li.textContent?.slice(0, 14))).toEqual(["2025–26 season", "2024–25 season"]);
    for (const r of rows) expect(r.textContent).toContain("9.0 MB");
    expect(screen.getByText(/Packs use/).textContent).toBe("Packs use 18.0 MB");
    fireEvent.click(screen.getByRole("button", { name: "Delete 2025–26 season" }));
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Freed 9.0 MB", { description: "2025–26 season deleted from this device." }));
  });
});
