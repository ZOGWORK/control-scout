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

export const words = (s: string) => normalize(s).split(" ").filter(Boolean);

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

/** Optimal string alignment distance (Damerau–Levenshtein with adjacent swaps). */
export function editDistance(a: string, b: string, cap = 3): number {
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

/** Edits allowed for a word of this length: none up to 3 letters, 1 up to 7, then 2
 *  (two edits on a 6-letter word turns "garden" into "warren"). */
export const allowedEdits = (len: number) => (len <= 3 ? 0 : len <= 7 ? 1 : 2);

/** How well one query word matches one name word (0–1). Prefixes count fully (typing as you go). */
export function wordScore(q: string, w: string): number {
  if (w === q) return 1;
  if (w.startsWith(q)) return q.length >= 2 || /^\d$/.test(q) ? 0.95 : 0.6;
  const d = editDistance(q, w.slice(0, Math.max(q.length, Math.min(w.length, q.length + 1))), 2);
  const dFull = editDistance(q, w, 2);
  const best = Math.min(d, dFull);
  if (best <= allowedEdits(q.length)) return best === 1 ? 0.8 : 0.65;
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

/** fuzzyScore on pre-split words (for scanning many names). */
export function scoreWords(qs: string[], ws: string[]): number {
  if (!qs.length || !ws.length) return 0;
  let total = 0, lastIdx = -1, inOrder = 0;
  for (const q of qs) {
    let best = 0, bestIdx = -1;
    ws.forEach((w, i) => { const s = wordScore(q, w); if (s > best) { best = s; bestIdx = i; } });
    if (best === 0) return 0;
    total += best;
    if (bestIdx > lastIdx) inOrder++;
    lastIdx = bestIdx;
  }
  const avg = total / qs.length;
  return Math.min(1, avg + (qs.length > 1 && inOrder === qs.length ? 0.03 : 0));
}
