// One match, opened in place under its row (never a dialog), as one column with no panels: the score and
// margin in the largest type; both lineups side by side as short muted lines; the score as one Red | difference |
// Blue table (phases first, their parts a tap away); then the call on the same columns (odds, predicted, actual,
// off by, bonus ranking points as icons with their names a hover or tap away), its reasons, the full breakdown a
// tap away, official result changes and the match's video. Fewer words, the same numbers.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Crosshair, Flag, History, MoveHorizontal, Percent, Radio, Sigma, Video, type LucideIcon } from "lucide-react";
import { ClipLink, MatchVideoLink } from "./MatchClip";
import { clipTime } from "../shared/recording";
import type { MatchDetail, MatchView } from "../shared/api";
import { matchReportHref } from "../shared/matchReport";
import { useApi } from "../lib/api";
import { matchTime, oddsPct } from "../lib/format";
import { Async } from "./states";
import { CalibrationLine, ConfidenceBadge, FactorList, KIND_LABEL, PairHistoryLine, WinBar } from "./predict";
import { TapTooltip, Tooltip, TooltipContent, TooltipTrigger } from "./ui/overlay";
import { VideoPanel, useVideoCount } from "./MatchVideo";
import { MatchContributorPanel } from "./contributors/MatchContributorPanel";
import { ShareMatch } from "./ShareMatch";
import { ResultChanges } from "./ResultChanges";
import { bonusLabels } from "../shared/labels";
import { FactorSheetPanel } from "./FactorSheet";
import { sheetWinner } from "../shared/factorSheet";
import { ScoreRange } from "./ScoreRange";
import { PredictionBasis } from "./PredictionBasis";
import { marginText, marginWords, matchBasis } from "../shared/predictionBasis";
import { tierPhrase } from "../shared/tierWords";
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
    <div className="border-t border-border px-3 py-5 sm:px-4">
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
  // Separated by space alone (no boxes, no headings). Wide: what happened on the left (score, lineups, the table),
  // the call on the right. Narrow (a phone, the half-width My teams panel): one column, the call under the table.
  return (
    <div className="@container">
     <div className="grid gap-x-10 gap-y-7 @4xl:grid-cols-2">
      <div className="min-w-0 space-y-7">
        <div className="space-y-4">
          <Headline d={d} eventName={eventName} href={href} />
          <div className="grid grid-cols-2 gap-x-4">
            {SIDES.map((s) => <Alliance key={s} d={d} side={s} />)}
          </div>
        </div>
        {played ? <Breakdown d={d} /> : <p className="text-sm text-text-muted">Not played yet — the score breakdown appears once the result is posted.</p>}
      </div>
      <div className="min-w-0 @4xl:border-l @4xl:border-border/60 @4xl:pl-10">
        <Prediction d={d} />
      </div>
     </div>
      {/* Match videos people added (docs/contributors.md): the one this viewer may see, and adding one, in the open. */}
      <MatchContributorPanel m={m} />
      {/* Asks again whenever this match's result or schedule on screen changes (live checks, refreshes). */}
      <div className="mt-7">
        <ResultChanges season={m.season} code={m.code} matchKey={m.key} bare
          refreshKey={JSON.stringify([m.time, m.played, m.red.score, m.blue.score, m.red.teams.map((t) => t.number), m.blue.teams.map((t) => t.number)])} />
      </div>
    </div>
  );
}

/** The loser's number fades back: the alliance colour mixed toward muted text, so it still reads at 4.5:1. */
const FADED: Record<Side, string> = {
  red: "text-[color-mix(in_srgb,var(--color-red-alliance-text)_55%,var(--color-text-muted))]",
  blue: "text-[color-mix(in_srgb,var(--color-blue-alliance-text)_55%,var(--color-text-muted))]",
};
const NAME: Record<Side, string> = { red: "Red", blue: "Blue" };

/** A match video's button: filled in the video colour, 44 px tall on a touch screen. */
const WATCH = "min-h-9 gap-1.5 rounded-lg bg-video px-3 text-sm font-semibold text-on-video shadow-sm hover:opacity-90 max-sm:min-h-11 [&_svg]:size-4";

/** The whole match in one glance: the score and the margin in the biggest type on the page, then which match
 *  and when, muted, with its links as icons (their names on hover, and for screen readers). */
export function Headline({ d, eventName, href }: { d: MatchDetail; eventName?: string; href?: (key: string) => string }) {
  const m = d.match, r = m.red.score, b = m.blue.score;
  const played = m.played && !!r && !!b;
  const diff = played ? r!.total - b!.total : 0;
  const win: Side | null = played && diff !== 0 ? (diff > 0 ? "red" : "blue") : null;
  const num = (s: Side) => cn("tabular-nums", win === s || !win ? cn("font-bold", TONE[s].text) : cn("font-normal", FADED[s]));
  const penalties = played && win && Math.sign(r!.np - b!.np) !== Math.sign(diff);
  const nav = "inline-flex items-center rounded px-1.5 py-0.5 tap-44 hover:bg-text-base/[0.06] hover:text-text-base";
  return (
    <header data-testid="match-headline">
      {played && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display" data-testid="breakdown-margin">
          <span className="text-5xl leading-none">
            <span className={num("red")}>{r!.total}</span><span className="font-normal text-text-muted"> – </span><span className={num("blue")}>{b!.total}</span>
          </span>
          <span className={cn("text-2xl font-bold", win ? TONE[win].text : "text-text-base")}>{win ? `${NAME[win]} by ${Math.abs(diff)}` : "Tie"}</span>
        </p>
      )}
      {/* A video of this match: the one loud button besides the score, so it's never missed. */}
      {(m.clip || m.video) && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="match-video-buttons">
          {m.clip && <ClipLink clip={m.clip} label={m.label} matchKey={m.key} className={WATCH}>Watch the match · {clipTime(m.clip.t)}</ClipLink>}
          {m.video && <MatchVideoLink url={m.video} label={m.label} matchKey={m.key} className={WATCH}>{m.clip ? "Official video" : "Watch the match"}</MatchVideoLink>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        <p data-testid="match-line">
          {d.description ?? m.label}
          {m.time && <> · {matchTime(m.time)}</>}
          {!played ? " · Not played yet" : !win ? " · Tie" : null}
          {penalties && " · decided by penalties"}
        </p>
        {eventName !== undefined && href && <Link to={href(m.key)} className="underline-offset-2 hover:underline">{d.event.name}</Link>}
        <span className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to={matchReportHref(m)} className={cn(nav, "text-accent-text")} aria-label={`Know your match: the pre-match report for ${m.label}`}><ClipboardList className="size-4" aria-hidden /></Link>
            </TooltipTrigger>
            <TooltipContent>Know your match: the pre-match report</TooltipContent>
          </Tooltip>
          {href && d.prev && <Link to={href(d.prev.key)} className={nav} aria-label={`Previous match, ${d.prev.label}`}><ChevronLeft className="size-3.5" />{d.prev.label}</Link>}
          {href && d.next && <Link to={href(d.next.key)} className={nav} aria-label={`Next match, ${d.next.label}`}>{d.next.label}<ChevronRight className="size-3.5" /></Link>}
        </span>
      </div>
    </header>
  );
}

function MatchVideoSection({ m }: { m: MatchView }) {
  const [open, setOpen] = useState(false);
  const saved = useVideoCount(matchRef(m));
  return (
    // Mounted only while open: closing it unmounts the recorder, which stops (and saves) any recording and releases the camera.
    <details className="group mt-6" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      {/* Saved videos of this match: as loud as the watch button; none yet: a quiet row to add one. */}
      <summary className={cn("flex min-h-11 w-fit cursor-pointer select-none items-center gap-2 [&::-webkit-details-marker]:hidden", saved > 0 ? "rounded-lg bg-video px-3 text-sm font-semibold text-on-video" : "text-xs text-text-muted hover:text-text-base")} title="Record, add a file or a YouTube link">
        <Video className={cn("size-4", saved > 0 ? "" : "text-accent-text")} aria-hidden />{saved > 0 ? `Your videos (${saved})` : "Video"}<span className="sr-only"> for {m.label}: record, add a file or a YouTube link</span><ChevronDown className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      {open && <div className="pt-2"><VideoPanel matchRef={matchRef(m)} label={`${m.code} ${m.label}`} /></div>}
    </details>
  );
}

/** One alliance as short lines: each robot's number (in its alliance colour) and name, its standing muted under
 *  it, then what the lineup's OPRs add up to. The side is said by the colour edge (and to screen readers); the
 *  bonus RPs it earned live once, in the call's bonus rows. */
function Alliance({ d, side }: { d: MatchDetail; side: Side }) {
  const m = d.match;
  const a = m[side], other = m[side === "red" ? "blue" : "red"];
  const won = m.played && a.score && other.score ? a.score.total > other.score.total : false;
  const onField = a.teams.filter((t) => t.onField);
  // What the robots' event OPRs add up to: the score this lineup "usually" puts up here.
  const oprs = onField.map((t) => d.teams[t.number]?.event?.opr.np);
  const expected = oprs.length && oprs.every((x) => x != null) ? (oprs as number[]).reduce((s, x) => s + x, 0) : null;
  return (
    <section className={cn("min-w-0 border-l-2 pl-2.5", side === "red" ? "border-red-alliance" : "border-blue-alliance")} aria-label={`${NAME[side]} alliance${won ? ", won" : ""}`}>
      <ul className="space-y-2">
        {a.teams.map((t) => {
          const info = d.teams[t.number];
          const ev = info?.event, se = info?.season;
          return (
            <li key={t.number} className={cn("min-w-0", !t.onField && "opacity-60")}>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                {hasTeamPage(t.number, info?.name)
                  ? <Link to={`/teams/${t.number}?season=${m.season}`} className={cn("font-mono text-sm font-semibold hover:underline", TONE[side].text)}>{t.number}</Link>
                  : <span className={cn("font-mono text-sm font-semibold", TONE[side].text)}>{t.number}</span>}
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
        <p className="mt-1.5 text-[11px] text-text-muted" title="What the robots' event OPRs add up to, then the points scored without penalties"><span className="sr-only">Event OPRs add up to </span><span aria-hidden>OPRs </span>{r1(expected)}{a.score ? <><span className="sr-only">, scored without penalties </span><span aria-hidden> → </span>{a.score.np} (<span className={cn(a.score.np - expected >= 0 ? "text-success" : "text-warning")}>{signed(a.score.np - expected)}</span>)</> : null}</p>
      )}
    </section>
  );
}

/** A robot's standing in one short line: station, event rank and record, OPR at this time, season OPR and rank.
 *  Short labels on screen; the full names in the tooltip and for screen readers. The season OPR is printed only
 *  when it differs from the event's, so the same number never shows twice. */
export function TeamLine({ station, ev, se }: { station?: number; ev?: MatchDetail["teams"][number]["event"]; se?: MatchDetail["teams"][number]["season"] }) {
  const evOpr = ev?.opr.np != null ? r1(ev.opr.np) : null, seOpr = se?.opr != null ? r1(se.opr) : null;
  // The season OPR on screen: a dash when unknown, the number when it differs from the event's, nothing when it's the same.
  const seVisible = seOpr == null ? "—" : seOpr !== evOpr ? seOpr : null;
  return (
    <p className="text-[11px] text-text-muted" data-testid="team-standing">
      {station ? <span title={`Station ${station}`}><span className="sr-only">Station </span><span aria-hidden>S</span>{station} · </span> : null}
      {ev?.rank ? <span title="Event rank and record"><span className="sr-only">Rank </span>#{ev.rank}{ev.wins != null && <> {ev.wins}-{ev.losses}-{ev.ties}</>}</span> : "Unranked"}
      {" · "}<span title="OPR at this time"><span className="sr-only">OPR at this time </span><span aria-hidden>OPR </span>{evOpr ?? "—"}</span>
      {(seVisible != null || se?.rank) ? <>{" · "}<span title={`Season OPR ${seOpr ?? "—"}${se?.rank ? `, rank #${se.rank.toLocaleString()}` : ""}`}><span className="sr-only">Season OPR {seOpr ?? "unknown"}{se?.rank ? ", season rank " : ""}</span><span aria-hidden>season {seVisible != null && <>{seVisible} </>}</span>{se?.rank ? <>#{se.rank.toLocaleString()}</> : null}</span></>
        : <span className="sr-only"> · Season OPR {seOpr}, the same as at this event</span>}
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
const GRID = "grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem_3.5rem] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_9rem_4.5rem] sm:gap-x-3";

/** The score as one table: a row per scoring phase with both values and the difference in words, in the
 *  colour of the side it favours. No bars: for two numbers, the difference says it faster. What each phase is
 *  made of sits under it, one tap away (collapsed on load). */
export function Breakdown({ d }: { d: MatchDetail }) {
  const groups = groupRows(breakdownRows(d));
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (i: number) => setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const id = `breakdown-${d.match.code}-${d.match.key.replace(/:/g, "-")}`;
  return (
    <section aria-label="Score breakdown">
      {/* The column names say what the table is: no title. */}
      <TableHead first="Phase" middle="Difference" />
      <ul className={TABLE}>
        {groups.map((g, i) => <Phase key={`${g.row.label}:${i}`} g={g} open={open.has(i)} onToggle={() => toggle(i)} id={`${id}-${i}`} />)}
      </ul>
    </section>
  );
}

/** The score table's and the call table's column names: Red, the middle column, Blue. */
function TableHead({ first, middle }: { first: string; middle: string }) {
  return (
    <div className={cn(GRID, "pb-1.5 text-[11px] text-text-muted")}>
      <span><span className="sr-only">{first}</span></span>
      <span className="text-right text-red-alliance">Red</span>
      <span className="text-center">{middle}</span>
      <span className="text-blue-alliance">Blue</span>
    </div>
  );
}

/** The tables' rows: ruled between, ruled above and below. */
const TABLE = "divide-y divide-border border-y border-border";

type RowIcon = LucideIcon | ((p: { size?: number; className?: string }) => ReactNode);

/** A call-table row's label: its icon and its name, as the score table draws a phase. */
function RowLabel({ icon: Icon, label, title, children }: { icon: RowIcon; label: string; title?: string; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm" title={title}>
      <Icon size={16} className="shrink-0 text-text-muted" />
      <span className="min-w-0 break-words">{label}</span>{children}
    </span>
  );
}

/** A side's value in the call table, in its alliance colour (the score table's leading-side look). */
const sideValue = (s: Side, extra?: string) => cn("text-sm font-semibold tabular-nums", s === "red" ? "text-right" : "text-left", TONE[s].text, extra);
/** The call table's middle cell: words, in the colour of the side they're about (the Difference cell's look). */
const middleCell = (tone?: string) => cn("text-center text-xs font-semibold", tone ?? "text-text-muted");
const ROW = cn(GRID, "min-h-[44px] py-2");

const rowData = (r: BreakdownRow) => ({ title: r.note, "data-depth": r.depth ?? 0, "data-label": r.label, "data-red": r.red ?? "", "data-blue": r.blue ?? "" });

function Phase({ g, open, onToggle, id }: { g: BreakdownGroup; open: boolean; onToggle: () => void; id: string }) {
  const x = g.row;
  const row = cn(GRID, "min-h-[44px] w-full py-2 text-left");
  return (
    <li>
      {g.parts.length ? (
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
          className={cn(row, "cursor-pointer outline-none hover:bg-text-base/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60")} {...rowData(x)}>
          <Cells x={x} open={open} />
        </button>
      ) : <div className={row} {...rowData(x)}><Cells x={x} /></div>}
      {g.parts.length > 0 && open && (
        <ul id={id} className="divide-y divide-border/60 border-t border-border/60" aria-label={`${x.label}, what it's made of`}>
          {g.parts.map((p, i) => <li key={`${p.label}:${i}`} className={cn(GRID, "min-h-9 py-1.5 pl-6")} {...rowData(p)}><Cells x={p} /></li>)}
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
      <span className={cn("tabular-nums", s === "red" ? "text-right" : "text-left", x.total ? "text-base font-bold" : sub ? "text-xs" : "text-sm",
        !v ? "text-text-muted" : lead.side === s ? cn("font-bold", TONE[s].text) : lead.side ? FADED[s] : "font-semibold text-text-base")} data-testid={`value-${s}`}>{v ?? "—"}</span>
    );
  };
  return (
    <>
      <span className={cn("flex min-w-0 items-center gap-1.5", sub ? "text-xs text-text-muted" : "text-sm", x.total && "font-semibold")}>
        {!sub && <Icon size={16} className="shrink-0 text-text-muted" />}
        <span className="min-w-0 break-words">{x.label}</span>{x.count && <span className="sr-only"> (count)</span>}
        {open !== undefined && <ChevronDown className={cn("size-3.5 shrink-0 text-text-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />}
      </span>
      {value("red")}
      <span className={cn("text-center tabular-nums", sub ? "text-[11px]" : "text-xs", lead.side ? cn(TONE[lead.side].text, !sub && "font-semibold") : "text-text-muted")} data-testid="lead">{lead.text}</span>
      {value("blue")}
    </>
  );
}

export function Prediction({ d }: { d: MatchDetail }) {
  const m = d.match, p = m.prediction;
  if (!p) {
    const full = [m.red, m.blue].every((a) => a.teams.filter((t) => t.onField).length === 2);
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-muted">{full ? "No prediction was recorded for this match." : "No prediction: the engine predicts full 2-against-2 matches only, and a robot was missing here."}</p>
        {d.bonus && <div><TableHead first="Bonus" middle="Earned" /><ul className={TABLE}><BonusRows season={m.season} odds={null} actual={d.bonus} /></ul></div>}
      </div>
    );
  }
  const played = m.played && m.red.score && m.blue.score;
  const tie = played && m.red.score!.total === m.blue.score!.total;
  const called = played && !tie ? (p.pRed > 0.5) === (m.red.score!.total > m.blue.score!.total) : null;
  // The robots on the field: the lineup the call was made for (and the share card names).
  const red = m.red.teams.filter((t) => t.onField).map((t) => t.number), blue = m.blue.teams.filter((t) => t.onField).map((t) => t.number);
  const Kind = p.kind === "live" ? Radio : History;
  const label = "text-xs text-text-muted";
  return (
    // The call on the score table's own columns, so predicted, actual and off by sit under Red and Blue.
    <section className="space-y-6" aria-label={`Prediction: ${KIND_LABEL[p.kind]}`}>
      <div>
        {/* What the call is, how sure it was, and its share button on their own short row above the table. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex text-text-muted" tabIndex={0} aria-label={KIND_LABEL[p.kind]}><Kind className="size-3.5" aria-hidden /></span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{KIND_LABEL[p.kind]}</TooltipContent>
          </Tooltip>
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted" data-confidence={p.tier}><span aria-hidden>Confidence</span>{/* Neutral here: the tier is a fact about the call, not a warning. */}<ConfidenceBadge tier={p.tier} className="border-border bg-transparent text-foreground" /></span>
          {red.length > 0 && blue.length > 0 && (
            <ShareMatch query={{ season: m.season, red, blue, event: m.code, match: m.key }} pRed={p.pRed} tier={p.tier} played={!!played} iconOnly />
          )}
        </div>
        {/* The call on the score table's own columns and look: Red, the call in words, Blue. */}
        <TableHead first="Item" middle="Call" />
        <ul className={TABLE} data-call-table>
          <li className={ROW} data-testid="call-odds">
            <RowLabel icon={Percent} label="Odds" title="Each side's chance to win, from the call" />
            <span className={sideValue("red")}>{oddsPct(p.pRed)}</span>
            <WinBar pRed={p.pRed} size="sm" />
            <span className={sideValue("blue")}>{oddsPct(1 - p.pRed)}</span>
          </li>
          {!p.noScoreBasis && (
            <li className={ROW} data-testid="call-predicted">
              <RowLabel icon={Crosshair} label="Predicted" />
              <span className={sideValue("red")}><ScoreRange mean={p.redMean} range={p.redRange} level={p.rangeLevel} className={TONE.red.text} pmClassName="text-[10px] font-normal text-text-muted" /></span>
              <span className={middleCell(p.redMean === p.blueMean ? undefined : TONE[p.redMean > p.blueMean ? "red" : "blue"].text)} data-testid="predicted-margin" title={marginText(p.redMean, p.blueMean)}>{marginWords(p.redMean, p.blueMean)}</span>
              <span className={sideValue("blue")}><ScoreRange mean={p.blueMean} range={p.blueRange} level={p.rangeLevel} className={TONE.blue.text} pmClassName="text-[10px] font-normal text-text-muted" /></span>
            </li>
          )}
          {played && (
            <li className={ROW} data-testid="call-actual">
              <RowLabel icon={Flag} label="Actual" />
              <span className={sideValue("red")}>{m.red.score!.total}</span>
              {/* Whether the favoured side won: a right call in the success green, an upset in the theme's info blue (never a warning colour: nothing to act on). */}
              <span className={middleCell(called == null ? undefined : called ? "text-success" : "text-info")} title="Whether the side the call favoured won" data-called={called == null ? "tie" : called ? "right" : "upset"}>{called == null ? "Tie" : called ? "Called it" : "Upset"}</span>
              <span className={sideValue("blue")}>{m.blue.score!.total}</span>
            </li>
          )}
          {played && !p.noScoreBasis && (
            <li className={ROW} data-testid="call-off">
              <RowLabel icon={MoveHorizontal} label="Off by" title="Actual minus predicted" />
              <span className="text-right text-sm tabular-nums text-text-muted">{signed(m.red.score!.total - p.redMean)}</span>
              <span className={middleCell()} title="Whether each score landed inside its predicted range">{p.redRange && p.blueRange ? rangeWords(inside(m.red.score!.total, p.redRange), inside(m.blue.score!.total, p.blueRange)) : ""}</span>
              <span className="text-sm tabular-nums text-text-muted">{signed(m.blue.score!.total - p.blueMean)}</span>
            </li>
          )}
          {(p.bonus || d.bonus) && <BonusRows season={m.season} odds={p.bonus ?? null} actual={played ? d.bonus : null} tier={p.tier} />}
        </ul>
      </div>
      {p.factors?.length || p.history ? (
        <div aria-label="Why">
          {p.factors?.length ? <FactorList factors={p.factors} reasons={p.reasons} /> : null}
          {p.history ? <PairHistoryLine history={p.history} className="mt-1.5" /> : null}
        </div>
      ) : null}
      {(
        <div className="space-y-1.5">
          {p.sheet && <FactorSheetPanel sheet={p.sheet} level={m.level} winner={played ? sheetWinner(m.red.score!.total, m.blue.score!.total) : null} quiet />}
          <div className="flex flex-wrap items-center gap-x-2">
            <CalibrationLine pRed={p.pRed} compact />
            <PredictionBasis kind={matchBasis(m.level)} quiet />
          </div>
        </div>
      )}
    </section>
  );
}

const RP_NOTE = "3 for a win and 1 for a tie, weighted by their chances (a tie is about 1% in an even match), plus each bonus chance, from each alliance's likely score this season. Qualification matches only.";

/** The bonus ranking points as rows of the call table: each RP's icon and name, then per side its chance (when the
 *  call had one) and whether it was earned (✓ earned, ✗ missed, in words for screen readers), the middle cell saying
 *  who earned it; then the expected RP. Rows only: the caller's table holds them. */
export function BonusRows({ season, odds, actual, tier }: {
  season: number;
  odds: NonNullable<MatchDetail["match"]["prediction"]>["bonus"] | null;
  actual: MatchDetail["bonus"] | null;
  tier?: string;
}) {
  const labels = bonusLabels(season) ?? actual?.labels ?? null;
  if (!labels) return null;
  const got = (s: Side, i: number) => (actual?.[s] ? actual[s]![i] : null);
  const word = (g: boolean | null) => (g == null ? "" : g ? ", earned" : ", missed");
  const cell = (s: Side, i: number) => {
    const g = got(s, i);
    return (
      <span className={sideValue(s, cn("inline-flex items-center gap-1", s === "red" ? "justify-end" : "justify-start"))}>
        {odds && <span>{oddsPct(odds[s][i])}</span>}
        {g != null && <span className={g ? "text-success" : "font-normal text-text-muted"} aria-hidden>{g ? "✓" : "✗"}</span>}
        {g == null && !odds && <span className="text-text-muted">—</span>}
        {g != null && <span className="sr-only">{g ? "earned" : "missed"}</span>}
      </span>
    );
  };
  const who = (i: number) => {
    const r = got("red", i), b = got("blue", i);
    if (r == null || b == null) return "";
    return r && b ? "Both earned" : r ? "Red earned" : b ? "Blue earned" : "Neither";
  };
  return (
    <>
      {labels.map((l, i) => {
        const r = got("red", i), b = got("blue", i);
        const tip = `${l}: bonus ranking point. Red${odds ? ` ${oddsPct(odds.red[i])}` : ""}${word(r)}, Blue${odds ? ` ${oddsPct(odds.blue[i])}` : ""}${word(b)}.${odds && tier ? ` ${tierPhrase(odds.tier)}.` : ""}`;
        return (
          <li key={l} className={ROW} data-bonus={l} title={tip}>
            <RowLabel icon={rpIcon(l)} label={`${l} RP`} />
            {cell("red", i)}
            <span className={middleCell(r && !b ? TONE.red.text : b && !r ? TONE.blue.text : undefined)}>{who(i)}</span>
            {cell("blue", i)}
          </li>
        );
      })}
      {odds && (
        <li className={ROW} data-bonus-expected title={`Expected ranking points. ${RP_NOTE}`}>
          <RowLabel icon={Sigma} label="Expected RP">
            <Link to="/methodology#bonus" className="tap-44 shrink-0 text-xs text-text-muted underline">How</Link>
          </RowLabel>
          <span className={sideValue("red")}>{odds.rpRed.toFixed(1)}</span>
          <span className={middleCell()}>{odds.rpRed === odds.rpBlue ? "Even" : `${odds.rpRed > odds.rpBlue ? "Red" : "Blue"} +${Math.abs(odds.rpRed - odds.rpBlue).toFixed(1)}`}</span>
          <span className={sideValue("blue")}>{odds.rpBlue.toFixed(1)}</span>
        </li>
      )}
    </>
  );
}
