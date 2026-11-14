// @vitest-environment jsdom
// The event page's one tap: its real size from the manifest; leaving the page before the idle check asks nothing;
// a bundle saved before the event pack (no team or match pages inside) is offered as an update, not "saved".
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { writeBundles } from "../../lib/offline/bundleMeta";
import type { BundleManifest, SavedBundle } from "../../shared/eventBundle";

const fetchBundleManifest = vi.hoisted(() => vi.fn());
vi.mock("../../lib/offline/bundles", () => ({ fetchBundleManifest, downloadBundle: vi.fn() }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null }, user: null }) }));
const { EventPackButton } = await import("./EventPackButton");

const manifest = { bytes: 168_000, version: "v" } as BundleManifest;
const saved = (over: Partial<SavedBundle>): SavedBundle => ({ season: 2025, code: "USTXQ1", name: "Texas", end: "2099-01-01", version: "v0", sha256: "s", bytes: 22_000, savedAt: 1, builtAt: "2026-11-01T00:00:00Z", dataAsOf: null, team: 13, workspace: null, reports: 0, picklist: false, ...over });
let idle: (() => void)[] = [];
const cancelled: number[] = [];

beforeEach(() => {
  idle = []; cancelled.length = 0;
  fetchBundleManifest.mockReset().mockResolvedValue(manifest);
  Object.assign(window, { requestIdleCallback: (f: () => void) => idle.push(f), cancelIdleCallback: (h: number) => cancelled.push(h) });
});
afterEach(() => { cleanup(); writeBundles([]); });

const show = () => render(<MemoryRouter><EventPackButton season={2025} code="USTXQ1" field={[13, 14]} /></MemoryRouter>);

describe("EventPackButton", () => {
  it("shows the pack's real size once the page is idle", async () => {
    show();
    expect(screen.getByRole("button").textContent).toContain("checking size");
    await act(async () => { idle.forEach((f) => f()); });
    expect(screen.getByRole("button").textContent).toBe("Download for offline · 168 KB");
  });

  it("leaving the page before it's idle asks nothing", () => {
    show();
    cleanup();
    expect(cancelled).toEqual([1]);
    expect(fetchBundleManifest).not.toHaveBeenCalled();
  });

  it("a bundle saved before the event pack is offered as an update, with what it was made for", async () => {
    writeBundles([saved({})]);
    show();
    await act(async () => { idle.forEach((f) => f()); });
    expect(screen.getByRole("button").textContent).toBe("Update for offline · 168 KB");
    expect(fetchBundleManifest.mock.calls[0][0]).toMatchObject({ season: 2025, code: "USTXQ1", team: 13, workspace: null });
  });

  it("a saved event pack says so, with its size", () => {
    writeBundles([saved({ apiPaths: ["/api/teams/13"], bytes: 168_000 })]);
    show();
    expect(screen.getByRole("link").textContent).toBe("Saved for offline · 168 KB");
    expect(idle).toHaveLength(0);
  });
});
