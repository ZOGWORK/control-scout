// The most-asked searches (./searchWarm.ts): counted, written most-asked first over the last list, and made by the
// next process within its time.
import { beforeAll, describe, expect, it, vi } from "vitest";
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
    await kvSet("search:hot", [["old one", 25], ["4215", 25]]);
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
    await kvSet("search:hot", [...Array.from({ length: HOT_MAX + 5 }, (_, i) => [`q${i}`, 25]), "junk", [1, 2]]);
    expect((await hotList()).length).toBe(HOT_MAX);
    await kvSet("search:hot", { not: "a list" });
    expect(await hotList()).toEqual([]);
  });
});
