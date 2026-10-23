// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackFile, PackManifest } from "../packs";
import { writeSaved, type SavedSeason } from "./saved";
import { askingAbout, markLater, pendingUpdates, setUpdate, updateNow, updateSnapshot } from "./updateStore";

// A save run the test controls: busy until the test frees it, and every run it's asked for, recorded.
const batch = vi.hoisted(() => ({ busy: false, idle: [] as (() => void)[], runs: [] as number[][] }));
vi.mock("./seasonBatch", () => ({
  whenIdle: () => (batch.busy ? new Promise<void>((res) => batch.idle.push(res)) : Promise.resolve()),
  runSeasonBatch: async (files: PackFile[]) => {
    if (batch.busy) return null;
    batch.runs.push(files.map((f) => f.seasons[0]));
    return { saved: files.map((f) => f.seasons[0]), failed: [], skipped: [], held: [] };
  },
}));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock("../../components/ui/sonner", () => ({
  toast: Object.assign((m: string) => { toasts.push(m); }, { loading: (m: string) => { toasts.push(m); return 1; }, success: (m: string) => { toasts.push(m); }, error: (m: string) => { toasts.push(m); } }),
}));

const file = (season: number, sha256: string): PackFile => ({ name: `s${season}`, url: `/packs/${season}.db`, bytes: 41.9e6, sha256, seasons: [season], kind: "full", contents: "" });
const manifest = (...full: PackFile[]): PackManifest => ({ format: 1, version: "v2", builtAt: "2026-10-20T00:00:00Z", engineVersion: "", dataAsOf: null, lite: null, full });
const saved = (season: number, sha256: string) => ({ season, sha256, version: "v1", bytes: 1, savedAt: 1, dataAsOf: null, builtAt: "" }) satisfies SavedSeason;

beforeEach(() => { localStorage.clear(); setUpdate(null, "none"); batch.busy = false; batch.idle = []; batch.runs = []; toasts.length = 0; });

describe("updateStore", () => {
  it("finds the saved seasons with a newer release, and nothing for ones not saved", () => {
    writeSaved([saved(2025, "old"), saved(2024, "same")]);
    setUpdate(manifest(file(2025, "new"), file(2024, "same"), file(2023, "x")), "prompt");
    const s = updateSnapshot();
    expect(s.updates.map((u) => u.season)).toEqual([2025]);
    expect(s.key).toBe("2025:new");
    expect(askingAbout(s)).toBe(true);
  });

  it("Later hides the inbox item for this release; the next release brings it back", () => {
    writeSaved([saved(2025, "old")]);
    setUpdate(manifest(file(2025, "new")), "prompt");
    markLater(["2025:new"]);
    expect(askingAbout(updateSnapshot())).toBe(false);
    setUpdate(manifest(file(2025, "newer")), "prompt");
    expect(askingAbout(updateSnapshot())).toBe(true);
  });

  it("the item goes once the season is updated (saved list matches)", () => {
    writeSaved([saved(2025, "old")]);
    setUpdate(manifest(file(2025, "new")), "prompt");
    writeSaved([saved(2025, "new")]);
    const s = updateSnapshot();
    expect(s.key).toBeNull();
    expect(askingAbout(s)).toBe(false);
  });

  it("Later is per season: updating one doesn't bring back the other's item", () => {
    writeSaved([saved(2025, "old"), saved(2024, "old")]);
    setUpdate(manifest(file(2025, "new"), file(2024, "new")), "prompt");
    markLater(["2025:new", "2024:new"]);
    writeSaved([saved(2025, "old"), saved(2024, "new")]); // 2024 updated from the Download page
    expect(askingAbout(updateSnapshot())).toBe(false);
  });

  it("never offers an older release than the one saved (a stale manifest)", () => {
    const newer = { ...saved(2025, "b"), builtAt: "2026-10-22T00:00:00Z" };
    expect(pendingUpdates(manifest(file(2025, "a")), [newer])).toEqual([]);
    const older = { ...saved(2025, "a"), builtAt: "2026-10-01T00:00:00Z" };
    expect(pendingUpdates(manifest(file(2025, "b")), [older]).map((r) => r.season)).toEqual([2025]);
  });

  it("asks only when the policy said prompt (not wait or download)", () => {
    writeSaved([saved(2025, "old")]);
    setUpdate(manifest(file(2025, "new")), "wait");
    expect(askingAbout(updateSnapshot())).toBe(false);
    setUpdate(manifest(file(2025, "new")), "download");
    expect(askingAbout(updateSnapshot())).toBe(false);
  });
});

describe("Update now", () => {
  it("while another save runs, waits for it and then updates: the answer is never dropped", async () => {
    writeSaved([saved(2025, "old")]);
    setUpdate(manifest(file(2025, "new")), "prompt");
    batch.busy = true;
    const done = updateNow();
    await vi.waitFor(() => expect(batch.idle.length).toBeGreaterThan(0));
    expect(batch.runs).toEqual([]);
    batch.busy = false;
    for (const f of batch.idle) f();
    await done;
    expect(batch.runs).toEqual([[2025]]);
    expect(toasts.at(-1)).toBe("Offline data for 2025–26 updated");
  });

  it("if that run already updated it, says it's up to date and downloads nothing more", async () => {
    writeSaved([saved(2025, "old")]);
    setUpdate(manifest(file(2025, "new")), "prompt");
    batch.busy = true;
    const done = updateNow();
    await vi.waitFor(() => expect(batch.idle.length).toBeGreaterThan(0));
    writeSaved([saved(2025, "new")]); // the other run saved the new release
    batch.busy = false;
    for (const f of batch.idle) f();
    await done;
    expect(batch.runs).toEqual([]);
    expect(toasts.at(-1)).toBe("Offline data for 2025–26 is up to date");
  });
});
