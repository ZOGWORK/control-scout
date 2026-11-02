// Rule questions ("Can robots descore sample elements in autonomous?", "penalty for pinning", "G402") are answered from
// the Rules quick reference (src/shared/rules: summaries of the season's game manual, with its revision), never by
// matching team names. Fixed rules, no model:
//   - A query is a rule question when it names a rule ("G402", "rule 10.5.1"), or opens with "penalty", "foul" or
//     "rule", or reads as a question (src/shared/searchQuery.ts isQuestionForm) with a rule word (RULE_WORDS: descore,
//     foul, penalty, pin, inspection, …). "auto" and "teleop" count only beside another rule word or "robot".
//   - A rule answers it only when every keyword left (the question's own words, stopwords and RULE_FRAME words out)
//     is in that rule's number, title, summary, penalty or keywords, a word's start counting ("pinning" finds "pin").
//     Nothing else is shown as an answer: no rule found is said plainly.
//   - A game piece or field part of one past game ("sample", "specimen": INTO THE DEEP; PAST_GAME_WORDS) makes the
//     question that season's: it is answered from that season's reference, or, with none, by saying which game the
//     word is from and linking that season (server/api/searchRules.ts). It counts only beside a rule word, a period
//     word, "robot", "score" or "point" ("who are the rubber ducks?" stays a name), and only when the current
//     reference doesn't use the word itself (a later game can reuse one).
import { QUESTION_WORDS, STOPWORDS, isQuestionForm, singularize } from "./searchQuery.js";
import type { RuleEntry, SeasonReference } from "./rules/types.js";

/** Words that make a question a rules question. */
const RULE_WORDS = new Set([
  "descore", "descoring", "descored", "penalty", "penalties", "foul", "fouls", "card", "cards", "yellow", "red",
  "dimension", "dimensions", "size", "sizing", "expansion", "extend", "extension", "contact", "pin", "pinning", "pinned",
  "inspection", "inspect", "illegal", "legal", "allowed", "rule", "rules", "manual", "ruling", "disqualified",
  "disqualification", "interference", "interfere", "possession", "control", "controlling", "hoard", "hoarding", "violation",
  "scoring", "warning", "disabled", "defense", "defend", "ram", "ramming", "tip", "tipping", "launch", "launching",
]);
/** Words about the match period: a rule word only beside another one or "robot(s)". */
const PERIOD_WORDS = new Set(["auto", "autonomous", "teleop", "teleoperated", "endgame"]);
/** Words that frame a rules question and never narrow which rule: dropped from the keywords. */
const RULE_FRAME = new Set(["robot", "robots", "rule", "rules", "penalty", "penalties", "allowed", "legal", "illegal", "point", "points", "get", "there", "any", "much", "many", "manual", "game"]);
/** The manual's own words for what people type. */
const SYNONYM: Record<string, string> = { autonomous: "auto", teleoperated: "teleop", descoring: "descore", descored: "descore", pinning: "pin", pinned: "pin", controlling: "control", hoarding: "hoard", tipping: "tip", interfere: "interference" };

/** Words that belong to one past game, and its season. Only words a game named its own pieces or field parts. */
export const PAST_GAME_WORDS: Record<string, number> = {
  sample: 2024, specimen: 2024, submersible: 2024, ascent: 2024,
  artifact: 2025, classifier: 2025, motif: 2025, obelisk: 2025,
  pixel: 2023, backdrop: 2023, mosaic: 2023, drone: 2023,
  cone: 2022, junction: 2022,
  freight: 2021, duck: 2021, carousel: 2021,
  wobble: 2020, powershot: 2020,
  skystone: 2019, stone: 2019, foundation: 2019,
};
/** Words that, beside a past game's word, make it a rules question. */
const PAST_CONTEXT = new Set(["robot", "score", "scoring", "point", "descore"]);
/** "samples" → "sample", for the past-game lookups. */
const one = (w: string) => (w.length > 3 ? w.replace(/s$/, "") : w);

const RULE_ID = /^(?:[a-z]\d{3}|\d{1,2}(?:\.\d{1,2}){1,3})$/i;
const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9.\s-]/g, " ");

export interface RuleQuery {
  /** What the rule must say ("descore", "sample", "element", "auto"); empty when a rule number was asked. */
  keywords: string[];
  /** A rule number asked for ("G402"). */
  id: string | null;
  /** Past-game words in the question, with their season ({ sample: 2024 }); absent when none. */
  past?: Record<string, number>;
}

/** The rule question `q` asks, or null when it isn't one. `asked`: the query as typed ended in "?". */
export function readRuleQuery(q: string, asked = false): RuleQuery | null {
  const ws = fold(singularize(q)).split(/\s+/).map((w) => w.replace(/^[.-]+|[.-]+$/g, "")).filter(Boolean);
  if (!ws.length) return null;
  const id = ws.find((w) => RULE_ID.test(w) && (/^[a-z]/.test(w) || ws.includes("rule"))) ?? null;
  const strong = ws.filter((w) => RULE_WORDS.has(w));
  const period = ws.some((w) => PERIOD_WORDS.has(w)) && (strong.length > 0 || ws.some((w) => w === "robot" || w === "robots"));
  const opens = /^(?:penalty|penalties|foul|fouls|rule|rules)$/.test(ws[0]) && ws.length > 1;
  const pastWords = [...new Set(ws.map(one).filter((w) => Object.hasOwn(PAST_GAME_WORDS, w)))];
  const pastAsked = pastWords.length > 0 && (strong.length > 0 || period || ws.some((w) => PAST_CONTEXT.has(one(w))));
  const question = asked || isQuestionForm(q);
  if (!id && !opens && !(question && (strong.length || period || pastAsked))) return null;
  if (id) return { keywords: [], id: id.toUpperCase() };
  const keywords = [...new Set(ws.filter((w) => !STOPWORDS.has(w) && !QUESTION_WORDS.has(w) && !RULE_FRAME.has(w) && !/^\d+$/.test(w) && w.length > 1).map((w) => (Object.hasOwn(SYNONYM, w) ? SYNONYM[w] : w)))];
  return pastWords.length ? { keywords, id: null, past: Object.fromEntries(pastWords.map((w) => [w, PAST_GAME_WORDS[w]])) } : { keywords, id: null };
}

const haystack = (r: RuleEntry, section: string) => fold(`${r.id} ${r.title} ${r.summary} ${r.penalty ?? ""} ${(r.keywords ?? []).join(" ")} ${section}`).split(/\s+/).filter(Boolean);
/** A keyword is in the rule when a word there starts with it, or with its stem ("elements" → "element"). */
const has = (words: string[], k: string) => { const stem = k.replace(/(?:ing|ed|es|s)$/, ""); return words.some((w) => w.startsWith(k) || (stem.length >= 4 && w.startsWith(stem))); };

/** The past season a rule question is about: its past-game words the reference `ref` doesn't use, newest season. */
export function pastSeasonOf(ref: SeasonReference, rq: RuleQuery): { season: number; words: string[] } | null {
  if (!rq.past) return null;
  const title = new Map(ref.sections.map((s) => [s.id, s.title]));
  const used = new Set(ref.rules.flatMap((r) => haystack(r, title.get(r.section) ?? "")).map(one));
  const words = Object.keys(rq.past).filter((w) => !used.has(w) && rq.past![w] !== ref.season);
  if (!words.length) return null;
  const season = Math.max(...words.map((w) => rq.past![w]));
  return { season, words: words.filter((w) => rq.past![w] === season) };
}

/** The rules that answer a rule question: the numbered rule, or those with every keyword (manual order). */
export function rulesFor(ref: SeasonReference, rq: RuleQuery): RuleEntry[] {
  if (rq.id) return ref.rules.filter((r) => r.id.toUpperCase() === rq.id);
  if (!rq.keywords.length) return [];
  const title = new Map(ref.sections.map((s) => [s.id, s.title]));
  return ref.rules.filter((r) => { const ws = haystack(r, title.get(r.section) ?? ""); return rq.keywords.every((k) => has(ws, k)); });
}
