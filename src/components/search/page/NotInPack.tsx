// /search with no signal, for a query the downloaded event packs can't answer (SearchAnswer.notInPack, made on the
// device by src/lib/offline/search.ts): what it needs that isn't on the phone, as search's parser read it, then what
// is, with its pages to open. Never the dead "Can't reach the server" page.
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CloudOff } from "lucide-react";
import type { NotInPack } from "../../../shared/api";
import { snapshotClock } from "../../../shared/eventBundle";
import { NO_BOX, NO_CHIP } from "./NoResults";
import { cn } from "../../cn";

/** "Bullock Creek Qualifier, 34 teams, 53 matches, data from Nov 13, 8:09 PM". */
export function packLine(p: NotInPack["packs"][number], now = new Date()): string {
  return `${p.name}, ${p.teams} ${p.teams === 1 ? "team" : "teams"}, ${p.matches} ${p.matches === 1 ? "match" : "matches"}, data from ${snapshotClock(p.dataAsOf, now)}`;
}

/** "the 2025–26 season", "team 4215 and Worlds". */
export function aboutText(about: string[]): string {
  if (about.length <= 1) return about[0] ?? "";
  return `${about.slice(0, -1).join(", ")} and ${about[about.length - 1]}`;
}

/** The sentence the card leads with. */
export function notInPackSentence(n: NotInPack): string {
  return `This needs data that isn't in your downloaded pack${n.about.length ? ` (it's about ${aboutText(n.about)})` : ""}.`;
}

const LINK = "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-accent/60";

export function NotInPackCard({ notInPack: n, now = new Date() }: { notInPack: NotInPack; now?: Date }) {
  return (
    <div className="space-y-5" data-not-in-pack>
      <div className={cn(NO_BOX, "text-sm text-foreground")}>
        <span className={NO_CHIP} aria-hidden><CloudOff className="size-4" /></span>
        <div className="mt-1.5 space-y-1">
          <p className="font-semibold" data-not-in-pack-why>{notInPackSentence(n)}</p>
          <p className="text-muted-foreground">With no signal, search answers from your pack: its teams by number or name, the event, and its matches. Search again when you're back online for the rest.</p>
        </div>
      </div>
      {!!n.links.length && (
        <section aria-label="In your pack and in your search" className="flex flex-wrap gap-2">
          {n.links.map((l) => <Link key={l.href} to={l.href} className={LINK}>{l.label}<ArrowRight className="size-4 text-muted-foreground" aria-hidden /></Link>)}
        </section>
      )}
      <section aria-label="In your pack" className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">In your pack</h2>
        <ul className="space-y-2">
          {n.packs.map((p) => (
            <li key={`${p.season}:${p.code}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <span className="min-w-0 text-sm text-foreground" data-pack-line>{packLine(p, now)}.</span>
              <Link to={`/events/${p.season}/${encodeURIComponent(p.code)}`} className={LINK}><CalendarDays className="size-4 text-muted-foreground" aria-hidden />Open event</Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
