// Search's faster typo matching gives exactly the numbers the plain one did: the edit distance with reused rows, the
// character-set bound that skips it (setsApart), wordScore with that bound, and the typo index's scan (search.ts
// buildFuzzyIndex + scoreIds) against scoreWords on the same names. The originals are copied here as they were.
import { describe, expect, it } from "vitest";
import { charSet, editDistance, joinedWords, scoreWords, setsApart, wordScore, words } from "./fuzzy";
import { buildFuzzyIndex, scoreIds } from "./search";

function plainDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

const allowed = (len: number) => (len <= 3 ? 0 : len <= 7 ? 1 : 2);
function plainWordScore(q: string, w: string): number {
  if (w === q) return 1;
  if (w.startsWith(q)) return q.length >= 2 || /^\d$/.test(q) ? 0.95 : 0.6;
  const cap = allowed(q.length);
  if (!cap) return 0;
  if (/^\d+$/.test(q) && (q.length !== w.length || !/^\d+$/.test(w))) return 0;
  const d = plainDistance(q, w.slice(0, Math.max(q.length, Math.min(w.length, q.length + 1))), cap);
  const best = d <= cap ? d : plainDistance(q, w, cap);
  if (best <= cap) return best === 1 ? 0.8 : 0.65;
  return 0;
}

// A fixed pseudo-random sequence, so a failure always shows the same pair.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const ALPHABET = "aeiorstnlcdhmpbgkwyuvxz0123456789 éß机";
const randomWord = (min = 1, max = 12) => Array.from({ length: min + Math.floor(rand() * (max - min + 1)) }, () => ALPHABET[Math.floor(rand() * 12 + (rand() < 0.2 ? rand() * (ALPHABET.length - 12) : 0))]).join("");
/** A word a few edits from `w` (typed wrong): letters changed, dropped, added or swapped. */
function typo(w: string): string {
  let s = w;
  for (let k = Math.floor(rand() * 4); k > 0; k--) {
    const i = Math.floor(rand() * Math.max(1, s.length)), r = rand();
    const ch = ALPHABET[Math.floor(rand() * 12)];
    s = r < 0.25 ? s.slice(0, i) + ch + s.slice(i + 1) : r < 0.5 ? s.slice(0, i) + s.slice(i + 1) : r < 0.75 ? s.slice(0, i) + ch + s.slice(i) : s.slice(0, i) + (s[i + 1] ?? "") + (s[i] ?? "") + s.slice(i + 2);
  }
  return s;
}
const NAMES = ["hypnotic robotics", "river dell regional high sch", "bad wolf", "first street kids", "ultraviolet", "enforcers", "raider robotics", "new jersey championship parkway division", "east bergen conference northern league tournament", "x drive", "pymble pride", "critical mass", "bectobots", "latest", "matches", "elimination", "record", "oradell", "badwolf", "12345", "2025"];

describe("the edit distance with reused rows", () => {
  it("is the plain distance for every pair and cap, past the cap too", () => {
    for (let n = 0; n < 20000; n++) {
      const a = rand() < 0.5 ? randomWord() : typo(NAMES[n % NAMES.length]);
      const b = rand() < 0.5 ? randomWord() : NAMES[(n * 7) % NAMES.length];
      const cap = Math.floor(rand() * 4);
      expect(editDistance(a, b, cap), `${a} / ${b} / ${cap}`).toBe(plainDistance(a, b, cap));
    }
  });
  it("handles a word longer than any before it", () => {
    const long = "a".repeat(300), other = `${"a".repeat(299)}b`;
    expect(editDistance(long, other, 2)).toBe(plainDistance(long, other, 2));
    expect(editDistance("ab", "ba", 1)).toBe(1);
  });
});

describe("setsApart", () => {
  it("never parts two strings within the edits allowed", () => {
    for (let n = 0; n < 20000; n++) {
      const a = typo(NAMES[n % NAMES.length]), b = rand() < 0.5 ? NAMES[n % NAMES.length] : randomWord();
      for (const cap of [1, 2, 3]) if (plainDistance(a, b, cap) <= cap) expect(setsApart(charSet(a), charSet(b), cap), `${a} / ${b} / ${cap}`).toBe(false);
    }
  });
  it("parts words with too many letters of their own", () => {
    expect(setsApart(charSet("lasetest"), charSet("robotics"), 2)).toBe(true);
    expect(setsApart(charSet("lasetest"), charSet("latest"), 2)).toBe(false);
  });
});

describe("wordScore with the bound", () => {
  it("scores every pair as the plain wordScore did", () => {
    for (let n = 0; n < 30000; n++) {
      const name = NAMES[n % NAMES.length];
      const q = rand() < 0.6 ? typo(name.split(" ")[0]) : randomWord(1, 10);
      const w = rand() < 0.7 ? name.split(" ").pop()! : randomWord();
      expect(wordScore(q, w), `${q} / ${w}`).toBe(plainWordScore(q, w));
      expect(wordScore(q, w, charSet(q)), `${q} / ${w}`).toBe(plainWordScore(q, w));
    }
  });
});

describe("the typo index's scan", () => {
  const rows = [...NAMES, "4215 hypnotic robotics", "6980 bad wolf", "23268 ultraviolet", "new jersey 3 17 24 state championship tournament turnpike division", "hypnotic", "robotics hypnotic"]
    .map((name, i) => ({ kind: (i % 3 ? "team" : "event") as "team" | "event", ref: String(i), season: 2025, weight: 1, title: name.split(" ")[0], subtitle: "", name }));
  const index = buildFuzzyIndex(rows);
  it("scores each name as scoreWords does, for queries typed right and wrong", () => {
    const queries = ["hypnotic robotics", "hypnotc robotcs", "badwolf", "bad wolff", "lasetest", "ultravoilet nj lasetest match", "4215", "elimination recrod", "new jersy champinship", "x", "raider robotic", "street kids first", "badwolfe"];
    for (let n = 0; n < 300; n++) queries.push(`${typo(NAMES[n % NAMES.length])}${rand() < 0.4 ? ` ${typo(NAMES[(n * 3) % NAMES.length].split(" ")[0])}` : ""}`);
    for (const query of queries) {
      const qs = words(query);
      const scorers = qs.map((q) => index.scorer(q));
      index.rows.forEach((r, i) => {
        const ws = words(`${rows[i].title} ${rows[i].name}`);
        expect(scoreIds(qs, scorers, r), `${query} / ${rows[i].name}`).toBe(scoreWords(qs, ws, joinedWords(ws)));
        expect(scoreWords(qs, ws), `${query} / ${rows[i].name}`).toBe(scoreWords(qs, ws, joinedWords(ws), qs.map((q) => charSet(q))));
      });
    }
  });
});
