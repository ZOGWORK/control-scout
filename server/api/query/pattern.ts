// A failed search as a pattern (docs/search-pipeline.md, "Failure patterns"), for failed-search reporting
// (server/searchFailures.ts): what the pipeline read, with every name, number and place left out, so a thousand
// queries that fail the same way are one entry, not a thousand. The words it couldn't read are kept beside it, counted,
// so a missing synonym shows up as the word most often missed.
//
// "12345 opr in the scorecard" and "copper lanterns opr in the scorecard" are both
//   intent: team opr · slots: team · not read: 1 word
// with "scorecard" counted under it.
import { describe, parseQuery } from "./parse.js";
import { parseContext } from "./context.js";
import { LEXICON } from "./lexicon.js";

export interface Pattern { key: string; missed: string[] }

const LEX = new Set(LEXICON.flatMap((e) => e.words));

/** The pattern a query reads as, and the words it couldn't read (lower case, never a number). */
export async function failurePattern(q: string, now = Date.now()): Promise<Pattern> {
  const p = await parseQuery(q, await parseContext(now));
  const intent = p.intent ? (describe(p).find((d) => d.startsWith("Intent: "))?.slice(8) ?? p.intent) : "unread question";
  const slots = [
    p.teams.length === 1 ? "team" : p.teams.length > 1 ? "teams" : null,
    p.place ? p.place.kind : null, p.event ? "event" : null, p.time ? (p.time.kind === "window" ? "window" : p.time.kind) : null,
    p.n != null ? "count" : null, p.level, p.alliance, p.worlds ? "worlds" : null, p.states ? "states" : null,
  ].filter((x): x is string => !!x);
  const missed = p.leftover.map((w) => w.toLowerCase()).filter((w) => !/^\d+$/.test(w) && !LEX.has(w));
  const parts = [
    `intent: ${intent.toLowerCase()}`,
    `slots: ${slots.length ? slots.join(", ") : "none"}`,
    ...(p.unexplained.length ? [`unexplained: ${[...p.unexplained].sort().join(", ")}`] : []),
    ...(missed.length ? [`not read: ${missed.length === 1 ? "1 word" : `${Math.min(missed.length, 3)}${missed.length > 3 ? "+" : ""} words`}`] : []),
  ];
  return { key: parts.join(" · "), missed };
}
