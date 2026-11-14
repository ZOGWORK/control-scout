// Clear cache: frees older releases' caches and files the current release doesn't need, measured from the bodies
// kept; keeps the current release's own files (the app still opens offline); never touches IndexedDB (packs, saved
// seasons, recordings) or localStorage (scouting notes, settings).
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPlanned, planClear } from "./appCache";

/** A small in-memory Cache Storage: cache name → url → body. */
function storage(init: Record<string, Record<string, string>>) {
  const data = new Map(Object.entries(init).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const open = async (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    const c = data.get(name)!;
    return {
      keys: async () => [...c.keys()].map((u) => new Request(u)),
      match: async (r: Request | string) => { const u = typeof r === "string" ? r : r.url; return c.has(u) ? new Response(c.get(u)) : undefined; },
      delete: async (u: string) => c.delete(u),
    };
  };
  const store = { keys: async () => [...data.keys()], open, delete: async (n: string) => data.delete(n), has: async (n: string) => data.has(n), match: async () => undefined } as unknown as CacheStorage;
  return { store, data };
}

const O = "https://controlscout.org";
afterEach(() => { vi.unstubAllGlobals(); });

describe("clear cache", () => {
  it("plans the older release's cache and the current one's extra files, measured; keeps the release's own files", async () => {
    const { store } = storage({
      "cs-shell-20261113-old": { [`${O}/`]: "x".repeat(100), [`${O}/assets/a.js`]: "y".repeat(400) },
      "cs-shell-20261114-new": { [`${O}/`]: "x".repeat(100), [`${O}/assets/b.js`]: "z".repeat(300), [`${O}/assets/extra.js`]: "e".repeat(50) },
    });
    const plan = await planClear(store, { cache: "cs-shell-20261114-new", files: ["/", "/assets/b.js"] });
    expect(plan.bytes).toBe(100 + 400 + 50);
    expect(plan.items).toEqual([
      { cache: "cs-shell-20261113-old", url: null, bytes: 500 },
      { cache: "cs-shell-20261114-new", url: `${O}/assets/extra.js`, bytes: 50 },
    ]);
  });

  it("clears what it planned and says how much it freed; the release's own files stay", async () => {
    const { store, data } = storage({
      "cs-shell-1": { [`${O}/assets/a.js`]: "a".repeat(10) },
      "cs-shell-2": { [`${O}/`]: "s".repeat(20), [`${O}/assets/x.js`]: "x".repeat(30) },
    });
    const freed = await clearPlanned(store, await planClear(store, { cache: "cs-shell-2", files: ["/"] }));
    expect(freed).toBe(40);
    expect([...data.keys()]).toEqual(["cs-shell-2"]);
    expect([...data.get("cs-shell-2")!.keys()]).toEqual([`${O}/`]);
  });

  it("with no service worker to ask, the newest release's cache stays whole", async () => {
    const { store } = storage({ "cs-shell-1": { [`${O}/a`]: "aa" }, "cs-shell-2": { [`${O}/b`]: "bbb" }, "other": { [`${O}/c`]: "c" } });
    const plan = await planClear(store, null);
    expect(plan.items.map((i) => i.cache)).toEqual(["cs-shell-1", "other"]);
    expect(plan.bytes).toBe(3);
  });

  it("never touches IndexedDB or localStorage", async () => {
    const idb = { open: vi.fn(), deleteDatabase: vi.fn(), databases: vi.fn() };
    vi.stubGlobal("indexedDB", idb);
    const ls = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 };
    vi.stubGlobal("localStorage", ls);
    const { store } = storage({ "cs-shell-1": { [`${O}/a`]: "aa" }, "cs-shell-2": { [`${O}/b`]: "bbb" } });
    await clearPlanned(store, await planClear(store, { cache: "cs-shell-2", files: [] }));
    for (const f of [...Object.values(idb), ls.getItem, ls.setItem, ls.removeItem, ls.clear]) expect(f).not.toHaveBeenCalled();
  });
});
