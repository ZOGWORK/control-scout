// The event page's first screen in v8 (docs/design/v8-revamp-brief.md; the Page plan on PR #1977): what a visitor
// came for, by the event's state. Live: now and next, the live standings' top and progress. Finished: who won, the
// awards, the final standings and who advanced. Upcoming: who's coming (predicted top seeds and their strength) and
// your teams there. Only drawn with v8 on; pages/EventPage.tsx keeps the old header otherwise.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Award, ChevronDown, Crown, Users } from "lucide-react";
import type { EventDetail, FieldRow, MatchView } from "../shared/api";
import type { EventTab } from "../lib/eventTab";
import { eventRoster, eventStanding } from "../shared/eventStanding";
import { glanceStats } from "../lib/eventGlance";
import { useProjections } from "../lib/projections";
import { awardLabel, awardTitle, num } from "../lib/format";
import { hasTeamPage } from "../shared/teamPages";
import { MatchList } from "./predict";
import { AdvancedTeams } from "./AdvancedTeams";
import { cn } from "./cn";
import { V8_AWARD, v8Rank } from "../lib/v8colour";
import { V8_PHASE } from "../lib/records/describe";

export type EventState = "live" | "finished" | "upcoming";

/** The event's state for the first screen: live on its dates, upcoming before, finished after. */
export const eventState = (status: EventDetail["event"]["status"]): EventState => (status === "live" ? "live" : status === "upcoming" ? "upcoming" : "finished");

/** v8's tab order by state: what the visitor wants first, first. */
export const V8_TAB_ORDER: Record<EventState, EventTab[]> = {
  live: ["matches", "rankings", "teams", "playoffs", "awards", "insights", "odds"],
  finished: ["rankings", "playoffs", "awards", "matches", "insights", "teams", "odds"],
  upcoming: ["teams", "odds", "matches", "rankings", "insights", "playoffs", "awards"],
};
/** v8's tab when the address names none: live = Matches, finished = Rankings, upcoming = Teams. */
export const V8_DEFAULT_TAB: Record<EventState, EventTab> = { live: "matches", finished: "rankings", upcoming: "teams" };

/** A neutral v8 card with a header row (title left, a quiet note or action right). */
export function FocusCard({ title, aside, children, className, label }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={cn("min-w-0 overflow-hidden rounded-xl border border-line bg-card", className)}>
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4">
        <h2 className="text-sm font-semibold text-text-base">{title}</h2>
        {aside && <div className="text-xs text-text-faint">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A quiet text button in a card header ("Full rankings"). */
function CardLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="tap-44 text-xs font-medium text-text-muted transition-colors duration-150 still-hover:text-text-base">{children}</button>;
}

/** A section that opens on a tap (native <details>, so it works with no script and keeps its content findable). */
export function Disclosure({ title, hint, children, className, id }: { title: string; hint?: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <details id={id} className={cn("group rounded-xl border border-line bg-card", className)} data-disclosure>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 text-sm font-medium text-text-base [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{title}{hint && <span className="ml-2 font-normal text-text-faint">{hint}</span>}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-text-muted transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t border-line px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}

/** Played / total as one mint bar (progress is one of the few things mint marks). */
export function ProgressLine({ played, total }: { played: number; total: number }) {
  const pc = total ? Math.min(100, (played / total) * 100) : 0;
  return (
    <div className="px-4 py-3" data-focus-progress>
      <p className="flex items-baseline justify-between text-xs text-text-faint">
        <span><span className="text-sm font-semibold tabular-nums text-text-base">{played}</span> / <span className="tabular-nums">{total}</span> matches played</span>
        <span className="tabular-nums">{Math.round(pc)}%</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label="Matches played" aria-valuemin={0} aria-valuemax={total} aria-valuenow={played}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${pc}%` }} />
      </div>
    </div>
  );
}

/** A team as a label: the number in the slate blue (white when it is yours), the name beside it grey. */
function TeamName({ team, name, season, yours }: { team: number; name?: string | null; season: number; yours?: boolean }) {
  const body = <><span className={cn("font-mono font-semibold tabular-nums", yours ? "text-text-base" : "text-accent")}>{team}</span> <span className="truncate text-text-muted">{name}</span></>;
  return hasTeamPage(team, name)
    ? <Link to={`/teams/${team}?season=${season}`} className="flex min-w-0 items-baseline gap-2 still-hover:underline">{body}</Link>
    : <span className="flex min-w-0 items-baseline gap-2">{body}</span>;
}

/** "Yours": a mint dot before the name, said for screen readers. */
const YoursMark = () => <span className="size-1.5 shrink-0 rounded-full bg-accent" role="img" aria-label="Your team" data-yours />;

/**
 * The standings' top `n` (the meet's own at a league meet), then any of your teams below them, each a 44px row:
 * rank, team, record and OPR. The top three ranks are gold, silver and bronze, OPR is the rating purple and your
 * teams sit on a slate-blue highlight (lib/v8colour.ts).
 */
export function TopStandings({ field, season, mine, n = 8 }: { field: FieldRow[]; season: number; mine: ReadonlySet<number>; n?: number }) {
  const rows = eventRoster(field).map((r) => ({ r, s: eventStanding(r) })).filter((x) => x.s.rank != null).sort((a, b) => a.s.rank! - b.s.rank!);
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-text-muted">No ranking yet. It fills in as qualification matches are scored.</p>;
  const shown = [...rows.slice(0, n), ...rows.slice(n).filter((x) => mine.has(x.r.team))];
  return (
    <ol className="divide-y divide-line" data-top-standings>
      {shown.map(({ r, s }, i) => {
        const yours = mine.has(r.team);
        return (
          <li key={r.team} className={cn("grid h-11 grid-cols-[2rem_minmax(0,1fr)_auto_3.5rem] items-center gap-3 px-4 text-sm", yours && "bg-accent/[0.08] shadow-[inset_2px_0_0_var(--color-accent)]", i === n && "border-t border-white/[0.12]")} data-team={r.team}>
            <span className={cn("text-right tabular-nums text-text-muted", s.rank != null && s.rank <= 3 && "font-semibold", v8Rank(s.rank))}>{s.rank}</span>
            <span className="flex min-w-0 items-center gap-2">{yours && <YoursMark />}<TeamName team={r.team} name={r.name} season={season} yours={yours} /></span>
            <span className="text-xs tabular-nums text-text-faint">{s.wins != null ? `${s.wins}-${s.losses ?? 0}-${s.ties ?? 0}` : ""}</span>
            <span className={cn("text-right tabular-nums text-text-base", V8_PHASE.np)} title="np OPR">{num(r.opr.np)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Live: now and next (the LIVE panel, then the next three matches with their calls), and the live standings' top. */
export function LiveFocus({ d, panel, next, mine, onAll }: { d: EventDetail; panel: ReactNode; next: MatchView | null; mine: ReadonlySet<number>; onAll: (t: EventTab) => void }) {
  const played = d.matches.filter((m) => m.played).length;
  const upNext = d.matches.filter((m) => !m.played && m.key !== next?.key).slice(0, 3);
  const highlight = [...mine][0];
  return (
    <div className="mb-6 grid gap-4 max-sm:mb-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]" data-event-focus="live">
      <div className="min-w-0 space-y-4 [&_[data-live-panel]]:mt-0">
        {panel}
        {upNext.length > 0 && (
          <FocusCard title="Up next" aside={<CardLink onClick={() => onAll("matches")}>All matches</CardLink>} label="Up next">
            <div className="p-2"><MatchList matches={upNext} highlight={highlight} /></div>
          </FocusCard>
        )}
      </div>
      <FocusCard title="Live standings" aside={<CardLink onClick={() => onAll("rankings")}>Full rankings</CardLink>} label="Live standings" className="self-start">
        {d.matches.length > 0 && <ProgressLine played={played} total={d.matches.length} />}
        <div className="border-t border-line"><TopStandings field={d.field} season={d.event.season} mine={mine} /></div>
      </FocusCard>
    </div>
  );
}

/** Finished: the winning alliance and the awards (Inspire first), then the final standings and who advanced. */
export function FinishedFocus({ d, mine, nameOf, onAll }: { d: EventDetail; mine: ReadonlySet<number>; nameOf: (t: number) => string; onAll: (t: EventTab) => void }) {
  const season = d.event.season;
  const won = glanceStats(d).winners;
  const rankOf = (a: EventDetail["awards"][number]) => (/inspire/i.test(a.name ?? awardLabel(a.type, a.placement)) ? 0 : 1) * 100 + (a.placement ?? 9);
  // The alliance awards (winning / finalist alliance) are the Winners card already: not repeated here.
  const awards = d.awards.filter((a) => !/alliance/i.test(a.name ?? awardLabel(a.type, a.placement))).sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 6);
  return (
    // On a phone the order reads winners, awards, standings, advancing; on a wide screen standings sit on the right.
    <div className="mb-6 grid gap-4 max-sm:mb-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]" data-event-focus="finished">
      <div className="min-w-0 space-y-4 lg:col-start-1">
        <FocusCard title={<span className="inline-flex items-center gap-2"><Crown className={cn("size-4 text-text-muted", V8_AWARD)} aria-hidden />Winners</span>} aside={won?.alliance != null ? `Alliance ${won.alliance}` : undefined} label="Winners">
          {won ? (
            <ul className="divide-y divide-line" data-winners>
              {won.teams.map((t) => (
                <li key={t} className="flex h-11 items-center gap-2 px-4 text-sm">{mine.has(t) && <YoursMark />}<TeamName team={t} name={nameOf(t)} season={season} yours={mine.has(t)} /></li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-text-muted">No playoff result on record for this event.</p>}
        </FocusCard>
        <FocusCard title={<span className="inline-flex items-center gap-2"><Award className={cn("size-4 text-text-muted", V8_AWARD)} aria-hidden />Awards</span>} aside={d.awards.length > awards.length ? <CardLink onClick={() => onAll("awards")}>All {d.awards.length} awards</CardLink> : undefined} label="Awards">
          {awards.length ? (
            <ul className="divide-y divide-line" data-focus-awards>
              {awards.map((a) => (
                <li key={`${a.type}${a.placement}${a.team}`} className="grid min-h-11 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-4 py-2 text-sm">
                  <span className={cn("truncate text-text-muted", V8_AWARD)}>{awardTitle(a)}</span>
                  <span className="flex min-w-0 items-center gap-2">{mine.has(a.team) && <YoursMark />}<TeamName team={a.team} name={nameOf(a.team)} season={season} yours={mine.has(a.team)} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-text-muted">No awards published yet. They appear after the closing ceremony.</p>}
        </FocusCard>
      </div>
      <FocusCard title="Final standings" aside={<CardLink onClick={() => onAll("rankings")}>Full rankings</CardLink>} label="Final standings" className="self-start lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <TopStandings field={d.field} season={season} mine={mine} />
      </FocusCard>
      {d.advancement && <FocusCard title="Advancing" label="Advancing" className="lg:col-start-1"><div className="p-4"><AdvancedTeams adv={d.advancement} season={season} nameOf={nameOf} /></div></FocusCard>}
    </div>
  );
}

/** Upcoming: who's coming (predicted top seeds from the projection, else the strongest by rating) and your teams there. */
export function UpcomingFocus({ d, mine, registered, onAll }: { d: EventDetail; mine: ReadonlySet<number>; registered: number; onAll: (t: EventTab) => void }) {
  const e = d.event;
  const proj = useProjections(e.season, e.code, { live: false });
  const roster = eventRoster(d.field);
  const names = new Map(roster.map((f) => [f.team, f]));
  const projected = (proj.data?.current?.teams ?? []).filter((t) => t.rank && names.has(t.team)).sort((a, b) => a.rank!.p50 - b.rank!.p50).slice(0, 5);
  const byRating = [...roster].filter((f) => f.rating || f.seasonOpr != null).sort((a, b) => (b.rating?.np ?? b.seasonOpr ?? 0) - (a.rating?.np ?? a.seasonOpr ?? 0)).slice(0, 5);
  const strength = (f: FieldRow | undefined) => (f?.rating ? `Rating ${num(f.rating.np)}` : f?.seasonOpr != null ? `OPR ${num(f.seasonOpr)}` : "");
  const count = roster.length || registered;
  const yours = roster.filter((f) => mine.has(f.team));
  return (
    <div className="mb-6 grid gap-4 max-sm:mb-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]" data-event-focus="upcoming">
      <FocusCard title={<span className="inline-flex items-center gap-2"><Users className="size-4 text-text-muted" aria-hidden />Who's coming</span>}
        aside={count ? <CardLink onClick={() => onAll("teams")}>All {count} teams</CardLink> : undefined} label="Who's coming">
        {!roster.length ? (
          <p className="px-4 py-6 text-sm text-text-muted">{registered ? `${registered} teams registered so far. Strengths show once FIRST publishes the team list.` : "No team list published yet. It appears here once FIRST publishes it."}</p>
        ) : (
          <>
            <p className="px-4 pt-3 text-xs text-text-faint">{projected.length ? "Predicted top seeds (median of simulated rankings)" : "Strongest teams coming, by rating (season OPR where there is none yet)"}</p>
            <ol className="mt-1 divide-y divide-line" data-predicted-seeds>
              {(projected.length ? projected.map((t) => ({ team: t.team, lead: `#${t.rank!.p50}`, row: names.get(t.team) })) : byRating.map((f, i) => ({ team: f.team, lead: `${i + 1}`, row: f })))
                .map(({ team, lead, row }) => (
                  <li key={team} className="grid h-11 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 text-sm">
                    <span className="text-right tabular-nums text-text-muted">{lead}</span>
                    <span className="flex min-w-0 items-center gap-2">{mine.has(team) && <YoursMark />}<TeamName team={team} name={row?.name} season={e.season} yours={mine.has(team)} /></span>
                    <span className="text-xs tabular-nums text-text-faint">{strength(row)}</span>
                  </li>
                ))}
            </ol>
          </>
        )}
      </FocusCard>
      <FocusCard title="Your teams here" label="Your teams here" className="self-start">
        {yours.length ? (
          <ul className="divide-y divide-line" data-your-teams>
            {yours.map((f) => (
              <li key={f.team} className="grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 text-sm shadow-[inset_2px_0_0_var(--color-accent)]">
                <TeamName team={f.team} name={f.name} season={e.season} yours />
                <span className="text-xs tabular-nums text-text-faint">{strength(f)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-5 text-sm text-text-muted">
            {mine.size ? "None of your teams are on this event's list." : <>Set <Link to="/settings" className="underline underline-offset-2">your team</Link> or follow teams to see them here.</>}
          </p>
        )}
      </FocusCard>
    </div>
  );
}
