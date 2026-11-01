// Pit scouting on Event day: one team's pit entry with where it stands in the queue ("Pit 8 of 18"), the team's
// snapshot at the event (rank, record, OPR) and its photos beside the fields, and the pit queue to move team to
// team. Save keeps the entry and moves on to the next team still to do. A team already scouted here opens its
// entry to read or change. Progress is the queue's own count (src/shared/scoutProgress.ts).
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Camera, ExternalLink } from "lucide-react";
import type { ScoutEntry } from "../../../lib/scouting";
import type { ScoutEvent } from "../../../lib/scoutEvent";
import { pitScouted } from "../../../shared/scoutProgress";
import { EntryEditor, type EntryEditorProps } from "../forms/EntryEditor";
import { EntryComments } from "../EntryComments";
import { PitQueue } from "./EventDay";
import { Badge } from "../../ui/basic";
import { cn } from "../../cn";

/** The pit entry a team already has at an event (the newest), if any. */
export function pitEntryAt(entries: readonly ScoutEntry[], eventCode: string, team: number): ScoutEntry | null {
  const code = eventCode.toUpperCase();
  let best: ScoutEntry | null = null;
  for (const e of entries) if (!e.deleted && e.kind === "pit" && e.team === team && (e.eventCode ?? "").toUpperCase() === code && (!best || e.updatedAt > best.updatedAt)) best = e;
  return best;
}

/** The next team still to do after `team` in the event's list (wrapping round), or null when every other is done. */
export function nextPitTeam(teams: readonly number[], done: ReadonlySet<number>, team: number): number | null {
  const at = teams.indexOf(team);
  for (let k = 1; k <= teams.length; k++) {
    const t = teams[(Math.max(at, 0) + k) % teams.length];
    if (t !== team && !done.has(t)) return t;
  }
  return null;
}

type EditorPass = Pick<EntryEditorProps, "season" | "space" | "spaceName" | "workspaceTemplate" | "templatePending" | "readOnly" | "sync" | "savedHere">;

export function PitScout({ event, entries, team, onTeam, onClose, onSaved, ...editor }: EditorPass & {
  event: ScoutEvent;
  entries: readonly ScoutEntry[];
  team: number;
  onTeam: (team: number) => void;
  onClose: () => void;
  /** After a save (the page notes that this visit has saved). */
  onSaved?: () => void;
}) {
  const done = useMemo(() => pitScouted(entries, event.code), [entries, event.code]);
  const numbers = useMemo(() => event.teams.map((t) => t.team), [event.teams]);
  const existing = pitEntryAt(entries as ScoutEntry[], event.code, team);
  const total = numbers.length;
  const doneHere = numbers.filter((t) => done.has(t)).length;
  // This entry's place in the count: the next one done, or (already scouted) where it already counts.
  const position = done.has(team) ? doneHere : Math.min(total, doneHere + 1);
  const next = nextPitTeam(numbers, done, team);
  const listed = event.teams.find((t) => t.team === team);
  const row = event.rows.get(team);
  const pct = total ? Math.round((doneHere / total) * 100) : 0;

  const header = (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-xl font-bold text-foreground">{total ? <>Pit {position} <span className="text-muted-foreground">of {total}</span></> : "Pit scouting"}</h3>
        <span className="text-sm text-muted-foreground">{existing ? "Already scouted: change it or keep it" : next ? `Then ${next}` : total ? "The last team to do" : ""}</span>
      </div>
      {total > 0 && <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>}
    </div>
  );

  const snapshot = (
    <section aria-label={`Team ${team} at this event`} className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-lg font-bold text-foreground">{team}</p>
          <p className="truncate text-sm text-muted-foreground">{listed?.name ?? "Not on this event's team list"}</p>
        </div>
        {done.has(team) ? <Badge variant="success">Pit done</Badge> : <Badge variant="outline">Pit to do</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[["Rank", row?.rank ?? "—"], ["Record", row && row.wins != null ? `${row.wins}–${row.losses ?? 0}${row.ties ? `–${row.ties}` : ""}` : "—"], ["OPR", row?.opr.np != null ? row.opr.np.toFixed(1) : "—"]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/60 px-2 py-1.5"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="font-mono font-semibold tabular-nums">{v}</dd></div>
        ))}
      </dl>
      <Link to={`/teams/${team}`} className="mt-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-accent-text hover:underline">Team page <ExternalLink className="size-3.5" aria-hidden /></Link>
    </section>
  );

  // Photos belong to a saved entry (they upload against it): a new one says where they'll go.
  const photos = existing ? null : (
    <section aria-label="Photos" className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
      <Camera className="size-5 shrink-0" aria-hidden /> Photos of the robot can be added once this entry is saved.
    </section>
  );

  return (
    <div className="grid gap-4">
      <EntryEditor key={`${event.code}:${team}:${existing?.uuid ?? "new"}`} kind="pit" {...editor} initial={existing} team={team}
        event={{ code: event.code, name: event.info?.name ?? event.schedule.eventName ?? null }} teams={event.teams}
        nextLabel={!existing && next != null ? String(next) : null} header={header}
        onSaved={(e) => {
          onSaved?.();
          // A new entry moves on to the next team still to do; a change stays put.
          if (!existing && next != null && e.team === team) onTeam(next);
        }}
        onClose={onClose}
        aside={<>
          {snapshot}
          {photos}
          <PitQueue event={event} entries={entries} readOnly={!!editor.readOnly} onPit={onTeam} current={team} className={cn("max-lg:hidden")} />
        </>} />
      {existing?.workspaceId != null && <EntryComments key={`comments-${existing.uuid}`} entry={existing} />}
      {/* A phone has the queue under the form (the column beside it is a wide screen's). */}
      <PitQueue event={event} entries={entries} readOnly={!!editor.readOnly} onPit={onTeam} current={team} className="lg:hidden" />
    </div>
  );
}
