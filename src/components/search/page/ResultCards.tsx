// The /search page's results as cards (src/pages/SearchPage.tsx): an event is a block like the Events list's card
// (status, date, place up front), a team carries its season numbers as small badges, and a Compare is an action of
// its own, never a team. Each card is one link to where it opens, its destination said as a "View …" cue inside it
// (a styled label, not a second control); no card shows a web address. The header dropdown keeps its compact rows.
import { Link } from "react-router-dom";
import { ArrowLeftRight, ArrowRight, CalendarDays, Compass, FileText, MapPin, Shield, Swords, Users } from "lucide-react";
import type { SearchHit, TeamSummary } from "../../../shared/api";
import { hitHref } from "../../../shared/search";
import { eventTypeLabel } from "../../../shared/labels";
import { EVENT_TYPE_TONE } from "../../../lib/textTones";
import { dateRange, seasonLabel } from "../../../lib/format";
import { EventStatusChip } from "../../EventChips";
import { HitFacts } from "../SearchBox";
import { cn } from "../../cn";
import { compareTeams, eventFacts } from "./results";

/** "View event →": where the card goes, as part of the card's own link. */
function Cta({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-text group-hover:underline" data-cta>
      {children}<ArrowRight className="size-3.5" aria-hidden />
    </span>
  );
}

const nf = new Intl.NumberFormat();

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

export function EventCard({ h, onOpen }: { h: SearchHit; onOpen: () => void }) {
  const e = eventFacts(h);
  const tone = EVENT_TYPE_TONE[e.type ?? ""];
  return (
    <Link to={hitHref(h)} onClick={onOpen} data-result="event"
      className="lift group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-4 pl-5 max-sm:py-3">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", tone?.bar ?? "bg-text-base/25")} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <EventStatusChip status={e.status} className="px-2 py-0.5" />
        {e.type && <span className={cn("truncate font-semibold", tone?.text ?? "text-muted-foreground")}>{e.typeLabel ?? eventTypeLabel(e.type)}</span>}
        {h.season != null && <span className="rounded bg-muted px-1.5 py-px text-[11px] font-medium tabular-nums text-foreground/80">{seasonLabel(h.season)}</span>}
        {e.teams != null && e.teams > 0 && <span className="ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground"><Users className="size-3.5" aria-hidden />{e.teams}<span className="sr-only"> teams</span></span>}
      </div>
      <p className="mt-2 line-clamp-2 font-medium leading-snug text-foreground group-hover:text-accent-text">{h.title}</p>
      <div className="mt-auto space-y-1 pt-3 text-xs max-sm:pt-2 text-muted-foreground">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><CalendarDays className="size-4 shrink-0 text-accent" aria-hidden />{e.start ? dateRange(e.start, e.end) : "Date to be announced"}</p>
        {(e.venue || e.place) && <p className="flex items-center gap-1.5"><MapPin className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{[e.venue, e.place].filter(Boolean).join(" · ")}</span></p>}
      </div>
      <div className="mt-3 max-sm:hidden"><Cta>View event</Cta></div>
    </Link>
  );
}

/** A team's season numbers, each only when the data has it (never a placeholder). */
export function TeamBadges({ summary }: { summary: SeasonSummary | undefined }) {
  if (!summary) return null;
  const { s, season } = summary;
  const badges: { label: string; value: string }[] = [];
  if (s.record) badges.push({ label: seasonLabel(season), value: s.record });
  if (s.opr != null) badges.push({ label: "OPR", value: s.opr.toFixed(1) });
  if (s.oprRank != null && s.of) badges.push({ label: "OPR rank", value: `#${nf.format(s.oprRank)} of ${nf.format(s.of)}` });
  else if (s.lastEvent) badges.push({ label: "Last event", value: s.lastEvent.name });
  if (!badges.length) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1" data-badges>
      {badges.map((b) => (
        <span key={b.label} className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px]">
          <span className="shrink-0 text-muted-foreground">{b.label}</span><span className="min-w-0 break-words font-semibold tabular-nums text-foreground">{b.value}</span>
        </span>
      ))}
    </span>
  );
}

export function TeamCard({ h, summary, onOpen }: { h: SearchHit; summary?: SeasonSummary; onOpen: () => void }) {
  return (
    <Link to={hitHref(h)} onClick={onOpen} data-result="team"
      className="lift group flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Shield className="size-4" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-foreground group-hover:text-accent-text">{h.title}</span>
        {h.subtitle && <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>}
        {h.facts?.length ? <HitFacts facts={h.facts} /> : <TeamBadges summary={summary} />}
      </span>
      <span className="shrink-0 self-center max-sm:hidden"><Cta>Team profile</Cta></span>
    </Link>
  );
}

/** "X vs Y": both sides by number, name and place, as an action (volt), never as a team row. */
export function CompareCard({ h, summaries, onOpen }: { h: SearchHit; summaries: Map<number, SeasonSummary>; onOpen: () => void }) {
  const nums = compareTeams(h);
  const names = h.title.split(/\s+vs\.?\s+/i);
  return (
    <Link to={hitHref(h)} onClick={onOpen} data-result="compare"
      className="lift group flex items-start gap-3 rounded-xl border border-accent/50 bg-accent/[0.08] px-4 py-3.5">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink"><ArrowLeftRight className="size-4.5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-display text-base font-semibold text-foreground">
          {nums.length >= 2 ? nums.map((n, i) => <span key={n}>{i > 0 && <span className="px-1.5 text-accent-text">vs</span>}{summaries.get(n)?.s.name ?? names[i]?.replace(/^\d+\s*\|?\s*/, "") ?? "Team"} ({n})</span>) : h.title}
        </span>
        <span className="mt-1 block space-y-0.5 text-xs text-muted-foreground">
          {nums.map((n) => { const s = summaries.get(n)?.s; return s?.place ? <span key={n} className="block truncate">{n}: {s.place}</span> : null; })}
        </span>
        <span className="mt-1 block text-xs text-foreground/80">Compare side by side: records, OPR and event history</span>
        <span className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink" data-cta>View comparison<ArrowRight className="size-3.5" aria-hidden /></span>
      </span>
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
    [`${seasonLabel(season)} record`, (s) => s.record],
    ["OPR", (s) => (s.opr != null ? s.opr.toFixed(1) : null)],
    ["OPR rank", (s) => (s.oprRank != null && s.of ? `#${nf.format(s.oprRank)} of ${nf.format(s.of)}` : null)],
  ];
  const shown = rows.filter(([, f]) => sides.some(({ s }) => s && f(s) != null));
  return (
    <aside aria-label="Head-to-head summary" className="rounded-xl border border-border bg-card p-4" data-head-to-head>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><ArrowLeftRight className="size-3.5 text-accent" aria-hidden />Head-to-head</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {sides.map(({ n, s }) => (
          <div key={n} className="min-w-0">
            <p className="font-display text-sm font-semibold tabular-nums text-foreground">{n}</p>
            <p className="truncate text-xs text-muted-foreground">{s?.name ?? " "}</p>
          </div>
        ))}
      </div>
      {shown.length ? (
        <dl className="mt-3 divide-y divide-border border-t border-border text-sm">
          {shown.map(([label, f]) => (
            <div key={label} className="py-2">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 grid grid-cols-2 gap-3 font-semibold tabular-nums text-foreground">{sides.map(({ n, s }) => <span key={n}>{(s && f(s)) ?? "—"}</span>)}</dd>
            </div>
          ))}
        </dl>
      ) : <p className="mt-3 text-xs text-muted-foreground">No season numbers yet for these teams.</p>}
      <Link to={hitHref(h)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-text hover:underline">View full comparison<ArrowRight className="size-4" aria-hidden /></Link>
    </aside>
  );
}

const ROW_ICON = { place: MapPin, match: Swords, page: FileText, browse: Compass, event: CalendarDays, team: Shield } as const;

/** A plain row (places, matches, a team's events, pages): its name and details, no web address. */
export function ResultRow({ h, icon, sub, onOpen }: { h: SearchHit; icon: keyof typeof ROW_ICON; sub?: boolean; onOpen: () => void }) {
  const Icon = ROW_ICON[icon];
  return (
    <Link to={hitHref(h)} onClick={onOpen} className={cn("group flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground/90 hover:bg-accent/[0.08] hover:text-foreground", sub && "pl-9")}>
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
