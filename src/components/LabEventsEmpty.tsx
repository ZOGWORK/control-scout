// The Predict Lab's event list with nothing to show (Advancement, step 2): says why, and offers the way on —
// search every event, try another season, or clear the search. Never a list of unrelated events.
import { CalendarDays } from "lucide-react";
import { Button } from "./ui/button";
import { seasonLabel } from "../lib/format";

export function LabEventsEmpty({ team, teamCount, teamEvents, season, q, otherMatches, otherSeason, onShowAll, onSeason, onClearSearch }: {
  /** The chosen team when the list is its events only (null: every event). */
  team: number | null;
  /** Advancing events the team is registered at this season. */
  teamCount: number | null;
  /** Events of any kind the team is registered at this season. */
  teamEvents: number;
  season: number;
  q: string;
  /** Scrimmages and league meets that match the search (the lab can't simulate them). */
  otherMatches: number;
  /** Another season the team has played, to offer. */
  otherSeason: number | null;
  onShowAll: () => void;
  onSeason: (s: number) => void;
  onClearSearch: () => void;
}) {
  const s = seasonLabel(season);
  const searching = !!q.trim();
  let title: string, body: string | null = null;
  if (team != null && !teamCount) {
    title = teamEvents ? `${team} has no ${s} qualifier, league tournament or championship yet` : `${team} isn't registered for any ${s} event yet`;
    body = "Advancement odds run at qualifiers, league tournaments and championships. Its events show here once FIRST lists the team at one.";
  } else if (team != null) {
    title = `None of ${team}'s ${s} events match "${q.trim()}"`;
  } else {
    title = searching ? `No qualifier, league tournament or championship matches "${q.trim()}"` : `No advancing events in ${s} yet`;
  }
  if (otherMatches) body = `${otherMatches} scrimmage${otherMatches === 1 ? "" : "s"} or league meet${otherMatches === 1 ? "" : "s"} match${otherMatches === 1 ? "es" : ""}, but those don't advance teams, so the lab doesn't simulate them.`;
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border px-4 py-5" role="status">
      <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
      <div>
        <p className="text-base font-medium text-foreground">{title}</p>
        {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {team != null && <Button variant="secondary" size="sm" onClick={onShowAll}>Search all events</Button>}
        {team != null && !teamCount && otherSeason != null && <Button variant="outline" size="sm" onClick={() => onSeason(otherSeason)}>Try {seasonLabel(otherSeason)}</Button>}
        {searching && <Button variant="ghost" size="sm" onClick={onClearSearch}>Clear search</Button>}
      </div>
    </div>
  );
}
