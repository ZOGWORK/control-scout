// The v8 results page's own pieces (docs/design/v8-revamp-brief.md §7 item 2; the PR's page plan): "answer my
// question, then let me go deeper". First screen: the understood line, the answer sized to the question (a team as a
// compact summary with its next match), 2–4 follow-up chips. Lower down: related results as plain rows, grouped, each
// group capped with "Show N more". Drawn only in v8 (src/pages/SearchPage.tsx); v8 off never renders these.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, ChevronDown, FileText, MapPin, Search, Shield, Swords } from "lucide-react";
import type { MatchView, SearchFollowUp, SearchHit } from "../../../shared/api";
import type { StatAnswer, StatMatchRow } from "../../../shared/searchStat";
import { hitHref } from "../../../shared/search";
import { useApi } from "../../../lib/api";
import { dateRange, seasonLabel } from "../../../lib/format";
import { cn } from "../../cn";
import { RecordText } from "./answerCells";
import { eventFacts, teamParts } from "./results";
import type { SeasonSummary } from "./ResultCards";

const searchHref = (q: string) => `/search?q=${encodeURIComponent(q)}`;
/** How a reading is said (shared/api SearchUnderstood kinds). */
const KIND_WORDS: Record<string, string> = { team: "a team", events: "events", compare: "a comparison", question: "a question", names: "names" };

/** The one line saying how the query was read: what was typed, and what search took it for. A wrong reading shows. */
export function UnderstoodLine({ query, understood, className }: { query: string; understood?: { kind?: string; label?: string } | null; className?: string }) {
  const as = understood?.kind ? KIND_WORDS[understood.kind] : undefined;
  return (
    <p className={cn("flex min-w-0 items-start gap-1.5 text-sm text-text-muted", className)} data-understood>
      <Search className="mt-0.5 size-3.5 shrink-0 text-text-faint" aria-hidden />
      <span className="min-w-0 break-words">
        <span className="text-foreground">“{query}”</span>
        {as ? <> read as {as}{understood?.label && <>: <span className="text-foreground">{understood.label}</span></>}</> : understood?.label ? <> read as <span className="text-foreground">{understood.label}</span></> : null}
      </span>
    </p>
  );
}

/** The 2–4 most useful next questions as chips: People also ask's first (each a whole question search answers), then
 *  related searches; a link to every related search after them. */
export function FollowChips({ ask, related, seeAll, className }: { ask: SearchFollowUp[]; related: SearchFollowUp[]; seeAll?: string; className?: string }) {
  const chips = useMemo(() => {
    const seen = new Set<string>();
    return [...ask, ...related].filter((x) => !seen.has(x.q.toLowerCase()) && seen.add(x.q.toLowerCase())).slice(0, 4);
  }, [ask, related]);
  if (chips.length < 2) return null;
  return (
    <nav aria-label="Ask next" className={cn("flex flex-wrap items-center gap-2", className)} data-follow-chips>
      {chips.map((x) => (
        <Link key={x.q} to={searchHref(x.q)} title={x.preview}
          className="inline-flex min-h-9 max-w-full items-center rounded-full border border-white/12 px-3.5 text-sm text-foreground transition-[background-color,border-color,transform] duration-150 ease-out hover:border-white/25 hover:bg-white/[0.06] active:scale-[0.97] motion-reduce:active:scale-100 max-md:min-h-[44px]"
          data-follow-chip>
          <span className="truncate">{x.q}</span>
        </Link>
      ))}
      {seeAll && related.length > 0 && (
        <Link to={`/related-searches?q=${encodeURIComponent(seeAll)}`} className="inline-flex min-h-9 items-center gap-1 px-1 text-sm text-text-muted hover:text-foreground max-md:min-h-[44px]" data-more-related>
          More related searches<ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </nav>
  );
}

/** The next match a team plays (else its last one), from its season's matches: "Next: Q12 · Sat 10:24". */
function useNextMatch(team: number, season: number | null | undefined) {
  const { data } = useApi<{ matches: MatchView[] }>(season != null ? `/api/teams/${team}/matches?season=${season}` : null);
  return useMemo(() => {
    const ms = data?.matches ?? [];
    const next = ms.filter((m) => !m.played).sort((a, b) => (a.startsAt ?? a.time ?? "").localeCompare(b.startsAt ?? b.time ?? ""))[0];
    if (next) return { kind: "next" as const, m: next };
    const last = ms.filter((m) => m.played && m.red.score && m.blue.score).at(-1);
    return last ? { kind: "last" as const, m: last } : null;
  }, [data]);
}

function when(m: MatchView): string | null {
  const t = m.startsAt ? new Date(m.startsAt) : null;
  if (t && !Number.isNaN(t.getTime())) return t.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return m.time;
}

/** A team asked for by itself: its summary in one compact card, its next match (else its last) in it, the team page a tap away. */
export function V8TeamAnswer({ team, name, place, summary, stat }: { team: number; name: string; place?: string; summary?: SeasonSummary; stat?: StatAnswer }) {
  const s = summary?.s;
  const next = useNextMatch(team, summary?.season ?? null);
  const facts: { label: string; value: ReactNode }[] = [];
  if (s?.record) facts.push({ label: "Record", value: <RecordText text={s.record} /> });
  if (s?.opr != null) facts.push({ label: "OPR", value: s.opr.toFixed(1) });
  if (s?.oprRank != null) facts.push({ label: "OPR rank", value: <>#{s.oprRank.toLocaleString()}{s.of != null && <span className="text-text-faint"> of {s.of.toLocaleString()}</span>}</> });
  if (stat?.intent === "team-highlights" && stat.headline) facts.push({ label: "Best score", value: stat.headline.value.replace(/\s*points?$/i, "") });
  const us = next?.m ? (next.m.red.teams.some((t) => t.number === team) ? "red" : "blue") : null;
  // The match's event by name (the summary knows the team's last and next events), never its code alone.
  const at = next?.m ? ([s?.nextEvent, s?.lastEvent].find((e) => e?.code === next.m.code)?.name ?? next.m.code) : null;
  return (
    <section aria-label={`Team ${team}`} className="rounded-xl border border-line bg-card p-5" data-v8-answer="team">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums text-foreground" data-team-number>{team}</p>
          <p className="mt-1.5 break-words text-base font-medium text-foreground">{name}</p>
          {(place || s?.place) && <p className="mt-0.5 flex items-center gap-1 text-sm text-text-muted"><MapPin className="size-3.5 shrink-0" aria-hidden />{place || s?.place}</p>}
        </div>
        <Link to={`/teams/${team}${summary ? `?season=${summary.season}` : ""}`} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-sm text-foreground hover:bg-white/[0.06] max-md:min-h-[44px]" data-team-page>
          Team page<ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      {facts.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4" data-team-facts>
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-text-faint">{f.label}{f.label === "Record" && summary ? `, ${seasonLabel(summary.season)}` : ""}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {next && (
        <Link to={`/events/${next.m.season}/${next.m.code}?match=${next.m.key}`} className="-mx-2 mt-3 flex min-h-[44px] items-center gap-3 rounded-lg border-t border-line px-2 pt-3 text-sm hover:bg-white/[0.04]" data-next-match={next.kind}>
          <Swords className="size-4 shrink-0 text-text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-text-faint">{next.kind === "next" ? "Next match" : "Last match"} </span>
            <span className="font-medium text-foreground">{next.m.label}</span>
            <span className="text-text-muted"> · {at}{next.kind === "next" && when(next.m) ? ` · ${when(next.m)}` : ""}</span>
          </span>
          {next.kind === "last" && next.m.red.score && next.m.blue.score && us && (
            <span className="shrink-0 tabular-nums text-foreground">{(us === "red" ? next.m.red : next.m.blue).score!.total}–{(us === "red" ? next.m.blue : next.m.red).score!.total}</span>
          )}
        </Link>
      )}
    </section>
  );
}

/** A team-highlights answer's matches (best score, best Auto, closest win) as plain rows: what it was, the match, the score. */
export function standoutRows(stat: StatAnswer | undefined): { title: string; rows: StatMatchRow[] } | null {
  const b = stat?.intent === "team-highlights" ? stat.blocks.find((x) => x.kind === "matches") : undefined;
  return b && b.kind === "matches" && b.rows.length ? { title: "Standout matches", rows: b.rows } : null;
}

export function MatchRows({ rows }: { rows: StatMatchRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={`${r.href}-${r.label}`}>
          <Link to={r.href} className="flex min-h-[44px] items-center gap-3 px-3 py-2.5 text-sm hover:bg-white/[0.04]" data-match-row>
            <Swords className="size-4 shrink-0 text-text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground">{r.note && <span className="text-text-muted">{r.note}: </span>}{r.label} at {r.event.label}</span>
              {r.date && <span className="block text-xs text-text-muted">{/^\d{4}-\d{2}-\d{2}/.test(r.date) ? dateRange(r.date.slice(0, 10)) : r.date}</span>}
            </span>
            <span className="shrink-0 tabular-nums"><span className={cn("font-semibold", r.result === "W" ? "text-foreground" : "text-text-muted")}>{r.own}</span><span className="text-text-faint">–{r.opp}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One group of plain rows (Teams, Events, Matches, Pages): five shown, the rest a tap away. */
export function RowGroup({ title, count, children, cap = 5, id }: { title: string; count: number; children: ReactNode[]; cap?: number; id: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? children : children.slice(0, cap);
  const rest = children.length - cap;
  return (
    <section aria-label={title} className="mt-6" data-v8-group={id}>
      <h2 className="mb-1.5 flex items-baseline gap-1.5 text-xs text-text-faint">{title}<span className="tabular-nums">{count}</span></h2>
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <ul className="divide-y divide-line">{shown.map((c, i) => <li key={i}>{c}</li>)}</ul>
        {rest > 0 && (
          <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all}
            className="flex min-h-[44px] w-full items-center gap-1.5 border-t border-line px-3 text-sm text-text-muted hover:bg-white/[0.04] hover:text-foreground" data-show-more>
            <ChevronDown className={cn("size-4 transition-transform duration-200 ease-out", all && "rotate-180")} aria-hidden />{all ? "Show fewer" : `Show ${rest} more`}
          </button>
        )}
      </div>
    </section>
  );
}

const ROW = "flex min-h-[44px] items-center gap-3 px-3 py-2.5 text-sm hover:bg-white/[0.04]";

/** A team as a plain row: number and name, its place, its record and OPR on the right. */
export function TeamRow({ h, summary, onOpen }: { h: SearchHit; summary?: SeasonSummary; onOpen: () => void }) {
  const p = teamParts(h.title);
  const s = summary?.s;
  return (
    <Link to={hitHref(h)} onClick={onOpen} className={ROW} data-row="team">
      <Shield className="size-4 shrink-0 text-text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground"><span className="font-medium tabular-nums text-accent">{p?.number ?? h.ref}</span>{p?.name && <span> {p.name}</span>}</span>
        {h.subtitle && <span className="block truncate text-xs text-text-muted">{h.subtitle}</span>}
      </span>
      {s && (s.record || s.opr != null) && (
        <span className="shrink-0 text-right text-xs tabular-nums text-text-muted">
          {s.record && <RecordText text={s.record} className="block" />}
          {s.opr != null && <span className="block">OPR <span className="text-foreground">{s.opr.toFixed(1)}</span></span>}
        </span>
      )}
    </Link>
  );
}

/** An event as a plain row: its name, dates and place, and live while it's on. No code, no raw date. */
export function EventRow({ h, onOpen }: { h: SearchHit; onOpen: () => void }) {
  const e = eventFacts(h);
  return (
    <Link to={hitHref(h)} onClick={onOpen} className={ROW} data-row="event">
      <CalendarDays className="size-4 shrink-0 text-text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{h.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
          {e.status === "live" && <span className="inline-flex shrink-0 items-center gap-1 text-foreground" data-live><span aria-hidden className="size-1.5 rounded-full bg-live" />Live</span>}
          <span className="shrink-0 tabular-nums">{e.start ? dateRange(e.start, e.end) : "Date to be announced"}</span>
          {e.place && <span className="truncate">· {e.place}</span>}
          {h.season != null && <span className="shrink-0 text-text-faint">· {seasonLabel(h.season)}</span>}
        </span>
      </span>
    </Link>
  );
}

/** Anything else (a match, a place, a site page) as a plain row. */
export function PlainRow({ h, onOpen, icon }: { h: SearchHit; onOpen: () => void; icon: "match" | "page" | "place" }) {
  const Icon = icon === "match" ? Swords : icon === "place" ? MapPin : FileText;
  return (
    <Link to={hitHref(h)} onClick={onOpen} className={ROW} data-row={icon}>
      <Icon className="size-4 shrink-0 text-text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{h.title}</span>
        {h.subtitle && <span className="block truncate text-xs text-text-muted">{h.subtitle}</span>}
      </span>
    </Link>
  );
}
