// The header dropdown's groups (FTC One Search, Requirement 17): the answer's own sections in the /search page's
// order, with a Compare pulled out into its own group above everything (never a team, never counted as one), and
// teams that only share a word with the query apart from the exact ones. Presentation only: no row is added or
// dropped, so the dropdown is always the top of the page's set.
import type { SearchAnswer, SearchHit } from "../../shared/api";
import type { AnswerNotes, AnswerSection } from "../../shared/searchSections";
import { SEARCH_GROUPS } from "../../shared/search";
import { unreadNote } from "../../shared/searchPage";
import { fuzzyWords, isCompare, isFuzzy } from "./page/results";

export type DropId = AnswerSection["id"] | "compare" | "fuzzy";
export type DropSection = Omit<AnswerSection, "id"> & { id: DropId };

const KINDS = new Set<DropId>(SEARCH_GROUPS.map(([k]) => k));

export function dropdownSections(sections: AnswerSection[], hits: SearchHit[]): DropSection[] {
  // From the hits themselves: a Compare of its own kind ("compare") is in no kind's section, an older one is a team's.
  const compare: DropSection = { id: "compare", title: "Comparisons", rows: hits.filter(isCompare).map((h) => ({ key: `compare:${h.ref}>${h.href ?? ""}`, hit: h })) };
  const out: DropSection[] = [];
  for (const s of sections) {
    // Only the answer's own hits moved up: Bruno AI's suggestion and the closest matches keep theirs.
    const rows = KINDS.has(s.id) ? s.rows.filter((r) => r.sub || !isCompare(r.hit)) : s.rows;
    if (!rows.some((r) => !r.sub)) continue;
    if (s.id === "team" && rows.some((r) => !r.sub && isFuzzy(r.hit))) {
      // A team's events stay under it, in whichever group it went to.
      const exact: typeof rows = [], fuzzy: typeof rows = [];
      let into = exact;
      for (const r of rows) { if (!r.sub) into = isFuzzy(r.hit) ? fuzzy : exact; into.push(r); }
      if (exact.length) out.push({ ...s, rows: exact });
      const word = fuzzyWords(hits);
      out.push({ id: "fuzzy", title: word ? `Other teams matching “${word}”` : "Other teams", rows: fuzzy });
      continue;
    }
    out.push({ ...s, rows });
  }
  return compare.rows.length ? [compare, ...out] : out;
}

/** The notes above the rows, with the live "we understood" line: what the server read the query as
 *  (`understood.label`, the /search page's own heading), in place of the older intent line. A correction already
 *  says what it was read as, and a query that found nothing has its own lines. */
export function dropdownNotes(notes: AnswerNotes, answer: SearchAnswer | undefined): AnswerNotes {
  const label = answer?.understood?.label?.trim();
  if (!label || answer?.step === "recovery" || answer?.step === "did-you-mean") return notes;
  const fallback = answer?.understood?.fallback;
  // Words the answer read past, said as the page says them (never in the label).
  const unread = answer ? unreadNote(answer) : null;
  return { ...notes, understood: [`Understood: ${label}`, ...(fallback ? [fallback] : []), ...(unread ? [unread] : [])] };
}

/** A group's count: rows shown, and for a set of events with more than fit, how many there are in all ("14 of 26"). */
export function groupCount(s: DropSection, answer: SearchAnswer | undefined): string {
  const n = s.rows.filter((r) => !r.sub).length;
  const total = answer?.understood?.kind === "events" ? answer.understood.total : undefined;
  return s.id === "event" && total != null && total > n ? `${n} of ${total}` : String(n);
}

/** A team hit's one compact number for the dropdown: its season OPR when the server sends it (`team.opr`). */
export function teamOpr(h: SearchHit): number | null {
  const opr = (h as SearchHit & { team?: { opr?: number | null } }).team?.opr;
  return typeof opr === "number" && Number.isFinite(opr) ? opr : null;
}
