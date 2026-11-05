// /search when nothing answers the query (the search results guide, §8 "No direct answer"): one sentence saying what's
// missing, the closest real results as full cards (never as the answer), searches that do answer about them, and
// places to browse, so the page is never an empty shell. What the query was understood as is kept off the page (§7):
// it travels as a data attribute only.
import { Link } from "react-router-dom";
import { CalendarDays, Shield } from "lucide-react";
import type { SearchHit } from "../../../shared/api";
import { EventCard, TeamCard } from "./ResultCards";
import { RelatedQuestions } from "./TeamAnswer";

/** Searches that answer about the closest results: a team's record and OPR, an event's winners. At most four. */
export function relatedFor(closest: SearchHit[]): string[] {
  const out: string[] = [];
  for (const h of closest) {
    if (h.kind === "team") out.push(`${h.ref} record`, `${h.ref} opr`);
    else if (h.kind === "event") out.push(`who won ${h.title}`);
  }
  return [...new Set(out)].slice(0, 4);
}

export function NoResults({ query, understood, closest, onOpen }: {
  query: string;
  understood: string[];
  /** Near matches that didn't make the cut. */
  closest: SearchHit[];
  onOpen: (h: SearchHit) => void;
}) {
  const cards = closest.filter((h) => h.kind === "team" || h.kind === "event").slice(0, 3);
  const related = relatedFor(cards);
  return (
    <div className="space-y-5" data-no-results data-understood={understood.map((u) => u.replace(/^Understood:\s*/, "")).join(" · ") || undefined}>
      <p className="text-sm text-foreground">
        Search has no answer for “{query}”{cards.length ? "; these are the closest real results." : ". Try a team number, a team or event name, or a place."}
      </p>
      {!!cards.length && (
        <section aria-label="Closest results" className="space-y-3">
          {cards.map((h) => (h.kind === "team"
            ? <TeamCard key={`${h.kind}:${h.ref}`} h={h} onOpen={() => onOpen(h)} />
            : <EventCard key={`${h.kind}:${h.ref}`} h={h} onOpen={onOpen} />))}
        </section>
      )}
      {!!related.length && <RelatedQuestions queries={related} title="Searches that answer about them" className="" />}
      <section aria-label="Browse">
        <div className="flex flex-wrap gap-2">
          <Link to="/events" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-accent/60"><CalendarDays className="size-4 text-muted-foreground" aria-hidden />Browse all events</Link>
          <Link to="/teams" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-accent/60"><Shield className="size-4 text-muted-foreground" aria-hidden />Browse all teams</Link>
        </div>
      </section>
    </div>
  );
}
