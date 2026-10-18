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
const toastErr = vi.fn(), toastOk = vi.fn();

vi.mock("../lib/packs", async (orig) => ({ ...(await orig<typeof import("../lib/packs")>()), fetchManifest: async () => MANIFEST, packStatus: () => null, syncLite: async () => null }));
vi.mock("../lib/offline/seasons", () => ({
  useSavedSeasons: () => saved,
  saveSeason: async (f: PackFile, _m: PackManifest, onProgress?: (d: number, t: number) => void) => {
    order.push(f.seasons[0]);
    onProgress?.(5, 10);
    await Promise.resolve();
    if (f.seasons[0] === failSeason) throw new Error("network");
    return { season: f.seasons[0] };
  },
  removeSeason: async () => {},
}));
vi.mock("../components/ui/sonner", () => ({ toast: Object.assign(vi.fn(), { success: (...a: unknown[]) => toastOk(...a), error: (...a: unknown[]) => toastErr(...a) }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));

const { default: DownloadPage } = await import("./DownloadPage");
const mount = () => render(<MemoryRouter><DownloadPage /></MemoryRouter>);
const sv = (season: number, sha: string) => ({ season, sha256: sha, version: "2026-09-01.1", bytes: 9_000_000, savedAt: 1 }) as unknown as SavedSeason;

beforeEach(() => { saved = []; order.length = 0; failSeason = null; toastErr.mockClear(); toastOk.mockClear(); });
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
});
