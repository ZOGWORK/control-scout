// A small word-level diff (the recoverable-changes view's "Show change": the member's unsent text against what
// the workspace has now). Plain text in, plain text out: nothing here is ever treated as markup.
//
// Text is split into words, punctuation and the whitespace between them (emoji sequences, combining marks and
// right-to-left letters stay whole with the word they belong to). The
// common start and end are matched first; the rest by longest common subsequence. A middle too long for that
// (more than MAX_CELLS word pairs) is shown as removed and added whole, rather than slowing the page.

export type DiffPart = { type: "same" | "added" | "removed"; text: string };

/** Above this many word pairs, the changed middle is shown as one removal and one addition. */
export const MAX_CELLS = 1_000_000;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

/**
 * Words, punctuation and the whitespace between them, in order (joined, they give the text back exactly). Words
 * by the platform's own word breaking (Intl.Segmenter: whole emoji sequences, letters with their combining marks,
 * any script); without it, runs of non-whitespace.
 */
export function tokenize(text: string): string[] {
  if (!segmenter) return text.match(/\s+|\S+/gu) ?? [];
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    // Neighbouring whitespace is one token (a run of spaces and line breaks stays whole).
    if (/^\s+$/u.test(segment) && out.length && /^\s+$/u.test(out[out.length - 1])) out[out.length - 1] += segment;
    else out.push(segment);
  }
  return out;
}

const isWord = (t: string) => /\S/u.test(t);
/** Counted as a word (punctuation alone isn't). */
const counts = (t: string) => /[^\s\p{P}]/u.test(t);

function push(out: DiffPart[], type: DiffPart["type"], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === type) last.text += text; else out.push({ type, text });
}

/** How `before` (what's shared now) becomes `after` (the member's text), word by word. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const out: DiffPart[] = [];
  push(out, "same", a.slice(0, start).join(""));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length, m = midB.length;
  if (n && m && n * m <= MAX_CELLS) {
    // lcs[i][j]: the longest common run of midA[i..] and midB[j..] (one flat table).
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = midA[i] === midB[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { push(out, "same", midA[i]); i++; j++; }
      else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) push(out, "removed", midA[i++]);
      else push(out, "added", midB[j++]);
    }
    while (i < n) push(out, "removed", midA[i++]);
    while (j < m) push(out, "added", midB[j++]);
  } else {
    push(out, "removed", midA.join(""));
    push(out, "added", midB.join(""));
  }
  push(out, "same", a.slice(endA).join(""));
  return tidy(out);
}

// A run of whitespace alone kept between two changes reads as noise ("~~fast~~ ++quick++" with a lone shared
// space): it joins both sides, so each change reads as a phrase.
function tidy(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  parts.forEach((p, k) => {
    const prev = parts[k - 1], next = parts[k + 1];
    if (p.type === "same" && !isWord(p.text) && prev && next && prev.type !== "same" && next.type !== "same") {
      out.push({ type: "removed", text: p.text }, { type: "added", text: p.text });
    } else out.push({ ...p });
  });
  reorder(out);
  return out;
}

/** Within each run of changes, removals first, then additions (merged). */
function reorder(out: DiffPart[]) {
  let k = 0;
  while (k < out.length) {
    if (out[k].type === "same") { k++; continue; }
    let end = k;
    while (end < out.length && out[end].type !== "same") end++;
    const removed = out.slice(k, end).filter((p) => p.type === "removed").map((p) => p.text).join("");
    const added = out.slice(k, end).filter((p) => p.type === "added").map((p) => p.text).join("");
    const run: DiffPart[] = [];
    if (removed) run.push({ type: "removed", text: removed });
    if (added) run.push({ type: "added", text: added });
    out.splice(k, end - k, ...run);
    k += run.length;
  }
}

/** The two sides of a diff: what's shared now (same + removed) and the member's text (same + added). */
export const sideOf = (parts: DiffPart[], side: "before" | "after") =>
  parts.filter((p) => p.type === "same" || p.type === (side === "before" ? "removed" : "added"));

/** How many words were added and removed (for the description read out with the comparison). */
export function diffCounts(parts: DiffPart[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const p of parts) {
    if (p.type === "same") continue;
    const words = tokenize(p.text).filter(counts).length;
    if (p.type === "added") added += words; else removed += words;
  }
  return { added, removed };
}
