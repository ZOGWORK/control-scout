// An event's initialisms, as people shorten its name (owner: "MTI highlights" for the Multinational Tech
// Invitational): the first letters of its significant words, and any short form its name states in parentheses
// ("… Invitational (MTI)"). Read from the stored names, never typed here; the search index holds them with the
// event's other words (server/stats/job.ts), so a query word that is one finds the event.
import { fold } from "./names.js";

/** Words an initialism skips ("Festival of the Robots" is FR). */
const SMALL = new Set(["of", "the", "and", "for", "at", "in", "a", "an", "on", "to", "by", "de", "la", "du", "des", "y", "et"]);

/** The lowest and highest length an initialism has: a 2-word name's to a 6-word one's. */
export const INITIALISM_LETTERS = [2, 6] as const;

/** `name`'s initialisms, lower case: what it states in parentheses, then its significant words' first letters (only
 *  for a name of 2 to 6 such words, none of them a number or a date). */
export function eventInitialisms(name: string): string[] {
  const out = new Set<string>();
  for (const m of String(name ?? "").matchAll(/\(([A-Za-z]{2,6})\)/g)) out.add(m[1].toLowerCase());
  const ws = fold(String(name ?? "").replace(/\([^)]*\)/g, " ")).split(" ").filter((w) => w && !SMALL.has(w));
  if (ws.length >= INITIALISM_LETTERS[0] && ws.length <= INITIALISM_LETTERS[1] && ws.every((w) => /^[a-z]/.test(w))) out.add(ws.map((w) => w[0]).join(""));
  return [...out];
}
