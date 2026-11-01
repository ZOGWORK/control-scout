// Bruno's written answer on /search (server/api/searchBrunoAnswer.ts): a question ("how many times did 4215 go to
// states") gets a sentence from Bruno AI above the results, then a bullet per record behind it, written only from the records search found
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

/** `prefer`: the visitor's preferred teams and events, as the page's own search sent them, so Bruno reads the same results. */
export function BrunoAnswer({ q, prefer = "", ready, className }: { q: string; prefer?: string; ready: boolean; className?: string }) {
  const on = useServerFlag("brunoAnswers");
  const query = q.trim();
  const asks = on && ready && isBrunoQuestion(query);
  // An answer belongs to its question and the preferred teams it was read with: either changing hides it.
  const key = `${query}
${prefer}`;
  const [state, setState] = useState<{ key: string; text: string | null; points: string[]; busy: boolean }>({ key: "", text: null, points: [], busy: false });
  useEffect(() => {
    if (!asks) return undefined;
    let live = true;
    const t = setTimeout(() => {
      setState({ key, text: null, points: [], busy: true });
      apiFetch<{ text: string; points?: string[] } | null>(`/api/search/bruno?q=${encodeURIComponent(query)}${prefer ? `&prefer=${encodeURIComponent(prefer)}` : ""}`)
        .then((r) => { if (live) setState({ key, text: r?.text ?? null, points: r?.points ?? [], busy: false }); })
        .catch(() => { if (live) setState({ key, text: null, points: [], busy: false }); });
    }, BRUNO_SETTLE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [asks, query, prefer, key]);
  if (!asks || state.key !== key || (!state.busy && !state.text)) return null;
  return (
    <div role="note" aria-label="Bruno AI's answer" aria-busy={state.busy || undefined} data-bruno-answer
      className={cn("rounded-xl border border-violet-400/30 bg-violet-500/[0.07] px-4 py-3.5", className)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
        <Sparkles className={cn("size-3.5 shrink-0", state.busy && "animate-pulse")} />Bruno AI
      </p>
      {state.busy
        ? <div className="mt-2.5 space-y-1.5" aria-label="Bruno is reading the results"><div className="h-3 w-11/12 animate-pulse rounded bg-violet-400/20" /><div className="h-3 w-7/12 animate-pulse rounded bg-violet-400/20" /></div>
        : (
          <>
            <p className="mt-2 text-sm font-medium leading-relaxed text-foreground">{state.text}</p>
            {!!state.points.length && (
              <ul className="mt-2.5 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90 marker:text-violet-500 dark:marker:text-violet-300">
                {state.points.map((p, i) => <li key={i} className="pl-0.5">{p}</li>)}
              </ul>
            )}
          </>
        )}
      {!state.busy && <p className="mt-3 border-t border-violet-400/20 pt-2 text-[11px] text-muted-foreground">Written by Bruno AI from the records below. Check them before relying on it.</p>}
    </div>
  );
}
