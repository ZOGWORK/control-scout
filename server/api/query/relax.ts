// Filter relaxation (docs/search-pipeline.md, "Relax"): when the exact filters find nothing, the pipeline widens them
// one step at a time in a fixed order and says which step it took, on the card and in its heading. The order:
//   1. a date window ("this week") to the season it's in
//   2. a season that came from that window to the season before (one step, the latest finished one)
// A question with no time at all about a place or everyone reads the current season; when that has nothing yet it
// reads the season before, said as "No 2026–27 matches yet in California; showing 2025–26".
// A filter the query typed in its own words other than a window (a place, an event, a year, a team) is never relaxed:
// a year named returns that year, a place named stays that place. Nothing is invented; an answer that's still empty
// after the last step is said plainly, with the steps tried.
import type { SearchAnswer } from "../../../src/shared/api.js";
import { seasonLabel } from "../../../src/shared/format.js";

/** One step taken: what the filter was, and what it became. */
export interface Relaxation { filter: "window" | "season" | "default"; from: string; to: string; note?: string }

/** An answer with nothing found for its filters. */
export const isEmpty = (a: SearchAnswer | null): boolean => !!a?.stat && !a.stat.headline && !!a.stat.none;

/** The steps for a window in `season`: the window's season, then the season before. */
export function windowSteps(window: { label: string }, season: number): { step: Relaxation; season: number }[] {
  return [
    { step: { filter: "window", from: window.label, to: seasonLabel(season) }, season },
    { step: { filter: "season", from: seasonLabel(season), to: seasonLabel(season - 1) }, season: season - 1 },
  ];
}

/** No time said: the current season, then (when it has nothing yet) the one before, `where` the place it's about. */
export function defaultSteps(season: number, where: string): { step: Relaxation; season: number }[] {
  return [{ step: { filter: "default", from: seasonLabel(season), to: seasonLabel(season - 1), note: `No ${seasonLabel(season)} matches yet${where}; showing ${seasonLabel(season - 1)}` }, season: season - 1 }];
}

/** Runs `attempt` with each step in turn until one finds something; the answer says every step it took. */
export async function relaxed(first: SearchAnswer | null, steps: { step: Relaxation; season: number }[], attempt: (season: number) => Promise<SearchAnswer | null>): Promise<SearchAnswer | null> {
  if (!first || !isEmpty(first)) return first;
  const taken: Relaxation[] = [];
  for (const s of steps) {
    taken.push(s.step);
    const a = await attempt(s.season);
    if (a && !isEmpty(a)) return said(a, taken, first);
  }
  return triedAll(first, taken);
}

/** Nothing after every step: the first answer, saying which steps were tried too. */
function triedAll(first: SearchAnswer, steps: Relaxation[]): SearchAnswer {
  if (!first.stat || !steps.length) return first;
  const tried = `Nothing in ${steps.map((s) => s.to).join(" or ")} either: the time filter was relaxed in order (${steps.map((s) => `${s.from} → ${s.to}`).join(", then ")}) and every other filter kept as asked.`;
  return {
    ...first, stat: { ...first.stat, none: `${first.stat.none!.replace(/\.?$/, ".")} ${tried}` },
    ...(first.intent ? { intent: { ...first.intent, pattern: `${first.intent.pattern} [relaxed-none:${steps.map((s) => s.filter).join(">")}]` } } : {}),
  };
}

/** The answer, stating the steps: a chip, a sentence in its definition, and its heading. */
function said(a: SearchAnswer, steps: Relaxation[], first: SearchAnswer): SearchAnswer {
  const from = steps[0].from, to = steps[steps.length - 1].to;
  const note = steps.find((s) => s.note)?.note;
  const chip = note ?? `Relaxed: ${from} → ${to}`;
  const why = note ? `${note}: no season was named, so the current one was read first, and it has nothing here yet. Every other filter is as asked.`
    : `Nothing matched ${from}${first.stat?.none ? ` (${first.stat.none.replace(/\.$/, "")})` : ""}, so the time filter was relaxed in order: ${steps.map((s) => `${s.from} → ${s.to}`).join(", then ")}. Every other filter is as asked.`;
  const stat = a.stat ? { ...a.stat, scope: [chip, ...a.stat.scope], definition: `${why} ${a.stat.definition}` } : a.stat;
  const label = `${a.understood?.label ?? stat?.title ?? ""} · ${note?.replace(/; showing .*$/, "") ?? `relaxed from ${from} to ${to}`}`;
  return {
    ...a, stat, understood: { ...(a.understood ?? { kind: "question" }), label },
    ...(a.intent ? { intent: { ...a.intent, pattern: `${a.intent.pattern} [relaxed:${steps.map((s) => s.filter).join(">")}]` } } : {}),
  };
}
