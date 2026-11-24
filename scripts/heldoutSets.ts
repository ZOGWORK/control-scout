// The held-out sets (scripts/search-heldout.ts): the first ones in scripts/search-heldout.json ({ set, n, q }), and one
// file a set in scripts/heldout/ (<set>.json: its questions, in order; each one's number is its place). A change that
// adds a set adds its own file, so two changes adding sets never edit the same lines.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export interface HeldOut { set: string; n: number; q: string }

/** A file's JSON, an error naming the file when it isn't (a truncated set file says which one). */
function parsed(path: string, name: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Error(`${name}: not valid JSON (${(e as Error).message})`); }
}

/** Every held-out question, the shared file's first, then each set's own file by name. Throws, naming the file, on a
 *  missing scripts/heldout/, a file there not named <set>.json, a file that isn't valid JSON or a list of questions,
 *  or a set and number given twice (a set in both places, or a file named as a shared set). */
export function heldoutSets(dir: string = import.meta.dirname): HeldOut[] {
  const shared = parsed(join(dir, "search-heldout.json"), "scripts/search-heldout.json") as HeldOut[];
  // The folder is where every set since the shared file's is: missing, those sets would be missing with no word said.
  const folder = join(dir, "heldout");
  if (!existsSync(folder)) throw new Error("scripts/heldout/ is missing: the held-out sets added since search-heldout.json live there");
  const names = readdirSync(folder);
  // Only <set>.json is read: a file named any other way would be left out with no word said.
  const odd = names.filter((f) => !f.endsWith(".json"));
  if (odd.length) throw new Error(`scripts/heldout/ holds ${odd.join(", ")}: each set is a <set>.json file (lower-case .json)`);
  const files = names.sort();
  const own = files.flatMap((f) => {
    const qs: unknown = parsed(join(folder, f), `scripts/heldout/${f}`);
    if (!Array.isArray(qs) || !qs.length || !qs.every((q) => typeof q === "string" && q.trim())) throw new Error(`scripts/heldout/${f}: a list of questions, each a non-empty string`);
    const set = basename(f, ".json");
    return (qs as string[]).map((q, i) => ({ set, n: i + 1, q }));
  });
  const all = [...shared, ...own];
  const seen = new Set<string>();
  for (const x of all) {
    const k = `${x.set} #${x.n}`;
    if (seen.has(k)) throw new Error(`held-out ${k} is given twice`);
    seen.add(k);
  }
  return all;
}
