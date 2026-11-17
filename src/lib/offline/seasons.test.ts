// @vitest-environment jsdom
// Saving, reading and removing seasons: storage, the open-database cache, the
// engine for the service worker. IndexedDB and the network are in-memory fakes.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import type { PackFile, PackManifest } from "../packs";
import { packDb } from "./testFixture";

const store = new Map<string, unknown>();
const files = new Map<string, Uint8Array>();
const gets: string[] = [];
vi.mock("../packs", () => ({
  put: async (k: string, v: unknown) => { store.set(k, v); },
  getv: async (k: string) => { gets.push(k); return store.get(k); },
  del: async (k: string) => { store.delete(k); },
  keys: async (prefix: string) => [...store.keys()].filter((k) => k.startsWith(prefix)),
  fetchVerified: async (f: PackFile) => files.get(f.url)!,
  checkFormat: (m: PackManifest) => { if (m.format !== 1) throw new Error("This pack is from a newer version of Control Scout. Refresh the page."); },
}));
// Counts sql.js engine starts: saving must never start it (it runs only for an offline read).
const engineStarts = vi.hoisted(() => ({ n: 0 }));
vi.mock("sql.js/dist/sql-wasm-browser.js", () => ({ default: () => { engineStarts.n++; return initSqlJs(); } }));
vi.mock("sql.js/dist/sql-wasm-browser.wasm?url", () => ({ default: "/assets/sql-wasm-browser-abc.wasm" }));

import { ENGINE_WAIT_MS, keepSearchIndexes, readSaved, removeSeason, saveSeason, savedSeasons, SEASONS_EVENT, SeasonGone } from "./seasons";
import { readSearch } from "./readers";
import { runSeasonBatch } from "./seasonBatch";
import { DownloadPaused, PIECE, download, partialDownloads } from "./download";
import { resumeMarks, wantResume } from "./resumeMarks";

// Cache Storage, as the service worker leaves it.
const caches = new Map<string, Set<string>>();
const cacheStub = {
  keys: async () => [...caches.keys()],
  open: async (n: string) => {
    if (!caches.has(n)) caches.set(n, new Set());
    const c = caches.get(n)!;
    return { match: async (u: string) => (c.has(u) ? {} : undefined), add: async (u: string) => { c.add(u); }, delete: async (u: string) => c.delete(u) };
  },
};
vi.stubGlobal("caches", cacheStub);
vi.stubEnv("DEV", false);

const manifest = { format: 1, version: "v1", builtAt: "b", dataAsOf: null } as unknown as PackManifest;
const file = (season: number, sha: string): PackFile => ({ name: `${season}.sqlite`, url: `/packs/${season}-${sha}`, bytes: 1, sha256: sha, seasons: [season], kind: "full", contents: "" });
const ENGINE = "/assets/sql-wasm-browser-abc.wasm";

beforeAll(async () => {
  for (const [season, sha, name] of [[2023, "a", "Old"], [2024, "a", "Mid"], [2025, "a", "New"], [2025, "b", "Newer"], [2025, "c", "Newest"]] as const) {
    const db = await packDb(season, { teams: [{ number: 1, name, city: null, state: null, country: null }] });
    files.set(file(season, sha).url, db.export());
  }
});
beforeEach(async () => {
  for (const s of savedSeasons()) await removeSeason(s.season);
  store.clear(); caches.clear(); gets.length = 0;
});
afterEach(() => vi.restoreAllMocks());

/** The season files read back (a kept search index is read alongside each: search-index:…). */
const fileGets = () => gets.filter((k) => k.startsWith("season:"));
const names = (only?: number) => readSaved(only, (dbs) => dbs.map((d) => `${d.season}:${d.db.all("SELECT name FROM teams")[0].name}`));

describe("saving never runs the pack", () => {
  it("stores the bytes without starting sql.js; the first (offline) read does", async () => {
    // First in this file: nothing has started the engine yet (it starts once per page).
    for (const s of [2023, 2024, 2025]) await saveSeason(file(s, "a"), manifest);
    expect(engineStarts.n).toBe(0);
    expect(gets).toEqual([]); // nothing read back either
    expect(await names(2025)).toEqual(["2025:New"]);
    expect(engineStarts.n).toBe(1);
  });

  it("a release in a newer format never replaces the saved copy", async () => {
    await saveSeason(file(2025, "a"), manifest);
    await expect(saveSeason(file(2025, "b"), { ...manifest, format: 2 } as PackManifest)).rejects.toThrow(/newer version/);
    expect(savedSeasons().map((s) => s.sha256)).toEqual(["a"]);
    expect([...store.keys()]).toEqual(["season:2025:a"]);
  });

  it("refuses a file that isn't SQLite", async () => {
    files.set("/packs/junk", new TextEncoder().encode("<html>not a pack</html>"));
    await expect(saveSeason({ ...file(2024, "z"), url: "/packs/junk" }, manifest)).rejects.toThrow(/isn't a Control Scout season pack/);
    expect(savedSeasons()).toEqual([]);
    expect([...store.keys()]).toEqual([]);
  });
});

describe("saveSeason", () => {
  it("puts the SQLite engine in the worker's newest cache before the season shows as saved", async () => {
    caches.set("cs-shell-20261001-aa", new Set()); caches.set("cs-shell-20261010-bb", new Set());
    let atSave = false;
    const on = () => { atSave = caches.get("cs-shell-20261010-bb")!.has(ENGINE); };
    window.addEventListener(SEASONS_EVENT, on);
    await saveSeason(file(2024, "a"), manifest);
    window.removeEventListener(SEASONS_EVENT, on);
    expect(atSave).toBe(true);
    expect(caches.get("cs-shell-20261001-aa")!.size).toBe(0);
  });

  it("caches the engine even before the worker made its cache (first visit)", async () => {
    await saveSeason(file(2024, "a"), manifest);
    expect([...caches.keys()].filter((k) => k.startsWith("cs-shell-"))).toHaveLength(1);
    expect([...caches.values()][0].has(ENGINE)).toBe(true);
  });

  it("a failed save leaves no file behind and keeps the previous copy readable", async () => {
    await saveSeason(file(2025, "a"), manifest);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    await expect(saveSeason(file(2025, "b"), manifest)).rejects.toThrow();
    await expect(saveSeason(file(2023, "a"), manifest)).rejects.toThrow();
    vi.restoreAllMocks();
    expect([...store.keys()]).toEqual(["season:2025:a"]);
    expect(savedSeasons().map((s) => s.sha256)).toEqual(["a"]);
    expect(await names()).toEqual(["2025:New"]);
  });

  it("two releases saved at once leave exactly one stored copy, the listed one", async () => {
    await saveSeason(file(2025, "a"), manifest);
    await Promise.all([saveSeason(file(2025, "b"), manifest), saveSeason(file(2025, "c"), manifest)]);
    const listed = savedSeasons().find((s) => s.season === 2025)!.sha256;
    expect([...store.keys()]).toEqual([`season:2025:${listed}`]);
  });

  it("a failed removal keeps the season listed, so Remove can be tried again", async () => {
    await saveSeason(file(2025, "a"), manifest);
    const packs = await import("../packs");
    vi.spyOn(packs, "del").mockRejectedValueOnce(new Error("idb broke"));
    await expect(removeSeason(2025)).rejects.toThrow("idb broke");
    expect(savedSeasons().map((s) => s.season)).toEqual([2025]);
    await removeSeason(2025);
    expect(savedSeasons()).toEqual([]);
  });

  it("a removal whose list write fails puts the file back, so the season still opens", async () => {
    await saveSeason(file(2025, "a"), manifest);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    await expect(removeSeason(2025)).rejects.toThrow();
    vi.restoreAllMocks();
    expect(savedSeasons().map((s) => s.season)).toEqual([2025]);
    expect([...store.keys()]).toEqual(["season:2025:a"]);
    expect(await names(2025)).toEqual(["2025:New"]);
  });

  it("removing a season also clears copies an interrupted save left behind (with cross-tab locks)", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (_n: string, fn: () => unknown) => Promise.resolve(fn()) } });
    await saveSeason(file(2025, "a"), manifest);
    store.set("season:2025:orphan", new Uint8Array(1));
    await removeSeason(2025);
    expect([...store.keys()]).toEqual([]);
    delete (navigator as { locks?: unknown }).locks;
  });

  it("an update replaces the old copy only once it's saved", async () => {
    await saveSeason(file(2025, "a"), manifest);
    await saveSeason(file(2025, "b"), manifest);
    expect([...store.keys()]).toEqual(["season:2025:b"]);
    expect(await names(2025)).toEqual(["2025:Newer"]);
  });
});

describe("Delete removes every copy", () => {
  /** A newer release of the season, paused by a dropped connection after `cut` bytes (kept as a half download). */
  async function pausedUpdate(season: number, cut: number) {
    const data = new Uint8Array(PIECE * 2).fill(9);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (sent >= cut) { c.error(new TypeError("network error")); return; } c.enqueue(data.slice(sent, cut)); sent = cut; } });
    const fetch = (async () => new Response(body, { status: 200 })) as unknown as typeof globalThis.fetch;
    const owner = { kind: "season" as const, id: String(season), label: "" };
    await expect(download({ url: `/packs/${season}-next.db.gz`, bytes: data.length, sha256: "next".padEnd(64, "0") }, { owner, fetch })).rejects.toBeInstanceOf(DownloadPaused);
  }

  it("the saved file, a paused update of it, its pick-up mark, and the SQLite engine once no season is left", async () => {
    caches.set("cs-shell-20261001-aa", new Set([ENGINE])); // as the worker or the save left it
    await saveSeason(file(2025, "a"), manifest);
    expect(caches.get("cs-shell-20261001-aa")!.has(ENGINE)).toBe(true);
    await pausedUpdate(2025, 1000);
    wantResume("season", "2025");
    expect(await partialDownloads()).toHaveLength(1);

    const saved = savedSeasons()[0].bytes;
    // What it says it freed counts the half download too.
    expect(await removeSeason(2025)).toBe(saved + 1000);
    expect([...store.keys()]).toEqual([]);
    expect(await partialDownloads()).toEqual([]);
    expect(resumeMarks()).toEqual([]);
    expect(caches.get("cs-shell-20261001-aa")!.has(ENGINE)).toBe(false);
  });

  it("acts at once: never reads the file back first, and never waits for a save still caching the engine", async () => {
    await saveSeason(file(2024, "a"), manifest);
    gets.length = 0;
    await removeSeason(2024);
    expect(gets).toEqual([]); // tens of MB were read back into memory before every Delete

    // The engine's request hangs (a line that just came back): the save waits for it ENGINE_WAIT_MS at most (the
    // save run keeps the season's Delete greyed out meanwhile), and a Delete then is done at once.
    let release: () => void = () => {};
    vi.stubGlobal("caches", {
      keys: async () => ["cs-shell-1"],
      open: async () => ({ match: async () => undefined, add: () => new Promise<void>((r) => { release = r; }), delete: async () => true }),
    });
    try {
      let t0 = Date.now();
      await saveSeason(file(2025, "a"), manifest);
      expect(Date.now() - t0).toBeLessThan(ENGINE_WAIT_MS + 1000);
      expect(savedSeasons().map((s) => s.season)).toEqual([2025]);
      t0 = Date.now();
      expect(await removeSeason(2025)).toBeGreaterThan(0);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(savedSeasons()).toEqual([]);
    } finally {
      release();
      vi.stubGlobal("caches", cacheStub);
    }
  });

  it("keeps the engine (and another season's half download) while another season is saved", async () => {
    caches.set("cs-shell-20261001-aa", new Set([ENGINE])); // as the worker or the save left it
    await saveSeason(file(2024, "a"), manifest);
    await saveSeason(file(2025, "a"), manifest);
    await pausedUpdate(2024, 500);
    await removeSeason(2025);
    expect(caches.get("cs-shell-20261001-aa")!.has(ENGINE)).toBe(true);
    expect((await partialDownloads()).map((p) => p.owner.id)).toEqual(["2024"]);
    await removeSeason(2024);
    expect(await partialDownloads()).toEqual([]);
  });
});

describe("readSaved", () => {
  it("opens only the season asked for, and keeps just the two most recently read open", async () => {
    for (const s of [2023, 2024, 2025]) await saveSeason(file(s, "a"), manifest);
    gets.length = 0;
    expect(await names()).toEqual(["2025:New", "2024:Mid", "2023:Old"]);
    expect(fileGets()).toEqual(["season:2023:a", "season:2024:a", "season:2025:a"]); // saving opened none of them
    gets.length = 0;
    expect(await names(2025)).toEqual(["2025:New"]);
    expect(await names(2024)).toEqual(["2024:Mid"]);
    expect(gets).toEqual([]); // the newest two stayed open after reading all three
    expect(await names(2023)).toEqual(["2023:Old"]);
    expect(await names(2025)).toEqual(["2025:New"]);
    expect(fileGets()).toEqual(["season:2023:a", "season:2025:a"]); // opening 2023 let go of 2025, the least recently read
  });

  it("keeps a season's built search index, reads it back with the file once reopened, and drops it with the season", async () => {
    for (const s of [2023, 2024, 2025]) await saveSeason(file(s, "a"), manifest);
    const want = await readSaved(2025, (dbs) => readSearch(dbs, "new"));
    await keepSearchIndexes();
    const kept = () => [...store.keys()].filter((k) => k.startsWith("search-index:"));
    expect(kept()).toHaveLength(1);
    expect(kept()[0]).toMatch(/^search-index:2025:a:/);
    // Reopened (the two others read since let it go): the kept index is read alongside the file, and answers the same.
    await names(2023); await names(2024);
    gets.length = 0;
    expect(await readSaved(2025, (dbs) => readSearch(dbs, "new"))).toEqual(want);
    expect(gets).toEqual(["season:2025:a", kept()[0]]);
    await removeSeason(2025);
    expect(kept()).toEqual([]);
  });

  it("keeps every saved season's index after a search over all of them, though only two stay open", async () => {
    for (const s of [2023, 2024, 2025]) await saveSeason(file(s, "a"), manifest);
    // A search reads all three; the least recent one (2023) is let go once it ends.
    await readSaved(undefined, (dbs) => readSearch(dbs, "new"));
    await keepSearchIndexes();
    expect([...store.keys()].filter((k) => k.startsWith("search-index:")).map((k) => k.split(":")[1]).sort()).toEqual(["2023", "2024", "2025"]);
  });
});

describe("updates never bring back a removed season (replaceOnly)", () => {
  it("a season removed while its update downloads stays removed, and nothing is stored", async () => {
    await saveSeason(file(2025, "a"), manifest);
    // The download finishes only after the person pressed Remove.
    const p = saveSeason(file(2025, "b"), manifest, () => {}, { replaceOnly: true });
    p.catch(() => {}); // it fails while the removal is still tidying up; checked below
    await removeSeason(2025);
    await expect(p).rejects.toBeInstanceOf(SeasonGone);
    expect(savedSeasons()).toEqual([]);
    expect([...store.keys()].filter((k) => k.startsWith("season:"))).toEqual([]);
  });

  it("an update batch skips it (not a failure) and still updates the rest", async () => {
    await saveSeason(file(2024, "a"), manifest);
    const r = await runSeasonBatch([file(2025, "b"), file(2024, "a")], manifest, { replaceOnly: true });
    expect(r).toEqual({ saved: [2024], failed: [], skipped: [2025], held: [] });
    expect(savedSeasons().map((s) => s.season)).toEqual([2024]);
  });

  it("a plain save still adds a season that isn't saved", async () => {
    await saveSeason(file(2025, "a"), manifest);
    expect(savedSeasons().map((s) => s.season)).toEqual([2025]);
  });
});

describe("automatic runs re-check before each season (go)", () => {
  it("stops before the next season when go says no; those seasons are held, not failed", async () => {
    await saveSeason(file(2024, "a"), manifest); await saveSeason(file(2025, "a"), manifest);
    let wifi = true;
    const r = await runSeasonBatch([file(2025, "b"), file(2024, "a")], manifest, { replaceOnly: true, go: () => { const ok = wifi; wifi = false; return ok; } });
    expect(r).toEqual({ saved: [2025], failed: [], skipped: [], held: [2024] });
  });
});
