// What a search answer lists, in order, for the header's dropdown and the /search page alike (docs/search.md):
// Bruno AI's suggestion (labelled as his, when he was asked), the results by kind (a team's events to pick
// under it), the closest matches when nothing matched, the site pages a word names, and where to browse.
// Every row is a link; the keyboard walks them in this order.
import type { SearchAnswer, SearchHit, SearchPageLink } from "./api.js";
import { SEARCH_GROUPS } from "./search.js";

export type SectionId = SearchHit["kind"] | "ai" | "closest" | "pages" | "browse";

export interface AnswerRow {
  key: string;
  hit: SearchHit;
  /** A team's event under it ("… OPR at this event"): shown indented. */
  sub?: boolean;
}

export interface AnswerSection { id: SectionId; title: string; rows: AnswerRow[] }

/** The lines above the rows: what the query was read as. */
export interface AnswerNotes {
  didYouMean?: string;
  understood: string[];
  /** What was asked but doesn't exist yet ("There's no reputation score…"), beside the closest real result. */
  gap?: string;
  /** Bruno AI's reading: `refined` when he rewrote the query, null when he found nothing to search for. */
  ai?: { refined: string | null; found: boolean };
}

const pageHit = (p: SearchPageLink): SearchHit => ({ kind: "place", ref: p.href, title: p.title, subtitle: "", season: null, href: p.href });
const keyOf = (h: SearchHit) => `${h.kind}:${h.ref}${h.atEvent ? `@${h.atEvent}` : ""}${h.href ? `>${h.href}` : ""}`;

/** A hit's rows: the hit, then its events to pick from (each opens the event on the team). */
function rowsOf(h: SearchHit, prefix: string): AnswerRow[] {
  const events = h.kind === "team" ? h.events ?? [] : [];
  return [
    { key: `${prefix}${keyOf(h)}`, hit: h },
    ...events.map((e): AnswerRow => ({
      key: `${prefix}${keyOf(h)}@${e.season}:${e.code}`, sub: true,
      hit: { kind: "team", ref: h.ref, atEvent: `${e.season}:${e.code}`, title: e.name, subtitle: e.opr != null ? `Event OPR ${e.opr.toFixed(1)}` : "No OPR at this event", season: e.season },
    })),
  ];
}

const byKind = (hits: SearchHit[], prefix = ""): AnswerSection[] =>
  SEARCH_GROUPS.map(([kind, title]): AnswerSection => ({ id: kind, title, rows: hits.filter((h) => h.kind === kind).flatMap((h) => rowsOf(h, prefix)) })).filter((s) => s.rows.length);

/** Plain hits (offline, or a box limited to some kinds): the kinds in order, nothing else. */
export const plainSections = (hits: SearchHit[]): AnswerSection[] => byKind(hits);

/** The sections and notes for an answer, and Bruno AI's, when there is one for the same query. */
export function answerSections(answer: SearchAnswer, ai?: SearchAnswer | null): { sections: AnswerSection[]; notes: AnswerNotes } {
  const sections: AnswerSection[] = [];
  const notes: AnswerNotes = { understood: [] };
  // His suggestion is his own section, above search's own results, and named as his.
  if (ai?.step === "ai" && ai.hits.length) {
    sections.push({ id: "ai", title: "Bruno AI suggestion", rows: ai.hits.slice(0, 5).flatMap((h) => rowsOf(h, "ai/")) });
    notes.ai = { refined: ai.refined ?? null, found: true };
  } else if (ai?.recovery?.ai) {
    notes.ai = { refined: ai.recovery.ai.refined, found: false };
  }
  if (answer.step === "did-you-mean" && answer.didYouMean) notes.didYouMean = answer.didYouMean;
  if (answer.intent) { notes.understood = [`Understood: ${answer.intent.understood.join(" · ")}`]; if (answer.intent.gap) notes.gap = answer.intent.gap; }
  sections.push(...byKind(answer.hits));
  if (answer.step === "recovery" && answer.recovery) {
    notes.understood = answer.recovery.understood;
    if (answer.recovery.closest.length) sections.push({ id: "closest", title: "Closest matches", rows: answer.recovery.closest.flatMap((h) => rowsOf(h, "closest/")) });
  }
  if (answer.pages.length) sections.push({ id: "pages", title: "Pages", rows: answer.pages.map((p) => ({ key: `page:${p.href}`, hit: pageHit(p) })) });
  if (answer.step === "recovery" && answer.recovery?.browse.length) {
    sections.push({ id: "browse", title: "Browse", rows: answer.recovery.browse.map((p) => ({ key: `browse:${p.href}`, hit: pageHit(p) })) });
  }
  return { sections, notes };
}

/** Whether an API answer is a whole search answer (the server's), not plain hits (offline, pickers). */
export const isAnswer = (x: unknown): x is SearchAnswer =>
  !!x && typeof x === "object" && typeof (x as SearchAnswer).step === "string" && Array.isArray((x as SearchAnswer).hits) && Array.isArray((x as SearchAnswer).pages);
