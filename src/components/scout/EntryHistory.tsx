// Conflicts and version history of shared scout entries (Task 16).
//
// - ConflictNotices: "Your edit was overwritten by <name>" for each edit this
//   device lost to a newer one (lostEdits.ts), until it is dismissed, restored
//   or discarded (once seen it never shows again); the version stays restorable from History.
// - ConflictDialog: their version against yours, field by field (template
//   labels), with Restore my version / Keep theirs.
// - HistorySheet: the entry's kept versions (the server keeps 20), who wrote
//   each and when, what each changed from the one before, and Restore on an
//   earlier version for its writer or an admin. An edit this device lost (and
//   the server may never have seen) is listed first.
//
// A restore is an ordinary save (restoreScoutVersion): a fresh updatedAt,
// attributed to you, checked by the server like any write.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, RotateCcw, TriangleAlert, X } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { agoShort } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { canDeleteScoutEntry, isScoutQueued, localScoutEntries, restoreScoutVersion, sameScoutText, type ScoutEntry } from "../../lib/scouting";
import { dropLostEdit, markLostSeen, useLostEdits, type LostEdit } from "../../lib/lostEdits";
import { entryDiff, entrySummary, NONE, type DiffRow, type EntryText } from "../../lib/entryDiff";
import { useMediaQuery } from "../../lib/meta";
import { useEntryTemplate } from "../../lib/scoutTemplates";
import { entrySubject } from "../../lib/scoutActivity";
import type { EntryVersion } from "../../shared/entryHistory";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/overlay";
import { Button } from "../ui/button";
import { Badge } from "../ui/basic";
import { toast } from "../ui/sonner";
import { ErrorState, LoadingBlock } from "../states";
import { cn } from "../cn";

/** `readOnly`: the space is read-only (Task 19, an orphaned workspace): nothing can be restored there. */
export type Viewer = { accountId?: number; role?: "admin" | "member"; readOnly?: boolean } | null;

type Versioned = EntryText & { season: number; templateId?: string; templateVersion?: number };

/**
 * May this viewer restore a version onto the entry? Its writer (the one whose work was overwritten) or an
 * admin; `writer` null: an edit this device lost (yours). Bringing back a deleted entry stays its author's or
 * an admin's, as for any write (the server refuses it otherwise).
 */
export function restoreBlock(current: ScoutEntry | null, writer: number | null, me: Viewer): string | null {
  if (me?.readOnly) return "This workspace is read-only, so nothing can be restored here.";
  if (!me?.role) return "Only members of this workspace can restore versions.";
  if (writer != null && me.role !== "admin" && writer !== me.accountId) return "Only whoever wrote a version, or a workspace admin, can restore it.";
  if (current?.deleted && !canDeleteScoutEntry(current, me)) return "This entry was deleted. Only its author or a workspace admin can bring it back.";
  return null;
}

const subjectOf = (e: Pick<EntryText, "team" | "kind" | "matchLabel" | "eventCode">) => entrySubject({ team: e.team, kind: e.kind, matchLabel: e.matchLabel, eventCode: e.eventCode });

/** The rows that differ from `before` to `after`, labelled with both versions' templates. */
function useDiff(before: Versioned | null, after: Versioned): DiffRow[] {
  const ta = useEntryTemplate(after);
  const tb = useEntryTemplate(before ?? after);
  return useMemo(() => (before ? entryDiff(before, after, tb.fields, ta.fields) : entrySummary(after, ta.fields)), [before, after, ta, tb]);
}

export function DiffTable({ rows, beforeLabel, afterLabel, caption }: { rows: DiffRow[]; beforeLabel: string; afterLabel: string; caption: string }) {
  const phone = useMediaQuery("(max-width: 639px)");
  if (!rows.length) return <p className="text-sm text-muted-foreground">No differences.</p>;
  if (phone) return <StackedDiff rows={rows} beforeLabel={beforeLabel} afterLabel={afterLabel} caption={caption} />;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr><th scope="col" className="w-[30%] px-3 py-2 text-left font-medium">Field</th><th scope="col" className="px-3 py-2 text-left font-medium">{beforeLabel}</th><th scope="col" className="px-3 py-2 text-left font-medium">{afterLabel}</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key} className="align-top">
              <th scope="row" className="break-words px-3 py-2 text-left font-medium">{r.label}</th>
              <td className="break-words px-3 py-2 text-muted-foreground"><span className="rounded bg-destructive/10 px-1 line-through decoration-destructive/50">{r.before}</span></td>
              <td className="break-words px-3 py-2"><span className="rounded bg-success/15 px-1">{r.after}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The same differences on a phone: each field with its Before above its After, both full width, so a long note
 * isn't squeezed into a third of the screen beside an empty cell. An empty side says so in one short line.
 */
function StackedDiff({ rows, beforeLabel, afterLabel, caption }: { rows: DiffRow[]; beforeLabel: string; afterLabel: string; caption: string }) {
  return (
    <ul aria-label={caption} className="divide-y divide-border overflow-hidden rounded-lg border border-border text-sm">
      {rows.map((r) => (
        <li key={r.key} className="space-y-1.5 px-3 py-2">
          <p className="break-words font-medium">{r.label}</p>
          <DiffSide side="Before" version={beforeLabel} value={r.before} />
          <DiffSide side="After" version={afterLabel} value={r.after} />
        </li>
      ))}
    </ul>
  );
}

function DiffSide({ side, version, value }: { side: "Before" | "After"; version: string; value: string }) {
  const empty = value === NONE;
  const before = side === "Before";
  return (
    <div data-side={side.toLowerCase()} className={cn("rounded-md border-l-2 py-1 pl-2.5", before ? "border-destructive/50" : "border-success/60")}>
      <p className="text-xs font-medium text-muted-foreground">{side} <span className="font-normal">({version})</span>{empty && <span className="font-normal">: empty</span>}</p>
      {!empty && (before
        ? <p className="mt-0.5 break-words text-muted-foreground"><span className="rounded bg-destructive/10 px-1 line-through decoration-destructive/50 [box-decoration-break:clone]">{value}</span></p>
        : <p className="mt-0.5 break-words"><span className="rounded bg-success/15 px-1 [box-decoration-break:clone]">{value}</span></p>)}
    </div>
  );
}

function SummaryList({ rows }: { rows: DiffRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing answered.</p>;
  return (
    <dl className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {rows.map((r) => <div key={r.key} className="contents"><dt className="break-words text-muted-foreground">{r.label}</dt><dd className="break-words">{r.after}</dd></div>)}
    </dl>
  );
}

const lostVersion = (l: LostEdit): Versioned => ({ ...l.mine, deleted: false });

/** Bring back a version, and say what happens next. */
function restore(current: Pick<ScoutEntry, "uuid" | "workspaceId">, v: Versioned & { updatedAt: number }, what: string) {
  try {
    restoreScoutVersion(current, v);
    toast.success(`Restored ${what}. It syncs as a new version from you.`);
    return true;
  } catch {
    toast.error("This device couldn't save the restore (storage full or blocked).");
    return false;
  }
}

// --- The notice -----------------------------------------------------------------------------

/** One line per edit this device lost in this space and hasn't been told about yet. */
export function ConflictNotices({ space, me }: { space: string; me: Viewer }) {
  const lost = useLostEdits(space);
  const [open, setOpen] = useState<LostEdit | null>(null);
  const unseen = lost.filter((l) => !l.seen);
  return (
    <>
      {unseen.length > 0 && (
        <div className="mb-4 space-y-2">
          {unseen.slice(0, 3).map((l) => (
            <div key={l.id} role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium">Your edit was overwritten by {l.by.name}</span>
                <span className="text-muted-foreground"> · {subjectOf(l.mine)}. Your version is kept on this device.</span>
              </p>
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="secondary" onClick={() => setOpen(l)}>View diff</Button>
                <button type="button" onClick={() => markLostSeen(space, l.id)} aria-label="Dismiss" className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
              </div>
            </div>
          ))}
          {unseen.length > 3 && <p className="text-xs text-muted-foreground">And {unseen.length - 3} more. Each entry's History lists them.</p>}
        </div>
      )}
      {open && <ConflictDialog lost={open} current={localScoutEntries(space).find((e) => e.uuid === open.uuid) ?? null} me={me} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Their version (the current one) against the one this device lost. */
export function ConflictDialog({ lost, current, me, onClose }: { lost: LostEdit; current: ScoutEntry | null; me: Viewer; onClose: () => void }) {
  const mine = lostVersion(lost);
  const theirs: Versioned | null = current ? { ...current } : null;
  const rows = useDiff(theirs, mine);
  const blocked = restoreBlock(current, null, me);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your edit was overwritten by {lost.by.name}</DialogTitle>
          <DialogDescription>{subjectOf(lost.mine)}. Their version is the current one; yours is kept on this device so you can bring it back.</DialogDescription>
        </DialogHeader>
        {theirs ? <DiffTable rows={rows} beforeLabel={`${lost.by.name} (current)`} afterLabel="Yours" caption="Current version against yours" />
          : <p className="text-sm text-muted-foreground">This entry isn't on this device anymore.</p>}
        {blocked && <p role="note" className="text-sm text-muted-foreground">{blocked}</p>}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => { dropLostEdit(lost.space, lost.id); onClose(); }}>Keep theirs</Button>
          <Button disabled={!!blocked || !current} onClick={() => { if (current && restore(current, { ...mine, updatedAt: lost.mine.updatedAt }, "your version")) { markLostSeen(lost.space, lost.id); onClose(); } }}><RotateCcw /> Restore my version</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- History ----------------------------------------------------------------------------------

const historyUrl = (ws: string, uuid: string) => `/api/scout/workspaces/${encodeURIComponent(ws)}/entries/${encodeURIComponent(uuid)}/history`;

/** The entry's kept versions from the server, newest first; refetched when the entry changes while open. */
function useHistory(entry: ScoutEntry, open: boolean) {
  const [state, setState] = useState<{ versions: EntryVersion[] | null; error: ApiError | null; loading: boolean }>({ versions: null, error: null, loading: false });
  // Only the latest request's answer counts: a slower, older one must not put back an older list.
  const latest = useRef(0);
  const load = useCallback(() => {
    if (!entry.workspaceId) return;
    const req = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    apiFetch<{ versions: EntryVersion[] }>(historyUrl(entry.workspaceId, entry.uuid))
      .then((r) => { if (req === latest.current) setState({ versions: r.versions ?? [], error: null, loading: false }); })
      .catch((e) => { if (req === latest.current) setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e : new ApiError(0, "Couldn't load the history.") })); });
  }, [entry.workspaceId, entry.uuid]);
  useEffect(() => () => { latest.current++; }, []);
  // Again whenever the entry changes, and when a queued edit of it is confirmed (the server stamps its editor then; the queue empties).
  useEffect(() => { if (open) load(); }, [open, load, entry.updatedAt, entry.editorAccountId]);
  return { ...state, reload: load };
}

export function HistorySheet({ entry, me, open, onOpenChange }: { entry: ScoutEntry; me: Viewer; open: boolean; onOpenChange: (o: boolean) => void }) {
  const now = useNow();
  const { versions, error, loading, reload } = useHistory(entry, open);
  const lost = useLostEdits(entry.workspaceId).filter((l) => l.uuid === entry.uuid);
  const current: Versioned = entry;
  const done = () => onOpenChange(false);
  // A change still queued on this device isn't in the history yet: no version is current. Otherwise the current one is the
  // newest version saying what the entry says (a save that changed nothing moves updatedAt but adds no version).
  const queued = isScoutQueued(entry);
  const currentNo = queued ? null : versions?.find((v) => sameScoutText(v, entry))?.versionNo ?? null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined} className="sm:max-w-lg">
        <SheetHeader className="pr-8">
          <SheetTitle className="flex items-center gap-2"><History className="size-4" /> History</SheetTitle>
          <SheetDescription>{subjectOf(entry)}. The last 20 versions, newest first. Restoring one saves it again as a new version from you.</SheetDescription>
        </SheetHeader>
        {lost.map((l) => <LostCard key={l.id} lost={l} entry={entry} current={current} me={me} now={now} onDone={done} />)}
        {loading && !versions ? <LoadingBlock rows={3} label="Loading history" />
          : error && !versions ? <ErrorState error={error} onRetry={reload} />
            : versions && !versions.length ? <p className="text-sm text-muted-foreground">No versions yet: this entry hasn't synced since history started. Its next change starts it.</p>
              : versions && (
                <>
                {/* This device has a change the history doesn't yet (still syncing): none of these is the current one. */}
                {queued && (
                  <p role="status" className="text-sm text-muted-foreground">The latest change on this device is still syncing. It shows here once the workspace has it.</p>
                )}
                <ol className="space-y-3">
                  {versions.map((v, i) => <VersionCard key={v.versionNo} v={v} older={versions[i + 1] ?? null} latest={v.versionNo === currentNo} entry={entry} me={me} now={now} onDone={done} />)}
                </ol>
                </>
              )}
      </SheetContent>
    </Sheet>
  );
}

function LostCard({ lost, entry, current, me, now, onDone }: { lost: LostEdit; entry: ScoutEntry; current: Versioned; me: Viewer; now: number; onDone: () => void }) {
  const mine = lostVersion(lost);
  const rows = useDiff(current, mine);
  const blocked = restoreBlock(entry, null, me);
  return (
    <section aria-label="Your overwritten edit" className="space-y-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm"><span className="font-medium">Your edit</span> <span className="text-muted-foreground">· {agoShort(lost.mine.updatedAt, now)} · overwritten by {lost.by.name}, kept on this device</span></p>
      </div>
      <DiffTable rows={rows} beforeLabel="Current" afterLabel="Yours" caption="Current version against your overwritten edit" />
      {blocked && <p role="note" className="text-xs text-muted-foreground">{blocked}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!!blocked} onClick={() => { if (restore(entry, { ...mine, updatedAt: lost.mine.updatedAt }, "your version")) { markLostSeen(lost.space, lost.id); onDone(); } }}><RotateCcw /> Restore my version</Button>
        <Button size="sm" variant="outline" onClick={() => dropLostEdit(lost.space, lost.id)}>Discard</Button>
      </div>
    </section>
  );
}

function VersionCard({ v, older, latest, entry, me, now, onDone }: { v: EntryVersion; older: EntryVersion | null; latest: boolean; entry: ScoutEntry; me: Viewer; now: number; onDone: () => void }) {
  const rows = useDiff(older, v);
  // The current version is already there; a deleted one can't be restored (that would be a delete).
  const restorable = !latest && !v.deleted;
  const blocked = restorable ? restoreBlock(entry, v.writtenBy.accountId, me) : null;
  const mineVersion = me?.accountId != null && v.writtenBy.accountId === me.accountId;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-mono text-xs text-muted-foreground">v{v.versionNo}</span>
        <span className="font-medium">{v.writtenBy.name || "A member"}{mineVersion ? " (you)" : ""}</span>
        <time className="text-muted-foreground" dateTime={new Date(v.updatedAt).toISOString()} title={new Date(v.updatedAt).toLocaleString()}>{agoShort(v.updatedAt, now)}</time>
        {latest && <Badge variant="soft">Current</Badge>}
        {v.deleted && <Badge variant="destructive">Deleted</Badge>}
        {v.restored && <Badge variant="secondary">{v.restoredFromVersion ? `Restored v${v.restoredFromVersion}` : "Restored an overwritten edit"}</Badge>}
      </div>
      {older ? <DiffTable rows={rows} beforeLabel={`v${older.versionNo}`} afterLabel={`v${v.versionNo}`} caption={`Changes in version ${v.versionNo}`} />
        : <><p className="text-xs text-muted-foreground">Earliest kept version</p><SummaryList rows={rows} /></>}
      {restorable && (
        blocked ? <p className="text-xs text-muted-foreground">{blocked}</p> : (
          <Button size="sm" variant="secondary" onClick={() => { if (restore(entry, v, `version ${v.versionNo}`)) onDone(); }}><RotateCcw /> Restore this version</Button>
        )
      )}
    </li>
  );
}
