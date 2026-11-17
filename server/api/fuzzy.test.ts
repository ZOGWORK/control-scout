import { describe, it, expect } from "vitest";
import { editDistance, fuzzyScore, joinThousands, normalize, trigramQuery, trigrams, wordScore } from "./fuzzy";

describe("editDistance", () => {
  it("counts an adjacent swap as one edit", () => {
    expect(editDistance("drvie", "drive")).toBe(1);
    expect(editDistance("pymbel", "pymble")).toBe(1);
  });
  it("counts inserts, deletes and substitutions", () => {
    expect(editDistance("robotics", "robotcs")).toBe(1);
    expect(editDistance("cyber", "cybor")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
  it("stops early past the cap", () => {
    expect(editDistance("abcdef", "uvwxyz", 2)).toBe(3);
  });
});

describe("fuzzyScore", () => {
  it("finds X Drive from a typo", () => {
    expect(fuzzyScore("X Drvie", "16321 X Drive")).toBeGreaterThan(0.7);
    expect(fuzzyScore("x drvie", "16321 X Drive")).toBeGreaterThan(fuzzyScore("x drvie", "Drive Shaft Robotics"));
  });
  it("matches as you type (prefixes)", () => {
    expect(fuzzyScore("pym", "18360 Pymble Pride")).toBeGreaterThan(0.9);
    expect(fuzzyScore("pymble pr", "18360 Pymble Pride")).toBeGreaterThan(0.9);
  });
  it("needs every query word to match something", () => {
    expect(fuzzyScore("pymble zebra", "18360 Pymble Pride")).toBe(0);
  });
  it("doesn't tolerate typos in very short words (too many false hits)", () => {
    expect(wordScore("abc", "abd")).toBe(0);
    expect(wordScore("drvie", "drive")).toBeGreaterThan(0);
  });
  it("doesn't stretch medium words two edits away (garden ≠ warren)", () => {
    expect(wordScore("garden", "warren")).toBe(0);
    expect(wordScore("qualifer", "qualifier")).toBeGreaterThan(0);
  });
  it("ignores case, accents and punctuation, but keeps every script", () => {
    expect(normalize("Équipe-Robo!")).toBe("equipe robo");
    expect(normalize("机器人 Team")).toBe("机器人 team");
    expect(fuzzyScore("机器人", "3333 机器人队")).toBeGreaterThan(0.9);
    expect(fuzzyScore("equipe robo", "Équipe Robo")).toBe(1);
  });
});

describe("trigrams", () => {
  it("splits like FTS5's trigram tokenizer and builds a safe OR query", () => {
    expect(trigrams("X Drive")).toContain("x d");
    expect(trigramQuery("ab")).toBeNull();
    expect(trigramQuery('a"bc')).toBe('"a b" OR " bc"');
  });
});

describe("normalize's plain-ASCII shortcut", () => {
  // The full Unicode passes, as normalize ran them for every string before the shortcut.
  const full = (s: string) => joinThousands(s).normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  it("gives exactly what the Unicode passes give, for every ASCII character and real names", () => {
    const every = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join("");
    const names = [every, "4215 | Hypnotic Robotics", "  Oradell, NJ, USA ", "1,000 Lakes", "Team 12,345,678!", "a,123", "1,23", "R2-D2 (Bots)", "ROBO_tics\t\n", "x.1,000", ""];
    for (const s of names) expect(normalize(s), JSON.stringify(s)).toBe(full(s));
  });
  it("leaves accents and other scripts to the Unicode passes", () => {
    expect(normalize("Équipe Robótica")).toBe("equipe robotica");
    expect(normalize("机器人 ４２１５")).toBe(full("机器人 ４２１５"));
  });
});
