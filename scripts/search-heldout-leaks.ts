// Which held-out questions appear word for word in the repo's tests or code (audit M2, 24 Nov). A question that does
// was seen while building search, so it isn't held out: it belongs in the training set ("train": true in
// scripts/search-heldout.json). The guard test (scripts/search-heldout.test.ts) fails when one does;
// scripts/search-heldout.ts --split marks them.
//
// Looked through: every .ts/.tsx/.mts/.cts/.js/.mjs/.cjs/.json/.txt file, whatever its size, under server/, src/, scripts/, packages/ and bot/, the other
// eval lists aside (they hold questions to ask, not code that answers them): the held-out file itself and
// each set's own file (scripts/heldout/), the sign-off sets (scripts/search-signoff/sets/, set A is the unique200 set) and the latency bench's query list.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = join(import.meta.dirname, "..");
export const SCANNED = ["server", "src", "scripts", "packages", "bot"];
/** Eval lists: questions to ask, never read by search. */
export const EVAL_LISTS = [/^scripts\/search-heldout\.json$/, /^scripts\/heldout\//, /^scripts\/search-signoff\/sets\//, /^scripts\/search-bench\//];
const EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|txt)$/;

/** Every scanned file's text, lower case, every run of whitespace one space (a question split across lines in a test
 *  is still that question), by its path from the repo root (forward slashes). */
export function scannedTexts(root = ROOT): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const p = join(dir, name), st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      const rel = relative(root, p).replace(/\\/g, "/");
      if (!EXT.test(name) || EVAL_LISTS.some((r) => r.test(rel))) continue;
      out.set(rel, readFileSync(p, "utf8").toLowerCase().replace(/\s+/g, " "));
    }
  };
  // A folder this checkout lacks is skipped; any other read error fails loudly, never a silently smaller scan.
  for (const d of SCANNED) {
    let there = true;
    try { statSync(join(root, d)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") there = false; else throw e; }
    if (there) walk(join(root, d));
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The question as a whole phrase: not inside a longer word ("4215 opr" is in "4215 opr rank", never in "14215 oprs"). */
const phrase = (q: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(q.trim().toLowerCase()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "u");

/** The files each question appears in word for word (questions that appear nowhere are left out). */
export function leaks(questions: string[], texts = scannedTexts()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const q of new Set(questions)) {
    // The plain text first (fast; scannedTexts folds whitespace to one space), the whole-phrase test only where it is.
    const re = phrase(q), lower = q.trim().toLowerCase().replace(/\s+/g, " ");
    const files = [...texts].filter(([, t]) => t.includes(lower) && re.test(t)).map(([p]) => p);
    if (files.length) out.set(q, files);
  }
  return out;
}
