// @vitest-environment jsdom
// Event-day bundles on the device: a download is checked against the manifest's SHA-256 and replaces that event's
// bundle; with no signal the event page answers from it, marked with the bundle's time; finished events prune.
import "fake-indexeddb/auto";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBundle, loadBundle, pruneFinished, removeBundle, removeOtherAccounts } from "./bundles";
import { put } from "../packs";
import { bundleFor, savedBundles, writeBundles } from "./bundleMeta";
import { offlineAnswer } from "./answer";
import { offlineSource } from "./saved";
import { bundleKey, type BundleManifest, type EventBundle } from "../../shared/eventBundle";

const bundle = (version: string): EventBundle => ({
  format: 1,
  manifest: { format: 1, season: 2025, code: "USTXQ1", name: "Texas Qualifier", end: "2026-11-01", version, builtAt: "2026-11-01T12:00:00Z", dataAsOf: "2026-11-01T11:58:00Z", engineVersion: "3.0.0", team: 13, workspace: null, sections: [{ id: "reports", label: "", version: "x", bytes: 1, items: 1, note: null }], field: [[13, "Climbers"]], reportKeys: ["qual:0:1"] },
  event: { event: { season: 2025, code: "USTXQ1", name: "Texas Qualifier" }, field: [], matches: [] } as never,
  ratings: null, reports: [{ key: "qual:0:1", label: "Q1", time: null, html: "<!doctype html><p>Q1</p>" }], picklist: null, rules: null,
  venue: { name: "Texas Qualifier" } as never,
});
function serve(version: string, workspace: { id: string; name: string } | null = null) {
  const gz = new Uint8Array(gzipSync(JSON.stringify(bundle(version))));
  const m = { ...bundle(version).manifest, workspace, url: "/api/bundles/2025/USTXQ1/file", bytes: gz.length, sha256: createHash("sha256").update(gz).digest("hex") } as BundleManifest;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/manifest") ? new Response(JSON.stringify(m)) : new Response(gz))));
  return m;
}

afterEach(async () => { await removeBundle(2025, "USTXQ1"); writeBundles([]); vi.unstubAllGlobals(); });

describe("event-day bundles on the device", () => {
  it("downloads one checked bundle per event; a new one replaces it", async () => {
    serve("v1");
    const req = { season: 2025, code: "USTXQ1", team: 13, workspace: null };
    const a = await downloadBundle(req);
    expect(a).toMatchObject({ version: "v1", team: 13, reports: 1, reportKeys: ["qual:0:1"], dataAsOf: "2026-11-01T11:58:00Z" });
    serve("v2");
    await downloadBundle(req);
    expect(savedBundles().map((b) => b.version)).toEqual(["v2"]);
    expect((await loadBundle(2025, "USTXQ1"))?.manifest.version).toBe("v2");
  });

  it("a newer bundle saved by another tab is read, never the copy decoded before", async () => {
    serve("v1");
    const req = { season: 2025, code: "USTXNXLT", team: 13, workspace: null };
    await downloadBundle({ ...req, code: "USTXQ1" });
    expect((await loadBundle(2025, "USTXQ1"))?.manifest.version).toBe("v1");
    // Another tab: new bytes in IndexedDB and a new list entry, nothing through this tab's download.
    const gz = new Uint8Array(gzipSync(JSON.stringify(bundle("v2"))));
    await put(bundleKey(2025, "USTXQ1"), { bytes: gz, version: "v2" });
    writeBundles(savedBundles().map((b) => ({ ...b, version: "v2" })));
    expect((await loadBundle(2025, "USTXQ1"))?.manifest.version).toBe("v2");
  });

  it("an update that can't be recorded (storage full) keeps the bundle already here", async () => {
    serve("v1");
    const req = { season: 2025, code: "USTXQ1", team: 13, workspace: null };
    await downloadBundle(req);
    serve("v2");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    await expect(downloadBundle(req)).rejects.toThrow(/kept/);
    setItem.mockRestore();
    expect(savedBundles().map((b) => b.version)).toEqual(["v1"]);
    expect((await loadBundle(2025, "USTXQ1"))?.manifest.version).toBe("v1");
  });

  it("refuses bytes that don't match the manifest", async () => {
    const m = serve("v1");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/manifest") ? new Response(JSON.stringify(m)) : new Response(new Uint8Array([1, 2])))));
    await expect(downloadBundle({ season: 2025, code: "USTXQ1", team: 13, workspace: null }, undefined, m)).rejects.toThrow(/checksum/);
    expect(bundleFor(2025, "USTXQ1")).toBeNull();
  });

  it("with no signal, the event page answers from the bundle, marked with its time", async () => {
    serve("v1");
    await downloadBundle({ season: 2025, code: "USTXQ1", team: 13, workspace: null });
    const d = await offlineAnswer("/api/events/2025/USTXQ1");
    expect((d as { event: { name: string } }).event.name).toBe("Texas Qualifier");
    expect(offlineSource(d)).toMatchObject({ dataAsOf: "2026-11-01T11:58:00Z", bundle: { name: "Texas Qualifier" } });
    expect(await offlineAnswer("/api/events/2025/OTHER1")).toBeNull();
  });

  it("a workspace bundle is only the downloading account's: another account on the device neither sees nor keeps it", async () => {
    const ws = serve("v1", { id: "3101", name: "Space" });
    localStorage.setItem("cs-personal-owner", "41");
    await downloadBundle({ season: 2025, code: "USTXQ1", team: 13, workspace: "3101", account: 41 }, undefined, ws);
    expect(bundleFor(2025, "USTXQ1")?.accountId).toBe(41);
    // Another account signs in on this device.
    localStorage.setItem("cs-personal-owner", "77");
    expect(bundleFor(2025, "USTXQ1")).toBeNull();
    expect(savedBundles()).toEqual([]);
    expect(await offlineAnswer("/api/events/2025/USTXQ1")).toBeNull();
    expect(await removeOtherAccounts()).toBe(1);
    localStorage.setItem("cs-personal-owner", "41");
    expect(bundleFor(2025, "USTXQ1")).toBeNull(); // gone from the device, not just hidden
    localStorage.removeItem("cs-personal-owner");
  });

  it("removes finished events' bundles", async () => {
    serve("v1");
    await downloadBundle({ season: 2025, code: "USTXQ1", team: 13, workspace: null });
    expect(await pruneFinished(new Date(2026, 10, 1, 12))).toBe(0);
    expect(await pruneFinished(new Date(2026, 10, 3))).toBe(1);
    expect(savedBundles()).toEqual([]);
  });
});
