// @vitest-environment jsdom
// Owner console › Clip coverage, triaged: Actionable is the default view and the only "To review"; every category is a
// filter with its count; each row says its category and why; the first clear is one button that says how many it marks
// and asks first, sending that count; a whole category or season the same way; 0 actionable is said plainly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CoverageTriage, OwnerClipCoverage, OwnerCoverageEvent } from "../../shared/api";

const ev = (code: string, triage: CoverageTriage, triageWhy: string, o: Partial<OwnerCoverageEvent> = {}): OwnerCoverageEvent => ({
  season: 2026, code, name: `${code} meet`, state: "partial", played: 26, withClip: 15, checkedAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null,
  version: `v-${code}`, videos: [], daysMissing: [], missing: [], triage, triageWhy, ...o,
});
const EVENTS: Record<string, OwnerCoverageEvent[]> = {
  actionable: [ev("AUSYQ2", "actionable", "1 match not yet checked against the video (Q1) (10 more held back for other reasons)", { season: 2025 })],
  "early-start": [ev("USAZFLQ", "early-start", "11 matches checked in the video: each starts while the match before is still on, so a clip would open on the wrong match")],
  "no-timing": [ev("USAZGLQ1", "no-timing", "42 matches: Video unavailable or private", { withClip: 0, played: 42, state: "unplaced" })],
  "old-season": [], reviewed: [],
};
const h = vi.hoisted(() => ({ actionable: 1, paths: [] as string[], sent: [] as { path: string; json: unknown }[] }));
const page = (list: string): OwnerClipCoverage => ({
  events: list === "actionable" && !h.actionable ? [] : EVENTS[list] ?? [], list: list as OwnerClipCoverage["list"], open: h.actionable, reviewed: 0,
  categories: { actionable: h.actionable, "no-timing": 1, "early-start": 1, "old-season": 0 },
  seasons: [{ season: 2026, open: 2, actionable: 0 }, { season: 2025, open: 3, actionable: 1 }],
  totals: { events: 1392, played: 45695, withClip: 29333, full: 708 },
});
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string) => { h.paths.push(path); return { data: page(new URL(path, "http://x").searchParams.get("list") ?? "actionable"), error: undefined, loading: false, reload: () => {} }; },
  prime: () => {},
  markStale: () => {},
  apiFetch: async (path: string, init: { json: unknown }) => { h.sent.push({ path, json: init.json }); return { ...page("actionable"), marked: 2 }; },
}));
vi.mock("../ui/sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
const { ClipCoveragePanel } = await import("./ClipCoveragePanel");

beforeEach(() => { h.actionable = 1; h.paths = []; h.sent = []; });
afterEach(cleanup);
const show = () => render(<MemoryRouter><ClipCoveragePanel /></MemoryRouter>);
const rows = () => [...document.querySelectorAll("[data-coverage-event]")].map((r) => [r.getAttribute("data-coverage-event"), r.getAttribute("data-triage")]);

describe("ClipCoveragePanel, triaged", () => {
  it("opens on Actionable only, keeps the totals, and says each row's category and why", () => {
    show();
    expect(h.paths[0]).toBe("/api/owner/clip-coverage?list=actionable");
    expect(document.querySelector("[data-coverage-totals]")?.textContent).toBe("1,392 recorded events checked · 708 fully clipped · 29,333 of 45,695 played matches have a clip");
    expect(screen.getByRole("heading", { name: "To review (1)" })).toBeTruthy();
    expect(rows()).toEqual([["2025/AUSYQ2", "actionable"]]);
    const why = document.querySelector("[data-triage-why]")!;
    expect(within(why as HTMLElement).getByText("Actionable")).toBeTruthy();
    expect(why.textContent).toMatch(/1 match not yet checked against the video \(Q1\)/);
    expect(why.textContent).not.toMatch(/early|by the clock/i);
    expect(document.querySelector("[data-coverage-triage]")?.textContent).toMatch(/To review: 1 event \(Actionable only\)\. Not to review: No timing 1 · Early start \/ unsafe 1 · Old season 0 · Reviewed 0\./);
  });

  it("filters by category: Early start shows Flagstaff, No timing shows Glendale, each with its reason", () => {
    show();
    fireEvent.click(document.querySelector('[data-coverage-list="early-start"]')!);
    expect(h.paths.at(-1)).toBe("/api/owner/clip-coverage?list=early-start");
    expect(rows()).toEqual([["2026/USAZFLQ", "early-start"]]);
    expect(screen.getByText(/11 matches checked in the video: each starts while the match before is still on/)).toBeTruthy();
    fireEvent.click(document.querySelector('[data-coverage-list="no-timing"]')!);
    expect(rows()).toEqual([["2026/USAZGLQ1", "no-timing"]]);
    expect(document.querySelector('[data-coverage-list="no-timing"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("Mark all non-actionable asks first, says how many, and sends that count", async () => {
    show();
    fireEvent.click(document.querySelector('[data-coverage-bulk="non-actionable"]')!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark 2 events reviewed?" })).toBeTruthy();
    expect(h.sent).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark 2 events reviewed/ }));
    await waitFor(() => expect(h.sent).toEqual([{ path: "/api/owner/clip-coverage/bulk-reviewed", json: { category: "non-actionable", season: undefined, expected: 2 } }]));
  });

  it("Cancel marks nothing", async () => {
    show();
    fireEvent.click(document.querySelector('[data-coverage-bulk="non-actionable"]')!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.sent).toEqual([]);
  });

  it("marks a whole category, or a whole season, the same way", async () => {
    show();
    fireEvent.click(document.querySelector('[data-coverage-list="no-timing"]')!);
    fireEvent.click(document.querySelector('[data-coverage-bulk="no-timing"]')!);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Mark 1 event reviewed/ }));
    await waitFor(() => expect(h.sent.at(-1)?.json).toEqual({ category: "no-timing", season: undefined, expected: 1 }));
    // By season is folded until opened.
    fireEvent.click(screen.getByRole("button", { name: /By season/ }));
    fireEvent.change(document.querySelector("[data-coverage-season]")!, { target: { value: "2025" } });
    // By default a season marks only its non-actionable events, and the confirm says how many Actionable it leaves.
    fireEvent.click(document.querySelector('[data-coverage-bulk="season"]')!);
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark 2 events reviewed?" })).toBeTruthy();
    expect(dialog.textContent).toMatch(/that isn't Actionable \(1 Actionable event stays under To review\)/);
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark 2 events reviewed/ }));
    await waitFor(() => expect(h.sent.at(-1)?.json).toEqual({ category: "non-actionable", season: 2025, expected: 2 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Ticked, its Actionable ones go too, and the confirm says so.
    fireEvent.click(document.querySelector("[data-coverage-season-actionable]")!);
    fireEvent.click(document.querySelector('[data-coverage-bulk="season"]')!);
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Mark 3 events reviewed?" })).toBeTruthy();
    expect(dialog.textContent).toMatch(/including its 1 Actionable/);
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark 3 events reviewed/ }));
    await waitFor(() => expect(h.sent.at(-1)?.json).toEqual({ category: undefined, season: 2025, expected: 3 }));
  });

  it("says 0 to review plainly when nothing is actionable", () => {
    h.actionable = 0;
    show();
    expect(screen.getByRole("heading", { name: "To review (0)" })).toBeTruthy();
    expect(screen.getByText("0 to review")).toBeTruthy();
    expect(rows()).toEqual([]);
  });
});
