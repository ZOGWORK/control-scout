// "My" and "our" with no team named ("what is my next event"): the visitor's My team (src/shared/searchMine.ts).
// Only when the query as typed found nothing to answer: "my 4215 next event" and a team named after "my" are the
// query's own (failed-search #731, #1144). With no My team on this device, the answer is to pick one, never "no
// team matched".
import type { SearchAnswer } from "../../src/shared/api.js";
import { MINE, mineQuery } from "../../src/shared/searchMine.js";
import { failureOf, outcomeTrace } from "../searchFailures.js";

/** The page to pick My team on. */
export const MY_TEAM_PATH = "/my-team";

/** Asked to pick a team: the visitor has none set here. */
export function pickTeamAnswer(q: string): SearchAnswer {
  return {
    q, hits: [], pages: [], step: "deterministic", weak: false,
    understood: { kind: "question", label: "Your team · not set on this device" },
    card: {
      kind: "info", title: "Your team",
      lines: [{ text: "Pick your team", detail: "Questions with \"my\" or \"our\" then answer for it", href: MY_TEAM_PATH }],
    },
  };
}

/** The answer for the visitor's team when `ans` (the query as typed) failed and the query says "my" or "our":
 *  `my`'s answer, else the ask to pick a team; null to keep `ans`. */
export async function mineAnswer(q: string, ans: SearchAnswer, my: number | null, ask: (q: string) => Promise<SearchAnswer>): Promise<SearchAnswer | null> {
  if (!MINE.test(q) || !failureOf(q, ans, outcomeTrace(ans))) return null;
  if (my == null) return pickTeamAnswer(q);
  const rq = mineQuery(q, my);
  const a = await ask(rq);
  return failureOf(rq, a, outcomeTrace(a)) ? null : a;
}
