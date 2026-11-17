// A New Jersey league page's conference rankings (src/shared/conferences.ts): one tab per conference of the league,
// each its tournament's teams ranked by FIRST's league standing over the league meets only. The rank column is that
// order, always: sorting by another column reorders rows, never renumbers them. Before the tournament it is the teams
// going in (FTC New Jersey's sign-ups until FIRST posts a field), after it the standing they went in with. No charts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { cn } from "./cn";
import { TeamNumber } from "./records/RecordsTable";
import { asOfDate, conferenceHref, CONFERENCE_LABEL, ordinal, type Conference, type ConferenceRow, type LeagueConferences } from "../shared/conferences";
import { dateRange, seasonLabel } from "../shared/format";
import { leagueTitle } from "../shared/leagues";

export const CONFERENCE_PAGE = 50;

type SortKey = "rank" | "rs" | "tbp" | "record" | "rating" | "opr" | "played" | "meets";
const SORTS: { key: SortKey; get: (r: ConferenceRow) => number | null }[] = [
  { key: "rank", get: (r) => r.rank },
  { key: "rs", get: (r) => r.rs },
  { key: "tbp", get: (r) => r.tbp },
  { key: "record", get: (r) => (r.wins == null ? null : r.wins - (r.losses ?? 0)) },
  { key: "rating", get: (r) => r.rating },
  { key: "opr", get: (r) => r.opr },
  { key: "played", get: (r) => r.played },
  { key: "meets", get: (r) => r.meets },
];

/** Rows in the order asked; rows with no value last whichever way, then FIRST's league order. */
export function sortConferenceRows(rows: ConferenceRow[], key: SortKey, dir: "asc" | "desc"): ConferenceRow[] {
  const get = SORTS.find((s) => s.key === key)!.get;
  const base = (r: ConferenceRow) => r.rank ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null || y == null) return x == null && y == null ? base(a) - base(b) || a.team - b.team : x == null ? 1 : -1;
    return (dir === "asc" ? x - y : y - x) || base(a) - base(b) || a.team - b.team;
  });
}

const one = (v: number | null) => (v == null ? null : v.toFixed(1));
const record = (r: ConferenceRow) => (r.wins == null || r.losses == null ? null : `${r.wins}-${r.losses}-${r.ties ?? 0}`);

/** The conference a link asks for (only when exactly one has that slug), else the one the marked team is in, else the
 *  latest with teams (the list is oldest tournament first), else the latest. */
export function pickConference(list: Conference[], slug: string | null, team: number | null): Conference | null {
  if (slug) {
    const hits = list.filter((c) => c.slug === slug);
    if (hits.length === 1) return hits[0];
  }
  if (team) {
    const hits = list.filter((c) => c.rows.some((r) => r.team === team));
    if (hits.length) return hits[hits.length - 1];
  }
  return [...list].reverse().find((c) => c.rows.length > 0) ?? list[list.length - 1] ?? null;
}

export function ConferenceSection({ data, leagueName, slug, team }: { data: LeagueConferences; leagueName: string | null; slug: string | null; team: number | null }) {
  // A tab clicked, by its tournament's code (unique, where a slug may not be). The league page remounts this section
  // on a new league, season, link or team, so a click never outlives the link it was made under.
  const [chosen, setChosen] = useState<string | null>(null);
  const picked = data.conferences.find((c) => c.code === chosen) ?? pickConference(data.conferences, slug, team);
  // A link to a conference this league doesn't have, or that two share: said, never a guess.
  const unknown = !!slug && !chosen && data.conferences.filter((c) => c.slug === slug).length !== 1;
  const ref = useRef<HTMLElement>(null);
  // Opened from a link to the section: in view once its rows are in.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#conferences") ref.current?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <section ref={ref} id="conferences" aria-labelledby="conferences-title" className="scroll-mt-20 space-y-3" data-conferences>
      <div>
        <h2 id="conferences-title" className="font-display text-lg font-semibold">Conference rankings</h2>
        <p className="text-sm text-muted-foreground">
          {leagueTitle(leagueName, data.code)}'s conferences, {seasonLabel(data.season)}: each conference tournament's teams, ranked by FIRST's league standing.
        </p>
      </div>
      {!data.conferences.length ? (
        <p className="rounded-xl border border-border bg-card p-3 text-sm" data-conference-none>
          The conferences aren't known yet: FIRST hasn't listed this league's conference tournaments.
        </p>
      ) : (
        <>
          {unknown && <p className="text-sm text-muted-foreground" data-conference-unknown>This league has no one conference by that name this season, so none is picked for it.</p>}
          {data.conferences.length > 1 && (
            <div role="tablist" aria-label="Conferences" className="flex flex-wrap gap-2">
              {data.conferences.map((c) => {
                const on = c.code === picked?.code;
                return (
                  <button key={c.code} type="button" role="tab" aria-selected={on} onClick={() => setChosen(c.code)}
                    className={cn("h-9 rounded-lg border px-3 text-sm font-medium max-sm:h-[44px]", on ? "border-accent bg-accent/10 text-accent-text" : "border-border bg-card hover:border-accent/60")}>
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
          {picked && <ConferenceTable key={`${picked.season}|${picked.code}`} c={picked} team={team} />}
        </>
      )}
    </section>
  );
}

function SourceLine({ c }: { c: Conference }) {
  const rs = c.rs;
  if (rs.kind === "gone") return (
    <p data-rs-source>
      The league standing these teams went in with is no longer available: a league meet came after the tournament.{" "}
      <Link to={`/events/${c.season}/${encodeURIComponent(c.code)}`} className="text-accent-text hover:underline">The tournament's own ranking</Link>.
    </p>
  );
  if (rs.kind === "snapshot") return <p data-rs-source>League RS as of {asOfDate(rs.asOf)}, the week before the tournament.</p>;
  if (rs.kind === "final") return <p data-rs-source>Final league RS — league meets ended {asOfDate(rs.lastMeet)}, before this tournament.</p>;
  return <p data-rs-source>League RS as of {asOfDate(rs.asOf) ?? "the last read from FIRST"}{c.rows.some((r) => r.meets != null && r.meets <= 1) ? ": early in the season, after one meet a team's RS rests on a few matches" : ""}.</p>;
}

function ConferenceTable({ c, team }: { c: Conference; team: number | null }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "rank", dir: "asc" });
  const rows = useMemo(() => sortConferenceRows(c.rows, sort.key, sort.dir), [c.rows, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / CONFERENCE_PAGE));
  // The page holding the marked team, so a link to it opens on its row.
  const teamPage = () => { const i = rows.findIndex((r) => r.team === team); return i < 0 ? 0 : Math.floor(i / CONFERENCE_PAGE); };
  const [page, setPage] = useState(teamPage);
  useEffect(() => { setPage(teamPage()); }, [rows, team]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.slice(page * CONFERENCE_PAGE, (page + 1) * CONFERENCE_PAGE);
  const ranked = c.rows.filter((r) => r.rank != null).length;
  const going = c.status === "upcoming";
  const pick = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "rank" ? "asc" : "desc" }));
  const where = [c.venue, c.city].filter(Boolean).join(", ");
  return (
    <div className="space-y-2" data-conference={c.slug}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-base font-semibold">{c.name}</h3>
        <Link to={`/events/${c.season}/${encodeURIComponent(c.code)}`} className="text-sm text-accent-text hover:underline" data-conference-event>
          {c.event} · {dateRange(c.start) || "Date to be set"}{where ? ` · ${where}` : ""}
        </Link>
      </div>
      {c.firstName && <p className="text-xs text-muted-foreground">FIRST's event list calls it {c.firstName}; this is FTC New Jersey's name for it.</p>}
      <p className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-sm font-semibold" data-conference-label>{CONFERENCE_LABEL}</p>
      <div className="space-y-1 text-sm text-muted-foreground">
        {going && c.teamsFrom === "registered" && c.registered && (
          <p data-going-in>
            Tournament hasn't started yet — {c.registered.count} teams registered via <a href={c.registered.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">FTC New Jersey</a>, fetched {asOfDate(c.registered.fetchedAt)}.
            {" "}Registered, not the final field: teams may be added or dropped before FIRST posts it.
          </p>
        )}
        {going && c.teamsFrom === "field" && <p data-going-in>Tournament hasn't started yet — FIRST's team list: {c.rows.length} teams.</p>}
        {going && c.teamsFrom === "none" && <p data-going-in>Tournament hasn't started yet, and no team list is out for it yet.</p>}
        <p>Ranked by the league's own standing (RS, then TBP: FIRST's sort keys, as FIRST gives them), not by the tournament. Tournament rank and league rank are two different rankings; the tournament's is on <Link to={`/events/${c.season}/${encodeURIComponent(c.code)}`} className="text-accent-text hover:underline">its event page</Link>.</p>
        <SourceLine c={c} />
        {c.winner && (
          <p className="flex items-center gap-1.5 text-text-base" data-conference-winner>
            <Trophy className="size-4 shrink-0 text-amber-500" aria-hidden />
            <span>Won by <TeamLink season={c.season} t={c.winner.captain} /> (Winning Alliance Captain){c.winner.picks.length ? <> with {c.winner.picks.map((p, i) => <span key={p.team}>{i ? ", " : ""}<TeamLink season={c.season} t={p} /></span>)}</> : null}, from FIRST's awards.</span>
          </p>
        )}
        {c.seasons.length > 0 && (
          <p data-conference-seasons>
            {c.seasons.map((o, i) => (
              <span key={o.season}>{i ? " · " : ""}<Link to={conferenceHref(o.season, o.region, o.league, { slug: o.slug, team })} className="text-accent-text hover:underline">{o.name}, {seasonLabel(o.season)} ({o.league} league)</Link></span>
            ))}
          </p>
        )}
      </div>
      {c.rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-3 text-sm">No teams are listed for this tournament yet.</p>
      ) : (
        <div className="custom-scrollbar overflow-x-auto rounded-xl border border-border bg-card" data-conference-table>
          <table className="w-full text-sm">
            <caption className="sr-only">{c.name}: {CONFERENCE_LABEL}</caption>
            <thead className="bg-card">
              <tr className="border-b border-border">
                <Th k="rank" sort={sort} pick={pick} label="Rank" title="Rank among this conference's teams, in FIRST's league order; the league rank beside it" align="right" />
                <th scope="col" className={cn(TH, "text-left")}>Team</th>
                <Th k="rs" sort={sort} pick={pick} label="RS" title="Ranking score: FIRST's first sort key, over the league meets" align="right" />
                <Th k="record" sort={sort} pick={pick} label="W-L-T" title="Record at the league meets (not this tournament)" align="right" />
                <Th k="tbp" sort={sort} pick={pick} label="TBP" title="FIRST's second sort key" align="right" hide />
                <Th k="played" sort={sort} pick={pick} label="Matches" title="Qualification matches played at the league meets" align="right" hide />
                <Th k="meets" sort={sort} pick={pick} label="Meets" title="League meets played" align="right" hide />
                <Th k="rating" sort={sort} pick={pick} label="Scout rating" title="Control Scout's rating this season (the number /rankings shows); not FIRST's" align="right" hide border />
                <Th k="opr" sort={sort} pick={pick} label="OPR" title="Season OPR, penalties left out" align="right" hide />
                <th scope="col" className={cn(TH, "text-right max-sm:hidden")} title="Rank in the whole league table">League rank</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const marked = r.team === team;
                const href = `/teams/${r.team}?season=${c.season}`;
                return (
                  <tr key={r.team} data-marked={marked ? "" : undefined} aria-current={marked ? "true" : undefined} data-team={r.team}
                    className={cn("border-b border-border last:border-b-0", marked && "bg-muted font-semibold shadow-[inset_3px_0_0_var(--color-text-base)]")}>
                    <td className={cn(TD, "text-right tabular-nums")} data-rank>
                      {r.rank != null ? (
                        <><span className="max-sm:hidden">{ordinal(r.rank)} in conference</span><span className="sm:hidden">{ordinal(r.rank)}</span>
                          {r.leagueRank != null && <span className="block text-[11px] font-normal text-muted-foreground"><span className="max-sm:hidden">{ordinal(r.leagueRank)} in league</span><span className="sm:hidden">{ordinal(r.leagueRank)} lg</span></span>}</>
                      ) : <span className="whitespace-normal text-xs font-normal text-muted-foreground" data-unranked>{c.rs.kind === "gone" ? "Not available" : <>Not ranked yet<span className="max-sm:hidden"> — no league meets played</span></>}</span>}
                    </td>
                    <td className={cn(TD, "max-w-[16rem] truncate")}>
                      <span className="sm:hidden"><TeamNumber team={r.team} name={r.name ?? ""} href={href} /></span>
                      <Link to={href} className="hover:underline max-sm:hidden"><span className="font-mono font-medium tabular-nums">{r.team}</span> <span className={cn(!marked && "text-muted-foreground")}>{r.name}</span></Link>
                      {r.registered === "pending" && <span className="ml-1 text-xs font-normal text-muted-foreground">(waitlist)</span>}
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>{one(r.rs) ?? "—"}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{record(r) ?? "—"}</td>
                    <td className={cn(TD, "text-right tabular-nums max-sm:hidden")}>{one(r.tbp) ?? "—"}</td>
                    <td className={cn(TD, "text-right tabular-nums max-sm:hidden")} data-played>{r.played ?? "—"}</td>
                    <td className={cn(TD, "text-right tabular-nums max-sm:hidden")} data-meets>{r.meets ?? "—"}</td>
                    <td className={cn(TD, "border-l border-border text-right tabular-nums max-sm:hidden")}>{one(r.rating) ?? "—"}</td>
                    <td className={cn(TD, "text-right tabular-nums max-sm:hidden")}>{one(r.opr) ?? "—"}</td>
                    <td className={cn(TD, "text-right tabular-nums max-sm:hidden")}>{r.leagueRank != null ? `${r.leagueRank} of ${c.leagueOf}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Conference table pages">
          <p className="text-sm text-text-muted">{page * CONFERENCE_PAGE + 1}–{Math.min(rows.length, (page + 1) * CONFERENCE_PAGE)} of {rows.length}</p>
          <div className="flex items-center gap-2">
            <button type="button" className={NAV} disabled={page <= 0} onClick={() => setPage(page - 1)}><ChevronLeft className="size-4" />Previous</button>
            <span className="px-1 text-sm tabular-nums text-text-muted">{page + 1} / {pages}</span>
            <button type="button" className={NAV} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next<ChevronRight className="size-4" /></button>
          </div>
        </nav>
      )}
      <p className="text-xs text-muted-foreground">
        {ranked} of {c.rows.length} teams have a league standing. Scout rating and OPR are Control Scout's, this season's: ratings only compare within one season, never against another season's.
      </p>
    </div>
  );
}

const TH = "h-9 whitespace-nowrap px-2.5 text-[10px] font-bold uppercase tracking-wider text-text-muted max-sm:px-1.5";
const TD = "whitespace-nowrap px-2.5 py-1.5 max-sm:px-1.5";
const NAV = "inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-card px-3 text-sm font-medium hover:border-text-base/25 disabled:pointer-events-none disabled:opacity-40 max-sm:h-10";

function Th({ k, sort, pick, label, title, align, hide, border }: { k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; pick: (k: SortKey) => void; label: string; title: string; align: "right"; hide?: boolean; border?: boolean }) {
  const on = sort.key === k;
  const Arrow = on ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn(TH, align === "right" && "text-right", hide && "max-sm:hidden", border && "border-l border-border")}>
      <button type="button" onClick={() => pick(k)} title={title} className="group inline-flex items-center gap-1 uppercase hover:text-text-base">
        {label}<Arrow className={cn("size-3", !on && "opacity-40")} />
      </button>
    </th>
  );
}

function TeamLink({ season, t }: { season: number; t: { team: number; name: string | null } }) {
  return <Link to={`/teams/${t.team}?season=${season}`} className="font-medium text-accent-text hover:underline">{t.team}{t.name ? ` ${t.name}` : ""}</Link>;
}
