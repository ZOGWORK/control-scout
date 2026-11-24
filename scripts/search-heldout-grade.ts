// Grading a held-out answer against the answer a person wrote for it (`want`, the q260 set's, audit M2, 24 Nov).
// Before this a question "passed" when a card appeared. A want is mostly prose ("Lowest OPR event in 2025–26, P1-4 PM
// Northern League Meet, OPR 52.4"); only the facts in it that stay true are checked: a record (26-6-0), a number with a
// decimal (101.6), and the names of a short want that is only names ("Oradell, NJ, USA", "Hypnotic Robotics",
// "Rookie year 2010"). Each must be in the answer. Ranks (#612 of 8,308) move as teams are added, and ratings (98 ±
// 3.2) with each engine version, so neither is held to the number written on 4 Nov: a want about a rating has no
// decimal checked (the team-page check, crosscheck.ts, compares ratings against the data instead).
//
// The wants were written for 2025–26 (2024–25 where that is the only season they name): wantSeason. The runner asks
// a wanted question in that season, as the page's season picker would, when its own answer is about another one. An
// answer still about another season is "unchecked", never wrong. Pure: the runner (scripts/search-heldout.ts) reads,
// this decides.

export type WantVerdict = { verdict: "correct" | "wrong" | "unchecked"; facts: string[]; missing: string[]; note?: string };

/** The season the wants were written in (2025–26). */
export const WANT_SEASON = 2025;

export const foldText = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[‐-―−]/g, "-").replace(/\s+/g, " ");

/** A want that is only names and numbers, no description: "Oradell, NJ, USA", "Gene Haas, Unique Scaffolding", "2010". */
const NAMES_ONLY = /^(?:[A-Z0-9][\w.'&]*(?: [A-Z0-9][\w.'&]*)*)(?:, (?:[A-Z0-9][\w.'&]*(?: [A-Z0-9][\w.'&]*)*))*$/;
/** Words that make a short want a description, not a value ("Rookie year 2010" keeps only 2010). */
const LEAD = /^(?:rookie year|rookie|sponsors?|region)\s+/i;

/** The checkable facts in a want, as they'd be written in an answer (folded). */
export function wantFacts(want: string): string[] {
  const w = want.replace(/[‐-―−]/g, "-");
  const facts = new Set<string>();
  for (const m of w.matchAll(/(?<![\d.-])\d+-\d+-\d+(?![\d-])/g)) facts.add(m[0]);
  if (!/rating|±/i.test(w)) for (const m of w.matchAll(/(?<![\d.,#])\d+\.\d+(?![\d.])/g)) facts.add(m[0]);
  const bare = w.trim().replace(LEAD, "");
  if (bare.length <= 60 && NAMES_ONLY.test(bare)) for (const part of bare.split(", ")) facts.add(part.trim());
  return [...facts].map(foldText);
}

/** The season a want is about: 2024–25 when that is the only season it names, else the one they were written in. */
export const wantSeason = (want: string) => (/2024[–-]25/.test(want) && !/2025[–-]26/.test(want) ? WANT_SEASON - 1 : WANT_SEASON);

/** A fact is in the text as a whole token (101.6 is not in 1101.65; "nj" is not in "njord"). A number of four digits
 *  or more may be written with a thousands comma. */
function has(text: string, fact: string): boolean {
  const esc = fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withCommas = /^\d{4,}$/.test(fact) ? `(?:${esc}|${Number(fact).toLocaleString("en-US")})` : esc;
  return new RegExp(`(?<![\\p{L}\\p{N}.])${withCommas}(?![\\p{L}\\p{N}]|\\.\\d)`, "u").test(text);
}

/** The want's facts against the answer's text. `season`: the season the answer is about (null: not said). */
export function gradeWant(want: string | undefined, answerText: string, season: number | null): WantVerdict {
  const facts = want ? wantFacts(want) : [];
  if (!facts.length) return { verdict: "unchecked", facts, missing: [], note: want ? "nothing checkable in the want" : "no want" };
  const asked = wantSeason(want!);
  if (season != null && season !== asked) return { verdict: "unchecked", facts, missing: [], note: `answer is about ${season}, the want ${asked}` };
  const text = foldText(answerText);
  const missing = facts.filter((f) => !has(text, f));
  return { verdict: missing.length ? "wrong" : "correct", facts, missing };
}
