// Compound questions (search audit, "compound clauses"): "<team> opr and <team> record", "<team> awards and highest
// score". Each part joined by "and" (or "and also", "&") is asked on its own as search asks any question, and
// when every part gets a card of its own, the cards stand one under another. Only when the whole question isn't read
// as one already (the pipeline's "between 2023 and 2025" stays one run), and only parts that each ask something (a
// stat, a best, a kind of thing): "12345 and 67890" and a team named "Nuts and Bolts" are never split. A part with no
// subject of its own takes the first part's team ("<team> awards and highest score"). Nothing here names a team, a
// stat or a place: the parse reads each part.
import type { SearchAnswer, SearchClause, SearchPageLink } from "../../../src/shared/api.js";
import { parseContext } from "./context.js";
import { parseQuery } from "./parse.js";

/** At most this many parts are asked (each is a question of its own). */
export const MAX_CLAUSES = 3;

/** The words that join two questions: "and", "and also", "&". Never a bare "also" ("teams who also won inspire" is
 *  one filter); never ";" (search reads the query with its punctuation gone). */
const JOIN = /\s+(?:and\s+also|and|&)\s+/i;
/** A part that points back at the one before ("… and how was their record", "… and which was its best"): one
 *  question, read whole by search's long-form readers. */
const BACK = /\b(?:their|they|them|theirs|its|it|his|her|he|she|that|those|these|which)\b/i;
/** A part asks something: a measure, a best, a kind of thing, a count (never only a name, a place or a time). */
const ASKS = /^(?:metric|agg|thing):/;

/** A compound question's parts. `apart`: each part names a subject of its own and asks something of its own, no two the
 *  same ("<team> last match and <team> next event"): two questions, never one about both teams, so they're split
 *  before the whole is read. Parts asking the same of two teams ("<team> opr and <team> opr") are one compare. */
export interface Clauses { parts: string[]; apart: boolean }

/** The parts of `q` to ask one by one, each as asked (the first part's team put before a part with no subject of its
 *  own), or null: fewer than two parts, more than MAX_CLAUSES, two the same, or a part that asks nothing. */
export async function readClauses(q: string, now?: number, prefer?: ReadonlySet<string>): Promise<Clauses | null> {
  const parts = q.split(JOIN).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > MAX_CLAUSES || parts.slice(1).some((s) => BACK.test(s))) return null;
  // The visitor's own team first among teams sharing a name, as each part's own search reads it.
  const ctx = await parseContext(now, prefer);
  const parsed = await Promise.all(parts.map((s) => parseQuery(s, ctx)));
  if (!parsed.every((p) => p.symbols.some((s) => ASKS.test(s)))) return null;
  // The first part's one team, for a part that names nothing it asks about ("… and highest score").
  const team = parsed[0].teams.length === 1 ? parsed[0].teams[0].number : null;
  const own = parsed.map((p) => !!(p.teams.length || p.event || p.place || p.worlds || p.states || p.leftover.length));
  const asked = parts.map((s, i) => (i > 0 && !own[i] && team != null ? `${team} ${s}` : s));
  if (new Set(asked.map((s) => s.toLowerCase())).size !== asked.length) return null;
  // Each part's own subject: its teams, event and place.
  const subject = parsed.map((p) => [p.teams.map((t) => t.number).join(","), p.event?.words ?? "", p.place?.name ?? ""].join("|"));
  const asks = parsed.map((p) => p.symbols.filter((s) => ASKS.test(s)).sort().join(" "));
  const apart = parsed.every((p) => p.teams.length || p.event || p.place) && new Set(subject).size === subject.length && new Set(asks).size === asks.length;
  return { parts: asked, apart };
}

/** Whether a part's answer is a card of its own, answered as asked: a stat's card (one that found something), or a
 *  fact's ("<team> next event", none published said so). Never a list of names, a guess or a recovery. */
export const isCard = (a: SearchAnswer | null): a is SearchAnswer => a?.step === "deterministic" && (a.stat ? !a.stat.none : !!a.card);

/** A part's card as the page draws it: its stat's, else its fact's. */
const clauseOf = (a: SearchAnswer): SearchClause => (a.stat ? { stat: a.stat, ...(a.card?.kind === "info" ? { card: a.card } : {}) } : { card: a.card });

/** The parts answered one under another (`answers`, each part's own, every one a card): the first part's answer, its
 *  card the first, each other part's card in `clauses`. */
export function clausesAnswer(q: string, parts: string[], answers: SearchAnswer[], opts: { full: boolean; pages: SearchPageLink[] }): SearchAnswer {
  const [first, ...rest] = answers;
  const labels = answers.map((a) => a.understood?.label ?? a.stat?.title ?? a.card?.title ?? "");
  // Each part's rows, once each, in the order asked.
  const seen = new Set<string>();
  const hits = answers.flatMap((a) => a.hits).filter((h) => { const k = `${h.kind}:${h.ref}`; return seen.has(k) ? false : (seen.add(k), true); });
  const { stat, ...head } = first;
  return {
    ...head, q, hits, pages: opts.pages,
    understood: { kind: "question", label: labels.join("; ") },
    intent: { kind: "stat-clauses", pattern: parts.map((_, i) => `[question ${i + 1}]`).join(" and "), met: true, understood: labels },
    ...(opts.full ? { ...(stat ? { stat } : {}), clauses: rest.map(clauseOf) } : {}),
  };
}
