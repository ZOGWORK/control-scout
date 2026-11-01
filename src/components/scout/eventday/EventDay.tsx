// Event day: the picked event's work in one screen. What the scout watches (a strip, changed any time), the
// progress so far (next match, matches and pit teams done, entries today), and the two queues side by side on a
// wide screen: matches on the left, pit teams on the right, with your own teams under them. A phone stacks the
// same pieces. Every count comes from the space's entries (src/shared/scoutProgress.ts), the same ones the
// queues' rows read, so the strip and the queues always agree.
import { useMemo, useState } from "react";
import { ArrowRight, Check, CircleDashed, ListChecks, PenLine } from "lucide-react";
import { Link } from "react-router-dom";
import { othersByMatch, type MatchAssignment } from "../../../lib/slotAssignments";
import type { ScoutEvent } from "../../../lib/scoutEvent";
import type { ScoutSession } from "../../../lib/scoutSession";
import { nextMatchIndex, normalizeMatchLabel, scoutedByMatch, type Watching } from "../../../shared/scoutMatch";
import { entriesToday, matchQueueProgress, pitProgress, pitScouted } from "../../../shared/scoutProgress";
import { MatchesList, shortTime, type OtherScout } from "../redesign/MatchesList";
import { ScheduleState } from "../redesign/MatchHeader";
import { WatchStrip } from "./WatchStrip";
import { Badge } from "../../ui/basic";
import { Button } from "../../ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../ui/controls";
import { EmptyState } from "../../page";
import { Skeleton } from "../../states";
import { cn } from "../../cn";

type Entry = Parameters<typeof scoutedByMatch>[0][number] & { updatedAt?: number };

/** A card with a title row: the queues' frame. */
function Panel({ title, meta, action, children, className, label }: { title: string; meta?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label ?? title} className={cn("min-w-0 rounded-2xl border border-border bg-card", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {meta}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="p-3 max-sm:p-2">{children}</div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3 max-sm:px-3 max-sm:py-2.5">
      <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 text-2xl font-bold tabular-nums leading-none text-foreground max-sm:text-xl">
        {value}{hint && <span className="truncate text-sm font-semibold text-accent-text">{hint}</span>}
      </p>
    </div>
  );
}

export interface EventDayProps {
  event: ScoutEvent;
  session: ScoutSession;
  entries: readonly Entry[];
  /** The space can't add entries: the queues read, nothing to scout from them. */
  readOnly: boolean;
  onWatching: (w: Watching) => void;
  /** Opens a match to scout (its label). */
  onMatch: (label: string) => void;
  /** No schedule (or a practice match): a match typed in by hand. */
  onManualMatch: () => void;
  /** Opens pit scouting for a team. */
  onPit: (team: number) => void;
  /** A workspace's match assignments: who has the other teams, per match row. */
  assignments?: readonly MatchAssignment[];
  me?: number | null;
  /** Your teams (the account's own and its Control Point teams). */
  ourTeams: readonly number[];
}

export function EventDay(p: EventDayProps) {
  const { event, session, entries } = p;
  const schedule = event.schedule;
  const scouted = useMemo(() => scoutedByMatch(entries, session.eventCode), [entries, session.eventCode]);
  const next = useMemo(() => nextMatchIndex(schedule.matches, session.watching, scouted), [schedule.matches, session.watching, scouted]);
  const matches = useMemo(() => matchQueueProgress(schedule.matches, session.watching, scouted), [schedule.matches, session.watching, scouted]);
  const teamNumbers = useMemo(() => event.teams.map((t) => t.team), [event.teams]);
  const pit = useMemo(() => pitProgress(entries, session.eventCode, teamNumbers.length ? teamNumbers : event.info?.teams ?? 0), [entries, session.eventCode, teamNumbers, event.info]);
  const today = useMemo(() => entriesToday(entries, session.eventCode), [entries, session.eventCode]);
  const nextMatch = next >= 0 && schedule.status === "ready" ? schedule.matches[next] : null;
  const nextTime = nextMatch ? shortTime(nextMatch.time) : "";
  return (
    <div className="grid gap-5 max-sm:gap-4">
      {!p.readOnly && <WatchStrip watching={session.watching} onChange={p.onWatching} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 max-sm:gap-2">
        <Kpi label="Next match" value={nextMatch ? nextMatch.label : "—"} hint={nextTime ? `~${nextTime}` : undefined} />
        <Kpi label="Matches scouted" value={schedule.matches.length ? `${matches.done} / ${matches.total}` : "—"} />
        <Kpi label="Pit scouting" value={pit.total ? `${pit.done} / ${pit.total}` : pit.done || "—"} />
        <Kpi label="Entries today" value={today} />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] max-sm:gap-4">
        <MatchQueue {...p} scouted={scouted} next={next} done={matches.done} />
        <div className="grid gap-5 max-sm:gap-4">
          <PitQueue event={event} entries={entries} readOnly={p.readOnly} onPit={p.onPit} />
          <OurTeams event={event} entries={entries} ourTeams={p.ourTeams} />
        </div>
      </div>
    </div>
  );
}

/** The match queue: every match with this scout's progress, the next one picked out and one tap from scouting. */
export function MatchQueue({ event, session, readOnly, onMatch, onManualMatch, assignments, me, scouted, next, done, current, className }: Pick<EventDayProps, "event" | "session" | "readOnly" | "onMatch" | "onManualMatch" | "assignments" | "me"> & {
  scouted: Map<string, Set<number>>;
  next: number;
  done: number;
  /** The match being scouted beside it (its label); else the next one is the current row. */
  current?: string | null;
  className?: string;
}) {
  const schedule = event.schedule;
  const others = useMemo<Map<string, OtherScout[]> | undefined>(() => (assignments?.length
    ? othersByMatch(assignments, schedule.matches, scouted, me, { eventCode: session.eventCode, season: session.season }) : undefined), [assignments, schedule.matches, scouted, me, session.eventCode, session.season]);
  const nextMatch = next >= 0 ? schedule.matches[next] : null;
  const wanted = normalizeMatchLabel(current);
  const found = wanted ? schedule.matches.findIndex((m) => normalizeMatchLabel(m.label) === wanted) : -1;
  const ready = schedule.status === "ready" && schedule.matches.length > 0;
  return (
    <Panel title="Match queue" className={className}
      meta={ready ? <>
        <Badge variant="success" className="tabular-nums">{done} done</Badge>
        {nextMatch && found < 0 && <Badge variant="soft">{nextMatch.label} is next</Badge>}
      </> : undefined}
      action={readOnly ? undefined : ready && nextMatch && found < 0 ? (
        <Button size="sm" onClick={() => onMatch(nextMatch.label)} className="max-sm:h-10">Scout {nextMatch.label} <ArrowRight /></Button>
      ) : <Button size="sm" variant="outline" onClick={onManualMatch} className="max-sm:h-10"><PenLine /> Type a match in</Button>}>
      {ready ? (
        <div className="grid gap-2">
          <ScheduleState status="ready" fromDevice={schedule.fromDevice} />
          <MatchesList schedule={schedule.matches} watching={session.watching} scouted={scouted} currentIndex={found >= 0 ? found : next} nextIndex={next}
            onOpen={readOnly ? undefined : (i) => onMatch(schedule.matches[i].label)} others={others} nowLabel={found >= 0 ? "Now" : "Next up"}
            listClassName="max-h-[24rem] overflow-y-auto overscroll-contain lg:max-h-[34rem]" />
        </div>
      ) : (
        <ScheduleState status={schedule.status === "ready" ? "none" : schedule.status} error={schedule.error} onManual={readOnly ? undefined : onManualMatch} onRetry={() => void schedule.reload()} />
      )}
    </Panel>
  );
}

type PitFilter = "todo" | "done" | "all";

/** The pit queue: the event's teams, done or to do, with the next one to visit first in line. */
export function PitQueue({ event, entries, readOnly, onPit, current, className }: { event: ScoutEvent; entries: readonly Entry[]; readOnly: boolean; onPit: (team: number) => void; current?: number | null; className?: string }) {
  const done = useMemo(() => pitScouted(entries, event.code), [entries, event.code]);
  const [filter, setFilter] = useState<PitFilter>("todo");
  const teams = event.teams;
  const total = teams.length;
  const doneHere = teams.filter((t) => done.has(t.team)).length;
  const nextTeam = teams.find((t) => !done.has(t.team) && t.team !== current)?.team ?? null;
  const shown = teams.filter((t) => filter === "all" || (filter === "done") === done.has(t.team));
  const pct = total ? Math.round((doneHere / total) * 100) : 0;
  return (
    <Panel title="Pit queue" className={className} meta={total ? <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">{doneHere} / {total}</span> : undefined}>
      {!total ? (
        event.schedule.status === "loading" && !event.info ? <div role="status" aria-label="Loading the event's teams" className="grid gap-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-11 rounded-lg" />)}</div>
          : <EmptyState icon={ListChecks} title="No team list yet" description="FIRST hasn't posted this event's teams. Pit scouting fills in once it does." />
      ) : (
        <div className="grid gap-3">
          <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup type="single" variant="chips" value={filter} onValueChange={(v) => v && setFilter(v as PitFilter)} aria-label="Show pit teams">
              <ToggleGroupItem value="todo" className="max-sm:h-[44px]">To do <span className="tabular-nums text-text-muted">{total - doneHere}</span></ToggleGroupItem>
              <ToggleGroupItem value="done" className="max-sm:h-[44px]">Done <span className="tabular-nums text-text-muted">{doneHere}</span></ToggleGroupItem>
              <ToggleGroupItem value="all" className="max-sm:h-[44px]">All <span className="tabular-nums text-text-muted">{total}</span></ToggleGroupItem>
            </ToggleGroup>
            {!readOnly && nextTeam != null && <Button size="sm" onClick={() => onPit(nextTeam)} className="max-sm:h-10">Scout {nextTeam} next <ArrowRight /></Button>}
          </div>
          {!shown.length ? <p className="px-1 py-3 text-sm text-muted-foreground">{filter === "todo" ? "Every team's pit is scouted." : "No pit entries here yet."}</p> : (
            <ul aria-label="Pit teams" className="divide-y divide-border max-h-[20rem] overflow-y-auto overscroll-contain rounded-xl border border-border lg:max-h-[26rem]">
              {shown.map((t) => {
                const isDone = done.has(t.team), isNext = t.team === nextTeam, isCurrent = t.team === current;
                const body = (
                  <>
                    {isDone ? <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success text-background"><Check className="size-3.5" aria-hidden /></span>
                      : <CircleDashed className={cn("size-6 shrink-0", isNext || isCurrent ? "text-accent" : "text-muted-foreground/60")} aria-hidden />}
                    <span className="min-w-0 flex-1 truncate"><span className="font-mono font-semibold text-foreground">{t.team}</span>{t.name && <span className="ml-2 text-sm text-muted-foreground">{t.name}</span>}</span>
                    {isCurrent ? <Badge variant="soft">Open</Badge> : isDone ? <Badge variant="success">Done</Badge> : isNext ? <Badge variant="soft">Next</Badge> : null}
                  </>
                );
                const cls = cn("flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left", isCurrent && "bg-accent/[0.07]");
                return (
                  <li key={t.team}>
                    {readOnly ? <div className={cls}>{body}</div> : (
                      <button type="button" onClick={() => onPit(t.team)} aria-current={isCurrent ? "true" : undefined}
                        aria-label={`${t.team}${t.name ? ` ${t.name}` : ""}, ${isDone ? "pit done, open its entry" : "pit to do, scout it"}`}
                        className={cn(cls, "outline-none transition-colors still-hover:bg-accent/[0.07] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60")}>{body}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {event.teamsFrom === "schedule" && <p className="text-xs text-muted-foreground">Teams from the match schedule (FIRST's team list isn't on this device).</p>}
        </div>
      )}
    </Panel>
  );
}

/** Your teams at the event: rank and record (once matches are played) and whether their pit is in. */
function OurTeams({ event, entries, ourTeams }: { event: ScoutEvent; entries: readonly Entry[]; ourTeams: readonly number[] }) {
  const done = useMemo(() => pitScouted(entries, event.code), [entries, event.code]);
  const here = event.teams.filter((t) => ourTeams.includes(t.team));
  if (!here.length) return null;
  return (
    <Panel title={here.length > 1 ? "Your teams here" : "Your team here"}>
      <ul className="grid gap-1">
        {here.map((t) => (
          <li key={t.team} className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="min-w-0 flex-1">
              <Link to={`/teams/${t.team}`} className="block truncate font-semibold text-foreground hover:underline"><span className="font-mono">{t.team}</span>{t.name ? ` ${t.name}` : ""}</Link>
              <span className="block text-xs text-muted-foreground">{teamLine(event, t.team)}</span>
            </span>
            {done.has(t.team) ? <Badge variant="success">Pit done</Badge> : <Badge variant="outline">Pit to do</Badge>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function teamLine(event: ScoutEvent, team: number): string {
  const next = event.schedule.matches.find((m) => !m.played && (m.red.includes(team) || m.blue.includes(team)));
  const side = next ? (next.red.includes(team) ? "Red" : "Blue") : null;
  const row = event.rows.get(team);
  const rank = row?.rank ? `Rank ${row.rank}` : null;
  const record = row && row.wins != null ? `${row.wins}–${row.losses ?? 0}${row.ties ? `–${row.ties}` : ""}` : null;
  return [rank, record, next ? `next: ${next.label} (${side})` : null].filter(Boolean).join(" · ") || "No matches yet";
}
