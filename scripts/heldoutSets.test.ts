// The held-out sets load whole: the shared file and each set's own file (scripts/heldout/), every set and number once.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heldoutSets } from "./heldoutSets";

const dirWith = (shared: unknown, own: Record<string, unknown>) => {
  const d = mkdtempSync(join(tmpdir(), "heldout-"));
  writeFileSync(join(d, "search-heldout.json"), JSON.stringify(shared));
  mkdirSync(join(d, "heldout"));
  for (const [f, v] of Object.entries(own)) writeFileSync(join(d, "heldout", f), JSON.stringify(v));
  return d;
};

describe("held-out sets", () => {
  it("the repository's load, every set and number once, every question a string", () => {
    const all = heldoutSets();
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((x) => `${x.set} #${x.n}`)).size).toBe(all.length);
    expect(all.every((x) => typeof x.q === "string" && x.q.trim().length > 0)).toBe(true);
    // The shared file holds whole entries: as many "q" keys as entries (a merge that glues two never passes).
    const raw = readFileSync(join(import.meta.dirname, "search-heldout.json"), "utf8");
    const shared = JSON.parse(raw) as unknown[];
    expect([(raw.match(/"set"\s*:/g) ?? []).length, (raw.match(/"q"\s*:/g) ?? []).length]).toEqual([shared.length, shared.length]);
  });
  it("a set's own file is its questions in order, numbered from 1", () => {
    const d = dirWith([{ set: "a", n: 1, q: "x" }], { "b.json": ["first", "second"] });
    expect(heldoutSets(d)).toEqual([{ set: "a", n: 1, q: "x" }, { set: "b", n: 1, q: "first" }, { set: "b", n: 2, q: "second" }]);
  });
  it("a set given twice, or a file that isn't a list of questions, fails loudly", () => {
    expect(() => heldoutSets(dirWith([{ set: "a", n: 1, q: "x" }], { "a.json": ["y"] }))).toThrow("held-out a #1 is given twice");
    expect(() => heldoutSets(dirWith([], { "c.json": { q: "x" } }))).toThrow("scripts/heldout/c.json");
    expect(() => heldoutSets(dirWith([], { "c.json": ["ok", ""] }))).toThrow("scripts/heldout/c.json");
  });
});
