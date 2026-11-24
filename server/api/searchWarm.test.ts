// The most-asked searches (./searchWarm.ts): counted, written most-asked first over the last list, and made by the
// next process within its time.
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { kvSet, migrate, openDb, setDb } from "../db";

const made: string[] = [];
vi.mock("./answers/followUps.js", () => ({
  pageAnswer: async (q: string, limit: number) => { made.push(`${q}|${limit}`); return { q, hits: [], pages: [], step: "deterministic", weak: false }; },
}));
const { HOT_MAX, hotList, noteAsked, saveHot, warmHot } = await import("./searchWarm");

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
});

describe("most-asked searches", () => {
  it("writes this process's most asked first, then the last list's others, and makes each", async () => {
    await kvSet("search:hot:one", [["old one", 25], ["4215", 25]]);
    for (let i = 0; i < 3; i++) noteAsked("4215", 25);
    noteAsked("top teams", 25);
    noteAsked("  ", 25);
    expect(await saveHot()).toBe(3);
    expect(await hotList()).toEqual([["4215", 25], ["top teams", 25], ["old one", 25]]);
    made.length = 0;
    expect(await warmHot()).toBe(3);
    expect(made).toEqual(["4215|25", "top teams|25", "old one|25"]);
  });

  it("stops making them when its time is up", async () => {
    let t = 0;
    made.length = 0;
    expect(await warmHot(10, () => (t += 6))).toBe(1);
  });

  it("keeps at most HOT_MAX, and reads nothing it doesn't recognise", async () => {
    await kvSet("search:hot:one", [...Array.from({ length: HOT_MAX + 5 }, (_, i) => [`q${i}`, 25]), "junk", [1, 2]]);
    expect((await hotList()).length).toBe(HOT_MAX);
    await kvSet("search:hot:one", { not: "a list" });
    expect(await hotList()).toEqual([]);
  });

  it("merges every lane's list, each lane writing only its own key, saves one at a time", async () => {
    await kvSet("search:hot:one", null);
    await kvSet("search:hot:a", [["a1", 25], ["shared", 25], ["a2", 25]]);
    await kvSet("search:hot:b", [["b1", 25], ["shared", 25]]);
    expect(await hotList()).toEqual([["a1", 25], ["b1", 25], ["shared", 25], ["a2", 25]]);
    const was = process.env.CS_LANE;
    process.env.CS_LANE = "b";
    try {
      noteAsked("b-new", 25);
      // Two saves at once (the interval and SIGTERM): one after the other, the same list.
      const [x, y] = await Promise.all([saveHot(), saveHot()]);
      expect(x).toBe(y);
      expect(((await hotList()).map(([q]) => q))).toEqual(expect.arrayContaining(["a1", "a2", "b-new", "b1", "shared"]));
    } finally {
      if (was === undefined) delete process.env.CS_LANE; else process.env.CS_LANE = was;
    }
  });
  it("writes nothing when its lane's list can't be read, so a kept list is never cut short", async () => {
    await kvSet("search:hot:one", [["kept", 25]]);
    noteAsked("new one", 25);
    const spy = vi.spyOn(db, "kvGet").mockRejectedValueOnce(new Error("busy"));
    await expect(saveHot()).rejects.toThrow("busy");
    spy.mockRestore();
    expect(await db.kvGet("search:hot:one")).toEqual([["kept", 25]]);
  });
});
