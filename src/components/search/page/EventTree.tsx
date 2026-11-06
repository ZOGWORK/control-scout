// An event split in divisions, in one season, as a tree (./eventFamilies.ts groups them): the event once on the left
// (on a phone, on top), its divisions and finals branched off it on the right (on a phone, stacked and indented under
// it) by one connector line. Each fact is said once: name, season and game, dates, place, venue, type and status on
// the event; a division is its name, its own pages, and its status only where it differs. Status is the colour (a
// solid chip, the block's bar, the connector); the structure (position, indent, the line) reads without it.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, MapPin } from "lucide-react";
import type { SearchHit } from "../../../shared/api";
import { hitHref } from "../../../shared/search";
import { eventTypeLabel } from "../../../shared/labels";
import { EVENT_STATUS_SOLID } from "../../../lib/textTones";
import { dateRange, seasonLabel } from "../../../lib/format";
import { cn } from "../../cn";
import { quickLinks } from "./ResultCards";
import { eventFacts } from "./results";
import { familyHref, familyMembers, familyStatus, type EventFamily, type FamilyStatus } from "./eventFamilies";

const SAY: Record<FamilyStatus, string> = { live: "Live", upcoming: "Upcoming", finished: "Finished" };
/** A hit's status as the tree colours it: an event under way with no end date stored ("started") is live. */
const statusOf = (h: SearchHit): FamilyStatus => { const s = eventFacts(h).status; return s === "started" ? "live" : s; };

function StatusChip({ status }: { status: FamilyStatus }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold", EVENT_STATUS_SOLID[status].chip)} data-event-chip="status">{SAY[status]}</span>;
}

/** `open`: its divisions shown at first (the newest finished season and any upcoming or live one, ./eventFamilies.ts
 *  openFamilies); the rest open with a tap. Closed or open, every division counts. */
export function EventTree({ f, open: first, onOpen }: { f: EventFamily; open: boolean; onOpen: (h: SearchHit) => void }) {
  const [open, setOpen] = useState(first);
  const id = useId();
  const status = familyStatus(f);
  const tone = EVENT_STATUS_SOLID[status];
  const head = eventFacts(f.finals ?? f.divisions[0]);
  const n = f.divisions.length;
  const season = `${seasonLabel(f.season)}${f.game ? ` ${f.game}` : ""}`;
  return (
    <section aria-label={`${f.name}, ${season}`} data-event-family={f.key} data-status={status} className="relative overflow-hidden rounded-xl border border-border bg-card sm:col-span-full">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", tone.bar)} />
      <div className="grid gap-x-6 gap-y-3 py-4 pl-6 pr-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <header className="min-w-0" data-family-parent>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={status} />
            {head.type && <span className="text-xs text-muted-foreground" data-family-type>{head.typeLabel ?? eventTypeLabel(head.type)}</span>}
          </div>
          <Link to={familyHref(f)} className="mt-1 flex min-h-[44px] items-center font-semibold leading-snug text-foreground hover:underline" data-family-link>{f.name}</Link>
          <p className="text-sm font-medium text-foreground" data-family-season>{season} season</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{head.start ? `Held ${dateRange(head.start, head.end)}` : "Date to be announced"}{head.place ? ` · ${head.place}` : ""}</p>
          {head.venue && <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground"><MapPin className="mt-px size-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{head.venue}</span></p>}
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
            className="mt-1 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-foreground hover:underline" data-family-count>
            <span aria-hidden className={cn("size-2.5 rounded-full", tone.bar)} />
            {n} {n === 1 ? "division" : "divisions"}{f.finals ? " and finals" : ""}
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
          </button>
        </header>
        {open && (
          <ul id={id} className={cn("grid min-w-0 content-start gap-2 border-l-2 pl-4 max-lg:ml-1 sm:grid-cols-2", tone.line)} data-family-members>
            {familyMembers(f).map((m) => {
              const own = statusOf(m.hit);
              const e = eventFacts(m.hit);
              const [s, c] = m.hit.ref.split(":");
              return (
                <li key={m.hit.ref} className={cn("relative min-w-0 rounded-lg border border-border bg-background/40 px-3 py-1 before:absolute before:-left-[18px] before:top-[22px] before:h-0.5 before:w-4", tone.tick)} data-division>
                  <div className="flex items-center gap-2">
                    <Link to={hitHref(m.hit)} onClick={() => onOpen(m.hit)} className="flex min-h-[44px] min-w-0 flex-1 items-center font-medium text-foreground hover:underline">{m.label}</Link>
                    {own !== status && <StatusChip status={own} />}
                  </div>
                  <nav aria-label={`${m.label}: pages`} className="-mx-1.5 flex flex-wrap text-xs" data-quick-links>
                    {quickLinks(e.status).map((l) => <Link key={l.tab} to={`/events/${s}/${c}?tab=${l.tab}`} onClick={() => onOpen(m.hit)} className="inline-flex min-h-[44px] items-center px-1.5 font-medium text-muted-foreground hover:text-foreground hover:underline md:min-h-8 pointer-coarse:min-h-[44px]">{l.label}</Link>)}
                  </nav>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
