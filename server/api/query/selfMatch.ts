// One team asked against itself ("predict 12345 vs 12345", "what if 12345 plays against itself"): a match puts two
// different teams on opposite alliances, so there is no call to make. The card says so plainly and opens the team's
// own forecasts (Predict on its scheduled matches) and its page, never a no-match page.
import type { SearchAnswer, SearchHit, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { predictHref } from "../../../src/shared/predictUrl.js";
import { normalise, type Parsed } from "./parse.js";

/** The words that set one side against the other ("vs", "against", "plays"), as the lexicon's "vs" reads them. */
const VS = String.raw`(?:vs|v|versus|against|facing|face|faced|play|played|playing|plays)`;
/** The team's number, then a "vs", then the team itself again: by a word ("itself") or by its number. */
const SELF = (n: number) => new RegExp(String.raw`(?:^| )${n} (?:.* )?${VS} (?:(?:the )?same team|itself|themselves|themself|${n})(?= |$)`);

/** Whether `p` (one team read, a "vs" said) asks that team against itself: its number on both sides of the "vs", or
 *  "itself" after it. A season or another number typed ("12345 2024 vs 12345 2025") is a team's two seasons, not this. */
export function asksSelfMatch(q: string, p: Parsed): boolean {
  if (p.teams.length !== 1 || p.vsAt == null || p.time || p.event || p.worlds || p.states) return false;
  const n = p.teams[0].number, said = normalise(q);
  // Every number typed is the team's own.
  if ((said.match(/\b\d+\b/g) ?? []).some((w) => Number(w) !== n)) return false;
  return SELF(n).test(said);
}

/** The card: no match between a team and itself, with that team's own forecasts to open. */
export function selfMatchAnswer(p: Parsed, hit: SearchHit | undefined, pages: SearchPageLink[], full: boolean): SearchAnswer {
  const t = p.teams[0], who = `${t.name ?? `Team ${t.number}`} (${t.number})`;
  const predict = { label: `Open in Predict: ${t.number}'s scheduled matches`, href: predictHref({ mode: "scheduled", pick: { kind: "team", team: t.number } }) };
  const stat: StatAnswer = {
    family: "stat", intent: "self-match", title: `${t.number} can't play itself`, team: { number: t.number, name: t.name },
    scope: [], blocks: [{ kind: "links", title: "Open", items: [predict, { label: `${who}'s page`, href: `/teams/${t.number}` }] }],
    none: `A match puts two different teams on opposite alliances, so there's no prediction for ${who} against itself. Its own forecasts are in Predict.`,
    definition: "A match is played between two alliances of different teams; one team can't be on both.",
    source: "FTC match rules",
  };
  return {
    q: p.q, hits: hit ? [{ ...hit, facts: undefined, events: undefined }] : [], pages: [{ title: predict.label, href: predict.href }, ...pages],
    step: "deterministic", weak: false, understood: { kind: "question", label: stat.title }, ...(full ? { stat } : {}),
    intent: { kind: "stat-self-match", pattern: "[team] vs [same team]", met: true, understood: [] },
  };
}
