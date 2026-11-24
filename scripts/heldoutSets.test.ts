// The held-out sets load whole: the shared file and each set's own file (scripts/heldout/), every set and number once.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heldoutSets } from "./heldoutSets";

const dirWith = (shared: unknown, own: Record<string, unknown>) => {
  const d = mkdtempSync(join(tmpdir(), "heldout-"));
  writeFileSync(join(d, "search-heldout.json"), JSON.stringify(shared));
  mkdirSync(join(d, "heldout"));
  for (const [f, v] of Object.entries(own)) writeFileSync(join(d, "heldout", f), typeof v === "string" ? v : JSON.stringify(v));
  return d;
};

describe("held-out sets", () => {
  it("the repository's load, every set and number once, every question a string", () => {
    const all = heldoutSets();
    expect(all.length).toBeGreaterThan(0);
    // Every set's own file is read: each one's questions are there.
    const own = readdirSync(join(import.meta.dirname, "heldout")).map((f) => f.replace(/\.json$/, ""));
    expect(own.length).toBeGreaterThan(0);
    for (const set of own) expect(all.some((x) => x.set === set), set).toBe(true);
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
  it("a shared entry's want is words and its train true or false, or it fails loudly", () => {
    expect(heldoutSets(dirWith([{ set: "a", n: 1, q: "x", want: "y", train: true }], { "b.json": ["z"] }))[0]).toMatchObject({ want: "y", train: true });
    expect(() => heldoutSets(dirWith([{ set: "a", n: 1, q: "x", want: 123 }], { "b.json": ["z"] }))).toThrow("entry 1");
    expect(() => heldoutSets(dirWith([{ set: "a", n: 1, q: "x", train: "false" }], { "b.json": ["z"] }))).toThrow("entry 1");
  });
  it("a set given twice, or a file that isn't a list of questions, fails loudly", () => {
    expect(() => heldoutSets(dirWith([{ set: "a", n: 1, q: "x" }], { "a.json": ["y"] }))).toThrow("held-out a #1 is given twice");
    expect(() => heldoutSets(dirWith([], { "c.json": { q: "x" } }))).toThrow("scripts/heldout/c.json");
    expect(() => heldoutSets(dirWith([], { "c.json": ["ok", ""] }))).toThrow("scripts/heldout/c.json");
    // A file that isn't JSON is named; a set file named any other way, or no folder at all, never passes as no sets.
    expect(() => heldoutSets(dirWith([], { "d.json": "[\"cut off" }))).toThrow("scripts/heldout/d.json: not valid JSON");
    expect(() => heldoutSets(dirWith([], { "e.JSON": ["x"] }))).toThrow("e.JSON");
    expect(() => heldoutSets(dirWith([], { ".json": ["x"] }))).toThrow("holds .json");
    const bare = mkdtempSync(join(tmpdir(), "heldout-"));
    writeFileSync(join(bare, "search-heldout.json"), "[]");
    expect(() => heldoutSets(bare)).toThrow("scripts/heldout/ is missing");
    writeFileSync(join(bare, "heldout"), "");
    expect(() => heldoutSets(bare)).toThrow("scripts/heldout/ can't be read");
    // A file that can't be read says so, never "not valid JSON".
    const gone = mkdtempSync(join(tmpdir(), "heldout-"));
    mkdirSync(join(gone, "heldout"));
    expect(() => heldoutSets(gone)).toThrow("scripts/search-heldout.json: can't be read");
    // The shared file is checked as the set files are, naming itself.
    expect(() => heldoutSets(dirWith({}, { "g.json": ["x"] }))).toThrow("scripts/search-heldout.json: a list of");
    expect(() => heldoutSets(dirWith([{ set: "a", n: 1 }], {}))).toThrow("scripts/search-heldout.json: entry 1");
    expect(() => heldoutSets(dirWith([{ set: "  ", n: 1, q: "x" }], {}))).toThrow("scripts/search-heldout.json: entry 1");
    // No questions at all never passes as a run that asked none.
    expect(() => heldoutSets(dirWith([], {}))).toThrow("no held-out questions");
  });
});
