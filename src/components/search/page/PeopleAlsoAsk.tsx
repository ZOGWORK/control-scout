// People also ask (server/api/answers/followUps.ts): below the answer, the next questions search answers directly,
// asked once that answer is on screen. Each row opens to its answer's own line and a link that runs the question; the
// numbers are that answer's, so the page it opens shows them too. Plain rows in the page's card style: no colour of
// its own, nothing when there's nothing to ask.
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useApi, qs } from "../../../lib/api";
import type { SearchFollowUp } from "../../../shared/api";
import { PART } from "./TeamAnswer";

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
              <p className="break-words text-foreground" data-preview>{x.preview}</p>
              <Link to={`/search?q=${encodeURIComponent(x.q)}`} className="mt-1 inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-2 hover:no-underline">See the full answer →</Link>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
