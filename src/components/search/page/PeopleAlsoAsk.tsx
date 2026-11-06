// People also ask (server/api/answers/followUps.ts): below the answer, the next questions search answers directly,
// asked once that answer is on screen. Each row opens to its answer's own line and a link that runs the question; the
// numbers are that answer's, so the page it opens shows them too, its number coloured as that answer's card colours
// it (search's palette). Plain rows in the page's card style, nothing when there's nothing to ask.
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useApi, qs } from "../../../lib/api";
import type { FollowUpTone, SearchFollowUp } from "../../../shared/api";
import { SEARCH_PALETTE } from "../../../lib/textTones";
import { cn } from "../../cn";
import { PART } from "./TeamAnswer";
import { headlineTone } from "./StatAnswer";
import { lineSwatch } from "./FactCard";

/** A follow-up's number in its answer card's colour: a stat headline's, a card line's, a yes or no, a count. */
export function toneOf(t: FollowUpTone, value: string, rest: string): string {
  if ("stat" in t) return headlineTone({ ...t.stat, headline: { value, label: rest } }, t.stat.teams.map((number) => ({ number })));
  if ("card" in t) return lineSwatch(t.card, { text: value }).text;
  if ("verdict" in t) return SEARCH_PALETTE[t.verdict === "Yes" ? "yes" : "no"].text;
  return SEARCH_PALETTE.count.text;
}

export function PeopleAlsoAsk({ q, prefer, ready }: { q: string; prefer?: string; ready: boolean }) {
  const { data } = useApi<{ q: string; ask: SearchFollowUp[] }>(ready && q ? `/api/search/follow${qs({ q, prefer })}` : null);
  const ask = data?.q === q ? data.ask : [];
  if (!ask.length) return null;
  return (
    <section aria-label="People also ask" className="mb-5" data-block="people-also-ask">
      <h2 className={PART}>People also ask</h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {ask.map((x) => (
          <details key={x.q} className="group">
            <summary className="flex min-h-[44px] cursor-pointer select-none list-none items-center gap-3 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 break-words">{x.q}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="px-4 pb-3 text-sm">
              <p className="break-words text-foreground" data-preview>
                <span className={cn("font-semibold tabular-nums", toneOf(x.tone, x.value, x.rest))} data-value>{x.value}</span>
                {x.rest && <span className="text-muted-foreground"> · {x.rest}</span>}
              </p>
              <Link to={`/search?q=${encodeURIComponent(x.q)}`} className="mt-1 inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-2 hover:no-underline">See the full answer →</Link>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
