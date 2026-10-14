// One match, opened in place under its row (never a dialog): both lineups
// with each robot's standing at the event and this season, the score
// breakdown side by side, bonus RPs, what OPR expected vs what happened, the
// prediction against the result with its reasons, and the match's video.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, PlayCircle } from "lucide-react";
import type { MatchDetail, MatchView } from "../shared/api";
import { useApi } from "../lib/api";
import { matchTime, oddsPct } from "../lib/format";
import { Async } from "./states";
import { CalibrationLine, ConfidenceBadge, FactorList, KIND_LABEL, WinBar } from "./predict";
import { VideoPanel } from "./MatchVideo";
import { cn } from "./cn";

type Side = "red" | "blue";
const SIDES: Side[] = ["red", "blue"];
const TONE: Record<Side, { text: string; bar: string; card: string }> = {
  red: { text: "text-red-alliance", bar: "bg-red-alliance/80", card: "border-red-alliance/30 bg-red-alliance/[0.05]" },
  blue: { text: "text-blue-alliance", bar: "bg-blue-alliance/80", card: "border-blue-alliance/30 bg-blue-alliance/[0.05]" },
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(r1(x))}`;

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
        {m.video && <a href={m.video} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-text-base"><PlayCircle className="size-3.5" /> Official video</a>}
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
    </div>
  );
}

function MatchVideoSection({ m }: { m: MatchView }) {
  const [open, setOpen] = useState(false);
  return (
    // Mounted only while open: closing it unmounts the recorder, which stops (and saves) any recording and releases the camera.
    <details className="group mt-4 rounded-xl border border-border bg-card" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">Video for {m.label}</summary>
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
                <div><dt className="sr-only">Event OPR</dt><dd>OPR here <span className="text-text-base">{ev?.opr.np != null ? r1(ev.opr.np) : "—"}</span></dd></div>
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

function Breakdown({ d }: { d: MatchDetail }) {
  const r = d.match.red.score!, b = d.match.blue.score!;
  const rows: { label: string; red: number; blue: number; note?: string }[] = [
    { label: "Auto", red: r.auto, blue: b.auto },
    { label: "TeleOp", red: r.teleop, blue: b.teleop },
    { label: "Endgame", red: r.endgame, blue: b.endgame },
    { label: "No penalties", red: r.np, blue: b.np },
    { label: "Fouls given away", red: r.pen, blue: b.pen, note: "Penalty points this alliance committed (they go to the other side)." },
    { label: "Total", red: r.total, blue: b.total },
  ];
  const diff = r.total - b.total;
  return (
    <section className="rounded-xl border border-border bg-card" aria-label="Score breakdown">
      <ul className="divide-y divide-border">
        {rows.map((x) => {
          const max = Math.max(Math.abs(x.red), Math.abs(x.blue), 1);
          return (
            <li key={x.label} className={cn("grid grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1fr)] items-center gap-2 px-3 py-2", x.label === "Total" && "font-semibold")} title={x.note}>
              <span className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-sm tabular-nums text-red-alliance">{x.red}</span>
                <span className="flex flex-1 justify-end"><span className={cn("h-1.5 rounded-full", TONE.red.bar)} style={{ width: `${(Math.abs(x.red) / max) * 100}%` }} /></span>
              </span>
              <span className="text-center text-xs text-text-muted">{x.label}</span>
              <span className="flex items-center gap-2">
                <span className="flex flex-1"><span className={cn("h-1.5 rounded-full", TONE.blue.bar)} style={{ width: `${(Math.abs(x.blue) / max) * 100}%` }} /></span>
                <span className="w-9 shrink-0 text-right text-sm tabular-nums text-blue-alliance">{x.blue}</span>
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
    return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">{full ? "No prediction was recorded for this match yet. Played matches get one at the next data refresh." : "No prediction: the engine predicts full 2-against-2 matches only, and a robot was missing here."}</p>;
  }
  const played = m.played && m.red.score && m.blue.score;
  const tie = played && m.red.score!.total === m.blue.score!.total;
  const called = played && !tie ? (p.pRed > 0.5) === (m.red.score!.total > m.blue.score!.total) : null;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Prediction">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-muted">{KIND_LABEL[p.kind]}</p>
        <ConfidenceBadge tier={p.tier} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="w-10 text-right text-sm font-semibold tabular-nums text-red-alliance">{oddsPct(p.pRed)}</span>
        <WinBar pRed={p.pRed} className="flex-1" />
        <span className="w-10 text-sm font-semibold tabular-nums text-blue-alliance">{oddsPct(1 - p.pRed)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {!p.noScoreBasis && <><dt className="text-text-muted">Predicted</dt><dd className="tabular-nums"><span className="text-red-alliance">{Math.round(p.redMean)}</span> – <span className="text-blue-alliance">{Math.round(p.blueMean)}</span></dd></>}
        {played && <><dt className="text-text-muted">Actual</dt><dd className="tabular-nums"><span className="text-red-alliance">{m.red.score!.total}</span> – <span className="text-blue-alliance">{m.blue.score!.total}</span></dd></>}
        {played && !p.noScoreBasis && <><dt className="text-text-muted">Off by</dt><dd className="tabular-nums">red {signed(m.red.score!.total - p.redMean)}, blue {signed(m.blue.score!.total - p.blueMean)}</dd></>}
        {called != null && <><dt className="text-text-muted">Call</dt><dd className={called ? "text-success" : "text-warning"}>{called ? "Called it" : "Upset"}</dd></>}
      </dl>
      {p.factors?.length ? <><p className="mt-3 text-xs font-medium text-text-muted">Why</p><FactorList factors={p.factors} className="mt-1.5" /></> : null}
      <CalibrationLine pRed={p.pRed} compact className="mt-3" />
    </section>
  );
}
