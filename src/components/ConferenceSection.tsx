// The pieces of a New Jersey conference's rankings page (src/pages/ConferencePage.tsx, src/shared/conferences.ts): the
// conference switch, the table and the unranked list. A conference's table is its tournament's teams ranked by FIRST's
// league standing over the league meets only. The rank column is that order, always: sorting by another column
// reorders rows, never renumbers them. Moves are by Scout rating among the conference's teams (region rankings' rule),
// never a move in FIRST's league rank. Before the tournament it is the teams going in (FTC New Jersey's sign-ups until
// FIRST posts a field), after it the standing they went in with. No charts.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./cn";
import { TeamNumber } from "./records/RecordsTable";
import { asGiven, asOfDate, conferenceHref, CONFERENCE_LABEL, ordinal, type Conference, type ConferenceRow } from "../shared/conferences";
import { leagueTitle } from "../shared/leagues";
import { Move, TrendBadge, active, idle, trigger } from "../pages/RankingsPage";
import type { MoverItem, NewItem } from "./rankings/MoverCards";

export const CONFERENCE_PAGE = 50;

export type SortKey = "rank" | "rs" | "tbp" | "record" | "rating" | "opr" | "played" | "meets" | "move";
const SORTS: { key: SortKey; get: (r: ConferenceRow) => number | null }[] = [
  { key: "rank", get: (r) => r.rank },
  { key: "rs", get: (r) => r.rs },
  { key: "tbp", get: (r) => r.tbp },
  // Win share, a tie counting half (as src/shared/teamTable.ts sorts records).
  { key: "record", get: (r) => { const n = (r.wins ?? 0) + (r.losses ?? 0) + (r.ties ?? 0); return r.wins == null || !n ? null : (r.wins + (r.ties ?? 0) / 2) / n; } },
  { key: "rating", get: (r) => r.rating },
  { key: "opr", get: (r) => r.opr },
  { key: "played", get: (r) => r.played },
  { key: "meets", get: (r) => r.meets },
  { key: "move", get: (r) => (typeof r.move === "number" ? r.move : null) },
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

/** What a link's `?conference=` names: a slug when only one conference has it, else the tournament's code (unique). */
export const conferenceKey = (list: Conference[], c: Conference) => (list.filter((o) => o.slug === c.slug).length === 1 ? c.slug : c.code);

/** The conference a link asks for (by its slug when only one has it, or by its code), else the one the marked team is
 *  in, else the latest with teams (the list is oldest tournament first), else the latest. */
export function pickConference(list: Conference[], slug: string | null, team: number | null): Conference | null {
  if (slug) {
    const hits = list.filter((c) => c.slug === slug || c.code.toUpperCase() === slug.toUpperCase());
    if (hits.length === 1) return hits[0];
  }
  if (team) {
    const hits = list.filter((c) => c.rows.some((r) => r.team === team));
    if (hits.length) return hits[hits.length - 1];
  }
  return [...list].reverse().find((c) => c.rows.length > 0) ?? list[list.length - 1] ?? null;
}

/** A link names a conference this league has no one of (none by that slug or code, or two by the slug). */
export const unknownConference = (list: Conference[], slug: string | null) =>
  !!slug && list.filter((c) => c.slug === slug || c.code.toUpperCase() === slug.toUpperCase()).length !== 1;

/** The switch: one segment per conference of the league, each with its league, tournament date and team count, the one
 *  shown marked. Each is a link (`?conference=`), so a link reproduces the view; the season, league and marked team
 *  are kept. */
export function ConferenceSwitch({ list, picked, leagueName, region, league, team }: { list: Conference[]; picked: Conference | null; leagueName: string | null; region: string; league: string; team: number | null }) {
  return (
    <nav aria-label="Conferences" className="flex flex-wrap gap-2" data-conference-switch>
      {list.map((c) => {
        const on = c.code === picked?.code;
        return (
          <Link key={c.code} to={conferenceHref(c.season, region, league, { slug: conferenceKey(list, c), team })} aria-current={on ? "page" : undefined}
            className={cn(trigger, on ? active : idle, "h-auto min-h-9 flex-col items-start gap-0 py-1.5 text-left max-sm:h-auto max-sm:min-h-[44px] max-sm:w-full")} data-conference-tab={c.code}>
            <span className="font-semibold">{c.name}</span>
            <span className="text-xs font-normal text-text-muted">{leagueTitle(leagueName, league)} · {asOfDate(c.start) ?? "Date to be set"} · {c.rows.length} team{c.rows.length === 1 ? "" : "s"}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Where the table's league numbers come from, in a sentence. */
export function sourceText(c: Conference): string {
  const rs = c.rs;
  if (rs.kind === "gone") return "The league standing these teams went in with is no longer available: a league meet came after the tournament.";
  if (rs.kind === "snapshot") return `League RS as of ${asOfDate(rs.asOf)}, the week before the tournament.`;
  if (rs.kind === "final") return `Final league RS — league meets ended ${asOfDate(rs.lastMeet)}, before this tournament.`;
  const thin = c.rows.some((r) => r.meets != null) && c.rows.every((r) => r.meets == null || r.meets <= 1);
  return `League RS as of ${asOfDate(rs.asOf) ?? "the last read from FIRST"}${thin ? ": after one meet, each team's RS rests on a few matches" : ""}.`;
}

/** The week's movers among the conference's teams, by Scout rating (src/shared/regionRankings.ts movers' rule). */
export function conferenceMovers(c: Conference): { climbers: MoverItem[]; fallers: MoverItem[]; newcomers: NewItem[]; newTotal: number } {
  // The place and the rating of the same week: a finished conference's movers are read at its tournament's week.
  const rated = c.rows.map((r) => ({ ...r, rating: r.ratingThen ?? r.rating }))
    .filter((r): r is ConferenceRow & { ratingRank: number; rating: number } => r.ratingRank != null && r.rating != null);
  const moved = rated.filter((r): r is typeof r & { move: number } => typeof r.move === "number" && r.move !== 0);
  const m = (r: (typeof moved)[number]): MoverItem => ({ team: r.team, name: r.name, rank: r.ratingRank, rating: r.rating, move: r.move });
  const fresh = rated.filter((r) => r.move === "new").sort((a, b) => a.ratingRank - b.ratingRank);
  return {
    climbers: moved.filter((r) => r.move > 0).sort((a, b) => b.move - a.move || a.ratingRank - b.ratingRank).slice(0, 3).map(m),
    fallers: moved.filter((r) => r.move < 0).sort((a, b) => a.move - b.move || a.ratingRank - b.ratingRank).slice(0, 3).map(m),
    newcomers: fresh.slice(0, 10).map((r) => ({ team: r.team, name: r.name, rank: r.ratingRank, rating: r.rating })),
    newTotal: fresh.length,
  };
}

/** The table: the conference's teams with a league standing, in FIRST's league order, sortable, 50 a page, the marked
 *  team's row marked and its page opened. */
export function ConferenceTable({ c, team }: { c: Conference; team: number | null }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "rank", dir: "asc" });
  const ranked = useMemo(() => c.rows.filter((r) => r.rank != null), [c.rows]);
  const rows = useMemo(() => sortConferenceRows(ranked, sort.key, sort.dir), [ranked, sort]);
  const moves = !!c.moves;
  const pages = Math.max(1, Math.ceil(rows.length / CONFERENCE_PAGE));
  // The page holding the marked team, so a link to it opens on its row.
  const teamPage = () => { const i = rows.findIndex((r) => r.team === team); return i < 0 ? 0 : Math.floor(i / CONFERENCE_PAGE); };
  const [page, setPage] = useState(teamPage);
  // Only a new marked team jumps to its page; a sort lands on the first page of the new order (pick, below).
  useEffect(() => { setPage(teamPage()); }, [team]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.slice(page * CONFERENCE_PAGE, (page + 1) * CONFERENCE_PAGE);
  // The marked row is on the page it opens on and highlighted, never scrolled to: the page's header, note and movers
  // come first (a dedicated page, not a section further down another one).
  const pick = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "rank" ? "asc" : "desc" }));
    setPage(0);
  };
  if (!ranked.length) {
    return <p className="rounded-xl border border-border bg-card p-3 text-sm" data-conference-empty>{!c.rows.length ? "No teams are listed for this tournament yet." : c.rs.kind === "gone" ? "The league standing these teams went in with can't be read any more: they're listed below." : "No team in this conference has a league standing yet: they're listed below."}</p>;
  }
  return (
    <div className="space-y-2">
      <div className="custom-scrollbar overflow-x-auto rounded-xl border border-border bg-card" data-conference-table>
        <table className="w-full text-sm">
          <caption className="sr-only">{c.name}: {CONFERENCE_LABEL}</caption>
          <thead className="bg-card">
            <tr className="border-b border-border">
              <Th k="rank" sort={sort} pick={pick} label="Rank" title="Rank among this conference's teams, in FIRST's league order; the league rank under it" />
              <th scope="col" className={cn(TH, "text-left")}>Team</th>
              <Th k="rs" sort={sort} pick={pick} label="RS" title="Ranking score: FIRST's first sort key, over the league meets" />
              <Th k="record" sort={sort} pick={pick} label="W-L-T" title="Record at the league meets (not this tournament)" />
              {moves && <Th k="move" sort={sort} pick={pick} label="Move" title="Places moved by Scout rating among this conference's teams since the week compared with (not FIRST's league rank)" />}
              <Th k="tbp" sort={sort} pick={pick} label="TBP" title="FIRST's second sort key" />
              <Th k="played" sort={sort} pick={pick} label="Matches" title="Qualification matches played at the league meets" />
              <Th k="meets" sort={sort} pick={pick} label="Meets" title="League meets played" />
              <Th k="rating" sort={sort} pick={pick} label="Scout rating" title="Control Scout's rating this season (the number /rankings shows); not FIRST's" border />
              <Th k="opr" sort={sort} pick={pick} label="OPR" title="Season OPR, penalties left out" />
              <th scope="col" className={cn(TH, "text-right")} title="Rank in the whole league table">League rank</th>
              {moves && <th scope="col" className={cn(TH, "text-left")} title="Scout rating against the week compared with">Trend</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const mine = r.team === team;
              const href = `/teams/${r.team}?season=${c.season}`;
              return (
                <tr key={r.team} data-marked={mine ? "" : undefined} aria-current={mine ? "true" : undefined} data-team={r.team}
                  className={cn("border-b border-border last:border-b-0", mine && "bg-muted font-semibold shadow-[inset_3px_0_0_var(--color-text-base)]")}>
                  <td className={cn(TD, "text-right tabular-nums")} data-rank>
                    <span className="max-sm:hidden">{ordinal(r.rank!)} in conference</span><span className="sm:hidden">{ordinal(r.rank!)}</span>
                    {r.leagueRank != null && <span className="block text-[11px] font-normal text-muted-foreground"><span className="max-sm:hidden">{ordinal(r.leagueRank)} in league</span><span className="sm:hidden">{ordinal(r.leagueRank)} lg</span></span>}
                  </td>
                  <td className={cn(TD, "max-w-[16rem] truncate max-sm:max-w-[9rem]")}>
                    <span className="sm:hidden"><TeamNumber team={r.team} name={r.name ?? ""} href={href} /></span>
                    <Link to={href} className="hover:underline max-sm:hidden"><span className="font-mono font-medium tabular-nums">{r.team}</span> <span className={cn(!mine && "text-muted-foreground")}>{r.name}</span></Link>
                    {r.registered === "pending" && <span className="ml-1 text-xs font-normal text-muted-foreground">(waitlist)</span>}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>{asGiven(r.rs) ?? "—"}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{record(r) ?? "—"}</td>
                  {moves && <td className={cn(TD, "text-right")} data-move><Move row={{ move: r.move ?? null }} /></td>}
                  <td className={cn(TD, "text-right tabular-nums")}>{asGiven(r.tbp) ?? "—"}</td>
                  <td className={cn(TD, "text-right tabular-nums")} data-played>{r.played ?? "—"}</td>
                  <td className={cn(TD, "text-right tabular-nums")} data-meets>{r.meets ?? "—"}</td>
                  <td className={cn(TD, "border-l border-border text-right tabular-nums")}>{one(r.rating) ?? "—"}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{one(r.opr) ?? "—"}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{r.leagueRank != null ? `${r.leagueRank} of ${c.leagueOf}` : "—"}</td>
                  {moves && <td className={TD} data-trend>{r.move === "new" ? <Move row={{ move: "new" }} /> : r.trend ? <TrendBadge row={{ trend: r.trend }} /> : <span className="text-text-muted">—</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
    </div>
  );
}

/** The conference's teams with no league standing, as region rankings lists its unranked teams: labelled, with no RS,
 *  no rank and no record. */
export function ConferenceUnranked({ c, team }: { c: Conference; team: number | null }) {
  const none = c.rows.filter((r) => r.rank == null);
  if (!none.length) return null;
  const label = c.rs.kind === "gone" ? "Not available — the going-in standing can't be read any more" : "Not ranked yet — no league meets played";
  return (
    <section aria-labelledby="conference-unranked" className="space-y-2" data-conference-unranked>
      <h2 id="conference-unranked" className="font-display text-lg font-semibold">{c.rs.kind === "gone" ? "Standing not available" : "Not ranked yet"} ({none.length})</h2>
      <ul className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {none.map((r) => (
          <li key={r.team} data-team={r.team} data-marked={r.team === team ? "" : undefined} className={cn("flex min-w-0 flex-col", r.team === team && "font-semibold")}>
            <Link to={`/teams/${r.team}?season=${c.season}`} className="truncate hover:underline"><span className="font-mono tabular-nums">{r.team}</span> {r.name ?? ""}{r.registered === "pending" ? " (waitlist)" : ""}</Link>
            <span className="text-xs font-normal text-text-muted" data-unranked>{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TH = "h-9 whitespace-nowrap px-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-text-muted max-sm:px-1.5";
const TD = "whitespace-nowrap px-2.5 py-1.5 max-sm:px-1.5";
const NAV = "inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-card px-3 text-sm font-medium hover:border-text-base/25 disabled:pointer-events-none disabled:opacity-40 max-sm:h-10";

function Th({ k, sort, pick, label, title, border }: { k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; pick: (k: SortKey) => void; label: string; title: string; border?: boolean }) {
  const on = sort.key === k;
  const Arrow = on ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn(TH, border && "border-l border-border")}>
      <button type="button" onClick={() => pick(k)} title={title} className="group inline-flex items-center gap-1 uppercase hover:text-text-base">
        {label}<Arrow className={cn("size-3", !on && "opacity-40")} />
      </button>
    </th>
  );
}
