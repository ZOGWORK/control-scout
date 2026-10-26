// The Scout redesign's Matches tab ("Your matches", docs/mockups/scout-redesign.html step 5): every match
// at the event with what this scout has done in it (Done, Partly done, Skipped, Now, or its time), a
// summary on top, and All / To do / Skipped chips. Tapping a row opens that match. In a workspace the
// page can pass who has the other teams (`others`), shown under each row.
// Built for 30–120 rows: statuses are worked out once per input change, rows are memoized and skip
// layout off screen (content-visibility), and "Jump to now" scrolls to the current match.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import { Button } from "../../ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../ui/controls";
import { cn } from "../../cn";
import { EmptyState, Stat } from "../../page";
import {
  matchProgress, normalizeMatchLabel, slotLabel, teamsWatched,
  type AllianceSide, type ScheduleMatch, type SlotId, type Watching,
} from "../../../shared/scoutMatch";

/** Someone else's part of a match in a workspace: the alliance or slot they have, and whether it's in. */
export interface OtherScout { side: AllianceSide | SlotId; name: string; done: boolean }

export interface MatchesListProps {
  schedule: ScheduleMatch[];
  watching: Watching;
  /** Teams with an entry per match (scoutedByMatch): normalized label → teams. */
  scouted: Map<string, Set<number>>;
  /** The match open on the scout screen (-1: none). */
  currentIndex: number;
  /** Where scouting picks up (nextMatchIndex): matches before it that are still to do count as skipped. */
  nextIndex: number;
  onOpen: (index: number) => void;
  /** Workspace only: who has the other teams, by normalized match label. Rows show it only when given. */
  others?: Map<string, OtherScout[]>;
}

export type MatchStatus = "done" | "partial" | "skipped" | "now" | "upcoming";
export type MatchFilter = "all" | "todo" | "skipped";

export interface MatchRowInfo {
  index: number;
  match: ScheduleMatch;
  status: MatchStatus;
  /** The teams this scout watches in it. */
  watched: Set<number>;
  /** Teams in the match with an entry (any of the four). */
  entries: number;
}

/**
 * Each match's status. Done wins; the open match is Now; then Partly done; a match still to do before
 * where scouting picks up is Skipped; the rest are upcoming.
 */
export function matchRows(schedule: readonly ScheduleMatch[], w: Watching, scouted: Map<string, Set<number>>, currentIndex: number, nextIndex: number): MatchRowInfo[] {
  return schedule.map((match, index) => {
    const progress = matchProgress(match, w, scouted);
    const status: MatchStatus = progress === "done" ? "done" : index === currentIndex ? "now" : progress === "partial" ? "partial" : index < nextIndex ? "skipped" : "upcoming";
    const have = scouted.get(normalizeMatchLabel(match.label) ?? "");
    const entries = have ? [...match.red, ...match.blue].filter((t) => have.has(t)).length : 0;
    return { index, match, status, watched: new Set(teamsWatched(match, w).map((t) => t.team)), entries };
  });
}

export function matchSummary(rows: readonly MatchRowInfo[]) {
  let done = 0, entries = 0, skipped = 0;
  for (const r of rows) {
    if (r.status === "done") done++;
    if (r.status === "skipped") skipped++;
    entries += r.entries;
  }
  return { done, entries, skipped };
}

/** To do: anything not done (the open match, partly done, skipped and upcoming). */
export const inFilter = (f: MatchFilter, s: MatchStatus) => f === "all" || (f === "skipped" ? s === "skipped" : s !== "done");

// Event-local time, as FIRST reports it with no zone: read as UTC so it shows the venue's clock.
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
export function shortTime(t: string | null): string {
  if (!t) return "";
  const zoned = /(Z|[+-]\d\d:?\d\d)$/.test(t);
  const d = new Date(zoned ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return zoned ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : TIME.format(d);
}

const STATUS_WORDS: Record<Exclude<MatchStatus, "upcoming">, string> = { done: "Done", partial: "Partly done", skipped: "Skipped", now: "Now" };
const sideName = (s: OtherScout["side"]) => (s === "red" ? "Red" : s === "blue" ? "Blue" : slotLabel(s));
const teamsSpoken = (t: number[]) => (t.length ? t.join(" and ") : "no teams yet");

function rowName(r: MatchRowInfo, others: OtherScout[] | undefined): string {
  const { match: m, status } = r;
  const time = shortTime(m.time);
  const state = status === "upcoming" ? (time ? `about ${time}` : "to do") : STATUS_WORDS[status].toLowerCase();
  const who = others?.map((o) => `${sideName(o.side)}: ${o.name}, ${o.done ? "done" : "assigned"}`) ?? [];
  return [m.label, `red ${teamsSpoken(m.red)}`, `blue ${teamsSpoken(m.blue)}`, state, ...who].join(", ");
}

// The same chip the event page's match rows use for a team's result.
const PILL: Record<MatchStatus, string> = {
  done: "bg-success/15 text-success",
  partial: "bg-accent/15 text-accent-text",
  skipped: "bg-warning/15 text-warning",
  now: "bg-accent text-accent-ink",
  upcoming: "bg-muted text-text-muted",
};

/** One alliance as the event page's match rows show it: a tinted box with a coloured edge. Watched teams
 *  are marked the way a highlighted team is there (when the scout watches all four, none stand out). */
function AllianceBox({ side, teams, watched, mark }: { side: AllianceSide; teams: number[]; watched: Set<number>; mark: boolean }) {
  return (
    <span className={cn(
      "grid min-w-0 auto-cols-fr grid-flow-col gap-x-1 rounded-lg border-l-[3px] px-2 py-1.5",
      side === "red" ? "border-red-alliance bg-red-alliance/[0.06]" : "border-blue-alliance bg-blue-alliance/[0.06] @min-[330px]:border-l-0 @min-[330px]:border-r-[3px] @min-[330px]:text-right",
    )}>
      {teams.length ? teams.map((t) => {
        const me = mark && watched.has(t);
        return <span key={t} data-watched={me || undefined} className={cn("tabular rounded-md px-1.5 py-0.5 font-mono text-[0.8125rem]", me ? "bg-accent/15 font-bold text-accent-text ring-1 ring-accent/60" : "text-text-base")}>{t}</span>;
      }) : <span className="px-1.5 py-0.5 text-[0.8125rem] text-text-muted">Teams not set</span>}
    </span>
  );
}

const MatchRow = memo(function MatchRow({ row, others, current, mark, onOpen }: { row: MatchRowInfo; others?: OtherScout[]; current: boolean; mark: boolean; onOpen: (i: number) => void }) {
  const { match: m, status } = row;
  const time = shortTime(m.time);
  const pill = status === "upcoming" ? (time ? `~${time}` : "To do") : STATUS_WORDS[status];
  return (
    // Off-screen rows skip layout and paint, so a 120-match event scrolls like a short one.
    <li className="@container border-b border-border [contain-intrinsic-size:auto_76px] [content-visibility:auto] last:border-b-0" data-index={row.index}>
      <button
        type="button"
        onClick={() => onOpen(row.index)}
        aria-label={rowName(row, others)}
        aria-current={current ? "true" : undefined}
        className={cn(
          "relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-3 text-left outline-none transition-[background-color] still-hover:bg-accent/[0.07] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
          "@3xl:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_7rem]",
          current && "bg-accent/[0.05] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent/70",
        )}
      >
        <span className="font-mono text-sm font-semibold">{m.label}</span>
        <span className="col-start-2 row-start-1 justify-self-end @3xl:col-start-4">
          <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold", PILL[status])}>{pill}</span>
        </span>
        <span className="col-span-2 row-start-2 grid gap-1 @min-[330px]:grid-cols-2 @min-[330px]:gap-1.5 @3xl:col-span-2 @3xl:col-start-2 @3xl:row-start-1">
          <AllianceBox side="red" teams={m.red} watched={row.watched} mark={mark} />
          <AllianceBox side="blue" teams={m.blue} watched={row.watched} mark={mark} />
        </span>
        {others?.length ? (
          <span className="col-span-2 truncate text-[11px] text-text-muted @3xl:col-span-2 @3xl:col-start-2">
            {others.map((o, i) => <span key={`${o.side}-${o.name}`}>{i > 0 && " · "}{sideName(o.side)}: <span className="text-text-base">{o.name}</span> {o.done ? "✓" : "· assigned"}</span>)}
          </span>
        ) : null}
      </button>
    </li>
  );
});

const EMPTY: Record<MatchFilter, string> = { all: "No matches in the schedule yet.", todo: "Nothing left to scout.", skipped: "No skipped matches." };

export function MatchesList({ schedule, watching, scouted, currentIndex, nextIndex, onOpen, others }: MatchesListProps) {
  const [filter, setFilter] = useState<MatchFilter>("all");
  const listRef = useRef<HTMLOListElement>(null);
  const rows = useMemo(() => matchRows(schedule, watching, scouted, currentIndex, nextIndex), [schedule, watching, scouted, currentIndex, nextIndex]);
  const summary = useMemo(() => matchSummary(rows), [rows]);
  const shown = useMemo(() => rows.filter((r) => inFilter(filter, r.status)), [rows, filter]);
  const counts = useMemo(() => ({ all: rows.length, todo: rows.filter((r) => inFilter("todo", r.status)).length, skipped: summary.skipped }), [rows, summary]);
  const othersOf = useCallback((m: ScheduleMatch) => others?.get(normalizeMatchLabel(m.label) ?? ""), [others]);
  const mark = watching.kind !== "all";

  const now = rows[currentIndex];
  // Each tap asks for a scroll once the list has rendered: under a chip that hides the open match, the
  // list goes back to All first so its row is there.
  const [jumps, setJumps] = useState(0);
  const jump = () => {
    if (now && !inFilter(filter, now.status)) setFilter("all");
    setJumps((n) => n + 1);
  };
  useEffect(() => {
    if (jumps) listRef.current?.querySelector<HTMLElement>(`[data-index="${currentIndex}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    // Only a tap scrolls; a new current match doesn't move the list under the scout's finger.
  }, [jumps]);

  return (
    <section className="space-y-3" aria-label="Your matches">
      <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card">
        <div className="p-3"><Stat label="Matches done" value={summary.done} /></div>
        <div className="p-3"><Stat label="Team entries" value={summary.entries} /></div>
        <div className="p-3"><Stat label="Skipped" value={summary.skipped} /></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup type="single" variant="chips" value={filter} onValueChange={(v) => v && setFilter(v as MatchFilter)} aria-label="Show matches">
          <ToggleGroupItem value="all" className="max-sm:h-[44px]">All <span className="tabular-nums text-text-muted">{counts.all}</span></ToggleGroupItem>
          <ToggleGroupItem value="todo" className="max-sm:h-[44px]">To do <span className="tabular-nums text-text-muted">{counts.todo}</span></ToggleGroupItem>
          <ToggleGroupItem value="skipped" className="max-sm:h-[44px]">Skipped <span className="tabular-nums text-text-muted">{counts.skipped}</span></ToggleGroupItem>
        </ToggleGroup>
        {now && <Button variant="outline" size="sm" className="max-sm:h-[44px]" onClick={jump}><LocateFixed /> Jump to {now.match.label}</Button>}
      </div>
      {shown.length ? (
        <ol ref={listRef} className="rounded-xl border border-border bg-card" aria-label="Matches">
          {shown.map((r) => <MatchRow key={r.match.key} row={r} others={othersOf(r.match)} current={r.index === currentIndex} mark={mark} onOpen={onOpen} />)}
        </ol>
      ) : (
        <EmptyState title={EMPTY[filter]} />
      )}
    </section>
  );
}
