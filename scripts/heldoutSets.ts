// The held-out sets (scripts/search-heldout.ts): the first ones in scripts/search-heldout.json ({ set, n, q }), and one
// file a set in scripts/heldout/ (<set>.json: its questions, in order; each one's number is its place). A change that
// adds a set adds its own file, so two changes adding sets never edit the same lines.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export interface HeldOut { set: string; n: number; q: string }

/** Every held-out question, the shared file's first, then each set's own file by name. Throws on a file that isn't a
 *  list of questions, or on a set and number given twice (a set in both places, or a file named as a shared set). */
export function heldoutSets(dir: string = import.meta.dirname): HeldOut[] {
  const shared = JSON.parse(readFileSync(join(dir, "search-heldout.json"), "utf8")) as HeldOut[];
  const folder = join(dir, "heldout");
  const files = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".json")).sort() : [];
  const own = files.flatMap((f) => {
    const qs: unknown = JSON.parse(readFileSync(join(folder, f), "utf8"));
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
