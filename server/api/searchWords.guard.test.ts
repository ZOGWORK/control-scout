// One word list for search (search audit 11-24, C1): the lexicon (src/shared/query/lexicon.ts) is where a way of
// saying something lives. The other readers take their words from it, never a copy of their own:
//   - the catalog's filler (./searchCatalog.ts FILLER) is lexicon filler too, so the parser and the keyword layer drop the
//     same words;
//   - a typo said in full before anything reads the query (INFORMAL: "ths" is "this") is never spelled out again in a
//     reader's regex;
//   - the FIRST Championship's names are one list (CHAMPIONSHIP_NAMES), and the lexicon's Worlds phrases hold them all;
//   - the keyword layer's words (./searchCatalog.ts) are the lexicon's own lists, the catalog spelling out none.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as lexicon from "../../src/shared/query/lexicon";
import { CHAMPIONSHIP_NAMES, INFORMAL, INTENT_WORDS, LEADER_STAT_ORDER, LEXICON, championshipNames } from "../../src/shared/query/lexicon";
import * as catalog from "./searchCatalog";

const { FILLER, INTENTS, LEADER_STAT_WORDS } = catalog;

const ROOT = join(import.meta.dirname, "..", "..");
const phrasesOf = (k: string) => new Set(LEXICON.filter((e) => e.syms.every((s) => s.k === k)).map((e) => e.words.join(" ")));

/** Letters apart, a letter typed in, dropped, changed or two swapped counting one. */
function edits(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.ts$/.test(d.name) && !/\.test\.ts$/.test(d.name) ? [p] : [];
  });
}

describe("search's words come from the lexicon", () => {
  it("every catalog filler phrase is lexicon filler", () => {
    const filler = phrasesOf("filler");
    expect(FILLER.filter((w) => !filler.has(w))).toEqual([]);
  });

  it("no reader spells out a typo the lexicon already says in full", () => {
    // A typo, not a short form: one word for one word, a couple of letters off ("ths", "thsi", "tis" for "this").
    const typos = INFORMAL.filter(([from, to]) => !/\s/.test(from + to) && from.length >= 3 && edits(from, to) <= 2).map(([from]) => from);
    expect(typos).toEqual(expect.arrayContaining(["ths", "thsi", "tis"]));
    const found: string[] = [];
    for (const p of [...sources(join(ROOT, "server", "api")), ...sources(join(ROOT, "src", "shared"))]) {
      const s = readFileSync(p, "utf8");
      for (const t of typos) if (new RegExp(`[(|]${t}[|)]`).test(s)) found.push(`${relative(ROOT, p).replace(/\\/g, "/")}: ${t}`);
    }
    expect(found).toEqual([]);
  });

  it("the FIRST Championship's names are one list, and none of them is a place", () => {
    const worlds = phrasesOf("worlds");
    expect(CHAMPIONSHIP_NAMES.filter((n) => !worlds.has(n))).toEqual([]);
    const re = new RegExp(`^(?:${championshipNames()})$`);
    for (const n of CHAMPIONSHIP_NAMES) expect(re.test(n)).toBe(true);
    // Words apart by any spaces, as typed.
    expect(re.test("world   championship")).toBe(true);
    expect(re.test("houston")).toBe(false);
  });

  it("every catalog keyword is a lexicon phrase: the catalog's word lists are the lexicon's own", () => {
    // Each intent's words are its INTENT_WORDS row, and every row is an intent's.
    for (const i of INTENTS) expect(i.words, i.id).toBe(INTENT_WORDS[i.id]);
    expect(Object.keys(INTENT_WORDS).sort()).toEqual(INTENTS.map((i) => i.id).sort());
    // The lists the keyword layer reads are the lexicon's objects, not copies.
    for (const name of ["AWARDS", "FILLER", "FORBIDDEN", "PARAPHRASES", "PHASES", "SCAFFOLD", "TAIL_FILLER", "WEAK_SIGNALS"] as const)
      expect(catalog[name], name).toBe(lexicon[name]);
    // A leaderboard's stat words are looked for in the lexicon's order, every one of them.
    expect([...LEADER_STAT_WORDS].sort()).toEqual([...LEADER_STAT_ORDER].sort());
  });

  it("the catalog spells out no word list of its own", () => {
    const src = readFileSync(join(ROOT, "server", "api", "searchCatalog.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // A list of words is three or more strings in a row; an intent's scope or a precedence pair is two at most.
    expect(src.match(/\[\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"/g) ?? []).toEqual([]);
    expect(src.match(/words:\s*\[/g) ?? []).toEqual([]);
  });
});
