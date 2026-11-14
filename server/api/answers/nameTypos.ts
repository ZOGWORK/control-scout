// Event names stored with a typo (one event's name missing a letter that eight other events spell in full): never
// offered as a question to try (./videoSuggest.ts). Precise by design, from the event names alone: a word reads as a
// typo only when no other event's name has it, and it is a slip from a word in at least three other events' names: a
// letter dropped, a letter doubled, or two swapped, inside the word (never its first or last letter). Real names differ
// from common words by just the other kinds, so those never count: a letter changed ("Grant", "Grand"), added
// ("Texans", "Texas"; "Johnston", "Johnson") or at the end ("Australian", "Australia"). A rare real name ("Humber",
// "Cactus Wren", "Défi Robotique") has no such neighbour and stays. Words are compared with accents stripped on both
// sides (fuzzy.ts words). Built once per search index version, off the request path: at server start, every few seconds
// after (server/index.ts), and, while a newer one builds, the last one is used.
import { all } from "../../db.js";
import { registerCache } from "../../caches.js";
import { words } from "../fuzzy.js";
import { searchVersion } from "../searchReads.js";

/** Shortest word read as a typo: shorter ones have too many real neighbours ("Quail", "Qual"; "Twain", "Twin"). */
const MIN_LEN = 6;
/** Other events' names the usual spelling must be in. */
const NEIGHBOUR_NAMES = 3;

/** `w` is `c` typed with one letter dropped, one doubled, or two side by side swapped, inside the word: its first and
 *  last letters are `c`'s own. */
export function slip(w: string, c: string): boolean {
  if (w === c || w[0] !== c[0] || w.at(-1) !== c.at(-1)) return false;
  if (Math.abs(w.length - c.length) === 1) {
    const [s, l] = w.length < c.length ? [w, c] : [c, w];
    let i = 0;
    while (i < s.length && s[i] === l[i]) i++;
    if (!(i > 0 && i < l.length - 1 && l.slice(i + 1) === s.slice(i))) return false;
    // A letter dropped, or one added only when it doubles the one before it ("Herritage").
    return w.length < c.length || w[i] === w[i - 1];
  }
  if (w.length !== c.length) return false;
  let i = 0;
  while (i < w.length && w[i] === c[i]) i++;
  return i > 0 && i + 1 < w.length - 1 && w[i] === c[i + 1] && w[i + 1] === c[i] && w.slice(i + 2) === c.slice(i + 2);
}

/** The words of `names` that read as typos (accents stripped, lower case). */
export function typoWords(names: Iterable<string>): Set<string> {
  const each = [...new Set(names)].map((n) => new Set(words(n)));
  // How many names have each word, and, for a word only one has, that name's words.
  const count = new Map<string, number>();
  const only = new Map<string, Set<string>>();
  for (const ws of each) for (const w of ws) {
    const n = (count.get(w) ?? 0) + 1;
    count.set(w, n);
    if (n === 1) only.set(w, ws); else only.delete(w);
  }
  // Words by first letter and length: a word is measured only against those that could be one slip away.
  const by = new Map<string, string[]>();
  for (const w of count.keys()) {
    if (!/^\p{L}+$/u.test(w)) continue;
    const k = `${w[0]}|${w.length}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(w);
  }
  const out = new Set<string>();
  for (const [w, own] of only) {
    if (w.length < MIN_LEN || !/^\p{L}+$/u.test(w)) continue;
    near: for (const len of [w.length - 1, w.length, w.length + 1]) {
      for (const c of by.get(`${w[0]}|${len}`) ?? []) {
        const others = (count.get(c) ?? 0) - (own.has(c) ? 1 : 0);
        if (others >= NEIGHBOUR_NAMES && slip(w, c)) { out.add(w); break near; }
      }
    }
  }
  return out;
}

/** Whether a text has none of `typos`' words. */
export const spelledBy = (text: string, typos: ReadonlySet<string>) => !words(text).some((w) => typos.has(w));

let built: { version: string; typos: Set<string> } | null = null;
let building: Promise<void> | null = null;
/** Clear caches pressed so far: a build one of them overlapped is kept as stale, so the next use builds again. */
let clears = 0;
/** Builds the set for the data as it is now, once at a time. */
const refresh = (): Promise<void> => building ??= (async () => {
  const at = clears;
  const version = await searchVersion();
  if (built?.version === version) return;
  const rows = await all<{ name: string }>("SELECT DISTINCT name FROM events WHERE name IS NOT NULL");
  built = { version: at === clears ? version : "", typos: typoWords(rows.map((r) => r.name)) };
})().finally(() => { building = null; });

/** The event-name typos: the set built last, a newer one started when the data has moved. Only the very first build
 *  (none yet: a server that never warmed) is waited on. */
export async function nameTypos(): Promise<ReadonlySet<string>> {
  if (!built) await refresh();
  else if (built.version !== (await searchVersion())) void refresh().catch(() => {});
  if (!built) throw new Error("event-name typos not built");
  return built.typos;
}

/** Builds the set ahead of a search (server start, and after the data moves). */
export const warmNameTypos = (): Promise<void> => refresh();
// The owner's Clear caches marks it stale: the next use, or server/index.ts's next warm, builds it again in the
// background, and the last one is used until then. Never read here: a process with no database open (a test) would
// open the default one.
export function forgetNameTypos() {
  clears++;
  if (built) built = { ...built, version: "" };
}
registerCache("Search answers: event-name typos", forgetNameTypos);
