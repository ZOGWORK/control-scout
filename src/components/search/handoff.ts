// What the search box's dropdown already found, handed to /search when Enter opens it: the box has the answer on
// screen, so the results page draws it at once instead of a loading screen while it asks again about the same words.
//
// The page's own answer replaces it as soon as it arrives, so this is a head start, never a source of numbers: what a
// visitor sees a moment later is always the server's answer to the request /search makes. Only a whole answer is kept
// (never a picker's list limited to some kinds), and only briefly, so nothing from an earlier search can stand in for
// a new one.
import type { SearchAnswer } from "../../shared/api";

/** How long a handed answer may seed the page: long enough for Enter right after the dropdown filled, short enough
 *  that it can never be mistaken for a later search's results. */
export const HANDOFF_MS = 60_000;

let last: { at: number; answer: SearchAnswer } | null = null;

/** The words compared: case and repeated spaces only, so the query as typed matches the answer's own `q`. */
const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** Keep `answer` as the one Enter may start the results page from. */
export function handOffAnswer(answer: SearchAnswer): void {
  last = { at: Date.now(), answer };
}

/** The answer this tab already has for `q`: null when there is none, it answers another query, or it is too old. */
export function handedAnswer(q: string, now = Date.now()): SearchAnswer | null {
  return last && now - last.at <= HANDOFF_MS && same(last.answer.q, q) ? last.answer : null;
}
