// "Show change" in the recoverable-changes view: the member's unsent wording next to what its destination holds
// now (side by side on wider screens, stacked on phones), with the words that differ marked. Read only: opening it
// only reads (src/lib/sharedNow.ts); Retry and Discard stay the row's own buttons, below it.
//
// Everything is plain text (React text nodes, never markup), in its own direction-isolated block (dir="auto"), so
// right-to-left text, stray direction marks, emoji and combining marks can't disturb the page around it. Changes
// are marked by more than colour: removed words are struck through and added ones underlined, and a screen reader
// hears "removed:" / "added:" around each, plus a one-line description of the whole comparison.
import { useEffect, useId, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { NO_ACCESS, readSharedNow, type ReviewTarget, type SharedNow } from "../../lib/sharedNow";
import { diffCounts, sideOf, wordDiff, type DiffPart } from "../../lib/wordDiff";
import { Button } from "../ui/button";

const plural = (n: number, w: string) => `${n} word${n === 1 ? "" : "s"} ${w}`;

/** What a screen reader hears for the whole comparison. */
export function describeDiff(parts: DiffPart[], hasShared: boolean): string {
  const { added, removed } = diffCounts(parts);
  if (!hasShared) return added ? `Nothing is shared there now; all ${plural(added, "of yours would be added")}.` : "Nothing is shared there now, and your text is empty.";
  if (!added && !removed) return "Your text is the same as what's shared now.";
  return `Compared with what's shared now: ${[added && plural(added, "added"), removed && plural(removed, "removed")].filter(Boolean).join(", ")}.`;
}

function Side({ parts, label, empty }: { parts: DiffPart[]; label: string; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {/* Scrolls when long; focusable so a keyboard can scroll it too. */}
      <div role="region" aria-label={label} tabIndex={0}
        className="max-h-60 overflow-auto rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {parts.length === 0 ? <p className="text-muted-foreground">{empty}</p> : (
          <p dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:isolate]">
            {parts.map((p, i) => p.type === "same" ? <span key={i}>{p.text}</span>
              : p.type === "added" ? (
                <ins key={i} className="rounded-sm bg-success/15 text-foreground decoration-success decoration-2 underline-offset-2 [text-decoration-line:underline]">
                  <span className="sr-only">added: </span>{p.text}<span className="sr-only"> (end added)</span>
                </ins>
              ) : (
                <del key={i} className="rounded-sm bg-danger/15 text-foreground decoration-danger decoration-2 [text-decoration-line:line-through]">
                  <span className="sr-only">removed: </span>{p.text}<span className="sr-only"> (end removed)</span>
                </del>
              ))}
          </p>
        )}
      </div>
    </div>
  );
}

export function ChangeReview({ id, target, text, reachable }: {
  id: string; target: ReviewTarget; text: string;
  /** The workspace is still one of this account's: when it isn't, nothing is read and it says so. */
  reachable: boolean;
}) {
  const [now, setNow] = useState<SharedNow | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { kind, workspaceId, season, team, base, entry, opId } = target;
  useEffect(() => {
    if (!reachable) return;
    const ctrl = new AbortController();
    setNow(null);
    readSharedNow({ kind, workspaceId, season, team, base, entry, opId }, ctrl.signal).then(setNow, () => undefined);
    return () => ctrl.abort();
  }, [reachable, kind, workspaceId, season, team, base, entry, opId, attempt]);

  const shared = now?.state === "ok" ? now.text : null;
  const parts = useMemo(() => (shared == null ? null : wordDiff(shared, text)), [shared, text]);
  const descId = useId();
  const yours = kind === "comment" ? "Your comment (not sent)" : "Your note (not saved)";

  if (!reachable) return <Notice id={id} message={NO_ACCESS} text={text} yours={yours} />;
  if (!now) {
    return (
      <div id={id} className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" aria-busy="true">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading what's shared now…
      </div>
    );
  }
  if (now.state !== "ok" || !parts) {
    return <Notice id={id} message={now.state === "ok" ? "" : now.message} text={text} yours={yours}
      retry={now.state === "unavailable" ? () => setAttempt((a) => a + 1) : undefined} />;
  }
  const posted = !!now.posted;
  return (
    <div id={id} role="group" aria-label="Your change compared with what's shared now" aria-describedby={descId} className="mt-2 space-y-2">
      <p id={descId} className="text-xs text-muted-foreground">
        {posted ? now.hint : <>{describeDiff(parts, shared !== "")}{now.hint && <> {now.hint}</>}</>}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Side parts={sideOf(parts, "after")} label={yours} empty="Empty: it clears what's shared now." />
        <Side parts={sideOf(parts, "before")} label="Shared now" empty={kind === "comment" ? "Not in the thread yet." : "No note yet."} />
      </div>
    </div>
  );
}

/** The destination is gone or out of reach: why, and the member's own text on its own (still nothing is sent). */
function Notice({ id, message, text, yours, retry }: { id: string; message: string; text: string; yours: string; retry?: () => void }) {
  const parts: DiffPart[] = text ? [{ type: "same", text }] : [];
  return (
    <div id={id} className="mt-2 space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-xs text-foreground" role="status">
        {message}
        {retry && <Button size="sm" variant="secondary" className="h-7 max-sm:h-11" onClick={retry}>Check again</Button>}
      </p>
      <Side parts={parts} label={yours} empty="Empty." />
    </div>
  );
}
