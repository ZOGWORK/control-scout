// Typo-tolerant matching for search. SQLite's FTS5 trigram index finds
// candidates that share 3-letter chunks with the query (so "X Drvie" still
// reaches "X Drive"); these functions then rank them by how close each query
// word is to a word in the name (Damerau–Levenshtein: one swap = one edit).
//
// Pure functions — no database — so they're unit-tested on their own.

/** Lowercase, strip accents and punctuation, collapse spaces — keeping letters of every script (机器人, Ελλάδα…). */
export function normalize(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** A number written with thousands separators ("1,000", "12,345,678") as one number: never a team and a leftover. */
export const joinThousands = (s: string) => s.replace(/(?<![\p{L}\p{N},.])\d{1,3}(?:,\d{3})+(?![\p{L}\p{N}]|,\d)/gu, (m) => m.replace(/,/g, ""));

export const words = (s: string) =>normalize(s).split(" ").filter(Boolean);

/** Distinct 3-letter chunks of the normalised text (spaces included, like FTS5's trigram tokenizer). */
export function trigrams(s: string): string[] {
  const n = normalize(s);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= n.length; i++) out.add(n.slice(i, i + 3));
  return [...out];
}

/** An FTS5 MATCH expression OR-ing the query's trigrams (null when the query is too short). */
export function trigramQuery(s: string, max = 40): string | null {
  const t = trigrams(s).slice(0, max);
  return t.length ? t.map((x) => `"${x.replace(/"/g, '""')}"`).join(" OR ") : null;
}

// The distance's three rows, kept between calls (it runs synchronously, so one set serves every call): search scans
// tens of thousands of names per typo, and a fresh array per row was most of its time.
let rowA = new Int32Array(64), rowB = new Int32Array(64), rowC = new Int32Array(64);

/** Optimal string alignment distance (Damerau–Levenshtein with adjacent swaps). */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const n = b.length;
  if (rowA.length <= n) { rowA = new Int32Array(n + 1); rowB = new Int32Array(n + 1); rowC = new Int32Array(n + 1); }
  // prev2: the row two back (for a swap), prev: the row before, cur: this one.
  let prev2 = rowA, prev = rowB, cur = rowC;
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1), ai2 = i > 1 ? a.charCodeAt(i - 2) : -1;
    for (let j = 1; j <= n; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === bj ? 0 : 1));
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && ai2 === bj) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    const t = prev2; prev2 = prev; prev = cur; cur = t;
  }
  return prev[n];
}

/** The characters of `s` (its first `end`) as a 32-bit set, each by its code's last five bits. */
export function charSet(s: string, end = s.length): number {
  let m = 0;
  for (let i = 0; i < end; i++) m |= 1 << (s.charCodeAt(i) & 31);
  return m;
}

const bitCount = (x: number) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

/** Whether two strings' character sets (charSet) already put them more than `cap` edits apart. Each character of one
 *  that the other lacks takes an edit of its own (a swap only moves characters both have), and a set bit missing from
 *  the other's set is such a character, so this never rules out a pair within `cap`: it only saves the distance on
 *  pairs that are clearly apart. */
export const setsApart = (a: number, b: number, cap: number) => bitCount(a & ~b) > cap || bitCount(b & ~a) > cap;

/** Edits allowed for a word of this length: none up to 3 letters, 1 up to 7, then 2
 *  (two edits on a 6-letter word turns "garden" into "warren"). */
export const allowedEdits = (len: number) => (len <= 3 ? 0 : len <= 7 ? 1 : 2);

/** How well one query word matches one name word (0–1). Prefixes count fully (typing as you go). `qSet`: the query
 *  word's charSet, when the caller scores it against many words. */
export function wordScore(q: string, w: string, qSet?: number): number {
  if (w === q) return 1;
  if (w.startsWith(q)) return q.length >= 2 || /^\d$/.test(q) ? 0.95 : 0.6;
  // Only the edits allowed count, so the distance stops as soon as it's past them (none allowed: no distance at all).
  const cap = allowedEdits(q.length);
  if (!cap) return 0;
  // A number typed is a typo only of a number as long ("2025" for "2026"): team 20205 isn't the year 2025, nor team
  // 20265 the "2026 Bishkek" of a name's words run together.
  if (/^\d+$/.test(q) && (q.length !== w.length || !/^\d+$/.test(w))) return 0;
  // The word's start (as long as the query word, or one letter more), then the whole word; either within the edits
  // allowed. Words whose letters are already too different skip the distance (setsApart).
  const qs = qSet ?? charSet(q);
  const end = Math.max(q.length, Math.min(w.length, q.length + 1));
  const d = setsApart(qs, charSet(w, end), cap) ? cap + 1 : editDistance(q, w.slice(0, end), cap);
  const best = d <= cap ? d : end >= w.length || Math.abs(w.length - q.length) > cap || setsApart(qs, charSet(w), cap) ? cap + 1 : editDistance(q, w, cap);
  if (best <= cap) return best === 1 ? 0.8 : 0.65;
  return 0;
}

/**
 * Score a name against a query (0–1): every query word must find a match in
 * the name; the score is the average of its best word matches, with a small
 * bonus when words appear in the same order.
 */
export function fuzzyScore(query: string, name: string): number {
  return scoreWords(words(query), words(name));
}

/** Each adjacent pair of a name's words as one word (joinedWords(["bad", "wolf"]) is ["badwolf"]): scoreWords's, kept
 *  with a name scanned often. */
export const joinedWords = (ws: string[]) => ws.slice(0, -1).map((w, i) => w + ws[i + 1]);

/** fuzzyScore on pre-split words (for scanning many names). `joined`: joinedWords(ws), when already worked out;
 *  `sets`: each query word's charSet. */
export function scoreWords(qs: string[], ws: string[], joined = joinedWords(ws), sets?: number[]): number {
  if (!qs.length || !ws.length) return 0;
  let total = 0, lastIdx = -1, inOrder = 0;
  // Words typed run together match a name's words side by side ("badwolf" → "Bad Wolf"): each adjacent pair of
  // the name's words is also a word, at the first one's place.
  for (let k = 0; k < qs.length; k++) {
    const q = qs[k], set = sets?.[k];
    let best = 0, bestIdx = -1;
    for (let i = 0; i < ws.length; i++) { const s = wordScore(q, ws[i], set); if (s > best) { best = s; bestIdx = i; } }
    if (q.length >= 5) for (let i = 0; i < joined.length; i++) { const s = wordScore(q, joined[i], set); if (s > best) { best = s; bestIdx = i; } }
    if (best === 0) return 0;
    total += best;
    if (bestIdx > lastIdx) inOrder++;
    lastIdx = bestIdx;
  }
  const avg = total / qs.length;
  return Math.min(1, avg + (qs.length > 1 && inOrder === qs.length ? 0.03 : 0));
}
