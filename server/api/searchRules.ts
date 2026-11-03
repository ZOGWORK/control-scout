// A rules question's answer (src/shared/searchRuleQuery.ts reads it): the matching entries of the season's Rules
// quick reference (src/shared/rules, the only rules source in Control Scout: our summaries of FIRST's game manual,
// each with its manual revision), as a card, each rule linked to its entry on /rules. Never team or event hits.
// No rule found, or the reference switched off (flag rulesReference): said plainly, with the Rules page and the
// official manual to go to. The /search page asks Bruno AI for a written answer to questions on its own, as before.
import type { SearchAnswer, SearchCardLine } from "../../src/shared/api.js";
import { pagesFor } from "../../src/shared/search.js";
import { pastSeasonOf, rulesFor, type RuleQuery } from "../../src/shared/searchRuleQuery.js";
import { ruleReference } from "../../src/shared/rules/index.js";
import { hasRuleReference } from "../../src/shared/rules/seasons.js";
import { pastManual } from "../../src/shared/rules/pastManuals.js";
import { CURRENT_SEASON, seasonInfo } from "../data/seasons.js";
import { isEnabled } from "../flags.js";

/** The most rules one card lists; the rest are on /rules. */
const MAX_RULES = 5;

export async function ruleAnswer(q: string, rq: RuleQuery): Promise<SearchAnswer> {
  // A past game's piece ("sample": INTO THE DEEP): that season's reference, or which game it is and a link to it.
  // A season named outright ("G402 in 2024-25") decides first; then an older game's piece.
  const past = rq.season != null ? (rq.season === CURRENT_SEASON ? null : { season: rq.season, words: [] }) : pastSeasonOf(ruleReference(CURRENT_SEASON), rq);
  if (past && !hasRuleReference(past.season)) return pastGameAnswer(q, rq, past);
  const ref = ruleReference(past?.season ?? CURRENT_SEASON);
  const pages = [...pagesFor(q).filter((p) => p.href !== "/rules"), { title: "Rules", href: "/rules" }];
  const asked = rq.id ?? rq.keywords.join(" ");
  const base = { q, hits: [], pages, step: "deterministic" as const, weak: false, understood: { kind: "question" as const, label: `A rules question: ${rq.id ? `rule ${rq.id}` : `"${asked}"`}` } };
  const title = `Rules quick reference · ${ref.game} ${ref.label} (manual ${ref.manual.revision})`;
  if (!(await isEnabled("rulesReference").catch(() => false))) {
    return { ...base, pages: pagesFor(q), card: { kind: "rule", title, lines: [{ text: `${ref.game} game manual`, detail: `FIRST's official manual, ${ref.manual.revision}`, href: ref.manual.url }], none: "The rules quick reference is switched off for now. The official game manual has every rule." } };
  }
  const rules = rulesFor(ref, rq);
  const lines: SearchCardLine[] = rules.slice(0, MAX_RULES).map((r) => ({
    text: `${r.id} · ${r.title}`, detail: r.summary, // Scoring entries (section 10.5) hold what they're worth, as /rules shows them; the rest, a penalty.
    ...(r.penalty ? { results: [`${r.section.startsWith("10.5") ? "Worth" : "Penalty"}: ${r.penalty}`] } : {}), href: `/rules#${encodeURIComponent(r.id)}`,
  }));
  const more = rules.length > MAX_RULES ? ` (${rules.length - MAX_RULES} more on the Rules page)` : "";
  return {
    ...base,
    card: rules.length
      ? { kind: "rule", title: `${title}${more}`, lines }
      : { kind: "rule", title, lines: [], none: `No rule found for "${asked}" in the ${ref.game} ${ref.label} quick reference. Try the Rules page, or ask the question in full on the official Q&A.` },
  };
}

/** A rules question about a past game we hold no quick reference for: never this season's rules, never a guess. */
function pastGameAnswer(q: string, rq: RuleQuery, past: { season: number; words: string[] }): SearchAnswer {
  const game = seasonInfo(past.season);
  const now = seasonInfo(CURRENT_SEASON);
  const manual = pastManual(past.season);
  const quoted = past.words.map((w) => `"${w}"`).join(" and ");
  const asked = past.words.length ? `${quoted} ${past.words.length > 1 ? "are" : "is"} from ${game.game} (${game.label})` : `A ${game.game} (${game.label}) rule${rq.id ? `: ${rq.id}` : ""}`;
  return {
    q, hits: [], step: "deterministic", weak: false,
    pages: pagesFor(q),
    understood: { kind: "question", label: `A rules question about ${game.game} (${game.label})${quoted ? `: ${quoted}` : rq.id ? `: rule ${rq.id}` : ""}`, season: past.season },
    card: {
      kind: "rule",
      title: `${game.game} ${game.label} rules`,
      lines: [
        { text: asked, detail: `Not this season's ${now.game}. There's no ${game.game} quick reference here; its rules are in that season's game manual.` },
        { text: `${game.game} game manual`, detail: manual.what, href: manual.url },
        { text: `${game.game} ${game.label} season`, detail: "Its events and results", href: `/events?season=${past.season}` },
      ],
    },
  };
}
