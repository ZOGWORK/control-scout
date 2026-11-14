// Event names stored with a typo (./nameTypos.ts): only a slip inside a word that other events spell in full reads as
// one; rare real names, accented names and real words a letter apart stay.
import { beforeAll, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../../db";
import { nameTypos, slip, spelledBy, typoWords } from "./nameTypos";

const WINTERBERRY = ["Arlington", "Waverly", "Denver", "Cedar Falls", "Valley", "Mall", "Tournament", "Square"].map((p) => `Winterberry ${p}`);
const names = [
  ...WINTERBERRY, "Wnterberry Waterloo",
  "Défi Robotique - Nantes", "Défi Robotique - Lyon", "Brăila Tech Challenge", "Humber Qualifier", "Cactus Wren League Meet",
  "Türkiye Championship", "CANCÚN Qualifier", "Andy Warhol Scrimmage", "Trout Meet", "Chill Meet",
  // Real words a letter apart, or at the end, from ones other names have: never typos.
  "Grant Wood League", "Grand Rapids Qualifier", "Grand Haven Qualifier", "Australian National Championship",
  "Australia Qualifier 1", "Australia Qualifier 2", "Quail Qualifier", "Stone Meet", "Store Meet", "Store Fair",
  // The data's own typo of a word dozens of names have.
  "Park City High School Qualifer",
];

describe("typoWords", () => {
  const t = typoWords(names);
  it("a slip inside a word other names spell in full is a typo", () => {
    expect([...t].sort()).toEqual(["qualifer", "wnterberry"]);
    expect(spelledBy("Wnterberry Waterloo highlights 2026-27", t)).toBe(false);
  });
  it("rare names, accented names and real words a letter apart stay", () => {
    for (const n of ["Défi Robotique - Nantes", "Brăila Tech Challenge", "Humber Qualifier", "Cactus Wren League Meet", "Türkiye Championship",
      "CANCÚN Qualifier", "Andy Warhol Scrimmage", "Grant Wood League", "Australian National Championship", "Quail Qualifier", "Stone Meet"]) {
      expect(spelledBy(`${n} highlights 2025-26`, t), n).toBe(true);
    }
  });
  it("a word one name has, its usual spelling in only two others: not enough to call it a typo", () => {
    expect(typoWords(["Wnterberry Waterloo", "Winterberry Waverly", "Winterberry Denver"]).size).toBe(0);
    expect(typoWords(["Wnterberry Waterloo", "Winterberry Waverly", "Winterberry Denver", "Winterberry Mall"])).toEqual(new Set(["wnterberry"]));
  });
  it("slip: a letter dropped, doubled or two swapped inside the word; never one changed, added or at its end", () => {
    expect(slip("wnterberry", "winterberry")).toBe(true);
    expect(slip("scrimamge", "scrimmage")).toBe(true);
    expect(slip("herritage", "heritage")).toBe(true);
    expect(slip("australian", "australia")).toBe(false);
    expect(slip("grant", "grand")).toBe(false);
    expect(slip("stone", "store")).toBe(false);
    // Real names a letter longer than common words.
    expect(slip("texans", "texas")).toBe(false);
    expect(slip("johnston", "johnson")).toBe(false);
    expect(slip("rocbots", "robots")).toBe(false);
  });
});

describe("nameTypos", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    for (const [i, n] of [...WINTERBERRY, "Wnterberry Waterloo"].entries()) {
      await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (2026, ?, ?, 'LeagueMeet', 'Waterloo', 'IA', 'USA', '2026-12-01', 'test')", [`USIAW${i}`, n]);
    }
    await kvSet("search:version", "v1");
  });
  it("reads the stored names, and after the data moves keeps the last set until the new one is built", async () => {
    expect([...(await nameTypos())]).toEqual(["wnterberry"]);
    await run("UPDATE events SET name = 'Winterberry Waterloo' WHERE name = 'Wnterberry Waterloo'");
    await kvSet("search:version", "v2");
    // The version is read at most every few seconds and after this process's writes: the next ask sees v2.
    const first = await nameTypos();
    expect([...first]).toEqual(["wnterberry"]);
    await new Promise((r) => setTimeout(r, 50));
    expect((await nameTypos()).size).toBe(0);
  });
});
