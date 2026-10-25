// One match, opened in place under its row (never a dialog): both lineups
// with each robot's standing at the event and this season, the score
// breakdown side by side, bonus RPs, what OPR expected vs what happened, the
// prediction against the result with its reasons, official result changes,
// and the match's video.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ClipboardList, PlayCircle, Video } from "lucide-react";
import { ClipLink } from "./MatchClip";
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
import { BonusOdds } from "./BonusOdds";
import { ScoreRange } from "./ScoreRange";
import { levelPct } from "../shared/scoreRange";
import { cn } from "./cn";

type Side = "red" | "blue";
const SIDES: Side[] = ["red", "blue"];
const TONE: Record<Side, { text: string; bar: string; card: string }> = {
  red: { text: "text-red-alliance", bar: "bg-red-alliance/80", card: "border-red-alliance/30 bg-red-alliance/[0.05]" },
  blue: { text: "text-blue-alliance", bar: "bg-blue-alliance/80", card: "border-blue-alliance/30 bg-blue-alliance/[0.05]" },
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(r1(x))}`;
const inside = (score: number, [lo, hi]: [number, number]) => (score < lo ? "below" : score > hi ? "above" : "yes");

export const matchRef = (m: MatchView) => `${m.season}:${m.code}:${m.level}:${m.series}:${m.number}`;

export function MatchDetails({ m, eventName }: { m: MatchView; eventName?: string }) {
  const state = useApi<MatchDetail>(`/api/events/${m.season}/${encodeURIComponent(m.code)}/matches/${m.key}`);
  return (
    <div className="border-t border-border bg-text-base/[0.02] px-3 py-4 sm:px-4">
      <Async state={state} loading={<div className="skeleton h-40 rounded-xl" />}>
        {(d) => <Body d={d} eventName={eventName} />}
      </Async>
      {/* Outside the server-loaded part: recording and saved videos work with no connection. */}
      <MatchVideoSection m={m} />
    </div>
  );
}

function Body({ d, eventName }: { d: MatchDetail; eventName?: string }) {
  const m = d.match;
  const played = m.played && !!m.red.score && !!m.blue.score;
  const href = (key: string) => `/events/${m.season}/${encodeURIComponent(m.code)}?tab=matches&match=${encodeURIComponent(key)}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        <span className="font-medium text-text-base">{d.description ?? m.label}</span>
        {m.time && <span>{matchTime(m.time)}</span>}
        {eventName !== undefined && <Link to={href(m.key)} className="underline-offset-2 hover:underline">{d.event.name}</Link>}
        {m.clip && <ClipLink clip={m.clip} className="font-medium text-[#ff4d6d] hover:text-text-base">Watch in the recording · {clipTime(m.clip.t)}</ClipLink>}
        {m.video && <a href={m.video} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-text-base"><PlayCircle className="size-3.5" /> Official video</a>}
        <Link to={matchReportHref(m)} className="inline-flex items-center gap-1 font-medium text-accent-text underline-offset-2 hover:underline"><ClipboardList className="size-3.5" aria-hidden /> Know your match</Link>
        <span className="ml-auto flex items-center gap-1">
          {d.prev && <Link to={href(d.prev.key)} className="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-text-base/[0.06] hover:text-text-base" aria-label={`Previous match, ${d.prev.label}`}><ChevronLeft className="size-3.5" />{d.prev.label}</Link>}
          {d.next && <Link to={href(d.next.key)} className="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-text-base/[0.06] hover:text-text-base" aria-label={`Next match, ${d.next.label}`}>{d.next.label}<ChevronRight className="size-3.5" /></Link>}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {SIDES.map((s) => <Alliance key={s} d={d} side={s} />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {played ? <Breakdown d={d} /> : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">Not played yet — the score breakdown appears once the result is posted.</p>}
        <Prediction d={d} />
      </div>
      {/* Asks again whenever this match's result or schedule on screen changes (live checks, refreshes). */}
      <ResultChanges season={m.season} code={m.code} matchKey={m.key}
        refreshKey={JSON.stringify([m.time, m.played, m.red.score, m.blue.score, m.red.teams.map((t) => t.number), m.blue.teams.map((t) => t.number)])} />
    </div>
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
    <section className={cn("rounded-xl border p-4", TONE[side].card)} aria-label={`${side === "red" ? "Red" : "Blue"} alliance`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={cn("text-xs font-semibold uppercase tracking-wide", TONE[side].text)}>{side === "red" ? "Red" : "Blue"} alliance{won ? " · won" : ""}</p>
        <p className={cn("font-display text-3xl font-bold tabular-nums", TONE[side].text)}>{a.score?.total ?? "—"}</p>
      </div>
      <ul className="mt-2 divide-y divide-border/60">
        {a.teams.map((t) => {
          const info = d.teams[t.number];
          const ev = info?.event, se = info?.season;
          return (
            <li key={t.number} className={cn("py-2", !t.onField && "opacity-60")}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link to={`/teams/${t.number}?season=${m.season}`} className="font-mono text-sm font-semibold hover:underline">{t.number}</Link>
                <span className="min-w-0 truncate text-sm">{info?.name ?? ""}</span>
                {d.stations[t.number] && <span className="text-[11px] text-text-muted">Station {d.stations[t.number]}</span>}
                {t.surrogate && <span className="rounded bg-muted px-1 text-[10px]">Surrogate</span>}
                {t.dq && <span className="rounded bg-destructive/15 px-1 text-[10px] text-destructive">DQ</span>}
                {!t.onField && <span className="rounded bg-muted px-1 text-[10px]">Not on field</span>}
              </div>
              <dl className="mt-1 grid grid-cols-3 gap-x-3 text-[11px] text-text-muted">
                <div><dt className="sr-only">Event rank</dt><dd>{ev?.rank ? <>Rank <span className="text-text-base">#{ev.rank}</span>{ev.wins != null && <> · {ev.wins}-{ev.losses}-{ev.ties}</>}</> : "Unranked"}</dd></div>
                <div><dt className="sr-only">Event OPR</dt><dd>OPR at this time <span className="text-text-base">{ev?.opr.np != null ? r1(ev.opr.np) : "—"}</span></dd></div>
                <div><dt className="sr-only">Season OPR</dt><dd>Season <span className="text-text-base">{se?.opr != null ? r1(se.opr) : "—"}</span>{se?.rank ? <> · #{se.rank.toLocaleString()}</> : null}</dd></div>
              </dl>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        {expected != null && <span>Event OPRs add up to <span className="text-text-base">{r1(expected)}</span>{a.score ? <> · scored {a.score.np} without penalties (<span className={cn(a.score.np - expected >= 0 ? "text-success" : "text-warning")}>{signed(a.score.np - expected)}</span>)</> : null}</span>}
      </div>
      {bonus && d.bonus && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Bonus ranking points">
          {d.bonus.labels.map((l, i) => <span key={l} className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", bonus[i] ? "border-success/40 bg-success/10 text-success" : "border-border opacity-60")}>{l} RP {bonus[i] ? "✓" : "✗"}</span>)}
        </div>
      )}
    </section>
  );
}

const FOULS_NOTE = "Penalty points this alliance committed (they go to the other side).";

/** The score side by side. With the season's full sheet (FIRST's breakdown: each group, then what it's made of,
 *  indented), that; otherwise the engine's split (auto, TeleOp, endgame). Both end on the total. */
function Breakdown({ d }: { d: MatchDetail }) {
  const r = d.match.red.score!, b = d.match.blue.score!;
  type Row = { label: string; red: number | null; blue: number | null; note?: string; depth?: 0 | 1; count?: boolean; total?: boolean };
  const rows: Row[] = d.sheet
    ? [...d.sheet.map((x) => ({ ...x, note: x.label === "Fouls given away" ? FOULS_NOTE : x.count ? "How many this alliance committed" : undefined })), { label: "Total", red: r.total, blue: b.total, total: true }]
    : [
      { label: "Auto", red: r.auto, blue: b.auto },
      { label: "TeleOp", red: r.teleop, blue: b.teleop },
      { label: "Endgame", red: r.endgame, blue: b.endgame },
      { label: "No penalties", red: r.np, blue: b.np },
      { label: "Fouls given away", red: r.pen, blue: b.pen, note: FOULS_NOTE },
      { label: "Total", red: r.total, blue: b.total, total: true },
    ];
  const diff = r.total - b.total;
  return (
    <section className="rounded-xl border border-border bg-card" aria-label="Score breakdown">
      <ul className="divide-y divide-border">
        {rows.map((x, i) => {
          const max = Math.max(Math.abs(x.red ?? 0), Math.abs(x.blue ?? 0), 1);
          const sub = x.depth === 1;
          // A zero fades back, so the rows that scored stand out (as on a paper score sheet).
          const num = (v: number | null, side: Side) => cn("w-9 shrink-0 tabular-nums", sub ? "text-xs" : "text-sm", side === "blue" && "text-right", v ? TONE[side].text : "text-text-muted");
          return (
            <li key={`${x.label}:${i}`} className={cn("grid grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1fr)] items-center gap-2 px-3", sub ? "py-1.5" : "py-2", x.total && "font-semibold", !sub && d.sheet && !x.total && "bg-text-base/[0.03] font-medium")} title={x.note} data-depth={x.depth ?? 0}>
              <span className="flex items-center gap-2">
                <span className={num(x.red, "red")}>{x.red ?? "—"}</span>
                <span className="flex flex-1 justify-end"><span className={cn("rounded-full", sub ? "h-1 opacity-70" : "h-1.5", TONE.red.bar)} style={{ width: `${(Math.abs(x.red ?? 0) / max) * 100}%` }} /></span>
              </span>
              <span className={cn("text-center text-xs", sub ? "text-text-muted" : "text-text-base")}>{sub ? <span className="text-text-muted/70" aria-hidden>· </span> : null}{x.label}{x.count && <span className="sr-only"> (count)</span>}</span>
              <span className="flex items-center gap-2">
                <span className="flex flex-1"><span className={cn("rounded-full", sub ? "h-1 opacity-70" : "h-1.5", TONE.blue.bar)} style={{ width: `${(Math.abs(x.blue ?? 0) / max) * 100}%` }} /></span>
                <span className={num(x.blue, "blue")}>{x.blue ?? "—"}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border px-3 py-2 text-xs text-text-muted">
        {diff === 0 ? "Tie." : <>{diff > 0 ? "Red" : "Blue"} by <span className="text-text-base">{Math.abs(diff)}</span>{Math.sign(r.np - b.np) !== Math.sign(diff) ? " — decided by penalties." : "."}</>}
      </p>
    </section>
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
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {!p.noScoreBasis && <><dt className="text-text-muted">Predicted{p.redRange && <span className="text-[11px]"> (± {levelPct(p.rangeLevel)} range)</span>}</dt><dd className="tabular-nums"><ScoreRange mean={p.redMean} range={p.redRange} level={p.rangeLevel} className="text-red-alliance" /> – <ScoreRange mean={p.blueMean} range={p.blueRange} level={p.rangeLevel} className="text-blue-alliance" /></dd></>}
        {played && <><dt className="text-text-muted">Actual</dt><dd className="tabular-nums"><span className="text-red-alliance">{m.red.score!.total}</span> – <span className="text-blue-alliance">{m.blue.score!.total}</span></dd></>}
        {played && !p.noScoreBasis && <><dt className="text-text-muted">Off by</dt><dd className="tabular-nums">red {signed(m.red.score!.total - p.redMean)}, blue {signed(m.blue.score!.total - p.blueMean)}</dd></>}
        {played && !p.noScoreBasis && p.redRange && p.blueRange && <><dt className="text-text-muted">Inside the range</dt><dd>red {inside(m.red.score!.total, p.redRange)}, blue {inside(m.blue.score!.total, p.blueRange)}</dd></>}
        {called != null && <><dt className="text-text-muted">Call</dt><dd className={called ? "text-success" : "text-warning"}>{called ? "Called it" : "Upset"}</dd></>}
      </dl>
      {p.bonus && <BonusOdds season={m.season} bonus={p.bonus} actual={played ? d.bonus : null} className="mt-3 bg-text-base/[0.02]" />}
      {p.factors?.length ? <><p className="mt-3 text-xs font-medium text-text-muted">Why</p><FactorList factors={p.factors} reasons={p.reasons} className="mt-1.5" /></> : null}
      {p.history ? <PairHistoryLine history={p.history} className="mt-1.5" /> : null}
      <CalibrationLine pRed={p.pRed} compact className="mt-3" />
    </section>
  );
}
