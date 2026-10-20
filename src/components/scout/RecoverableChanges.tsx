// Changes not saved yet (audit E4): a small list of the signed-in account's shared work that hasn't reached its
// workspace, shown only while there is some. Each row says exactly what it is and where it belongs (team,
// workspace, season), why it's waiting, and offers Retry and Discard. It clears itself as things reconcile.
//
// Sources (src/lib/pendingWork.ts):
// - the open pick list's notes and order changes that need the member (usePickList publishes them);
// - pick list notes kept on this device for a list that isn't open (picklistDrafts.ts): Retry sends them with
//   their base, so a teammate's newer note is never replaced;
// - pick list order changes kept on this device from before this page (picklistOps.ts, via sharedPicklist.ts);
// - comment attempts not confirmed (commentAttempts.ts);
// - workspace entries queued on this device whose push didn't go through (scouting.ts).
// Every source is per account, and only the signed-in account's rows are ever read or shown.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleAlert, ClipboardList, CloudOff, ListOrdered, Loader2, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import { isClaimed, usePendingVersion, usePendingWork, type PendingItem } from "../../lib/pendingWork";
import { allNoteDrafts, clearNoteDraft, NOTE_DRAFTS_CHANGED } from "../../lib/picklistDrafts";
import { loadKeptOrderChanges, noteInFlight, sendKeptNote, setPicklistAccount } from "../../lib/sharedPicklist";
import { discardQueuedScoutEntry, pullScouting, queuedWorkspaceEntries, SCOUT_CHANGED, scoutSyncProblem, syncScouting } from "../../lib/scouting";
import { seasonLabel } from "../../lib/format";
import { loadCommentAttempts } from "../../lib/commentAttempts";
import { Button } from "../ui/button";
import { ChangeReview } from "./ChangeReview";
import { cn } from "../cn";

interface Workspace { id: string; name: string; orphaned?: unknown }
/** A row: a published item, plus whether a Retry is on its way. */
type Row = PendingItem & { busy?: boolean };

const KIND_ICON = { note: ListOrdered, order: ListOrdered, comment: MessageSquare, entry: ClipboardList } as const;

export function RecoverableChanges({ account, workspaces, className }: { account: number | null | undefined; workspaces: Workspace[]; className?: string }) {
  const published = usePendingWork(account);
  const version = usePendingVersion();
  // Comment attempts kept from before a reload: checked against their threads (once per page), then listed if still needed.
  useEffect(() => { loadCommentAttempts(account); }, [account]);
  // Pick list order changes kept on the device from before this page: checked with the workspace, then listed if still needed.
  // Only the signed-in account's are read, and only it may send them.
  useEffect(() => { setPicklistAccount(account ?? null); void loadKeptOrderChanges(account); }, [account]);
  // Re-read the device's kept notes and queued entries when they change (here or in another tab).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(NOTE_DRAFTS_CHANGED, bump);
    window.addEventListener(SCOUT_CHANGED, bump);
    window.addEventListener("storage", bump);
    return () => { window.removeEventListener(NOTE_DRAFTS_CHANGED, bump); window.removeEventListener(SCOUT_CHANGED, bump); window.removeEventListener("storage", bump); };
  }, []);
  // Per row: a Retry on its way, or what the last one said.
  const [local, setLocal] = useState<Record<string, { busy?: boolean; message?: string }>>({});
  const setRow = (key: string, v: { busy?: boolean; message?: string } | null) => setLocal((cur) => {
    if (!v) { if (!(key in cur)) return cur; const { [key]: _gone, ...rest } = cur; return rest; }
    return { ...cur, [key]: v };
  });

  const kept = useMemo<Row[]>(() => {
    if (account == null) return [];
    return allNoteDrafts(account)
      .filter((d) => !isClaimed(`${account}:${d.space}:${d.season}`) && !noteInFlight(d.draft.wid))
      .map(({ space, season, draft }) => {
        const key = `kept:${account}:${space}:${season}:${draft.team}`;
        return {
          key, account, kind: "note", workspaceId: space, season, team: draft.team, label: `Note on ${draft.team}`, status: "attention",
          text: draft.note, base: draft.base,
          message: "Kept on this device; the workspace hasn't confirmed it. Retry sends it, and never over a teammate's newer note.",
          retry: () => {
            setRow(key, { busy: true });
            void sendKeptNote(account, space, season, draft).then((r) => setRow(key, r === "saved" || r === "gone" ? null : {
              message: r === "conflict" ? "A teammate changed this note after you wrote yours, so it wasn't sent. Open the pick list to choose which to keep."
                : "Still not saved: the workspace couldn't be reached, or didn't confirm it. Retry again in a moment.",
            }));
          },
          discard: () => { clearNoteDraft(account, space, season, draft.team); setRow(key, null); },
        };
      });
  }, [account, version, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = useMemo<Row[]>(() => {
    if (account == null) return [];
    return queuedWorkspaceEntries().flatMap((e) => {
      const problem = scoutSyncProblem(e.workspaceId);
      if (!problem || e.workspaceId == null) return [];
      const space = e.workspaceId;
      const key = `entry:${account}:${space}:${e.uuid}`;
      const what = e.deleted ? `Delete entry ${e.team}` : `Entry ${e.team} · ${e.kind === "pit" ? "Pit" : `Match ${e.matchLabel ?? ""}`.trim()}`;
      return [{
        key, account, kind: "entry", workspaceId: space, season: e.season, team: e.team, label: what,
        status: problem.kind === "offline" ? "waiting" : "attention", message: problem.message,
        retry: () => {
          setRow(key, { busy: true });
          void syncScouting(space).then(() => pullScouting(space)).catch(() => undefined).finally(() => setRow(key, null));
        },
        discard: () => { discardQueuedScoutEntry(space, e.uuid); void pullScouting(space).catch(() => undefined); },
      } satisfies Row];
    });
  }, [account, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Order changes of a pick list open on this page are in that list's own notice (KeptPickChanges): not listed twice.
  const shown = published.filter((r) => !(r.kind === "order" && isClaimed(`${r.account}:${r.workspaceId}:${r.season}`)));
  const rows: Row[] = [...shown, ...kept, ...entries]
    .map((r) => ({ ...r, busy: r.busy || local[r.key]?.busy, message: local[r.key]?.message ?? r.message }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "attention" ? -1 : 1));
  const attention = rows.filter((r) => r.status === "attention").length;

  // Said politely: how many are waiting when that changes, and that everything went once the list empties.
  const [said, setSaid] = useState("");
  const before = useRef(rows.length);
  useEffect(() => {
    const n = rows.length;
    if (n === before.current) return;
    setSaid(n === 0 ? "All changes are saved." : `${n} change${n === 1 ? "" : "s"} not saved yet.`);
    before.current = n;
  }, [rows.length]);

  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // A row acted on that then goes (retried and saved, or discarded): focus moves to the list's heading instead of
  // being lost with the row. (The whole list gone: the announcement says so.)
  const actedOn = useRef<string | null>(null);
  const afterAction = (key: string) => { actedOn.current = key; };
  const keys = rows.map((r) => r.key).join("|");
  useEffect(() => {
    const k = actedOn.current;
    if (!k || rows.some((r) => r.key === k)) return;
    actedOn.current = null;
    heading.current?.focus();
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  const [confirming, setConfirming] = useState<string | null>(null);
  // Rows whose "Show change" is open (reading only: nothing is sent until Retry).
  const [shown, setShown] = useState<Record<string, true>>({});
  const toggleShown = (key: string) => setShown((cur) => { if (cur[key]) { const { [key]: _gone, ...rest } = cur; return rest; } return { ...cur, [key]: true }; });
  const reviewBase = useId();
  const nameOf = (id: string) => workspaces.find((w) => w.id === id);

  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{said}</p>
      {rows.length > 0 && (
        <section aria-labelledby={headingId} className={cn("mb-4 rounded-xl border px-4 py-3 text-sm",
          attention ? "border-warning/50 bg-warning/10" : "border-border bg-card", className)}>
          <h2 id={headingId} ref={heading} tabIndex={-1} className="flex items-center gap-2 font-medium outline-none">
            {attention ? <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden /> : <CloudOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            Changes not saved yet ({rows.length})
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {attention ? "These haven't reached their workspace. Retry sends them again (never twice, and never over a teammate's newer change); Discard lets them go." : "Kept on this device. They go up by themselves once there's a connection."}
          </p>
          <ul className="mt-2 divide-y divide-border">
            {rows.map((r) => {
              const Icon = KIND_ICON[r.kind];
              const ws = nameOf(r.workspaceId);
              const readOnly = !!ws?.orphaned;
              // Only the signed-in account's own wording, for a note or a comment (rows are this account's already).
              const reviewable = r.text !== undefined && r.account === account && (r.kind === "note" || r.kind === "comment");
              const open = reviewable && !!shown[r.key];
              const reviewId = `${reviewBase}-${r.key.replace(/[^\w-]/g, "_")}`;
              return (
                <li key={r.key} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5" data-pending={r.key}>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", r.status === "attention" ? "text-warning" : "text-muted-foreground")} aria-hidden />
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-medium [overflow-wrap:anywhere]">{r.label}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {ws ? ws.name.trim() || "Your workspace" : "A workspace you're no longer in"}{r.season != null && <> · {seasonLabel(r.season)} season</>}
                      {r.team != null && <> · team <span className="font-mono">{r.team}</span></>}
                    </p>
                    <p className={cn("mt-0.5 text-xs", r.status === "attention" ? "text-foreground" : "text-muted-foreground")}>
                      {r.message}{readOnly && " The workspace is read-only now, so it can't be sent."}
                    </p>
                    {reviewable && (
                      <Button size="sm" variant="outline" className="mt-1.5 max-sm:h-11" aria-expanded={open} aria-controls={open ? reviewId : undefined}
                        aria-label={`${open ? "Hide" : "Show"} change: ${r.label}`} onClick={() => toggleShown(r.key)}>
                        <ChevronDown className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} /> {open ? "Hide change" : "Show change"}
                      </Button>
                    )}
                  </div>
                  {open && (
                    <div className="min-w-0 basis-full sm:pl-7">
                      <ChangeReview id={reviewId} text={r.text!} reachable={!!ws}
                        target={{ kind: r.kind as "note" | "comment", workspaceId: r.workspaceId, season: r.season, team: r.team, base: r.base, entry: r.entry, opId: r.opId }} />
                    </div>
                  )}
                  <div role="group" aria-label={`${r.label}: actions`} className={cn("flex shrink-0 flex-wrap items-center gap-2", open ? "basis-full sm:pl-7" : "ml-auto")}>
                    {confirming === r.key ? (
                      <>
                        <span className="text-xs text-muted-foreground">Discard this change?</span>
                        <Button size="sm" variant="destructive" className="max-sm:h-11" onClick={() => { setConfirming(null); afterAction(r.key); r.discard?.(); }}><Trash2 /> {r.discardLabel ?? "Discard"}</Button>
                        <Button size="sm" variant="secondary" className="max-sm:h-11" onClick={() => setConfirming(null)}>Keep it</Button>
                      </>
                    ) : (
                      <>
                        {r.retry && !readOnly && (
                          <Button size="sm" variant="secondary" className="max-sm:h-11" disabled={r.busy} aria-label={`Retry: ${r.label}`} onClick={() => { afterAction(r.key); r.retry!(); }}>
                            {r.busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
                          </Button>
                        )}
                        {r.discard && (
                          <Button size="sm" variant="outline" className="max-sm:h-11" disabled={r.busy} aria-label={`${r.discardLabel ?? "Discard"}: ${r.label}`} onClick={() => setConfirming(r.key)}>
                            <Trash2 /> {r.discardLabel ?? "Discard"}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
