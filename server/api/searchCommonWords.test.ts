// A search of common words only ("teams with highest opr") scanning the typo index (search.ts searchWords): each
// name's own words (nameWords) are read only for the few names that score, once per name in this process. Read for
// every one of the ~28k names, on every such search, they held the server for 4 s (#1557).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";

const counted = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../src/shared/searchQuery.js", async (real) => {
  const m = await real<typeof import("../../src/shared/searchQuery.js")>();
  return { ...m, nameWords: (...a: Parameters<typeof m.nameWords>) => { counted.n++; return m.nameWords(...a); } };
});

const { ensureSearchIndex, search } = await import("./search");

const NAMES = 3000;
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Names of their own (none shares a word with the searches below), and a few made of common words, that a search of
  // only those words matches as typed.
  const syl = ["ka", "zo", "mi", "ru", "te", "vax", "lo", "pin", "qua", "dre"];
  for (let i = 0; i < NAMES; i++) {
    const name = `${syl[i % 10]}${syl[Math.floor(i / 10) % 10]}${syl[Math.floor(i / 100) % 10]} ${syl[Math.floor(i / 1000) % 10]}bots`;
    await run("INSERT INTO teams (number, name, city) VALUES (?, ?, 'Austin')", [10000 + i, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [10000 + i]);
  }
  await run("INSERT INTO teams (number, name, city) VALUES (9001, 'The Best', 'Reno'), (9002, 'Top Team', 'Reno')");
  await rebuildSearch();
  await ensureSearchIndex(rebuildSearch);
});

describe("a search of common words only", () => {
  it("reads the words of only the names that score, never of every name in the typo index", async () => {
    for (const q of ["teams with highest opr", "the best teams", "who has the most wins"]) {
      counted.n = 0;
      await search(q, 12);
      expect(counted.n, q).toBeLessThan(NAMES / 10);
    }
  });

  it("finds the same names: a name typed whole still matches", async () => {
    expect((await search("the best", 5)).map((h) => h.title)).toContain("9001 | The Best");
  });
});
