// Bruno's written answer on /search (server/api/searchBrunoAnswer.ts): a question ("how many times did 4215 go to
// states") gets a sentence or three from Bruno AI above the results, written only from the records search found
// for it. Asked once the question has settled (not per letter) and search's results are in; nothing is shown while
// he's off, unreachable or has nothing to add, so the page never waits on him.
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useServerFlag } from "../../lib/flags";
import { isBrunoQuestion } from "../../shared/search";
import { cn } from "../cn";

/** How long the question must stay unchanged before Bruno is asked. */
export const BRUNO_SETTLE_MS = 600;

export function BrunoAnswer({ q, ready, className }: { q: string; ready: boolean; className?: string }) {
  const on = useServerFlag("brunoAnswers");
  const query = q.trim();
  const asks = on && ready && isBrunoQuestion(query);
  const [state, setState] = useState<{ q: string; text: string | null; busy: boolean }>({ q: "", text: null, busy: false });
  useEffect(() => {
    if (!asks) return undefined;
    let live = true;
    const t = setTimeout(() => {
      setState({ q: query, text: null, busy: true });
      apiFetch<{ text: string } | null>(`/api/search/bruno?q=${encodeURIComponent(query)}`)
        .then((r) => { if (live) setState({ q: query, text: r?.text ?? null, busy: false }); })
        .catch(() => { if (live) setState({ q: query, text: null, busy: false }); });
    }, BRUNO_SETTLE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [asks, query]);
  if (!asks || state.q !== query || (!state.busy && !state.text)) return null;
  return (
    <div role="note" aria-label="Bruno AI's answer" aria-busy={state.busy || undefined} data-bruno-answer
      className={cn("rounded-xl border border-violet-400/30 bg-violet-500/[0.07] px-4 py-3", className)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
        <Sparkles className={cn("size-3.5 shrink-0", state.busy && "animate-pulse")} />Bruno AI
      </p>
      {state.busy
        ? <div className="mt-2 space-y-1.5" aria-label="Bruno is reading the results"><div className="h-3 w-11/12 animate-pulse rounded bg-violet-400/20" /><div className="h-3 w-7/12 animate-pulse rounded bg-violet-400/20" /></div>
        : <p className="mt-1 text-sm leading-relaxed text-foreground">{state.text}</p>}
      {!state.busy && <p className="mt-1.5 text-[11px] text-muted-foreground">Written by Bruno AI from the records below. Check them before relying on it.</p>}
    </div>
  );
}
