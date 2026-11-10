// Search's kept reads, answers and pages (server/api/searchReads.ts): what is kept is shared, bounded in number, its
// reads dropped when the data moves (search:version, data:version, a write to a data table), its answers and pages
// served from before the move until drawn again once, and everything dropped by "Clear caches".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kvSet, migrate, openDb, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { keptAnswer, keptCounts, keptPage, PAGE_TTL_MS, PAGES_KEPT, searchRead, STALE_MS } from "./searchReads";

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => { vi.useRealTimers(); });

const tick = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("kept pages", () => {
  it("draws a page once within its TTL, and again after", async () => {
    const draw = vi.fn(async () => ({ html: "<p>page</p>", status: 200 as const }));
    const a = await keptPage("/teams/4215", draw);
    tick(PAGE_TTL_MS - 1_000);
    const b = await keptPage("/teams/4215", draw);
    expect(b).toBe(a);
    expect(draw).toHaveBeenCalledTimes(1);
    tick(PAGE_TTL_MS + 2_000);
    await keptPage("/teams/4215", draw);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("serves the kept page past its time while one fresh copy is made, then the fresh one", async () => {
    await keptPage("/events/2025/X", async () => "old");
    tick(PAGE_TTL_MS + 1_000);
    let release!: (v: string) => void;
    const remake = vi.fn(() => new Promise<string>((r) => { release = r; }));
    expect(await keptPage("/events/2025/X", remake)).toBe("old");
    expect(await keptPage("/events/2025/X", remake)).toBe("old");
    expect(remake).toHaveBeenCalledTimes(1);
    release("new");
    await new Promise((r) => setTimeout(r, 0));
    expect(await keptPage("/events/2025/X", remake)).toBe("new");
  });

  it("never serves a kept page past its stale window", async () => {
    await keptPage("/events/2025/Y", async () => "old");
    tick(PAGE_TTL_MS + STALE_MS + 1_000);
    expect(await keptPage("/events/2025/Y", async () => "new")).toBe("new");
  });

  it("serves a page from before a data move only within its time and the stale window", async () => {
    await keptPage("/teams/1", async () => "old");
    tick(PAGE_TTL_MS + STALE_MS + 1_000);
    await kvSet("data:version", "3");
    expect(await keptPage("/teams/1", async () => "new")).toBe("new");
  });

  it("keeps each address apart", async () => {
    expect(await keptPage("/teams/4215", async () => "a")).toBe("a");
    expect(await keptPage("/teams/7149", async () => "b")).toBe("b");
    expect(keptCounts().pages).toBe(2);
  });

  it("serves each page and answer from before a data move while one draw from the new data is made", async () => {
    await keptPage("/teams/4215", async () => "v1");
    await keptAnswer("q", async () => "a1");
    await kvSet("data:version", "2");
    tick(3_000);
    let done!: (v: string) => void;
    const draw = vi.fn(() => new Promise<string>((r) => { done = r; }));
    // Every ask while the new draw is under way: the copy from before, and one draw only.
    expect(await keptPage("/teams/4215", draw)).toBe("v1");
    expect(await keptPage("/teams/4215", draw)).toBe("v1");
    expect(draw).toHaveBeenCalledTimes(1);
    done("v2");
    await Promise.resolve(); await Promise.resolve();
    expect(await keptPage("/teams/4215", draw)).toBe("v2");
    expect(draw).toHaveBeenCalledTimes(1);
    expect(await keptAnswer("q", async () => "a2")).toBe("a1");
    await Promise.resolve();
    expect(await keptAnswer("q", async () => "a3")).toBe("a2");
  });

  it("reads the rows again at once when the data moves", async () => {
    const read = () => searchRead<{ n: number }>("SELECT COUNT(*) n FROM teams");
    expect(Number((await read())[0].n)).toBe(0);
    await kvSet("data:version", "2");
    tick(3_000);
    await (await import("../db")).run("INSERT INTO teams (number, name) VALUES (1, 'One')");
    expect(Number((await read())[0].n)).toBe(1);
  });

  it("serves a page from before a write in this process the same way", async () => {
    await keptPage("/teams/1", async () => "v1");
    await (await import("../db")).run("INSERT INTO teams (number, name) VALUES (1, 'One')");
    expect(await keptPage("/teams/1", async () => "v2")).toBe("v1");
    await Promise.resolve(); await Promise.resolve();
    expect(await keptPage("/teams/1", async () => "v3")).toBe("v2");
  });

  it("keeps the copy from before when the new draw fails, and tries again on the next ask", async () => {
    await keptPage("/teams/1", async () => "v1");
    await kvSet("data:version", "2");
    tick(3_000);
    expect(await keptPage("/teams/1", () => Promise.reject(new Error("db busy")))).toBe("v1");
    await Promise.resolve(); await Promise.resolve();
    expect(await keptPage("/teams/1", async () => "v2")).toBe("v1");
    await Promise.resolve(); await Promise.resolve();
    expect(await keptPage("/teams/1", async () => "v3")).toBe("v2");
  });

  it("carries pages over a search index rebuild (search:version) the same way", async () => {
    await keptPage("/search?q=4215", async () => "v1");
    await kvSet("search:version", "9");
    tick(3_000);
    expect(await keptPage("/search?q=4215", async () => "v2")).toBe("v1");
    await Promise.resolve(); await Promise.resolve();
    expect(await keptPage("/search?q=4215", async () => "v3")).toBe("v2");
  });

  it("carries only copies that can still be served, and no more than are kept", async () => {
    for (let i = 0; i < PAGES_KEPT; i++) await keptPage(`/teams/${i}`, async () => `p${i}`);
    await kvSet("data:version", "2");
    tick(3_000);
    // A few asked again after the move; the rest are carried untouched.
    for (let i = 0; i < 5; i++) await keptPage(`/x/${i}`, async () => `x${i}`);
    expect(keptCounts().carried).toBe(PAGES_KEPT);
    for (let i = 0; i < 5; i++) await keptPage(`/y/${i}`, async () => `y${i}`);
    await Promise.resolve();
    await kvSet("data:version", "3");
    tick(3_000);
    await keptPage("/z", async () => "z");
    // The newest PAGES_KEPT of the carried and the newly drawn: never more.
    expect(keptCounts().carried).toBe(PAGES_KEPT);
    // Past their time and the stale window, none is carried on.
    tick(PAGE_TTL_MS + STALE_MS);
    await kvSet("data:version", "4");
    tick(3_000);
    await keptPage("/w", async () => "w");
    expect(keptCounts().carried).toBe(0);
  });

  it("never serves anything from before Clear caches", async () => {
    await keptPage("/teams/1", async () => "v1");
    clearAllCaches();
    await kvSet("data:version", "2");
    tick(3_000);
    expect(await keptPage("/teams/1", async () => "v2")).toBe("v2");
  });

  it("is emptied by Clear caches", async () => {
    await keptPage("/", async () => "v1");
    await searchRead("SELECT 1 AS one");
    expect(keptCounts()).toMatchObject({ pages: 1, rows: 1 });
    clearAllCaches();
    expect(keptCounts()).toEqual({ rows: 0, answers: 0, pages: 0, carried: 0 });
  });

  it("keeps at most PAGES_KEPT pages, dropping the least recently used", async () => {
    for (let i = 0; i < PAGES_KEPT + 5; i++) await keptPage(`/teams/${i}`, async () => `p${i}`);
    expect(keptCounts().pages).toBe(PAGES_KEPT);
    const draw = vi.fn(async () => "again");
    expect(await keptPage("/teams/0", draw)).toBe("again");
    expect(await keptPage(`/teams/${PAGES_KEPT + 4}`, draw)).toBe(`p${PAGES_KEPT + 4}`);
  });

  it("does not keep a page that failed to draw", async () => {
    await expect(keptPage("/teams/1", async () => { throw new Error("no"); })).rejects.toThrow("no");
    expect(await keptPage("/teams/1", async () => "ok")).toBe("ok");
  });
});
