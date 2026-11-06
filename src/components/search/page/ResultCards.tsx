// The /search page's results as cards (src/pages/SearchPage.tsx): an event is a block like the Events list's card
// (status, date, place up front), a team carries its season numbers as small badges, and a Compare is an action of
// its own, never a team. Each card is one link to where it opens, its destination said as a "View …" cue inside it
// (a styled label, not a second control); no card shows a web address. The header dropdown keeps its compact rows.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight, ArrowRight, CalendarDays, Compass, FileText, MapPin, Shield, Swords, Trophy, Users } from "lucide-react";
import type { SearchHit, TeamSummary } from "../../../shared/api";
import { hitHref } from "../../../shared/search";
import { eventTypeLabel } from "../../../shared/labels";
import { EVENT_TYPE_TONE } from "../../../lib/textTones";
import { dateRange, seasonLabel } from "../../../lib/format";
import { EventStatusChip } from "../../EventChips";
import { HitFacts } from "../SearchBox";
import { cn } from "../../cn";
import { RecordText, better } from "./answerCells";
import { compareSides, compareTeams, eventFacts, teamParts } from "./results";
import { eventName } from "./records";
import { familyHref, familyMembers, type EventFamily } from "./eventFamilies";

/** "View event →": where the card goes, as part of the card's own link. */
function Cta({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-text group-hover:underline" data-cta>
      {children}<ArrowRight className="size-3.5" aria-hidden />
    </span>
  );
}

const nf = new Intl.NumberFormat();

/** "18061 | Simply Complex": number and name, each once (the server's title, in either of its forms). */
const teamTitle = (t: string) => { const p = teamParts(t); return p?.name ? `${p.number} | ${p.name}` : t; };

/** A team's numbers and the season they're from. */
export interface SeasonSummary { s: TeamSummary; season: number }
const hasNumbers = (t: TeamSummary) => t.record != null || t.opr != null;

/** Each team's summary for this season, or last season's when this one has no numbers for it yet (early season). */
export function teamSeasons(now: TeamSummary[] | undefined, before: TeamSummary[] | undefined, season: number): Map<number, SeasonSummary> {
  const out = new Map<number, SeasonSummary>();
  for (const t of before ?? []) out.set(t.team, { s: t, season: season - 1 });
  for (const t of now ?? []) if (hasNumbers(t) || !out.has(t.team) || !hasNumbers(out.get(t.team)!.s)) out.set(t.team, { s: t, season });
  return out;
}

/** An event's own pages, each only where it has something: its teams always, matches, rankings and playoffs once
 *  it has started (all are tabs of the event page). */
function quickLinks(h: SearchHit, status: string): { label: string; tab: string }[] {
  const links = [{ label: "Teams", tab: "teams" }];
  if (status !== "upcoming") links.unshift({ label: "Matches", tab: "matches" }, { label: "Rankings", tab: "rankings" });
  if (status === "finished") links.push({ label: "Playoffs", tab: "playoffs" });
  return links;
}

/** An event as a block: status, type and teams up top, a short title (a division's own name, its championship as a
 *  badge), date and place, then its own pages. The title's link covers the whole card (one link, no nesting); the
 *  quick links sit above it. Events that share a name across seasons are one card with a tab per season. */
export function EventCard({ h, onOpen, seasons, name }: { h: SearchHit; onOpen: (h: SearchHit) => void; seasons?: SearchHit[]; name?: string }) {
  const [pick, setPick] = useState(h.ref);
  const cur = seasons?.find((x) => x.ref === pick) ?? h;
  const e = eventFacts(cur);
  const tone = EVENT_TYPE_TONE[e.type ?? ""];
  const own = eventName(cur.title);
  const title = name ?? own.title, badges = own.badges;
  const [s, c] = cur.ref.split(":");
  return (
    <div data-result="event" className="lift group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-4 pl-5 max-sm:py-3">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", tone?.bar ?? "bg-text-base/25")} />
      {seasons && seasons.length > 1 && (
        <div role="group" aria-label={`${title}: season`} className="relative z-10 mb-2 flex flex-wrap gap-1" data-season-tabs>
          {seasons.map((x) => (
            <button key={x.ref} type="button" aria-pressed={x.ref === cur.ref} onClick={() => setPick(x.ref)}
              className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums max-md:min-h-[44px] max-md:px-3 max-md:text-xs pointer-coarse:min-h-[44px] pointer-coarse:px-3", x.ref === cur.ref ? "bg-accent text-accent-ink" : "bg-muted text-muted-foreground hover:text-foreground")}>
              {x.season != null ? seasonLabel(x.season) : "—"}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {e.status === "started"
          ? <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground/80" data-event-chip="status">Started</span>
          : <EventStatusChip status={e.status} className="px-2 py-0.5" />}
        {e.type && <span className={cn("truncate font-semibold", tone?.text ?? "text-muted-foreground")}>{e.typeLabel ?? eventTypeLabel(e.type)}</span>}
        {e.teams != null && e.teams > 0 && <span className="ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground"><Users className="size-3.5" aria-hidden />{e.teams}<span className="sr-only"> teams registered</span></span>}
      </div>
      <Link to={hitHref(cur)} onClick={() => onOpen(cur)} className="mt-2 line-clamp-2 font-medium leading-snug text-foreground outline-none group-hover:text-accent-text after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-accent">{title}</Link>
      <p className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
        {[...badges, e.place, cur.season != null ? seasonLabel(cur.season) : null].filter(Boolean).map((b) => <span key={b} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-medium text-foreground/80">{b}</span>)}
      </p>
      <div className="mt-auto space-y-1 pt-3 text-xs max-sm:pt-2 text-muted-foreground">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />{e.start ? dateRange(e.start, e.end) : "Date to be announced"}</p>
        {e.venue && <p className="flex items-start gap-1.5"><MapPin className="mt-px size-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words" data-venue>{e.venue}</span></p>}
      </div>
      <nav aria-label={`${title}: pages`} className="relative z-10 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-quick-links>
        {quickLinks(cur, e.status).map((l) => <Link key={l.tab} to={`/events/${s}/${c}?tab=${l.tab}`} onClick={() => onOpen(cur)} className="font-medium text-muted-foreground hover:text-accent-text hover:underline max-md:inline-flex max-md:min-h-[44px] max-md:items-center max-md:rounded-full max-md:border max-md:border-border max-md:px-3.5 max-md:text-sm max-md:text-foreground max-md:hover:no-underline">{l.label}</Link>)}
        <Link to={hitHref(cur)} onClick={() => onOpen(cur)} tabIndex={-1} aria-hidden className="ml-auto max-sm:hidden"><Cta>View event</Cta></Link>
      </nav>
    </div>
  );
}

/** An event split in divisions, in one season (./eventFamilies.ts): the event once (status, how many divisions, its
 *  name, season, dates, place and venue), its name a link to the Events list on that season and event, then a card
 *  per division and one for its finals. Spans the whole events grid. */
export function EventFamilyCard({ f, onOpen }: { f: EventFamily; onOpen: (h: SearchHit) => void }) {
  const e = eventFacts(f.finals ?? f.divisions[0]);
  const n = f.divisions.length;
  return (
    <section aria-label={`${f.name}, ${seasonLabel(f.season)}`} data-event-family={f.key} className="rounded-xl border border-border bg-card p-4 sm:col-span-full">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {e.status === "started"
          ? <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground/80" data-event-chip="status">Started</span>
          : <EventStatusChip status={e.status} className="px-2 py-0.5" />}
        <span className="text-muted-foreground" data-family-count>{n} {n === 1 ? "division" : "divisions"}</span>
      </div>
      <Link to={familyHref(f)} className="mt-2 block font-medium leading-snug text-foreground hover:underline max-md:min-h-[44px] max-md:content-center" data-family-link>{f.name}</Link>
      <p className="mt-1 text-sm text-muted-foreground">
        {seasonLabel(f.season)} season · {e.start ? `held ${dateRange(e.start, e.end)}` : "date to be announced"}{e.place ? ` · ${e.place}` : ""}
      </p>
      {e.venue && <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground"><MapPin className="mt-px size-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{e.venue}</span></p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-family-members>
        {familyMembers(f).map((m) => <EventCard key={m.hit.ref} h={m.hit} name={m.label} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

/** A team's season numbers, each only when the data has it (never a placeholder). */
export function TeamBadges({ summary, className }: { summary: SeasonSummary | undefined; className?: string }) {
  if (!summary) return null;
  const { s, season } = summary;
  const badges: { label: string; value: string }[] = [];
  if (s.record) badges.push({ label: seasonLabel(season), value: s.record });
  if (s.opr != null) badges.push({ label: "OPR", value: s.opr.toFixed(1) });
  if (s.oprRank != null && s.of) badges.push({ label: "OPR rank", value: `#${nf.format(s.oprRank)} of ${nf.format(s.of)}` });
  else if (s.lastEvent) badges.push({ label: "Last event", value: s.lastEvent.name });
  if (!badges.length) return null;
  return (
    <span className={cn("mt-1.5 flex flex-wrap gap-1", className)} data-badges>
      {badges.map((b) => (
        <span key={b.label} className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] max-md:rounded-full max-md:bg-muted max-md:px-2 max-md:text-xs">
          <span className="shrink-0 text-muted-foreground">{b.label}</span><span className="min-w-0 break-words font-semibold tabular-nums text-foreground">{b.value}</span>
        </span>
      ))}
    </span>
  );
}

/** `bare`: the page's summary already shows this team's numbers, so the card shows none (neither the server's facts
 *  nor the season badges): each number once. */
export function TeamCard({ h, summary, bare, onOpen }: { h: SearchHit; summary?: SeasonSummary; bare?: boolean; onOpen: () => void }) {
  // The title's link covers the whole card (the tap target). On a phone its own actions (VS Compare, Shortlist,
  // Matches) sit under it (PhoneTeamActions.tsx).
  return (
    <div data-result="team" className="lift group relative flex min-h-14 items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Shield className="size-4" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <Link to={hitHref(h)} onClick={onOpen} className="block break-words text-sm font-medium text-foreground outline-none group-hover:text-accent-text after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-accent max-md:text-base">{teamTitle(h.title)}</Link>
        {h.subtitle && <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground max-md:text-sm"><MapPin className="size-3.5 shrink-0 md:hidden" aria-hidden /><span className="truncate">{h.subtitle}</span></span>}
        {bare ? null : h.facts?.length ? <HitFacts facts={h.facts} /> : <TeamBadges summary={summary} />}
      </span>
      <span className="shrink-0 self-center max-sm:hidden"><Cta>View scouting profile</Cta></span>
    </div>
  );
}

/** "X vs Y": both sides by number, name and place, as the team page's bold numbers, never as a team row. */
/** `preview` (phones): a tap opens the head-to-head over the results instead of leaving them; the card keeps its link
 *  (open it in a new tab, copy it). */
export function CompareCard({ h, summaries, onOpen, preview }: { h: SearchHit; summaries: Map<number, SeasonSummary>; onOpen: () => void; preview?: (from: HTMLElement) => void }) {
  const nums = compareTeams(h);
  const sides = compareSides(h);
  const names = h.title.split(/\s+vs\.?\s+/i);
  return (
    <Link to={hitHref(h)} onClick={(e) => {
      onOpen();
      // A plain tap previews; a modified click (new tab, new window) is left to the link.
      if (preview && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); preview(e.currentTarget); }
    }} data-result="compare"
      className="lift group block rounded-2xl border border-border bg-card p-4 sm:p-6">
      <span className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeftRight className="size-4" aria-hidden />Compare side by side: records, OPR and event history</span>
      {nums.length >= 2 ? (
        <span className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
          {nums.slice(0, 2).map((n, i) => {
            const name = sides.find((x) => x.number === n)?.name ?? summaries.get(n)?.s.name ?? teamParts(names[i] ?? "")?.name ?? "Team";
            const place = sides.find((x) => x.number === n)?.place || summaries.get(n)?.s.place;
            return (
              <span key={n} className={cn("min-w-0", i === 1 && "col-start-3 text-right")}>
                <span className="block font-display text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground group-hover:text-accent-text sm:text-4xl">{n}</span>
                <span className="mt-1.5 block break-words text-base text-foreground/90 sm:text-lg">{name}</span>
                {place && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{place}</span>}
              </span>
            );
          })}
          <span aria-hidden className="col-start-2 row-start-1 self-center text-sm font-medium text-muted-foreground">vs</span>
        </span>
      ) : <span className="mt-2 block break-words font-display text-lg font-semibold text-foreground">{h.title}</span>}
      {nums.length > 2 && <span className="mt-2 block text-sm text-foreground/90">{nums.slice(2).map((n) => `${sides.find((x) => x.number === n)?.name ?? summaries.get(n)?.s.name ?? "Team"} (${n})`).join(", ")}</span>}
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-foreground underline decoration-border underline-offset-2 max-md:min-h-[44px]" data-cta>View comparison<ArrowRight className="size-4" aria-hidden /></span>
    </Link>
  );
}

/** Head-to-head at a glance (desktop, beside the results): each side's season record, OPR and OPR rank. A preview
 *  only: the full comparison is a link away. */
export function HeadToHead({ h, now, before, season: current }: { h: SearchHit; now?: TeamSummary[]; before?: TeamSummary[]; season: number }) {
  const nums = compareTeams(h).slice(0, 2);
  // One season for both sides, so the rows compare like with like: this season once either side has numbers in it.
  // With no earlier season to fall back on (a Compare that names its season), always this one.
  const useNow = !before || nums.some((n) => { const t = now?.find((x) => x.team === n); return !!t && hasNumbers(t); });
  const season = useNow ? current : current - 1;
  const sides = nums.map((n) => ({ n, s: (useNow ? now : before)?.find((x) => x.team === n) ?? now?.find((x) => x.team === n) }));
  const rows: [string, (s: TeamSummary) => string | null][] = [
    ["Record", (s) => s.record],
    ["OPR", (s) => (s.opr != null ? s.opr.toFixed(1) : null)],
    ["OPR rank", (s) => (s.oprRank != null && s.of ? `#${nf.format(s.oprRank)} of ${nf.format(s.of)}` : null)],
    ["Prediction rating", (s) => (s.rating != null ? `${s.rating.toFixed(1)}${s.ratingSd != null ? ` ±${s.ratingSd.toFixed(1)}` : ""}` : null)],
  ];
  const shown = rows.filter(([, f]) => sides.some(({ s }) => s && f(s) != null));
  return (
    <aside aria-label="Head-to-head summary" className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-head-to-head>
      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground"><span className="inline-flex items-center gap-1.5"><ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden />Head-to-head</span><span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-foreground/80" data-h2h-season>{seasonLabel(season)}</span></p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {sides.map(({ n, s }) => (
          <div key={n} className="min-w-0">
            <p className="font-display text-2xl font-semibold leading-none tabular-nums text-foreground">{n}</p>
            <p className="mt-1 truncate text-sm text-foreground/90">{s?.name ?? " "}</p>
          </div>
        ))}
      </div>
      {shown.length ? (
        <dl className="mt-3 divide-y divide-border border-t border-border text-sm">
          {shown.map(([label, f]) => (
            <div key={label} className="py-2.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 grid grid-cols-2 gap-3 font-display text-lg font-semibold tabular-nums text-foreground">{(() => {
                const vs = sides.map(({ s }) => (s && f(s)) ?? null);
                // The better side marked (the record by win share; a rank the lower), as the search answers mark it.
                const share = (r: string | null) => { const m = r && /^(\d+)-(\d+)-(\d+)/.exec(r); const g = m ? +m[1] + +m[2] + +m[3] : 0; return m && g ? (+m[1] + +m[3] / 2) / g : null; };
                const win = vs.length === 2 ? (label === "Record" ? better(label, share(vs[0]), share(vs[1])) : better(label, vs[0], vs[1])) : null;
                return sides.map(({ n }, i) => (
                  <span key={n} className={cn("inline-flex items-center gap-1", win === (i === 0 ? "a" : "b") && "font-bold")} data-better={win === (i === 0 ? "a" : "b") ? "" : undefined}>
                    {vs[i] == null ? "—" : label === "Record" ? <RecordText text={vs[i]!} /> : vs[i]}
                    {win === (i === 0 ? "a" : "b") && <Trophy className="size-3.5 text-muted-foreground" aria-label="Better" />}
                  </span>
                ));
              })()}</dd>
            </div>
          ))}
        </dl>
      ) : <p className="mt-3 text-xs text-muted-foreground">No season numbers yet for these teams.</p>}
      <Link to={hitHref(h)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-text hover:underline max-md:min-h-[44px] pointer-coarse:min-h-[44px]">View full comparison<ArrowRight className="size-4" aria-hidden /></Link>
    </aside>
  );
}

const ROW_ICON = { place: MapPin, match: Swords, page: FileText, browse: Compass, event: CalendarDays, team: Shield, compare: ArrowLeftRight } as const;

/** A plain row (places, matches, a team's events, pages): its name and details, no web address. */
export function ResultRow({ h, icon, sub, onOpen }: { h: SearchHit; icon: keyof typeof ROW_ICON; sub?: boolean; onOpen: () => void }) {
  const Icon = ROW_ICON[icon];
  return (
    <Link to={hitHref(h)} onClick={onOpen} className={cn("group flex min-h-[44px] items-center gap-2.5 px-3 py-2.5 text-sm text-foreground/90 hover:bg-muted/60 hover:text-foreground", sub && "pl-9")}>
      <Icon className={cn("size-4 shrink-0", icon === "place" && !h.href ? "text-accent" : "text-muted-foreground")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words">{h.title}</span>
        {(h.subtitle || (h.season != null && (h.kind === "match" || h.atEvent))) && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {(h.kind === "match" || h.atEvent) && h.season != null && <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium tabular-nums text-foreground/80">{seasonLabel(h.season)}</span>}
            <span className="truncate">{h.subtitle}</span>
          </span>
        )}
        {h.facts?.length ? <HitFacts facts={h.facts} /> : null}
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </Link>
  );
}
