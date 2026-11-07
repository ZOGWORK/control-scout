// Every /search answer's one card, in the team page and My Teams card's own treatment (src/pages/MyTeamsPage.tsx
// TeamCard): a plain rounded card, a header with the team's number big and bold, its name and home under it, the
// season it's about as a badge and the way on to the full team page; then the answer, a bold title over its
// subtitle; then the team's season at a glance, the team page's own tiles (OPR, prediction rating, record, events)
// and its events, read from the team page's own data (/api/teams/:n). Nothing here is computed: a value the data
// doesn't hold is a dash. An answer about no team (a rule, a season's list) keeps the card and the title.
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, GraduationCap, MapPin, Search, Sparkles, Target, Trophy } from "lucide-react";
import { qs, useApi } from "../../../lib/api";
import { useCurrentSeason } from "../../../lib/meta";
import { dateRange, num, place, rankPct, seasonLabel } from "../../../lib/format";
import type { TeamEventRow, TeamProfile } from "../../../shared/api";
import { Meter, StatTile, rankPc } from "../../StatTile";
import { Badge } from "../../ui/basic";
import { cn } from "../../cn";
import { EventMarker, RankPill, RecordText } from "./answerCells";
import { GLANCE_TONE as G } from "../../../lib/textTones";
import { teamFill } from "../../../lib/textTones";

/** The touch rule every search control keeps: 44px tall on phones and touch screens. */
export const TAP = "max-md:min-h-[44px] pointer-coarse:min-h-[44px]";
/** A secondary action on an answer: underlined text, gold only on hover; the page's one primary action is the button. */
export const SECONDARY = "inline-flex items-center gap-1 text-sm font-medium text-foreground underline decoration-border underline-offset-2 hover:text-accent-text";

/** The H3 of a part inside an answer card. */
export const PART = "mb-2 text-sm font-semibold text-foreground";

/** The season an answer states ("OPR in 2025–26", a "2025–26" scope chip), as the year it starts in. */
export function statedSeason(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    const m = t?.match(/\b(20\d\d)[–-](\d\d)\b/);
    if (m && (Number(m[1]) + 1) % 100 === Number(m[2])) return Number(m[1]);
  }
  return null;
}

/** The season an answer that states none is about: the latest completed one (the season before the current, which
 *  has only just begun), as search answers it (.claude/search-260-rules.md "Season default"). */
export function useAnswerSeason(stated: number | null): number {
  const current = useCurrentSeason();
  return stated ?? current - 1;
}

/** The team page's profile of the team in that season: undefined while it loads, null when it couldn't be read (the
 *  answer stands without its supporting detail, which is then left out rather than left loading). */
export function useTeamProfile(team: number | null | undefined, season: number): TeamProfile | null | undefined {
  const r = useApi<TeamProfile>(team ? `/api/teams/${team}${qs({ season })}` : null);
  const p = r.data;
  if (p && p.team?.number === team && p.season === season) return p;
  return r.error ? null : undefined;
}

/** The card's title says only what the page's heading already says ("Record in 2025–26" under "Hypnotic Robotics
 *  (4215) · Record in 2025–26"): then it's for screen readers only, so nothing reads twice. */
export const repeats = (heading: string | null | undefined, title: string, chips: readonly string[] = []) => {
  // The title less what its chips say at its end ("Top 10 teams in New Jersey · 2025–26" with a 2025–26 chip).
  let t = title.trim();
  for (let i = t.lastIndexOf(" · "); i > 0 && chips.some((c) => c.trim().toLowerCase() === t.slice(i + 3).trim().toLowerCase()); i = t.lastIndexOf(" · ")) t = t.slice(0, i).trim();
  return !!heading && !!t && heading.toLowerCase().includes(t.toLowerCase());
};

type Who = { number: number; name: string | null };

/** The answer's card: a team header (one team, or two side by side), the title and subtitle, the answer, then
 *  whatever supports it. `season`: the badge in the header (the season the answer is about). */
export function AnswerFrame({ teams, split, profile, season, title, hideTitle, sub, children, label, data }: {
  teams?: Who[];
  /** Two alliances: the first `split` teams are one side of the "vs", the rest the other. */
  split?: number;
  profile?: TeamProfile | null;
  season?: number | null;
  title: string;
  /** The page's heading already says it: the title is for screen readers only. */
  hideTitle?: boolean;
  sub?: ReactNode;
  children: ReactNode;
  label?: string;
  data?: Record<string, string | undefined>;
}) {
  const shown = teams?.filter(Boolean) ?? [];
  return (
    <article aria-label={label ?? title} className="mb-5 overflow-hidden rounded-2xl border border-border bg-card" data-answer-frame {...data}>
      {shown.length === 1 ? <TeamHeader who={shown[0]} profile={profile} season={season} />
        : shown.length > 1 ? <TeamsHeader teams={shown} split={split} season={season} /> : null}
      <div className="p-4 sm:p-6">
        <div className={cn("min-w-0", (!hideTitle || sub) && "mb-4")}>
          <h2 className={cn("font-display text-lg font-semibold leading-snug text-foreground", hideTitle && "sr-only")} data-answer-title>{title}</h2>
          {sub && <div className="mt-1 text-sm text-muted-foreground" data-answer-sub>{sub}</div>}
        </div>
        {children}
      </div>
    </article>
  );
}

/** My Teams' card header: the number big and bold, the name, where it's from (the team page's facts line), the
 *  season and the full team page. */
function TeamHeader({ who, profile, season }: { who: Who; profile?: TeamProfile | null; season?: number | null }) {
  const t = profile?.team;
  const name = t?.name ?? who.name;
  const loc = t ? place(t.city, t.state, t.country) : null;
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-4 sm:p-6" data-answer-team={who.number}>
      <div className="min-w-0">
        <Link to={`/teams/${who.number}${season != null ? `?season=${season}` : ""}`} className="group block max-w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          <span className="block font-display text-4xl font-semibold leading-none tracking-tight text-foreground transition-colors group-hover:text-accent-text">{who.number}</span>
          <span className="mt-1.5 block break-words text-lg text-foreground/90">{name ?? "Name not on file"}</span>
        </Link>
        {t && (loc || t.school || t.rookieYear) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground" data-team-facts>
            {loc && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 shrink-0" aria-hidden />{loc}</span>}
            {t.school && <span className="inline-flex min-w-0 items-center gap-1.5"><GraduationCap className="size-4 shrink-0" aria-hidden /><span className="break-words">{t.school}</span></span>}
            {t.rookieYear && <span>Rookie year {t.rookieYear}</span>}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
        {season != null && <Badge variant="secondary" data-answer-season>{seasonLabel(season)}</Badge>}
        {/* A secondary action: a text link, never a button (one primary action per page, the guide's §9). */}
        <Link to={`/teams/${who.number}${season != null ? `?season=${season}` : ""}`} className={cn(SECONDARY, TAP)} data-secondary>Full team page <ArrowRight className="size-4" aria-hidden /></Link>
      </div>
    </header>
  );
}

/** Two teams (a head-to-head, a comparison): each number big with its name, side by side, each its own link. */
function TeamsHeader({ teams, split, season }: { teams: Who[]; split?: number; season?: number | null }) {
  const q = season != null ? `?season=${season}` : "";
  // Two alliances: each side's teams together, one colour per side, "vs" between them.
  if (split && split > 0 && split < teams.length) {
    const sides = [teams.slice(0, split), teams.slice(split)];
    return (
      <header className="border-b border-border p-4 sm:p-6" data-answer-teams data-answer-sides>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="sr-only">Alliances</span>
          {season != null && <Badge variant="secondary" className="ml-auto" data-answer-season>{seasonLabel(season)}</Badge>}
        </div>
        <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          {sides.map((side, i) => (
            <Fragment key={i}>
              <div className={cn("min-w-0 space-y-2", i === 1 && "col-start-3 text-right")} aria-label={side.map((t) => t.name ? `${t.name} (${t.number})` : `Team ${t.number}`).join(" and ")}>
                {side.map((t) => (
                  <Link key={t.number} to={`/teams/${t.number}${q}`} className={cn("group block min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60", TAP)}>
                    <span className="block font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-foreground transition-colors group-hover:text-accent-text sm:text-3xl">{t.number}</span>
                    <span className="mt-1 block break-words text-sm text-foreground/90 sm:text-base">{t.name ?? "Name not on file"}</span>
                  </Link>
                ))}
                <span aria-hidden className={cn("block h-1 w-10 rounded-full", teamFill(i), i === 1 && "ml-auto")} data-side-mark={i} />
              </div>
              {i === 0 && <span aria-hidden className="col-start-2 row-start-1 text-sm font-medium text-muted-foreground">vs</span>}
            </Fragment>
          ))}
        </div>
      </header>
    );
  }
  return (
    <header className="border-b border-border p-4 sm:p-6" data-answer-teams>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="sr-only">Scouting profiles</span>
        {season != null && <Badge variant="secondary" className="ml-auto" data-answer-season>{seasonLabel(season)}</Badge>}
      </div>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {teams.slice(0, 2).map((t, i) => (
          <TeamSide key={t.number} t={t} q={q} right={i === 1} first={i === 0} i={i} />
        ))}
      </div>
      {teams.length > 2 && (
        <p className="mt-3 flex flex-wrap gap-x-4 text-sm">
          {teams.slice(2).map((t) => <Link key={t.number} to={`/teams/${t.number}${q}`} className={cn("inline-flex items-center font-medium text-foreground hover:text-accent-text", TAP)}>{t.name ? `${t.name} (${t.number})` : `Team ${t.number}`}</Link>)}
        </p>
      )}
    </header>
  );
}

function TeamSide({ t, q, right, first, i }: { t: Who; q: string; right: boolean; first: boolean; i: number }) {
  return (
    <>
      <Link to={`/teams/${t.number}${q}`} aria-label={t.name ? `${t.name} (${t.number})` : `Team ${t.number}`} className={cn("group block min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60", right && "col-start-3 text-right")}>
        <span className="block font-display text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground transition-colors group-hover:text-accent-text sm:text-4xl">{t.number}</span>
        <span className="mt-1.5 block break-words text-base text-foreground/90 sm:text-lg">{t.name ?? "Name not on file"}</span>
        <span aria-hidden className={cn("mt-2 block h-1 w-10 rounded-full", teamFill(i), right && "ml-auto")} data-side-mark={i} />
      </Link>
      {first && <span aria-hidden className="col-start-2 row-start-1 text-sm font-medium text-muted-foreground">vs</span>}
    </>
  );
}

/** The team page's season tiles (My Teams' Season): OPR with its world rank, prediction rating, record, events. The
 *  tiles plain; each number in its own colour (lib/textTones GLANCE_TONE), a record's wins green and losses red. */
export function SeasonTiles({ profile, season }: { profile?: TeamProfile | null; season: number }) {
  if (profile === null) return null;
  if (!profile) return <div className="skeleton h-32 rounded-xl" aria-hidden data-season-tiles="loading" />;
  const s = profile.stats;
  const r = s?.record;
  const top = rankPct(s?.opr.np.rank, s?.opr.np.of);
  const when = `in ${seasonLabel(season)}`;
  return (
    <section aria-label={`${seasonLabel(season)} at a glance`} data-season-tiles>
      <h3 className={PART}>{seasonLabel(season)} at a glance</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="neutral" icon={Target} label="OPR" value={<span className={G.opr.text}>{num(s?.opr.np.value)}</span>}
          hint={s?.opr.np.rank ? `#${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()}${top ? ` · ${top}` : ""}` : "not ranked"}
          bar={s?.opr.np.rank ? <Meter parts={[{ pc: rankPc(s.opr.np.rank, s.opr.np.of), cls: G.opr.bar }]} /> : null} />
        <StatTile tone="neutral" icon={Sparkles} label="Prediction rating"
          value={s?.rating ? <><span className={G.rating.text}>{num(s.rating.np)}</span><span className="ml-1 text-base font-medium text-muted-foreground">±{num(s.rating.sd)}</span></> : "—"}
          hint={s?.rating ? `${s.rating.rank ? `#${s.rating.rank.toLocaleString()} worldwide · ` : ""}${s.rating.matches} matches` : `no matches ${when}`} />
        <StatTile tone="neutral" icon={Trophy} label="Record"
          value={r ? <span className="tabular-nums" aria-label={`${r.wins} wins, ${r.losses} losses, ${r.ties} ties`}><span aria-hidden><span className={G.win.text}>{r.wins}</span><span className="text-muted-foreground">-</span><span className={G.loss.text}>{r.losses}</span><span className="text-muted-foreground">-{r.ties}</span></span></span> : "—"}
          hint={r ? `${r.matches} matches · ${r.events} event${r.events === 1 ? "" : "s"}` : `no matches ${when}`}
          bar={r && r.wins + r.losses + r.ties > 0 ? <Meter parts={[{ pc: (100 * r.wins) / (r.wins + r.losses + r.ties), cls: G.win.bar, value: r.wins, scale: r.wins + r.losses + r.ties }, { pc: (100 * r.losses) / (r.wins + r.losses + r.ties), cls: G.loss.bar, value: r.losses, scale: r.wins + r.losses + r.ties }]} /> : null} />
        <StatTile tone="neutral" icon={CalendarDays} label="Events" value={<span className={G.events.text}>{profile.events.length}</span>}
          hint={profile.events.length ? `last: ${profile.events[profile.events.length - 1].name}` : `none ${when}`} />
      </div>
    </section>
  );
}

/** The season's events as the team page lists them: name, date and place, then rank and record there. */
export function SeasonEvents({ profile, season }: { profile?: TeamProfile | null; season: number }) {
  const events = profile?.events ?? [];
  if (!events.length) return null;
  return (
    <section aria-label={`${seasonLabel(season)} events`} className="mt-5" data-season-events>
      <h3 className={PART}>{seasonLabel(season)} events <span className="font-normal text-muted-foreground">· {events.length}</span></h3>
      <ul className="overflow-hidden rounded-xl border border-border">
        {[...events].reverse().map((e) => <EventRow key={e.code} e={e} team={profile!.team.number} />)}
      </ul>
    </section>
  );
}

function EventRow({ e, team }: { e: TeamEventRow; team: number }) {
  const rec = e.wins != null ? `${e.wins}-${e.losses ?? 0}-${e.ties ?? 0}` : null;
  const where = place(e.city, e.state, e.country);
  return (
    <li className="border-t border-border first:border-t-0">
      <Link to={`/events/${e.season}/${e.code}?team=${team}`} className="flex min-h-[44px] items-center gap-3 px-3.5 py-2.5 hover:bg-muted/50">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium text-foreground"><EventMarker type={e.type} />{e.name}<EventMarker type={e.type} chip /></span>
          <span className="block text-xs text-muted-foreground">{[e.start ? dateRange(e.start, e.end) : null, where].filter(Boolean).join(" · ")}</span>
        </span>
        {e.rank != null && <span className="shrink-0 text-right"><span className="block font-display text-base font-semibold"><RankPill text={`#${e.rank}`} /></span><span className="block text-[11px] text-muted-foreground">rank</span></span>}
        {rec && <span className="shrink-0 text-right"><span className="block font-display text-base font-semibold tabular-nums text-foreground"><RecordText text={rec} /></span><span className="block text-[11px] text-muted-foreground">record</span></span>}
      </Link>
    </li>
  );
}

/** Questions search answers about the same team, each run as a search: plain pills, the app's own outline buttons. */
export function RelatedQuestions({ queries, title = "Related questions", className = "mt-5" }: { queries: string[]; title?: string; className?: string }) {
  if (!queries.length) return null;
  return (
    <nav aria-label={title} className={className} data-block="related">
      <h3 className={PART}>{title}</h3>
      <ul className="flex flex-wrap gap-2">
        {queries.map((q) => (
          <li key={q}><Link to={`/search?q=${encodeURIComponent(q)}`} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm font-medium text-foreground hover:border-foreground/30 hover:bg-muted/50", TAP)}><Search className="size-3.5 text-muted-foreground" aria-hidden />{q}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
