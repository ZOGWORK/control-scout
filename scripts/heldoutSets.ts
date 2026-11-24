// The held-out sets (scripts/search-heldout.ts): the first ones in scripts/search-heldout.json ({ set, n, q }), and one
// file a set in scripts/heldout/ (<set>.json: its questions, in order; each one's number is its place). A change that
// adds a set adds its own file, so two changes adding sets never edit the same lines. A question there is a string,
// or { "q": ..., "train": true } once it was found in tests or code (the training set, ./search-heldout.test.ts).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/** An entry may also carry `train` (seen in tests or code: the training set, ./search-heldout.test.ts), and a shared
 *  one the answer a person wrote (`want`). */
export interface HeldOut { set: string; n: number; q: string; want?: string; train?: boolean }

/** A file's JSON. Each failure names the file and says what it is: one that can't be read (missing, a folder), or
 *  one that isn't JSON (a truncated set file). */
function parsed(path: string, name: string): unknown {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (e) { throw new Error(`${name}: can't be read (${(e as Error).message})`); }
  try { return JSON.parse(text); } catch (e) { throw new Error(`${name}: not valid JSON (${(e as Error).message})`); }
}

/** A question in a set's own file: its words, or its words marked as the training set's. */
export type OwnQuestion = string | { q: string; train: true };
const isQuestion = (x: unknown): x is OwnQuestion => {
  if (typeof x === "string") return !!x.trim();
  const e = x as { q?: unknown; train?: unknown } | null;
  return !!e && typeof e === "object" && typeof e.q === "string" && !!e.q.trim() && e.train === true && Object.keys(e).length === 2;
};

/** A shared entry as the runner reads one: a set, a number, a question. */
const isEntry = (x: unknown): x is HeldOut => {
  const e = x as Partial<HeldOut> | null;
  return !!e && typeof e === "object" && typeof e.set === "string" && !!e.set.trim() && Number.isInteger(e.n) && typeof e.q === "string" && !!e.q.trim();
};

/** Every held-out question, the shared file's first, then each set's own file by name. Throws, naming the file, on a
 *  missing scripts/heldout/, a file there not named <set>.json, a file that isn't valid JSON or a list of questions,
 *  a shared file that isn't a list of { set, n, q }, a set and number given twice (a set in both places, or a file
 *  named as a shared set), or no questions at all (a run that asks none never passes). */
export function heldoutSets(dir: string = import.meta.dirname): HeldOut[] {
  const shared = parsed(join(dir, "search-heldout.json"), "scripts/search-heldout.json");
  if (!Array.isArray(shared)) throw new Error("scripts/search-heldout.json: a list of { set, n, q } entries");
  const bad = shared.findIndex((x) => !isEntry(x));
  if (bad >= 0) throw new Error(`scripts/search-heldout.json: entry ${bad + 1} isn't { set, n, q } with a question`);
  // The folder is where every set since the shared file's is: missing, those sets would be missing with no word said.
  const folder = join(dir, "heldout");
  if (!existsSync(folder)) throw new Error("scripts/heldout/ is missing: the held-out sets added since search-heldout.json live there");
  // A folder that can't be listed (a file of that name, no permission) says so, naming it.
  let names: string[];
  try { names = readdirSync(folder); } catch (e) { throw new Error(`scripts/heldout/ can't be read (${(e as Error).message})`); }
  // Only <set>.json is read: a file named any other way would be left out with no word said.
  const odd = names.filter((f) => !f.endsWith(".json") || !basename(f, ".json").trim());
  if (odd.length) throw new Error(`scripts/heldout/ holds ${odd.join(", ")}: each set is a <set>.json file (a name, then lower-case .json)`);
  const files = names.sort();
  const own = files.flatMap((f) => {
    const qs: unknown = parsed(join(folder, f), `scripts/heldout/${f}`);
    if (!Array.isArray(qs) || !qs.length || !qs.every(isQuestion)) throw new Error(`scripts/heldout/${f}: a list of questions, each a non-empty string (or { "q", "train": true })`);
    const set = basename(f, ".json");
    return (qs as OwnQuestion[]).map((q, i): HeldOut => (typeof q === "string" ? { set, n: i + 1, q } : { set, n: i + 1, q: q.q, train: true }));
  });
  const all = [...(shared as HeldOut[]), ...own];
  if (!all.length) throw new Error("no held-out questions: scripts/search-heldout.json and scripts/heldout/ hold none");
  const seen = new Set<string>();
  for (const x of all) {
    const k = `${x.set} #${x.n}`;
    if (seen.has(k)) throw new Error(`held-out ${k} is given twice`);
    seen.add(k);
  }
  return all;
}
