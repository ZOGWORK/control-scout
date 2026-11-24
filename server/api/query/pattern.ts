// A failed search as a pattern (docs/search-pipeline.md, "Failure patterns"), for failed-search reporting
// (server/searchFailures.ts): what the pipeline read, with every name, number and place left out, so a thousand
// queries that fail the same way are one entry, not a thousand. The words it couldn't read are kept beside it, counted,
// so a missing synonym shows up as the word most often missed.
//
// "12345 opr in the scorecard" and "copper lanterns opr in the scorecard" are both
//   intent: team opr · slots: team · not read: scorecard
// with "scorecard" counted under it. The words it couldn't read are part of the key (audit M8, 24 Nov): one gap is one
// entry, so "who is your creator?" and an unknown team name never share an issue as "unread question · 2 words" did
// (#793). Numbers said as words are read as digits first, as search reads them, so "opr over eighty" and "opr over 80"
// are one pattern.
import { describe, parseQuery } from "./parse.js";
import { parseContext } from "./context.js";
import { spelledNumbers } from "./lexicon.js";

/** `read`: what the parser made of the query, for the soft-failure check (server/searchFailures.ts softFailureOf). */
/** `legacy`: the key as it was before unread words were part of it ("not read: 2 words"), so a failure whose old pattern
 *  has an open or dismissed issue keeps landing there (server/searchFailures.ts onRows). */
export interface Pattern { key: string; missed: string[]; read: { intent: string | null; complete: boolean }; legacy: string }

/** The unread words in a key: lower case, each once, sorted, three at most ("+2" for the rest). */
export const UNREAD_IN_KEY = 3;
export function unreadKey(missed: string[]): string {
  const ws = [...new Set(missed)].sort();
  return `${ws.slice(0, UNREAD_IN_KEY).join(" ")}${ws.length > UNREAD_IN_KEY ? ` +${ws.length - UNREAD_IN_KEY}` : ""}`;
}

/** The pattern a query reads as, and the words it couldn't read (lower case, never a number). */
export async function failurePattern(q: string, now = Date.now()): Promise<Pattern> {
  const p = await parseQuery(spelledNumbers(q), await parseContext(now));
  const intent = p.intent ? (describe(p).find((d) => d.startsWith("Intent: "))?.slice(8) ?? p.intent) : "unread question";
  const slots = [
    p.teams.length === 1 ? "team" : p.teams.length > 1 ? "teams" : null,
    p.place ? p.place.kind : null, p.event ? "event" : null, p.time ? (p.time.kind === "window" ? "window" : p.time.kind) : null,
    p.n != null ? "count" : null, p.level, p.alliance, p.worlds ? "worlds" : null, p.states ? "states" : null,
  ].filter((x): x is string => !!x);
  // Every word the parser left, a lexicon word too ("offensive" without "power rating" was never read).
  const missed = p.leftover.map((w) => w.toLowerCase()).filter((w) => !/^\d+$/.test(w));
  const parts = [
    `intent: ${intent.toLowerCase()}`,
    `slots: ${slots.length ? slots.join(", ") : "none"}`,
    ...(p.unexplained.length ? [`unexplained: ${[...p.unexplained].sort().join(", ")}`] : []),
    // No intent: what it did read, so "… rp scorecard" and "… reliability scorecard" stay apart.
    ...(!p.intent ? [`read: ${p.symbols.filter((s) => !s.startsWith("prep:")).sort().join(", ") || "nothing"}`] : []),
  ];
  const said = missed.length ? [`not read: ${unreadKey(missed)}`] : [];
  const counted = missed.length ? [`not read: ${missed.length === 1 ? "1 word" : `${Math.min(missed.length, 3)}${missed.length > 3 ? "+" : ""} words`}`] : [];
  return { key: [...parts, ...said].join(" · "), missed, read: { intent: p.intent ?? null, complete: !!p.complete }, legacy: [...parts, ...counted].join(" · ") };
}
