// /search when nothing answers the query: never a bare "nothing matches". It says what search covers and what the
// query was read as, shows the closest real results under a label that says they're a fallback (never as the
// answer), and offers places to browse and example searches that work.
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, Info, Shield } from "lucide-react";
import type { SearchHit } from "../../../shared/api";
import { ExampleChips } from "../discover";
import { EventCard, ResultRow } from "./ResultCards";

export function NoResults({ query, understood, fallback, closest, onOpen }: {
  query: string;
  understood: string[];
  /** The server's labeled fallback ("No events at … — showing all New Jersey events instead"). */
  fallback?: { label: string; hits: SearchHit[] };
  /** Near matches that didn't make the cut. */
  closest: SearchHit[];
  onOpen: (h: SearchHit) => void;
}) {
  const nav = useNavigate();
  const fbEvents = fallback?.hits.filter((h) => h.kind === "event") ?? [];
  const fbOther = fallback?.hits.filter((h) => h.kind !== "event") ?? [];
  return (
    <div className="space-y-5" data-no-results>
      <div className="rounded-xl border border-border bg-card px-4 py-3.5 text-sm">
        <p className="text-foreground">Nothing matched “{query}” exactly.</p>
        <p className="mt-1 text-muted-foreground">FTC One Search covers teams, events, matches and places: try a team number, a team or event name, or a place.</p>
        {!!understood.length && (
          <div className="mt-2.5 flex items-start gap-1.5 text-muted-foreground" data-understood>
            <Info className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            <p>We understood: {understood.map((u, i) => <span key={i}>{i > 0 && " · "}<b className="font-medium text-foreground">{u.replace(/^Understood:\s*/, "")}</b></span>)}</p>
          </div>
        )}
      </div>
      {!!fallback?.hits.length && (
        <section aria-label={fallback.label}>
          <h2 className="mb-2 text-sm font-medium text-foreground" data-fallback-label>{fallback.label}</h2>
          {!!fbEvents.length && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{fbEvents.map((h) => <EventCard key={h.ref} h={h} onOpen={() => onOpen(h)} />)}</div>}
          {!!fbOther.length && (
            <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
              {fbOther.map((h) => <li key={`${h.kind}:${h.ref}`} className="border-b border-border last:border-b-0"><ResultRow h={h} icon={h.kind === "team" ? "team" : h.kind} onOpen={() => onOpen(h)} /></li>)}
            </ul>
          )}
        </section>
      )}
      {!!closest.length && (
        <section aria-label="Closest matches">
          <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Closest matches <span className="normal-case tracking-normal">(not an exact match)</span></h2>
          <ul className="overflow-hidden rounded-xl border border-border bg-card">
            {closest.map((h) => <li key={`${h.kind}:${h.ref}`} className="border-b border-border last:border-b-0"><ResultRow h={h} icon={h.kind === "team" ? "team" : h.kind} onOpen={() => onOpen(h)} /></li>)}
          </ul>
        </section>
      )}
      <section aria-label="Browse and try" className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Link to="/events" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-accent/60"><CalendarDays className="size-4 text-accent" aria-hidden />Browse all events</Link>
          <Link to="/teams" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-accent/60"><Shield className="size-4 text-accent" aria-hidden />Browse all teams</Link>
        </div>
        <ExampleChips label="Or try" onRun={(q) => nav(`/search?q=${encodeURIComponent(q)}`)} />
      </section>
    </div>
  );
}
