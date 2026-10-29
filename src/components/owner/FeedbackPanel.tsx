// Owner console › Feedback & errors: the contact form's inbox (server/portal/feedback.ts), and the triage
// buttons a bug report, data correction or idea carries here and in the Moderation tab's queue. One inbox:
// the queue is the same messages, and a triage decision files the message (fixed or rejected: resolved).
import { useRef, useState, type ReactNode } from "react";
import { Archive, Ban, CheckCircle2, Inbox, Mail, RefreshCw, RotateCcw, ThumbsUp, Wrench } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Badge } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, markStale, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import { TRIAGE_NEXT, TRIAGE_TOPICS, type FeedbackList, type FeedbackMessage, type FeedbackStatus, type TriageState } from "../../shared/owner";

export const TOPIC: Record<string, string> = { bug: "Bug", data: "Wrong data", feature: "Idea", other: "Other" };
export const topicVariant = (t: string) => (t === "bug" ? "destructive" : t === "data" ? "soft" : t === "feature" ? "beta" : "secondary") as "destructive" | "soft" | "beta" | "secondary";
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

const TRIAGE_LABEL: Record<TriageState, string> = { accepted: "Accepted", rejected: "Rejected", fixed: "Fixed" };
const TRIAGE_VARIANT: Record<TriageState, "info" | "secondary" | "success"> = { accepted: "info", rejected: "secondary", fixed: "success" };
const ACTION: Record<TriageState | "undo", { label: string; icon: typeof ThumbsUp; variant: "secondary" | "outline" | "ghost" }> = {
  accepted: { label: "Accept", icon: ThumbsUp, variant: "secondary" },
  fixed: { label: "Mark fixed", icon: Wrench, variant: "secondary" },
  rejected: { label: "Reject", icon: Ban, variant: "outline" },
  undo: { label: "Undo triage", icon: RotateCcw, variant: "ghost" },
};

/** The triage state as a badge (nothing for a message that isn't triaged). */
export function TriageBadge({ m }: { m: FeedbackMessage }) {
  if (!m.triage) return TRIAGE_TOPICS.includes(m.topic) ? <Badge variant="outline">Not triaged</Badge> : null;
  return <Badge variant={TRIAGE_VARIANT[m.triage]} title={m.triageAt ? when(m.triageAt) : undefined}>{TRIAGE_LABEL[m.triage]}</Badge>;
}

/**
 * Accept / reject / mark fixed (and take it back) for one bug report, data correction or idea. An accepted
 * data correction says how it gets fixed: from FIRST through a re-sync, never by editing match records.
 */
export function TriageActions({ m, onOpenResync, onChanged }: { m: FeedbackMessage; onOpenResync?: () => void; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!TRIAGE_TOPICS.includes(m.topic)) return null;
  const next = TRIAGE_NEXT[m.triage ?? "untriaged"];
  const send = async (to: TriageState | null) => {
    setBusy(true);
    try {
      await apiFetch(`/api/owner/feedback/${m.id}/triage`, { method: "PATCH", json: { triage: to } });
      // The inbox lists, the queue and the overview's open count all hold this message.
      markStale("/api/owner/feedback");
      markStale("/api/owner/moderation");
      markStale("/api/owner/overview");
      onChanged?.();
      toast.success(to ? `Marked ${TRIAGE_LABEL[to].toLowerCase()}` : "Triage taken back");
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Triage message #${m.id}`}>
        {next.map((to) => {
          const a = ACTION[to ?? "undo"];
          return <Button key={to ?? "undo"} size="sm" variant={a.variant} className="max-sm:h-10" disabled={busy} onClick={() => void send(to)}><a.icon /> {a.label}</Button>;
        })}
      </div>
      {m.topic === "data" && m.triage === "accepted" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs text-foreground">
          <span className="min-w-0 flex-1">Match records are never edited by hand. Once FIRST has the fix, a re-sync brings it in; then mark this fixed.</span>
          {onOpenResync && <Button size="sm" variant="outline" className="max-sm:h-10" onClick={onOpenResync}><RefreshCw /> Re-sync</Button>}
        </div>
      )}
    </div>
  );
}

/** One message as a card: topic, sender, text, then whatever actions the caller puts under it. */
export function MessageCard({ m, children }: { m: FeedbackMessage; children?: ReactNode }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={topicVariant(m.topic)}>{TOPIC[m.topic] ?? m.topic}</Badge>
        <TriageBadge m={m} />
        <span className="font-medium text-foreground">{m.name ?? "No name given"}</span>
        <a className="inline-flex min-w-0 items-center gap-1 truncate text-accent-text underline-offset-4 hover:underline" href={`mailto:${m.email}`}><Mail className="size-3.5 shrink-0" aria-hidden />{m.email}</a>
        <span className="ml-auto text-xs text-muted-foreground" title={when(m.createdAt)}>#{m.id} · {ago(m.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{m.message}</p>
      {children}
    </li>
  );
}

export function FeedbackPanel({ onOpenResync }: { onOpenResync?: () => void }) {
  const [status, setStatus] = useState<FeedbackStatus | "all">("open");
  const path = `/api/owner/feedback?status=${status}`;
  const state = useApi<FeedbackList>(path);
  const [busy, setBusy] = useState<number | null>(null);
  // Older pages ("Show older"), for the list they were loaded for; the first page is the cached one above.
  const [older, setOlder] = useState<{ status: FeedbackStatus | "all"; messages: FeedbackMessage[]; more: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const extra = older?.status === status ? older : null;
  // Bumped by every move: a page asked for before it is out of date and dropped when it arrives.
  const olderGen = useRef(0);
  const loadOlder = async (first: FeedbackList) => {
    const last = (extra?.messages.at(-1) ?? first.messages.at(-1))?.id;
    if (!last) return;
    const gen = olderGen.current;
    setLoadingOlder(true);
    try {
      const page = await apiFetch<FeedbackList>(`${path}&before=${last}`);
      if (gen !== olderGen.current) return;
      setOlder({ status, messages: [...(extra?.messages ?? []), ...page.messages], more: page.more });
    } catch (e) { toast.error((e as ApiError).message); } finally { setLoadingOlder(false); }
  };
  // Older pages may hold a moved message: they load again on request, and one still on its way is dropped.
  const dropOlder = () => { olderGen.current++; setOlder(null); };
  const move = async (m: FeedbackMessage, to: FeedbackStatus) => {
    setBusy(m.id);
    try {
      await apiFetch(`/api/owner/feedback/${m.id}`, { method: "PATCH", json: { status: to } });
      dropOlder();
      // Every list (and the overview's open count) is out of date now, not just this one.
      // Marked stale rather than dropped: what's on screen reloads in place, the rest when next shown.
      markStale("/api/owner/feedback");
      markStale("/api/owner/moderation");
      markStale("/api/owner/overview");
      toast.success(to === "open" ? "Moved back to open" : to === "resolved" ? "Marked resolved" : "Archived");
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(null); }
  };
  const counts = state.data?.counts;
  const tabs: [FeedbackStatus | "all", string][] = [["open", "Open"], ["resolved", "Resolved"], ["archived", "Archived"], ["all", "All"]];
  return (
    <Section title="Feedback inbox" description="Messages from the contact form. Bug reports, data corrections and ideas are triaged here or in Moderation: one inbox, nothing deleted.">
      <div className="mb-4 flex flex-wrap gap-1" role="group" aria-label="Show">
        {tabs.map(([k, label]) => (
          <Button key={k} size="sm" variant={k === status ? "default" : "outline"} aria-pressed={k === status} onClick={() => setStatus(k)}>
            {label}{counts && k !== "all" ? <span className="tabular-nums opacity-70">{counts[k]}</span> : null}
          </Button>
        ))}
      </div>
      <Async state={state} empty={(d) => !d.messages.length && <EmptyState icon={Inbox} title={status === "open" ? "Inbox zero" : "Nothing here"} description={status === "open" ? "Every message has been dealt with." : undefined} />}>
        {(d) => (
          <>
            <ul className="space-y-3">
              {[...d.messages, ...(extra?.messages ?? []).filter((m) => !d.messages.some((x) => x.id === m.id))].map((m) => (
                <MessageCard key={m.id} m={m}>
                  <div className="mt-3"><TriageActions m={m} onOpenResync={onOpenResync} onChanged={dropOlder} /></div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {m.status !== "resolved" && <Button size="sm" variant="secondary" className="max-sm:h-10" disabled={busy === m.id} onClick={() => void move(m, "resolved")}><CheckCircle2 /> Resolve</Button>}
                    {m.status !== "archived" && <Button size="sm" variant="outline" className="max-sm:h-10" disabled={busy === m.id} onClick={() => void move(m, "archived")}><Archive /> Archive</Button>}
                    {m.status !== "open" && <Button size="sm" variant="ghost" className="max-sm:h-10" disabled={busy === m.id} onClick={() => void move(m, "open")}><RotateCcw /> Reopen</Button>}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {m.status !== "open" && m.statusAt ? `${m.status === "resolved" ? "Resolved" : "Archived"} ${ago(m.statusAt)}` : m.emailed ? "Also emailed to you" : "Stored here only"}
                    </span>
                  </div>
                </MessageCard>
              ))}
            </ul>
            {(extra ? extra.more : d.more) && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" disabled={loadingOlder} onClick={() => void loadOlder(d)}>{loadingOlder ? "Loading…" : "Show older messages"}</Button>
              </div>
            )}
          </>
        )}
      </Async>
    </Section>
  );
}
