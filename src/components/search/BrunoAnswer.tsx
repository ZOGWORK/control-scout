// Bruno's written answer on /search (server/api/searchBrunoAnswer.ts): a question ("how many times did 4215 go to
// states") gets a sentence from Bruno AI above the results, then a bullet per record behind it, written only from the records search found
// for it. Asked once the question has settled (not per letter) and search's results are in. His card shows only once
// he has answered: never while he's writing (no placeholder), off, unreachable or with nothing to add, so it can't
// appear and then vanish, and the page never waits on him. The answer is still read as a stream (lib/brunoStream.ts),
// but its parts aren't shown: a checked part can still be withdrawn, or the whole answer dropped at the end.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { streamBrunoAnswer, type BrunoAnswerBody } from "../../lib/brunoStream";
import { useServerFlag } from "../../lib/flags";
import { useMediaQuery } from "../../lib/meta";
import { isBrunoQuestion } from "../../shared/search";
import { cn } from "../cn";

/** How long the question must stay unchanged before Bruno is asked. */
export const BRUNO_SETTLE_MS = 600;

/** `prefer`: the visitor's preferred teams and events, as the page's own search sent them, so Bruno reads the same results.
 *  `children`: a summary computed from the records (timeline, stat banner), shown at the top of the card, and on its
 *  own (as "Summary") while Bruno is off, still writing, or has nothing to add. A summary never stands in for him: every
 *  question (isBrunoQuestion) asks him, whatever cards or summary the page also shows (SearchPage.bruno.test.tsx). */
export function BrunoAnswer({ q, prefer = "", ready, className, children }: { q: string; prefer?: string; ready: boolean; className?: string; children?: ReactNode }) {
  const on = useServerFlag("brunoAnswers");
  const query = q.trim();
  const asks = on && ready && isBrunoQuestion(query);
  // An answer belongs to its question and the preferred teams it was read with: either changing hides it.
  const key = `${query}
${prefer}`;
  const [state, setState] = useState<{ key: string; text: string | null; points: string[] }>({ key: "", text: null, points: [] });
  useEffect(() => {
    if (!asks) return undefined;
    let live = true;
    const stop = new AbortController();
    const t = setTimeout(() => {
      const url = `/api/search/bruno?q=${encodeURIComponent(query)}${prefer ? `&prefer=${encodeURIComponent(prefer)}` : ""}`;
      const show = (r: BrunoAnswerBody | null) => { if (live) setState({ key, text: r?.text?.trim() ? r.text : null, points: r?.points ?? [] }); };
      const none = () => { if (live) setState({ key, text: null, points: [] }); };
      // Only his finished answer shows: a part still being written can be withdrawn, or the answer dropped by the
      // number check, and a card that shows and then vanishes is worse than none. A stream that breaks asks the plain
      // way, which shares the same model call on the server (or its cached answer).
      streamBrunoAnswer(`${url}&stream=1`, () => {}, stop.signal)
        .then(show)
        .catch(() => { if (live) apiFetch<BrunoAnswerBody | null>(url).then(show).catch(none); });
    }, BRUNO_SETTLE_MS);
    return () => { live = false; clearTimeout(t); stop.abort(); };
  }, [asks, query, prefer, key]);
  const phone = useMediaQuery("(max-width: 767px)");
  if (!asks || state.key !== key || !state.text) {
    if (!children) return null;
    return (
      <div role="note" aria-label="Summary" data-search-summary className={cn("rounded-xl border border-border bg-card/60 px-4 py-3.5", className)}>
        <p className="text-xs font-semibold text-muted-foreground">Summary</p>
        <div className="mt-2.5">{children}</div>
        <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">Counted from the records below.</p>
      </div>
    );
  }
  const said = (
    <>
      <p className="mt-2 text-sm font-medium leading-relaxed text-foreground">{state.text}</p>
      {/* With a summary (below), it stands in for his bullets: they'd repeat the same records. */}
      {!children && !!state.points.length && (
        <ul className="mt-2.5 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90 marker:text-violet-500 dark:marker:text-violet-300">
          {state.points.map((p, i) => <li key={i} className="pl-0.5">{p}</li>)}
        </ul>
      )}
    </>
  );
  // It fades in once, with his answer (no movement under reduced motion).
  return (
    <div role="note" aria-label="Bruno AI's answer" data-bruno-answer
      className={cn("animate-[cs-call-in_300ms_ease-out] rounded-xl border border-violet-400/30 bg-violet-500/[0.07] px-4 py-3.5 motion-reduce:animate-none", className)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
        <Sparkles className="size-3.5 shrink-0" />Bruno AI from Control Point
      </p>
      {phone ? (
        // Phones: the numbers first; his writing folded away, so the results below stay near the top of the screen.
        <>
          {children && <div className="mt-3" data-search-summary>{children}</div>}
          <details className="group mt-2" data-ai-analysis>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-violet-700 dark:text-violet-300 [&::-webkit-details-marker]:hidden">
              Show AI Analysis<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            {said}
          </details>
        </>
      ) : (
        <>
          {said}
          {children && <div className="mt-3" data-search-summary>{children}</div>}
        </>
      )}
      <p className="mt-3 border-t border-violet-400/20 pt-2 text-[11px] text-muted-foreground">Written by Bruno AI from Control Point, from the records below. Check them before relying on it.</p>
    </div>
  );
}
