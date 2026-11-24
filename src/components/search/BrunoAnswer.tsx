// Bruno's written answer on /search (server/api/searchBrunoAnswer.ts): a question ("how many times did 4215 go to
// states") gets a sentence from Bruno AI above the results, then a bullet per record behind it, written only from the records search found
// for it. Asked once the question has settled (not per letter) and search's results are in. Below the results his card
// shows only once he has answered: never while he's writing (no placeholder), off, unreachable or with nothing to add,
// so it can't appear and then vanish, and the page never waits on him. Leading the page (`lead`, v8: a question search
// has no direct answer to) his slot is held instead, a skeleton in his card's frame from the first frame, so his answer
// fills it in place; with nothing to add it is let go (SearchPage.bruno.test.tsx "Bruno leading the v8 page"). The answer is still read as a stream (lib/brunoStream.ts),
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

/** One answer's key: the question and the preferred teams it was read with (either changing asks again). */
export const brunoKey = (q: string, prefer = "") => `${q.trim()}\n${prefer}`;

/** Whether the page asks Bruno for this query at all (his flag on, a question, search's own answer not a direct one):
 *  the page lays itself out from this before he answers, so his card's slot is there from the first frame. */
export function useBrunoAsks(q: string, answered: boolean): boolean {
  const on = useServerFlag("brunoAnswers");
  return on && !answered && isBrunoQuestion(q.trim());
}

/** A yes-or-no answer's verdict, read off his first word ("Yes, Absolute Zero is …" → Yes + "Absolute Zero is …"). Only
 *  a word set off by its own punctuation: "No team has …" and "No-one …" answer with a sentence, not a verdict. */
export function brunoVerdict(text: string): { answer: "Yes" | "No"; rest: string } | null {
  const m = /^\s*(yes|no)\s*[,.:;!\u2013\u2014-]+\s+/i.exec(text);
  if (!m) return null;
  const rest = text.slice(m[0].length).trim();
  if (!rest) return null;
  return { answer: m[1].toLowerCase() === "yes" ? "Yes" : "No", rest: rest[0].toUpperCase() + rest.slice(1) };
}

/** His settled answers (null: nothing to add) by brunoKey, kept by the page so his card can move (leading the page,
 *  or below the results) without asking him again. */
export type BrunoMemo = Map<string, { text: string | null; points: string[] }>;

/** `memo`: the page's BrunoMemo, shared by its cards.
 *  `lead`: his card is the page's answer, at the top: its slot is held (a quiet skeleton) while he writes, and let go
 *  when he has nothing to add.
 *  `prefer`: the visitor's preferred teams and events, as the page's own search sent them, so Bruno reads the same results.
 *  `children`: a summary computed from the records (timeline, stat banner), shown at the top of the card, and on its
 *  own (as "Summary") while Bruno is off, still writing, or has nothing to add. A summary never stands in for him: every
 *  question (isBrunoQuestion) asks him, whatever summary the page also shows (SearchPage.bruno.test.tsx), unless
 *  `answered`: search's own answer card (a card or stat answer, not a guess) already says it, and his card beside it
 *  would say the same thing twice. */
export function BrunoAnswer({ q, prefer = "", ready, answered = false, lead = false, memo, onOutcome, className, children }: { q: string; prefer?: string; ready: boolean; answered?: boolean; lead?: boolean; memo?: BrunoMemo; onOutcome?: (key: string, said: boolean) => void; className?: string; children?: ReactNode }) {
  const query = q.trim();
  // `answered`: search's own answer card already says it; his card would say the same thing twice.
  const willAsk = useBrunoAsks(query, answered);
  const asks = willAsk && ready;
  // An answer belongs to its question and the preferred teams it was read with: either changing hides it.
  const key = brunoKey(query, prefer);
  const [state, setState] = useState<{ key: string; text: string | null; points: string[] }>(() => {
    const known = memo?.get(key);
    return known ? { key, ...known } : { key: "", text: null, points: [] };
  });
  useEffect(() => {
    if (!asks) return undefined;
    // Settled already (by this page's other card): shown as it was, never asked again.
    const known = memo?.get(key);
    if (known) { setState((s) => (s.key === key ? s : { key, ...known })); return undefined; }
    let live = true;
    const stop = new AbortController();
    const t = setTimeout(() => {
      const url = `/api/search/bruno?q=${encodeURIComponent(query)}${prefer ? `&prefer=${encodeURIComponent(prefer)}` : ""}`;
      // Only what he answered is kept for the page's other card: a failed ask is asked again next time.
      const show = (r: BrunoAnswerBody | null) => {
        const v = { text: r?.text?.trim() ? r.text : null, points: r?.points ?? [] };
        if (memo) { memo.set(key, v); if (memo.size > 50) memo.delete(memo.keys().next().value!); }
        if (live) setState({ key, ...v });
      };
      const none = () => { if (live) setState({ key, text: null, points: [] }); };
      // Only his finished answer shows: a part still being written can be withdrawn, or the answer dropped by the
      // number check, and a card that shows and then vanishes is worse than none. A stream that breaks asks the plain
      // way, which shares the same model call on the server (or its cached answer).
      streamBrunoAnswer(`${url}&stream=1`, () => {}, stop.signal)
        .then(show)
        .catch(() => { if (live) apiFetch<BrunoAnswerBody | null>(url).then(show).catch(none); });
    }, BRUNO_SETTLE_MS);
    return () => { live = false; clearTimeout(t); stop.abort(); };
  }, [asks, query, prefer, key, memo]);
  // The page hears whether he answered this question, by its key (brunoKey: the question and the preferred teams), so
  // a leading card's page lays its heading out by it.
  const outcome = state.key === key ? !!state.text : null;
  useEffect(() => { if (outcome != null) onOutcome?.(key, outcome); }, [outcome, key, onOutcome]);
  const phone = useMediaQuery("(max-width: 767px)");
  // Leading the page: his slot is held while he writes (the same card's frame, so his answer fills it in place).
  if (lead && willAsk && state.key !== key && !children) {
    return (
      <div role="status" aria-label="Bruno AI is writing an answer" data-bruno-pending className={cn("rounded-xl border border-violet-400/30 bg-violet-500/[0.07] px-4 py-3.5 v8:border-accent/25 v8:bg-accent/[0.05]", className)}>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 v8:font-medium v8:text-accent"><Sparkles className="size-3.5 shrink-0" aria-hidden />Bruno AI from Control Point</p>
        <div className="skeleton mt-3 h-7 w-20" aria-hidden />
        <div className="skeleton mt-3 h-3.5 w-11/12" aria-hidden />
        <div className="skeleton mt-2 h-3.5 w-2/3" aria-hidden />
      </div>
    );
  }
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
  // A yes-or-no question's answer leads with the word, big and in its colour; the sentence after it.
  const verdict = brunoVerdict(state.text);
  const said = (
    <>
      {verdict ? (
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1.5" data-bruno-verdict={verdict.answer}>
          <span className={cn("rounded-lg px-3 py-0.5 font-display text-3xl font-semibold leading-tight v8:font-sans", verdict.answer === "Yes" ? "bg-success/10 text-success-text" : "bg-danger/10 text-danger-text")}>{verdict.answer}</span>
          <span className="min-w-0 basis-full text-base font-medium leading-relaxed text-foreground sm:basis-auto sm:flex-1">{verdict.rest}</span>
        </div>
      ) : <p className={cn("mt-2 font-medium leading-relaxed text-foreground", lead ? "text-base" : "text-sm")}>{state.text}</p>}
      {/* With a summary (below), it stands in for his bullets: they'd repeat the same records. */}
      {!children && !!state.points.length && (
        <ul className="mt-2.5 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90 marker:text-violet-500 dark:marker:text-violet-300 v8:marker:text-text-faint">
          {state.points.map((p, i) => <li key={i} className="pl-0.5">{p}</li>)}
        </ul>
      )}
    </>
  );
  // It fades in once, with his answer (no movement under reduced motion).
  return (
    <div role="note" aria-label="Bruno AI's answer" data-bruno-answer
      className={cn("animate-[cs-call-in_300ms_ease-out] rounded-xl border border-violet-400/30 bg-violet-500/[0.07] px-4 py-3.5 v8:border-accent/25 v8:bg-accent/[0.05] motion-reduce:animate-none", className)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 v8:font-medium v8:text-accent">
        <Sparkles className="size-3.5 shrink-0" />Bruno AI from Control Point
      </p>
      {phone && children ? (
        // Phones with a summary: the numbers first; his writing folded away, so the results below stay near the top of the screen.
        <>
          {children && <div className="mt-3" data-search-summary>{children}</div>}
          <details className="group mt-2" data-ai-analysis>
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-sm font-medium text-violet-700 dark:text-violet-300 v8:text-foreground [&::-webkit-details-marker]:hidden">
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
      <p className="mt-3 border-t border-violet-400/20 pt-2 text-[11px] text-muted-foreground v8:border-accent/15 v8:text-[0.75rem] v8:text-text-faint">Written by Bruno AI from Control Point, from the records below. Check them before relying on it.</p>
    </div>
  );
}
