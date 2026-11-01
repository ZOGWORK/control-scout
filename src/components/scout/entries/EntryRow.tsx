// One entry in Entries: a row in one filtered list, not a card. Team, what (a match or the pit), the event, who
// and when, a line of its answers and notes, where its sync stands, and its actions. A wide screen lines the rows
// up in columns; a phone stacks each row's parts in two short lines with the actions beside them.
import { Link } from "react-router-dom";
import { ClipboardCheck, History, MessageSquare, Trash2 } from "lucide-react";
import { deleteScoutEntry, isScoutQueued, isScoutRejected, scoutSyncProblem, type ScoutEntry } from "../../../lib/scouting";
import { useEntryTemplate } from "../../../lib/scoutTemplates";
import { isKnownTime } from "../../../lib/format";
import { formatAnswer } from "../../../lib/entryDiff";
import { detailKey } from "../../../shared/scoutTemplate";
import { EntryAttribution } from "../../EntryAttribution";
import { SaveStatus } from "../../SaveStatus";
import { EntryPhotos } from "../EntryPhotos";
import { CommonsBadge } from "../CommonsShare";
import { Badge } from "../../ui/basic";
import { Button } from "../../ui/button";
import { toast } from "../../ui/sonner";
import { cn } from "../../cn";

/** An entry's time as a date, or "Date unknown" for one repaired to 0 (or out of Date's range): never 1969. */
export function entryDate(updatedAt: number | null | undefined): string {
  if (!isKnownTime(updatedAt)) return "Date unknown";
  const d = new Date(updatedAt);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "Date unknown";
}

/**
 * Where an entry's latest change stands. A shared entry: Synced, or Syncing…, or Waiting to sync while offline
 * (kept on this device), or Needs attention when a push didn't go through or its result wasn't confirmed, or
 * Paused by the owner. A Personal entry: Synced to the account, Waiting to sync, or On this device with no
 * account to sync to. Either, turned down by the server for good: Not synced, kept on this device.
 */
export function EntrySyncState({ e, signedIn = true }: { e: ScoutEntry; signedIn?: boolean }) {
  const queued = isScoutQueued(e);
  const what = `Entry ${e.team} ${e.kind === "pit" ? "pit" : `match ${e.matchLabel ?? ""}`}`.trim();
  // Turned down by the server for good (not queued any more, never stored there): never shown as Synced.
  if (!queued && signedIn && isScoutRejected(e)) return <SaveStatus state="attention" text="Not synced: kept on this device" what={what} className="shrink-0" />;
  if (e.workspaceId == null) {
    if (!signedIn) return <SaveStatus state="draft" text="On this device" what={what} className="shrink-0" />;
    return <SaveStatus state={queued ? "draft" : "saved"} text={queued ? "Waiting to sync" : "Synced"} what={what} className="shrink-0" />;
  }
  const problem = queued ? scoutSyncProblem(e.workspaceId) : null;
  const state = !queued ? "saved" : problem?.kind === "offline" || problem?.kind === "paused" ? "draft" : problem ? "attention" : "saving";
  const text = !queued ? "Synced" : problem?.kind === "paused" ? "Paused by the owner" : state === "draft" ? "Waiting to sync" : state === "saving" ? "Syncing…"
    : problem?.kind === "unconfirmed" ? "Not confirmed yet" : "Not synced";
  return <SaveStatus state={state} text={text} what={what} className="shrink-0" />;
}

export function EntryRow({ e, assigned, canDelete, readOnly, comments, signedIn = true, onEdit, onHistory }: {
  e: ScoutEntry; assigned: string | null; canDelete: boolean; readOnly: boolean; comments: number; signedIn?: boolean;
  onEdit: () => void; onHistory: () => void;
}) {
  // The fields it was made with (an older template version stays readable after the admin changes it).
  const t = useEntryTemplate(e);
  const answers = t.fields.filter((f) => e.data[f.id] !== undefined && e.data[f.id] !== false && e.data[f.id] !== 0 && e.data[f.id] !== "")
    .map((f) => {
      const d = f.type === "toggleDetail" ? e.data[detailKey(f.id)] : undefined;
      return `${f.label}: ${formatAnswer(e.data[f.id], f)}${typeof d === "string" && d ? `, ${d}` : ""}`;
    });
  const kind = e.kind === "pit" ? "Pit" : `Match ${e.matchLabel ?? ""}`;
  const what = `${e.team} · ${kind}`;
  return (
    // min-w-0: a grid item is otherwise as wide as its longest line that can't break, which pushed the actions
    // past a phone's edge. The actions wrap under the details when both don't fit (long names, two scouts).
    <li className="min-w-0 px-3 py-2.5 hover:bg-muted/30 md:px-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="grid min-w-0 flex-1 basis-56 gap-x-4 gap-y-0.5 md:grid-cols-[5.5rem_5.5rem_minmax(0,1fr)] md:items-baseline">
          <Link to={`/teams/${e.team}?season=${e.season}`} className="font-mono text-base font-bold hover:underline max-md:inline">{e.team}</Link>
          <span className={cn("text-sm font-medium max-md:hidden", e.kind === "pit" ? "text-accent-text" : "text-foreground")}>{kind}</span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground md:hidden">{kind}</span>
              {e.workspaceId == null ? <span>{e.eventCode ?? "No event"} · {entryDate(e.updatedAt)}</span> : (
                <>
                  <span className="font-mono">{e.eventCode ?? "No event"}</span>
                  <EntryAttribution e={e} className="min-w-0" />
                </>
              )}
              <EntrySyncState e={e} signedIn={signedIn} />
            </div>
            {answers.length > 0 && <p className="mt-0.5 truncate text-sm" title={answers.join(" · ")}>{answers.join(" · ")}</p>}
            {e.notes && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{e.notes}</p>}
            {(assigned || e.workspaceId != null) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {e.workspaceId != null && <CommonsBadge e={e} />}
                {assigned && <Badge variant="beta" className="mt-1 max-w-full whitespace-normal leading-snug [overflow-wrap:anywhere]"><ClipboardCheck className="shrink-0" /> {assigned}</Badge>}
              </div>
            )}
            <EntryPhotos entry={e} className="mt-2" />
          </div>
        </div>
        <div role="group" aria-label={`Entry ${what}`} className="ml-auto flex shrink-0 gap-1">
          {comments > 0 && (
            <Button variant="ghost" size="sm" onClick={onEdit} className="text-muted-foreground max-sm:h-10" aria-label={`${comments} comment${comments === 1 ? "" : "s"}: open the entry`}>
              <MessageSquare />{comments}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit} className="max-sm:h-10">{readOnly ? "View" : "Edit"}</Button>
          {e.workspaceId != null && <Button variant="ghost" size="icon-sm" aria-label="Version history" title="History" onClick={onHistory} className="max-sm:size-10"><History /></Button>}
          {canDelete && <Button variant="ghost" size="icon-sm" aria-label="Delete entry" onClick={() => { deleteScoutEntry(e); toast("Entry deleted"); }} className="max-sm:size-10"><Trash2 /></Button>}
        </div>
      </div>
    </li>
  );
}
