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
}));
vi.mock("sql.js/dist/sql-wasm-browser.js", () => ({ default: () => initSqlJs() }));
vi.mock("sql.js/dist/sql-wasm-browser.wasm?url", () => ({ default: "/assets/sql-wasm-browser-abc.wasm" }));

import { readSaved, removeSeason, saveSeason, savedSeasons, SEASONS_EVENT } from "./seasons";

// Cache Storage, as the service worker leaves it.
const caches = new Map<string, Set<string>>();
vi.stubGlobal("caches", {
  keys: async () => [...caches.keys()],
  open: async (n: string) => {
    if (!caches.has(n)) caches.set(n, new Set());
    const c = caches.get(n)!;
    return { match: async (u: string) => (c.has(u) ? {} : undefined), add: async (u: string) => { c.add(u); } };
  },
});
vi.stubEnv("DEV", false);

const manifest = { version: "v1", builtAt: "b", dataAsOf: null } as unknown as PackManifest;
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

const names = (only?: number) => readSaved(only, (dbs) => dbs.map((d) => `${d.season}:${d.db.all("SELECT name FROM teams")[0].name}`));

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

  it("removing a season also clears copies an interrupted save left behind", async () => {
    await saveSeason(file(2025, "a"), manifest);
    store.set("season:2025:orphan", new Uint8Array(1));
    await removeSeason(2025);
    expect([...store.keys()]).toEqual([]);
  });

  it("an update replaces the old copy only once it's saved", async () => {
    await saveSeason(file(2025, "a"), manifest);
    await saveSeason(file(2025, "b"), manifest);
    expect([...store.keys()]).toEqual(["season:2025:b"]);
    expect(await names(2025)).toEqual(["2025:Newer"]);
  });
});

describe("readSaved", () => {
  it("opens only the season asked for, and keeps just the two most recently read open", async () => {
    for (const s of [2023, 2024, 2025]) await saveSeason(file(s, "a"), manifest);
    gets.length = 0;
    expect(await names()).toEqual(["2025:New", "2024:Mid", "2023:Old"]);
    expect(gets).toEqual(["season:2023:a"]); // the save kept 2024 and 2025 open; 2023 was let go
    gets.length = 0;
    expect(await names(2025)).toEqual(["2025:New"]);
    expect(await names(2024)).toEqual(["2024:Mid"]);
    expect(gets).toEqual([]); // the newest two stayed open after reading all three
    expect(await names(2023)).toEqual(["2023:Old"]);
    expect(await names(2025)).toEqual(["2025:New"]);
    expect(gets).toEqual(["season:2023:a", "season:2025:a"]); // opening 2023 let go of 2025, the least recently read
  });
});
