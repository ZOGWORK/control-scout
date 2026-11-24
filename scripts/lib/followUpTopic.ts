// What a search's People also ask / Related searches are allowed to be about (scripts/search-followups.ts): the
// things the search named or its answer card is about. Pure: the script reads the parse and the answer, this judges.
import { fold } from "../../src/shared/query/names.js";

/** The parts of a search's reading and answer a follow-up may name. */
export type Subject = {
  teams: { number: number; name?: string | null }[];
  /** An event as typed or as the answer names it ("nj championship", "USNJCMP"). */
  events: string[];
  /** A place as typed or as stored ("nj", "New Jersey"). */
  places: string[];
  /** The query's own words, for a search that names none of the above ("highest score in 2025-26"). */
  words: string[];
};

/** Words too common to make two searches about the same thing. */
const COMMON = new Set(("the a an of in at on for to and or vs with from by is are was were what who whos which when how many much "
  + "has have had did does do team teams ftc season seasons this last next year years best top most highest lowest score scores "
  + "record opr rating rank ranked event events match matches win wins won ever all every right now current").split(" "));

/** `phrase` as whole words in `text`, a possessive's "s" allowed (fold reads "4215's" as "4215s"). */
const has = (text: string, phrase: string) => phrase.length > 0 && new RegExp(`(?:^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?: |$)`).test(text);

/** The subject's things, folded, each a phrase a follow-up names it by. A name shorter than 3 letters is too common. */
export function namesOf(s: Subject): string[] {
  const out = new Set<string>();
  for (const t of s.teams) {
    out.add(String(t.number));
    const n = fold(t.name ?? "");
    if (n.length >= 3 && !COMMON.has(n)) out.add(n);
  }
  for (const x of [...s.events, ...s.places]) { const n = fold(x); if (n.length >= 2 && !COMMON.has(n)) out.add(n); }
  return [...out];
}

/** Why follow-up `q` is off the subject, or null when it names one of its things. A subject with no team, event or
 *  place is matched on its own words instead (at least one shared word of 3+ letters, common ones aside). */
export function offTopic(q: string, s: Subject): string | null {
  const text = fold(q);
  const things = namesOf(s);
  if (things.length) return things.some((n) => has(text, n)) ? null : `names none of ${things.slice(0, 6).join(", ")}`;
  const words = [...new Set(s.words.map(fold).flatMap((w) => w.split(" ")))].filter((w) => w.length >= 3 && !COMMON.has(w) && !/^\d+$/.test(w));
  if (!words.length) return null;
  return words.some((w) => has(text, w)) ? null : `shares no word with the search (${words.slice(0, 6).join(", ")})`;
}
