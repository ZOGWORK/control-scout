// @vitest-environment jsdom
// Owner Data & sync and Packs & offline on a phone (390 px): sync status per season, every data-quality flag
// with its count and first rows, the full SHA-256 of each pack with a copy button, and the re-sync and rebuild
// both asking before anything starts. Neither screen offers a delete.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { OpsStatus } from "../../shared/owner";
import type { OwnerDataReport, OwnerPacks } from "../../shared/ownerData";

const now = new Date().toISOString();
const DATA: OwnerDataReport = {
  computedAt: now, currentSeason: 2026,
  timestamps: { syncAt: now, statsAt: now, recordsAt: null, packsAt: now },
  seasons: [
    { season: 2026, label: "2026–27", game: "BIOBUZZ", current: true, frozen: false, lastSync: now, lastComplete: null, teamsAt: now, events: 120, eventsDetailed: 40, fallbackEvents: 2, matchesPlayed: 900, lastRun: { listed: 120, detailed: 12, failed: 1, fallback: 0, teams: 0 } },
    { season: 2025, label: "2025–26", game: "DECODE", current: false, frozen: true, lastSync: now, lastComplete: now, teamsAt: null, events: 800, eventsDetailed: 800, fallbackEvents: 0, matchesPlayed: 40000, lastRun: null },
  ],
  flags: [
    { id: "sync-failures", title: "Events the last sync couldn't fetch", description: "d", count: 1, examples: [{ label: "2026 BROKEN", detail: "FIRST 500", href: "/events/2026/BROKEN" }], error: null },
    { id: "ended-no-matches", title: "Ended events with no matches", description: "d", count: 12, examples: [{ label: "2026 EMPTY: Event", detail: "ended", href: "/events/2026/EMPTY" }], error: null },
    { id: "record-mismatch", title: "Season records that don't add up", description: "d", count: 0, examples: [], error: null },
    { id: "season-below-events", title: "Season totals below their events", description: "d", count: 0, examples: [], error: null },
    { id: "sitemap-404", title: "Sitemap URLs that would 404", description: "d", count: 0, examples: [], error: "database busy" },
  ],
};
const SHA = "0123456789abcdef".repeat(4);
const PACKS: OwnerPacks = {
  unavailable: null, serving: true,
  manifest: { format: 1, version: "2026-10-29.2", builtAt: now, engineVersion: "2.11.0", dataAsOf: now },
  files: [
    { name: "scout-pack-2026-10-29-2-lite.json.gz", url: "/packs/x", kind: "lite", season: null, seasons: [2025, 2024], bytes: 1_200_000, sha256: SHA, onDisk: true },
    { name: "scout-pack-2026-10-29-2-2025.db", url: "/packs/y", kind: "full", season: 2025, seasons: [2025], bytes: 30_000_000, sha256: SHA.split("").reverse().join(""), onDisk: false },
  ],
  totalBytes: 31_200_000, versionsOnDisk: ["2026-10-29.2", "2026-10-29.1"], lastBuildAt: now,
};
const OPS: OpsStatus = { jobs: {}, writer: null, cycle: null, unavailable: {} };

const fetched = vi.fn();
const copied = vi.fn();
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string) => ({ data: path === "/api/owner/data" ? DATA : path === "/api/owner/packs" ? PACKS : OPS, error: undefined, loading: false, reload: () => Promise.resolve() }),
  apiFetch: (...a: unknown[]) => { fetched(...a); return new Promise(() => {}); },
}));
vi.mock("../../lib/clipboard", () => ({ copyText: (...a: unknown[]) => { copied(...a); return Promise.resolve(true); } }));
const { DataPanel } = await import("./DataPanel");
const { PacksPanel } = await import("./PacksPanel");

beforeAll(() => { Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 }); });
afterEach(() => { cleanup(); fetched.mockClear(); copied.mockClear(); });

const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("DataPanel", () => {
  it("shows each season's sync, with the current one marked and failed fetches counted", () => {
    renderIn(<DataPanel />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Current")).toBeTruthy();
    expect(within(rows[0]).getByText("Never complete")).toBeTruthy();
    expect(within(rows[0]).getByText("1 failed")).toBeTruthy();
    expect(within(rows[1]).getByText("Frozen")).toBeTruthy();
    // On a phone only Season, Last sync and Events show.
    const heads = screen.getAllByRole("columnheader");
    expect(heads.filter((h) => !h.className.includes("max-sm:hidden")).map((h) => h.textContent)).toEqual(["Season", "Last sync", "Events"]);
  });

  it("lists every flag with its count, its first rows as links, and a failed check as failed", () => {
    renderIn(<DataPanel />);
    const flags = screen.getAllByRole("heading", { level: 3 }).filter((h) => DATA.flags.some((f) => h.textContent?.startsWith(f.title)));
    expect(flags).toHaveLength(5);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByRole("link", { name: "2026 BROKEN" }).getAttribute("href")).toBe("/events/2026/BROKEN");
    expect(screen.getByText("Check failed")).toBeTruthy();
    expect(screen.getByText("database busy")).toBeTruthy();
    expect(screen.getAllByText("None")).toHaveLength(2);
  });

  it("asks before a re-sync, and offers no delete", () => {
    renderIn(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Re-sync now/ }));
    const dialog = screen.getByRole("dialog", { name: "Re-sync now?" });
    expect(dialog.textContent).toMatch(/only ever changes to what FIRST publishes/);
    expect(fetched).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /Yes, re-sync now/ }));
    expect(fetched).toHaveBeenCalledWith("/api/owner/ops/resync", { method: "POST", json: { confirm: true } });
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});

describe("PacksPanel", () => {
  it("shows the manifest facts and every file's size and full SHA-256, wrapping instead of overflowing", () => {
    renderIn(<PacksPanel />);
    expect(screen.getAllByText("2026-10-29.2").length).toBe(2); // the Version tile and the release badge
    expect(screen.getByText("2.11.0")).toBeTruthy();
    const files = within(screen.getByRole("list", { name: "Pack files" })).getAllByRole("listitem");
    expect(files).toHaveLength(2);
    const code = within(files[0]).getByLabelText("SHA-256 of Lite: ratings");
    expect(code.textContent).toBe(SHA);
    expect(code.className).toMatch(/break-all/);
    expect(code.className).toMatch(/min-w-0/);
    expect(within(files[0]).getByText("1.2 MB")).toBeTruthy();
    expect(within(files[1]).getByText("Missing on disk")).toBeTruthy();
    expect(within(files[1]).getByText("2025–26")).toBeTruthy();
  });

  it("copies a SHA-256", () => {
    renderIn(<PacksPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Copy SHA-256 of 2025–26" }));
    expect(copied.mock.calls[0][0]).toBe(PACKS.files[1].sha256);
  });

  it("asks before a rebuild, and has no delete anywhere", () => {
    renderIn(<PacksPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Rebuild offline packs/ }));
    expect(screen.getByRole("dialog", { name: "Rebuild offline packs?" }).textContent).toMatch(/saved on devices stay/);
    expect(fetched).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("button").filter((b) => /delete|remove/i.test(b.textContent ?? "") || /delete|remove/i.test(b.getAttribute("aria-label") ?? ""))).toEqual([]);
  });
});
