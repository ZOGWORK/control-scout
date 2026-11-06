// An event split in divisions, in one season, as a tree (./eventFamilies.ts groups them): the event once, as the
// tree's root, on the left (on a phone, on top); its divisions branch off one line on the right (on a phone, stacked
// and indented under it), each a node on the line, and the finals last, where the divisions meet. Each fact is said
// once: name, season and game, dates, place, venue, type, status and team total on the event; a division is its name,
// its teams, its own pages, and its status only where it differs. Status is the colour (the root's badge, a solid
// chip, the block's bar, the line and its nodes); the structure (position, indent, the line) reads without it.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Layers, MapPin, Trophy, Users } from "lucide-react";
import type { SearchHit } from "../../../shared/api";
import { hitHref } from "../../../shared/search";
import { eventTypeLabel } from "../../../shared/labels";
import { EVENT_STATUS_SOLID } from "../../../lib/textTones";
import { dateRange, seasonLabel } from "../../../lib/format";
import { cn } from "../../cn";
import { quickLinks } from "./ResultCards";
import { eventFacts } from "./results";
import { familyDates, familyHref, familyMembers, familyStatus, type EventFamily, type FamilyStatus } from "./eventFamilies";

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
  const when = familyDates(f);
  const n = f.divisions.length;
  const season = `${seasonLabel(f.season)}${f.game ? ` ${f.game}` : ""}`;
  // The type, unless the event's name already says it ("FIRST Championship - …" is a FIRST Championship): once.
  const type = head.type ? head.typeLabel ?? eventTypeLabel(head.type) : null;
  const typeShown = type && !f.name.toLowerCase().includes(type.toLowerCase()) ? type : null;
  // Teams in all: the divisions' (the finals' teams come from them), when the data lists any.
  const teams = f.divisions.reduce((t, h) => t + (h.eventTeams ?? 0), 0);
  const members = familyMembers(f);
  return (
    <section aria-label={`${f.name}, ${season}`} data-event-family={f.key} data-status={status} className="relative overflow-hidden rounded-xl border border-border bg-card sm:col-span-full">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", tone.bar)} />
      <div className="grid gap-x-6 gap-y-3 py-4 pl-6 pr-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <header className="min-w-0" data-family-parent>
          <div className="flex items-start gap-3">
            {/* The tree's root. */}
            <span aria-hidden className={cn("grid size-11 shrink-0 place-items-center rounded-xl text-white shadow-sm", tone.chip)} data-family-root><Trophy className="size-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={status} />
                {typeShown && <span className="text-xs text-muted-foreground" data-family-type>{typeShown}</span>}
              </div>
              <Link to={familyHref(f)} className="mt-1 block font-semibold leading-snug text-foreground hover:underline max-md:py-2" data-family-link>{f.name}</Link>
            </div>
          </div>
          <p className="mt-2 text-sm font-medium text-foreground" data-family-season>{season} season</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{when.start ? `Held ${dateRange(when.start, when.end)}` : "Date to be announced"}{head.place ? ` · ${head.place}` : ""}</p>
          {head.venue && <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground"><MapPin className="mt-px size-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{head.venue}</span></p>}
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
            className="mt-1 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-foreground hover:underline" data-family-count>
            <span aria-hidden className={cn("size-2.5 rounded-full", tone.bar)} />
            {n} {n === 1 ? "division" : "divisions"}{f.finals ? " and finals" : ""}{teams ? ` · ${teams} teams` : ""}
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
          </button>
        </header>
        {open && (
          <ul id={id} className="min-w-0 content-start pl-7 max-lg:ml-2" data-family-members>
            {members.map((m, i) => {
              const own = statusOf(m.hit);
              const node = EVENT_STATUS_SOLID[own];
              const e = eventFacts(m.hit);
              const finals = m.hit === f.finals;
              const last = i === members.length - 1;
              const [s, c] = m.hit.ref.split(":");
              return (
                <li key={m.hit.ref} className="relative pb-2 last:pb-0" data-division>
                  {/* The line through every node (to the last one's), its node, and the branch to the row. */}
                  <span aria-hidden className={cn("absolute -left-[19px] top-0 w-0.5", tone.bar, last ? "h-[26px]" : "bottom-0", i === 0 && "top-[26px]")} />
                  <span aria-hidden className={cn("absolute -left-[24px] top-[20px] size-3 rounded-full ring-4 ring-card", node.bar)} data-node />
                  <span aria-hidden className={cn("absolute -left-[12px] top-[25px] h-0.5 w-3", tone.bar)} />
                  <div className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-lg border px-3 py-1.5", finals ? cn("border-transparent", node.tint) : "border-border bg-background/40")}>
                    <span aria-hidden className={cn("grid size-8 place-items-center rounded-lg", node.tint, node.icon)}>{finals ? <Trophy className="size-4" /> : <Layers className="size-4" />}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <Link to={hitHref(m.hit)} onClick={() => onOpen(m.hit)} className={cn("flex min-h-[44px] min-w-0 items-center text-foreground hover:underline md:min-h-8", finals ? "font-bold" : "font-medium")}>{m.label}</Link>
                        {own !== status && <StatusChip status={own} />}
                        {e.teams != null && e.teams > 0 && <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground" data-division-teams><Users className="size-3" aria-hidden />{e.teams} teams</span>}
                      </div>
                    </div>
                    <nav aria-label={`${m.label}: pages`} className="col-start-2 -mx-1 flex flex-wrap text-xs" data-quick-links>
                      {quickLinks(e.status).map((l) => <Link key={l.tab} to={`/events/${s}/${c}?tab=${l.tab}`} onClick={() => onOpen(m.hit)} className="inline-flex min-h-[44px] items-center px-1 font-medium text-muted-foreground hover:text-foreground hover:underline md:min-h-8 pointer-coarse:min-h-[44px]">{l.label}</Link>)}
                    </nav>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
