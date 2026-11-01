// The picked event, as the Scout page's header: once an event is picked it stays picked (useScoutSession, kept on
// this device) and every section works inside it. Its name, dates, place, match and team counts, the page's sync
// state, and the one way to pick another event.
import type { ReactNode } from "react";
import { ArrowLeftRight } from "lucide-react";
import { dateRange, place } from "../../../lib/format";
import type { ScoutEvent } from "../../../lib/scoutEvent";
import { Button } from "../../ui/button";
import { Skeleton } from "../../states";

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

export function EventBar({ event, onChange, status }: {
  event: ScoutEvent;
  /** Opens the event picker (null: this space can't scout, so there's nothing to change to). */
  onChange: (() => void) | null;
  /** The page's sync state, beside Change event. */
  status?: ReactNode;
}) {
  const name = event.info?.name || event.schedule.eventName;
  return (
    <section aria-label="Event you're scouting" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-accent/40 bg-accent/[0.06] px-5 py-4 max-sm:mb-4 max-sm:px-4 max-sm:py-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent-text">Now scouting · <span className="font-mono">{event.code}</span></p>
        {name ? <h2 className="mt-0.5 text-xl font-bold leading-tight text-foreground sm:text-2xl">{name}</h2>
          : <Skeleton className="mt-1 h-7 w-56 rounded-md" />}
        <p className="mt-1 text-sm text-muted-foreground">{eventFacts(event)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status}
        {onChange && <Button variant="outline" onClick={onChange} className="max-sm:h-11"><ArrowLeftRight /> Change event</Button>}
      </div>
    </section>
  );
}
