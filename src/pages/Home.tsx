// Home, the FTC observatory: the dashboard (src/components/home/HomeDashboard.tsx), with search in the
// middle, then live events, top teams and your teams, inside the shell (which draws the sidebar, your
// picture, the wash and Report a bug around it). The brand lives in the shell's chrome.
import { Link } from "react-router-dom";
import { CalendarDays, MapPin } from "lucide-react";
import { UsernameBanner } from "../components/AccountSetup";
import { EventStatusChip } from "../components/EventChips";
import { HomeDashboard } from "../components/home/HomeDashboard";
import { useTitle } from "../lib/meta";
import { dateRange, place } from "../lib/format";
import type { EventListItem } from "../shared/api";

export default function Home() {
  useTitle(null);
  return (
    <div data-v8-home>
      <UsernameBanner />
      <HomeDashboard />
    </div>
  );
}

/** An event as a card (the My team page's tracked events use it). */
export function EventCard({ e }: { e: EventListItem }) {
  return (
    <Link to={`/events/${e.season}/${e.code}`} className="lift group flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <EventStatusChip status={e.status} className="px-2 py-0.5" />
        <span className="truncate text-xs text-muted-foreground">{e.typeLabel}</span>
        {e.matchesTotal > 0 && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{e.matchesPlayed}/{e.matchesTotal}</span>}
      </div>
      <p className="mt-2 line-clamp-2 font-medium leading-snug group-hover:text-accent-text">{e.name}</p>
      <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />{dateRange(e.start, e.end)}</p>
      <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0" />{place(e.city, e.state, e.country) || "Location TBA"}{e.teams ? ` · ${e.teams} teams` : ""}</p>
    </Link>
  );
}
