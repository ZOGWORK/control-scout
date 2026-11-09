// One match, opened in place under its row (never a dialog): both lineups
// with each robot's standing at the event and this season, the score
// breakdown as one difference table (phases first, what each is made of a tap away), bonus RPs, what OPR expected vs what happened, the
// prediction against the result with its reasons, official result changes,
// and the match's video.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Video } from "lucide-react";
import { ClipLink, MatchVideoLink } from "./MatchClip";
import { clipTime } from "../shared/recording";
import type { MatchDetail, MatchView } from "../shared/api";
import { matchReportHref } from "../shared/matchReport";
import { useApi } from "../lib/api";
import { matchTime, oddsPct } from "../lib/format";
import { Async } from "./states";
import { CalibrationLine, ConfidenceBadge, FactorList, KIND_LABEL, PairHistoryLine, WinBar } from "./predict";
import { VideoPanel } from "./MatchVideo";
import { ShareMatch } from "./ShareMatch";
import { ResultChanges } from "./ResultChanges";
import { BonusOddsRow } from "./BonusOdds";
import { FactorSheetPanel } from "./FactorSheet";
import { sheetWinner } from "../shared/factorSheet";
import { ScoreRange } from "./ScoreRange";
import { PredictionBasis } from "./PredictionBasis";
import { marginText, marginWords, matchBasis } from "../shared/predictionBasis";
import { levelPct } from "../shared/scoreRange";
import { cn } from "./cn";
import { hasTeamPage } from "../shared/teamPages";
import { rowIcon, rpIcon } from "./BreakdownIcons";

type Side = "red" | "blue";
const SIDES: Side[] = ["red", "blue"];
const TONE: Record<Side, { text: string }> = {
  red: { text: "text-red-alliance" },
  blue: { text: "text-blue-alliance" },
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(r1(x))}`;
const inside = (score: number, [lo, hi]: [number, number]) => (score < lo ? "below" : score > hi ? "above" : "yes");

/** Both scores against their ranges in the fewest words: "both in range", or each side's own. */
const rangeWords = (red: string, blue: string) => (red === "yes" && blue === "yes" ? "both in range"
  : `red ${red === "yes" ? "in range" : red + " range"}, blue ${blue === "yes" ? "in range" : blue + " range"}`);

export const matchRef = (m: MatchView) => `${m.season}:${m.code}:${m.level}:${m.series}:${m.number}`;

export function MatchDetails({ m, eventName }: { m: MatchView; eventName?: string }) {
  const state = useApi<MatchDetail>(`/api/events/${m.season}/${encodeURIComponent(m.code)}/matches/${m.key}`);
  return (
    <div className="border-t border-border bg-text-base/[0.02] px-3 py-4 sm:px-4">
      <Async state={state} loading={<div className="skeleton h-40 rounded-xl" />}>
        {(d) => <Body d={d} eventName={eventName} />}
      </Async>
      {/* No connection, so no match detail: the call this list already made on the device (lite pack) keeps its why. */}
      {state.error?.offline && m.prediction?.sheet ? (
        <div className="mt-3 rounded-xl border border-border bg-card p-4" data-testid="offline-why">
          {m.prediction.factors?.length ? <><p className="text-xs font-medium text-text-muted">Why</p><FactorList factors={m.prediction.factors} className="mt-1.5" /></> : null}
          <FactorSheetPanel sheet={m.prediction.sheet} level={m.level} winner={m.played && m.red.score && m.blue.score ? sheetWinner(m.red.score.total, m.blue.score.total) : null} className="mt-3" />
        </div>
      ) : null}
      {/* Outside the server-loaded part: recording and saved videos work with no connection. */}
      <MatchVideoSection m={m} />
    </div>
  );
}

function Body({ d, eventName }: { d: MatchDetail; eventName?: string }) {
  const m = d.match;
  const played = m.played && !!m.red.score && !!m.blue.score;
  const href = (key: string) => `/events/${m.season}/${encodeURIComponent(m.code)}?tab=matches&match=${encodeURIComponent(key)}`;
  // One column, read top to bottom: the score and margin first, then the breakdown, then the call and its why.
  return (
    <div className="space-y-4">
      <Headline d={d} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        {eventName !== undefined && <Link to={href(m.key)} className="underline-offset-2 hover:underline">{d.event.name}</Link>}
        {m.clip && <ClipLink clip={m.clip} label={m.label} matchKey={m.key} className="font-medium text-video hover:text-text-base">Watch in the recording · {clipTime(m.clip.t)}</ClipLink>}
        {m.video && <MatchVideoLink url={m.video} label={m.label} matchKey={m.key} className="hover:text-text-base">Official video</MatchVideoLink>}
        <Link to={matchReportHref(m)} className="inline-flex items-center gap-1 font-medium text-accent-text underline-offset-2 hover:underline"><ClipboardList className="size-3.5" aria-hidden /> Know your match</Link>
        <span className="ml-auto flex items-center gap-1">
          {d.prev && <Link to={href(d.prev.key)} className="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-text-base/[0.06] hover:text-text-base" aria-label={`Previous match, ${d.prev.label}`}><ChevronLeft className="size-3.5" />{d.prev.label}</Link>}
          {d.next && <Link to={href(d.next.key)} className="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-text-base/[0.06] hover:text-text-base" aria-label={`Next match, ${d.next.label}`}>{d.next.label}<ChevronRight className="size-3.5" /></Link>}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {SIDES.map((s) => <Alliance key={s} d={d} side={s} />)}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {played ? <Breakdown d={d} /> : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">Not played yet — the score breakdown appears once the result is posted.</p>}
        <Prediction d={d} />
      </div>
      {/* Asks again whenever this match's result or schedule on screen changes (live checks, refreshes). */}
      <ResultChanges season={m.season} code={m.code} matchKey={m.key}
        refreshKey={JSON.stringify([m.time, m.played, m.red.score, m.blue.score, m.red.teams.map((t) => t.number), m.blue.teams.map((t) => t.number)])} />
    </div>
  );
}

/** The loser's number fades back: the alliance colour mixed toward muted text, so it still reads at 4.5:1. */
const FADED: Record<Side, string> = {
  red: "text-[color-mix(in_srgb,var(--color-red-alliance-text)_55%,var(--color-text-muted))]",
  blue: "text-[color-mix(in_srgb,var(--color-blue-alliance-text)_55%,var(--color-text-muted))]",
};
const NAME: Record<Side, string> = { red: "Red", blue: "Blue" };

/** The whole match in one glance: the score and the margin in the biggest type on the page, then which match,
 *  when, and who won. Winner bold in its colour, loser faded. */
export function Headline({ d }: { d: MatchDetail }) {
  const m = d.match, r = m.red.score, b = m.blue.score;
  const played = m.played && !!r && !!b;
  const diff = played ? r!.total - b!.total : 0;
  const win: Side | null = played && diff !== 0 ? (diff > 0 ? "red" : "blue") : null;
  const num = (s: Side) => cn("tabular-nums", win === s || !win ? cn("font-bold", TONE[s].text) : cn("font-normal", FADED[s]));
  const penalties = played && win && Math.sign(r!.np - b!.np) !== Math.sign(diff);
  return (
    <header data-testid="match-headline">
      {played && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display" data-testid="breakdown-margin">
          <span className="text-4xl sm:text-5xl">
            <span className={num("red")}>{r!.total}</span><span className="font-normal text-text-muted"> – </span><span className={num("blue")}>{b!.total}</span>
          </span>
          <span className={cn("text-xl font-bold sm:text-2xl", win ? TONE[win].text : "text-text-base")}>{win ? `${NAME[win]} by ${Math.abs(diff)}` : "Tie"}</span>
        </p>
      )}
      <p className="mt-1 text-sm text-text-muted" data-testid="match-line">
        <span className="font-medium text-text-base">{d.description ?? m.label}</span>
        {m.time && <> · {matchTime(m.time)}</>}
        {!played ? " · Not played yet" : !win ? " · Tie" : null}
        {penalties && " · decided by penalties"}
      </p>
    </header>
  );
}

function MatchVideoSection({ m }: { m: MatchView }) {
  const [open, setOpen] = useState(false);
  return (
    // Mounted only while open: closing it unmounts the recorder, which stops (and saves) any recording and releases the camera.
    <details className="group mt-4 rounded-xl border border-border bg-card" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium max-sm:min-h-11"><Video className="size-4 text-accent-text" aria-hidden />Video for {m.label}<span className="font-normal text-text-muted">: record, add a file or a YouTube link</span></summary>
      {open && <div className="border-t border-border p-4"><VideoPanel matchRef={matchRef(m)} label={`${m.code} ${m.label}`} /></div>}
    </details>
  );
}

/** One alliance as compact text: each robot on one line (number, name), its standing under it (station, event
 *  rank and record, OPR at this time, season OPR and rank), what the lineup's OPRs add up to, and its bonus RPs. */
function Alliance({ d, side }: { d: MatchDetail; side: Side }) {
  const m = d.match;
  const a = m[side], other = m[side === "red" ? "blue" : "red"];
  const won = m.played && a.score && other.score ? a.score.total > other.score.total : false;
  const onField = a.teams.filter((t) => t.onField);
  // What the robots' event OPRs add up to: the score this lineup "usually" puts up here.
  const oprs = onField.map((t) => d.teams[t.number]?.event?.opr.np);
  const expected = oprs.length && oprs.every((x) => x != null) ? (oprs as number[]).reduce((s, x) => s + x, 0) : null;
  const bonus = d.bonus?.[side];
  return (
    <section className={cn("min-w-0 border-l-2 pl-3", side === "red" ? "border-red-alliance" : "border-blue-alliance")} aria-label={`${NAME[side]} alliance`}>
      <p className={cn("text-xs font-semibold", TONE[side].text)}>{NAME[side]}{won ? " · won" : ""}</p>
      <ul className="mt-1 space-y-1.5">
        {a.teams.map((t) => {
          const info = d.teams[t.number];
          const ev = info?.event, se = info?.season;
          return (
            <li key={t.number} className={cn(!t.onField && "opacity-60")}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                {hasTeamPage(t.number, info?.name)
                  ? <Link to={`/teams/${t.number}?season=${m.season}`} className="font-mono text-sm font-semibold hover:underline">{t.number}</Link>
                  : <span className="font-mono text-sm font-semibold">{t.number}</span>}
                <span className="min-w-0 truncate text-sm">{info?.name ?? ""}</span>
                {t.surrogate && <span className="rounded bg-muted px-1 text-[10px]">Surrogate</span>}
                {t.dq && <span className="rounded bg-destructive/15 px-1 text-[10px] text-destructive">DQ</span>}
                {!t.onField && <span className="rounded bg-muted px-1 text-[10px]">Not on field</span>}
              </div>
              <TeamLine station={d.stations[t.number]} ev={ev} se={se} />
            </li>
          );
        })}
      </ul>
      {expected != null && (
        <p className="mt-1.5 text-[11px] text-text-muted" title="What the robots' event OPRs add up to, then the points scored without penalties"><span className="sr-only">Event OPRs add up to </span><span aria-hidden>OPRs </span><span className="text-text-base">{r1(expected)}</span>{a.score ? <><span className="sr-only">, scored without penalties </span><span aria-hidden> → scored </span><span className="text-text-base">{a.score.np}</span> (<span className={cn(a.score.np - expected >= 0 ? "text-success" : "text-warning")}>{signed(a.score.np - expected)}</span>)</> : null}</p>
      )}
      {bonus && d.bonus && (
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={`${NAME[side]} bonus ranking points`}>
          {d.bonus.labels.map((l, i) => <RpChip key={l} label={l} earned={bonus[i]} />)}
        </ul>
      )}
    </section>
  );
}

/** A robot's standing in one short line: station, event rank and record, OPR at this time, season OPR and rank.
 *  Short labels on screen; the full names in the tooltip and for screen readers. The season OPR is printed only
 *  when it differs from the event's, so the same number never shows twice. */
function TeamLine({ station, ev, se }: { station?: number; ev?: MatchDetail["teams"][number]["event"]; se?: MatchDetail["teams"][number]["season"] }) {
  const evOpr = ev?.opr.np != null ? r1(ev.opr.np) : null, seOpr = se?.opr != null ? r1(se.opr) : null;
  return (
    <p className="text-[11px] text-text-muted" data-testid="team-standing">
      {station ? <span title={`Station ${station}`}><span className="sr-only">Station </span><span aria-hidden>S</span>{station} · </span> : null}
      {ev?.rank ? <span title="Event rank and record"><span className="sr-only">Rank </span><span className="text-text-base">#{ev.rank}</span>{ev.wins != null && <> {ev.wins}-{ev.losses}-{ev.ties}</>}</span> : "Unranked"}
      {" · "}<span title="OPR at this time"><span className="sr-only">OPR at this time </span><span aria-hidden>OPR </span><span className="text-text-base">{evOpr ?? "—"}</span></span>
      {" · "}<span title="Season OPR and rank"><span className="sr-only">Season OPR </span><span aria-hidden>season </span>{seOpr !== evOpr && <span className="text-text-base">{seOpr ?? "—"} </span>}{se?.rank ? <>#{se.rank.toLocaleString()}</> : null}</span>
    </p>
  );
}

const FOULS_NOTE = "Penalty points this alliance committed (they go to the other side).";

export type BreakdownRow = { label: string; red: number | null; blue: number | null; note?: string; depth?: 0 | 1; count?: boolean; total?: boolean; fouls?: boolean };

/** The rows the breakdown shows, straight from the match's data (display only: nothing is recomputed). With the
 *  season's full sheet (FIRST's breakdown: each group, then what it's made of, indented), that; otherwise the
 *  engine's split (auto, TeleOp, endgame). Both end on the total. */
export function breakdownRows(d: MatchDetail): BreakdownRow[] {
  const r = d.match.red.score!, b = d.match.blue.score!;
  return d.sheet
    ? [...d.sheet.map((x) => ({ ...x, fouls: x.label === "Fouls given away" || !!x.count, note: x.label === "Fouls given away" ? FOULS_NOTE : x.count ? "How many this alliance committed" : undefined })), { label: "Total", red: r.total, blue: b.total, total: true }]
    : [
      { label: "Auto", red: r.auto, blue: b.auto },
      { label: "TeleOp", red: r.teleop, blue: b.teleop },
      { label: "Endgame", red: r.endgame, blue: b.endgame },
      { label: "No penalties", red: r.np, blue: b.np },
      { label: "Fouls given away", red: r.pen, blue: b.pen, note: FOULS_NOTE, fouls: true },
      { label: "Total", red: r.total, blue: b.total, total: true },
    ];
}

/** Who's ahead on one row and by how much, in words (never colour alone). Fouls: who gave away more. */
export function rowLead(x: BreakdownRow): { side: Side | null; text: string } {
  // A value FIRST didn't report: no gap to name.
  if (x.red == null || x.blue == null) return { side: null, text: "—" };
  const diff = x.red - x.blue;
  if (diff === 0) return { side: null, text: "Even" };
  const side: Side = diff > 0 ? "red" : "blue", by = Math.abs(diff), who = side === "red" ? "Red" : "Blue";
  if (x.fouls) return { side, text: x.count ? `${who} ${by} more` : `${who} gave ${by} more` };
  return { side, text: `${who} +${by}` };
}

/** A sheet's rows grouped by phase: each top-level row (Auto, TeleOp, fouls, the total) with what it's made of. */
export type BreakdownGroup = { row: BreakdownRow; parts: BreakdownRow[] };
export function groupRows(rows: BreakdownRow[]): BreakdownGroup[] {
  const out: BreakdownGroup[] = [];
  for (const x of rows) {
    if (x.depth === 1 && out.length) out[out.length - 1].parts.push(x);
    else out.push({ row: x, parts: [] });
  }
  return out;
}

// label | red | difference | blue. Fixed number tracks, so every row's values line up.
const GRID = "grid grid-cols-[minmax(0,1fr)_2.5rem_6.75rem_2.5rem] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_3.5rem_9rem_3.5rem] sm:gap-x-3";

/** The score as one table: a row per scoring phase with both values and the difference in words, in the
 *  colour of the side it favours. No bars: for two numbers, the difference says it faster. What each phase is
 *  made of sits under it, one tap away (collapsed on load). */
export function Breakdown({ d }: { d: MatchDetail }) {
  const groups = groupRows(breakdownRows(d));
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (i: number) => setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const id = `breakdown-${d.match.code}-${d.match.key.replace(/:/g, "-")}`;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Score breakdown">
      <div className={cn(GRID, "border-b border-border px-3 py-2 text-[11px]")}>
        <span className="text-text-muted">Score breakdown</span>
        <span className="text-right font-semibold text-red-alliance">Red</span>
        <span className="text-center text-text-muted">Difference</span>
        <span className="font-semibold text-blue-alliance">Blue</span>
      </div>
      <ul className="divide-y divide-border">
        {groups.map((g, i) => <Phase key={`${g.row.label}:${i}`} g={g} open={open.has(i)} onToggle={() => toggle(i)} id={`${id}-${i}`} />)}
      </ul>
    </section>
  );
}

const rowData = (r: BreakdownRow) => ({ title: r.note, "data-depth": r.depth ?? 0, "data-label": r.label, "data-red": r.red ?? "", "data-blue": r.blue ?? "" });

function Phase({ g, open, onToggle, id }: { g: BreakdownGroup; open: boolean; onToggle: () => void; id: string }) {
  const x = g.row;
  const row = cn(GRID, "min-h-[44px] w-full px-3 py-2 text-left", x.total && "bg-text-base/[0.03]");
  return (
    <li>
      {g.parts.length ? (
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
          className={cn(row, "cursor-pointer outline-none hover:bg-text-base/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60")} {...rowData(x)}>
          <Cells x={x} open={open} />
        </button>
      ) : <div className={row} {...rowData(x)}><Cells x={x} /></div>}
      {g.parts.length > 0 && open && (
        <ul id={id} className="divide-y divide-border/60 border-t border-border bg-text-base/[0.02]" aria-label={`${x.label}, what it's made of`}>
          {g.parts.map((p, i) => <li key={`${p.label}:${i}`} className={cn(GRID, "min-h-9 py-1.5 pl-9 pr-3")} {...rowData(p)}><Cells x={p} /></li>)}
        </ul>
      )}
    </li>
  );
}

function Cells({ x, open }: { x: BreakdownRow; open?: boolean }) {
  const sub = x.depth === 1;
  const Icon = rowIcon(x.label);
  const lead = rowLead(x);
  // The side a row favours is bold in its colour, the other faded; an even row, both plain.
  const value = (s: Side) => {
    const v = x[s];
    return (
      <span className={cn("tabular-nums", s === "red" ? "text-right" : "text-left", x.total ? "text-base" : sub ? "text-xs" : "text-sm",
        !v ? "text-text-muted" : lead.side === s ? cn("font-bold", TONE[s].text) : lead.side ? FADED[s] : "font-semibold text-text-base")} data-testid={`value-${s}`}>{v ?? "—"}</span>
    );
  };
  return (
    <>
      <span className={cn("flex min-w-0 items-center gap-1.5", sub ? "text-xs text-text-muted" : "text-sm", x.total && "font-semibold")}>
        {!sub && <Icon size={16} className="shrink-0 text-accent-text" />}
        <span className="min-w-0 break-words">{x.label}</span>{x.count && <span className="sr-only"> (count)</span>}
        {open !== undefined && <ChevronDown className={cn("size-3.5 shrink-0 text-text-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />}
      </span>
      {value("red")}
      <span className={cn("text-center tabular-nums", sub ? "text-[11px]" : "text-xs", lead.side ? cn(TONE[lead.side].text, !sub && "font-semibold") : "text-text-muted")} data-testid="lead">{lead.text}</span>
      {value("blue")}
    </>
  );
}

/** One bonus RP: its icon and name, and earned or missed said by a mark and the chip's outline as well as by colour.
 *  The icon only names the RP; `earned` comes straight from the match data. */
export function RpChip({ label, earned }: { label: string; earned: boolean }) {
  const Icon = rpIcon(label);
  return (
    <li className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight",
      earned ? "border-success/50 bg-success/10 text-text-base" : "border-dashed border-border text-text-muted")}
      data-earned={earned}>
      <span className="sr-only">{label} RP {earned ? "earned" : "missed"}</span>
      <Icon size={14} className={earned ? "text-success" : "opacity-70"} />
      <span aria-hidden>{label}</span>
      <span className={earned ? "font-semibold text-success" : undefined} aria-hidden>{earned ? "✓" : "✗"}</span>
    </li>
  );
}

function Prediction({ d }: { d: MatchDetail }) {
  const m = d.match, p = m.prediction;
  if (!p) {
    const full = [m.red, m.blue].every((a) => a.teams.filter((t) => t.onField).length === 2);
    return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">{full ? "No prediction was recorded for this match." : "No prediction: the engine predicts full 2-against-2 matches only, and a robot was missing here."}</p>;
  }
  const played = m.played && m.red.score && m.blue.score;
  const tie = played && m.red.score!.total === m.blue.score!.total;
  const called = played && !tie ? (p.pRed > 0.5) === (m.red.score!.total > m.blue.score!.total) : null;
  // The robots on the field: the lineup the call was made for (and the share card names).
  const red = m.red.teams.filter((t) => t.onField).map((t) => t.number), blue = m.blue.teams.filter((t) => t.onField).map((t) => t.number);
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Prediction">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-muted">{KIND_LABEL[p.kind]}</p>
        <div className="flex items-center gap-2">
          <ConfidenceBadge tier={p.tier} />
          {red.length > 0 && blue.length > 0 && (
            <ShareMatch query={{ season: m.season, red, blue, event: m.code, match: m.key }} pRed={p.pRed} tier={p.tier} played={!!played} />
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="w-10 text-right text-sm font-semibold tabular-nums text-red-alliance">{oddsPct(p.pRed)}</span>
        <WinBar pRed={p.pRed} className="flex-1" />
        <span className="w-10 text-sm font-semibold tabular-nums text-blue-alliance">{oddsPct(1 - p.pRed)}</span>
      </div>
      <div className="mt-3 space-y-1 text-sm">
        {!p.noScoreBasis && (
          <p className="tabular-nums" data-testid="call-predicted">
            <span className="text-text-muted">Predicted </span><ScoreRange mean={p.redMean} range={p.redRange} level={p.rangeLevel} className="text-red-alliance" /> – <ScoreRange mean={p.blueMean} range={p.blueRange} level={p.rangeLevel} className="text-blue-alliance" />
            {" · "}<span data-testid="predicted-margin" title={marginText(p.redMean, p.blueMean)}>{marginWords(p.redMean, p.blueMean)}</span>
          </p>
        )}
        {played && (
          <p className="tabular-nums" data-testid="call-actual">
            <span className="text-text-muted">Actual </span><span className="text-red-alliance">{m.red.score!.total}</span> – <span className="text-blue-alliance">{m.blue.score!.total}</span>
            {!p.noScoreBasis && <><span className="text-text-muted"> · off </span><span title="Actual minus predicted, red then blue">{signed(m.red.score!.total - p.redMean)} / {signed(m.blue.score!.total - p.blueMean)}</span></>}
            {!p.noScoreBasis && p.redRange && p.blueRange && <> · <span title="Whether each score landed inside its predicted range">{rangeWords(inside(m.red.score!.total, p.redRange), inside(m.blue.score!.total, p.blueRange))}</span></>}
            {called != null && <> · <span className={cn("font-semibold", called ? "text-success" : "text-warning")}>{called ? "Called it" : "Upset"}</span></>}
          </p>
        )}
      </div>
      {p.bonus && <BonusOddsRow season={m.season} bonus={p.bonus} actual={played ? d.bonus : null} className="mt-3 border-t border-border pt-3" />}
      {p.factors?.length ? <><p className="mt-3 text-xs font-medium text-text-muted">Why</p><FactorList factors={p.factors} reasons={p.reasons} className="mt-1.5" /></> : null}
      {p.history ? <PairHistoryLine history={p.history} className="mt-1.5" /> : null}
      {p.sheet && <FactorSheetPanel sheet={p.sheet} level={m.level} winner={played ? sheetWinner(m.red.score!.total, m.blue.score!.total) : null} className="mt-3" />}
      <CalibrationLine pRed={p.pRed} compact className="mt-3" />
      <PredictionBasis kind={matchBasis(m.level)} className="mt-1.5" />
    </section>
  );
}
