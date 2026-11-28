// The picked event, as the Scout page's header: once an event is picked it stays picked (useScoutSession, kept on
// this device) and every section works inside it. Its name, dates, place, match and team counts, the page's sync
// state, the one way to pick another event, and Stop scouting to leave it.
import type { ReactNode } from "react";
import { ArrowLeftRight, LogOut, MoreHorizontal } from "lucide-react";
import { dateRange, place } from "../../../lib/format";
import type { ScoutEvent } from "../../../lib/scoutEvent";
import { Button } from "../../ui/button";
import { Skeleton } from "../../states";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/overlay";


const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The facts line: "Oct 30–31, 2026 · Freeland, MI · 36 matches · 24 teams" (what's known of it). */
export function eventFacts(ev: Pick<ScoutEvent, "info" | "teams" | "schedule">): string {
  const info = ev.info;
  const matches = ev.schedule.matches.length || info?.matchesTotal || 0;
  const teams = ev.teams.length || info?.teams || 0;
  return [
    info ? dateRange(info.start, info.end) : null,
    info ? place(info.city, info.state) || null : null,
    matches ? plural(matches, "match", "matches") : "Schedule not out yet",
    teams ? plural(teams, "team") : null,
  ].filter(Boolean).join(" · ");
}

export function EventBar({ event, onChange, onStop, status }: {
  event: ScoutEvent;
  /** Opens the event picker (null: this space can't scout, so there's nothing to change to). */
  onChange: (() => void) | null;
  /** Ends the session: this device stops scouting the event (its entries stay). */
  onStop?: (() => void) | null;
  /** The page's sync state, beside Change event. */
  status?: ReactNode;
}) {
  const name = event.info?.name || event.schedule.eventName;
  
  // v8 (docs/design/v8-revamp-brief.md §7.7): a quiet line under the page title, not a tinted box. Change event is
  // the one button beside it; Stop scouting (rare, and it ends the session) waits in More.
  return (
    <section aria-label="Event you're scouting" data-event-bar="v8" className="mb-5 flex items-start gap-3 border-b border-line pb-4 max-sm:mb-4 max-sm:pb-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-faint">Scouting · <span className="font-mono">{event.code}</span></p>
        {name ? <h2 className="mt-0.5 text-[1.0625rem] font-semibold leading-snug text-text-base">{name}</h2>
          : <Skeleton className="mt-1 h-6 w-56 rounded-md" />}
        <p className="mt-0.5 text-sm text-text-muted tabular-nums max-sm:text-xs">{eventFacts(event)}</p>
        {status && <div className="mt-1.5">{status}</div>}
      </div>
      {(onChange || onStop) && <div className="flex shrink-0 items-center gap-1.5">
        {onChange && <Button variant="outline" size="sm" onClick={onChange} aria-label="Change event"><ArrowLeftRight /><span>Change<span className="max-sm:hidden"> event</span></span></Button>}
        {onStop && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More event options" data-more-actions><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              <DropdownMenuItem onSelect={onStop}><LogOut /> Stop scouting</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>}
    </section>
  );
}
