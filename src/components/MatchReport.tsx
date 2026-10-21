// "Know your match" (v1.6 Task 2): the pre-match scouting report's body. The win prediction on top (never
// without its confidence tier), then red and blue, each team as one card: OPR with its auto / driver-
// controlled / endgame split, rank here and this season, the OPR trend, watch-list flags, and the
// workspace's consensus (top ratings, strengths, weaknesses) for members. Without a workspace, or with no
// entries yet, the cards are OPR-only: never empty, and members always get a "Scout this team" link.
// The page around it: src/pages/MatchReportPage.tsx. The rules: src/shared/matchReport.ts.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardList, Eye, Flag, Star, ThumbsDown, ThumbsUp, TrendingUp, Waves } from "lucide-react";
import type { MatchView } from "../shared/api";
import type { TeamConsensus } from "../shared/consensus";
import { MIN_EVENT_MATCHES, type DataFlag, type MatchReport, type MatchReportWorkspace, type OprSplit, type ReportTeam, type WatchFlag } from "../shared/matchReport";
import type { WorkspaceAnswer } from "../lib/consensus";
import { scoutTeamHref } from "../lib/consensus";
import { workspaceLabel } from "../lib/scoutSpace";
import { agoShort, int, num, oddsPct } from "../lib/format";
import { ConfidenceBadge, FactorList, KIND_LABEL, TierMark, WinBar } from "./predict";
import { OprSpark, PARTS } from "./shortlist/charts";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";
import { Skeleton } from "./ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/controls";
import { cn } from "./cn";
import { blendedIndex, type Reliability } from "../shared/reliability";
import { ScoreRange } from "./ScoreRange";
import { levelPct } from "../shared/scoreRange";

type Side = "red" | "blue";
const SIDE: Record<Side, { name: string; text: string; card: string; edge: string }> = {
  red: { name: "Red", text: "text-red-alliance", card: "border-red-alliance/30 bg-red-alliance/[0.04]", edge: "border-l-red-alliance" },
  blue: { name: "Blue", text: "text-blue-alliance", card: "border-blue-alliance/30 bg-blue-alliance/[0.04]", edge: "border-l-blue-alliance" },
};

export interface ReportWorkspaceProps {
  ws: WorkspaceAnswer<MatchReportWorkspace> | null;
  watch: ReadonlyMap<number, WatchFlag[]>;
}

/** The whole report: prediction, then each alliance's teams. */
export function MatchReportView({ r, ws, watch }: { r: MatchReport } & ReportWorkspaceProps) {
  const m = r.match;
  const byTeam = new Map(r.teams.map((t) => [t.team, t]));
  // A refusal (not a member any more, paused) or a failure: OPR-only, as for anyone without a workspace.
  const workspace = ws && !ws.state.error ? ws : null;
  return (
    <div className="space-y-5 max-sm:space-y-4">
      <Call m={m} />
      <WorkspaceLine ws={ws} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(["red", "blue"] as const).map((side) => (
          <Alliance key={side} side={side} m={m} remote={r.event.remote} byTeam={byTeam} ws={workspace} watch={watch} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        OPR is the points a robot adds to its alliance's score, worked out from every match it played (without penalties). The split is
        auto, driver-controlled and endgame. Tap a flag to see why it's there.
      </p>
    </div>
  );
}

/** The prediction (or, once played, the result next to the call made before it). */
function Call({ m }: { m: MatchView }) {
  const p = m.prediction;
  const scored = m.played && m.red.score && m.blue.score ? { red: m.red.score.total, blue: m.blue.score.total } : null;
  const winner: Side | "tie" | null = scored ? (scored.red === scored.blue ? "tie" : scored.red > scored.blue ? "red" : "blue") : null;
  const called = p && winner && winner !== "tie" ? (p.pRed > 0.5) === (winner === "red") : null;
  const full = [m.red, m.blue].every((a) => a.teams.filter((t) => t.onField).length === 2);
  return (
    <section aria-label={scored ? "Result and prediction" : "Prediction"} className="rounded-xl border border-border bg-card p-4">
      {scored && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3" data-testid="report-result">
          <span className="text-sm text-muted-foreground">Final</span>
          <span className="font-display text-3xl font-bold tabular-nums"><span className="text-red-alliance">{scored.red}</span><span className="px-1.5 text-muted-foreground">–</span><span className="text-blue-alliance">{scored.blue}</span></span>
          <span className={cn("text-sm font-semibold", winner === "red" ? "text-red-alliance" : winner === "blue" ? "text-blue-alliance" : "text-muted-foreground")}>{winner === "tie" ? "Tie" : `${SIDE[winner!].name} won`}</span>
          {called != null && <span className={cn("rounded-full px-2 py-px text-xs font-medium", called ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>{called ? "Called it" : "Upset"}</span>}
        </div>
      )}
      {p ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{KIND_LABEL[p.kind]}</p>
            <ConfidenceBadge tier={p.tier} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="w-11 text-right text-base font-semibold tabular-nums text-red-alliance">{oddsPct(p.pRed)}</span>
            <WinBar pRed={p.pRed} className="flex-1" />
            <span className="w-11 text-base font-semibold tabular-nums text-blue-alliance">{oddsPct(1 - p.pRed)}</span>
          </div>
          {!p.noScoreBasis && (
            <p className="mt-2 text-sm text-muted-foreground">Predicted score <ScoreRange mean={p.redMean} range={p.redRange} level={p.rangeLevel} className="text-red-alliance" /> – <ScoreRange mean={p.blueMean} range={p.blueRange} level={p.rangeLevel} className="text-blue-alliance" />
              {p.redRange && p.blueRange && <span className="block text-xs">± is the {levelPct(p.rangeLevel)} range: red {p.redRange[0]}–{p.redRange[1]}, blue {p.blueRange[0]}–{p.blueRange[1]}. About {Math.round((p.rangeLevel ?? 0.8) * 10)} in 10 real scores land inside.</span>}</p>
          )}
          {p.factors?.length ? (
            <details className="group mt-2" open>
              <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">Why</summary>
              <FactorList factors={p.factors.slice(0, 3)} reasons={p.reasons} className="mt-1.5" />
            </details>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{!full ? "No prediction: the engine predicts full 2-against-2 matches only." : scored ? "No prediction was recorded before this match." : "No prediction for this match yet."}</p>
      )}
    </section>
  );
}

/** Whose scouting this is (members), or what's missing for it. */
function WorkspaceLine({ ws }: { ws: ReportWorkspaceProps["ws"] }) {
  if (!ws) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-testid="opr-only">
        OPR and data flags only. Members of a scouting workspace also see what their scouts noted on each team here.
      </p>
    );
  }
  const name = workspaceLabel(ws.workspace);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">
        {ws.state.error
          ? <>Couldn't load {name}'s scouting just now, so this is OPR only. It's asked again in a minute.</>
          : <>Scouting from <span className="font-medium text-foreground">{name}</span>. Only its members see it.</>}
      </span>
      {ws.workspaces.length > 1 && (
        <Select value={ws.workspace.id} onValueChange={ws.select}>
          <SelectTrigger size="sm" aria-label="Workspace" className="h-9 max-w-[12rem] max-sm:h-10"><SelectValue /></SelectTrigger>
          <SelectContent>{ws.workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{workspaceLabel(w)}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}

function Alliance({ side, m, remote, byTeam, ws, watch }: {
  side: Side; m: MatchView; remote: boolean; byTeam: ReadonlyMap<number, ReportTeam>;
} & ReportWorkspaceProps) {
  const a = m[side];
  const s = SIDE[side];
  const p = m.prediction;
  const score = m.played && a.score ? a.score.total : null;
  const missing = 2 - a.teams.length;
  return (
    <section aria-label={`${s.name} alliance`} className={cn("min-w-0 rounded-xl border p-3 sm:p-4", s.card)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className={cn("font-display text-lg font-semibold", s.text)}>{s.name} alliance</h2>
        <p className="text-sm tabular-nums text-muted-foreground">
          {score != null ? <>Scored <span className={cn("font-semibold", s.text)}>{score}</span></>
            : p ? <>{oddsPct(side === "red" ? p.pRed : 1 - p.pRed)} to win{!p.noScoreBasis && <> · <ScoreRange mean={side === "red" ? p.redMean : p.blueMean} range={side === "red" ? p.redRange : p.blueRange} level={p.rangeLevel} approx /> pts</>} <TierMark tier={p.tier} className="align-middle" /></> : null}
        </p>
      </div>
      <ul className="space-y-3">
        {a.teams.map((t) => {
          const info = byTeam.get(t.number);
          return (
            <li key={t.number}>
              <TeamCard side={side} season={m.season} t={t} info={info ?? null} ws={ws} watch={watch.get(t.number) ?? []} />
            </li>
          );
        })}
        {missing > 0 && Array.from({ length: missing }, (_, i) => (
          <li key={`missing-${i}`} className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground" data-testid="missing-team">
            {a.teams.length === 0
              ? (remote ? "No alliance here: remote events score one robot at a time." : "Lineup not published yet.")
              : (remote ? "Remote event: this robot plays on its own." : "No second robot on this alliance.")}
          </li>
        ))}
      </ul>
    </section>
  );
}

const FLAG_ICON: Record<DataFlag["kind"] | WatchFlag["kind"], typeof Flag> = {
  mine: Star, assigned: ClipboardList, picklist: Flag, tracked: Eye,
  penalties: AlertTriangle, inconsistent: Waves, rising: TrendingUp,
};
const FLAG_TONE: Record<DataFlag["kind"] | WatchFlag["kind"], string> = {
  mine: "border-accent/50 bg-accent/15 text-accent-text",
  assigned: "border-accent/50 bg-accent/15 text-accent-text",
  picklist: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  tracked: "border-border bg-muted text-foreground",
  penalties: "border-danger/40 bg-danger/10 text-danger",
  inconsistent: "border-warning/40 bg-warning/10 text-warning",
  rising: "border-success/40 bg-success/10 text-success",
};

/** One flag: a chip that opens its reason on tap or click. */
function FlagChip({ f }: { f: DataFlag | WatchFlag }) {
  const Icon = FLAG_ICON[f.kind];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium", FLAG_TONE[f.kind])} aria-label={`${f.label}: ${f.detail}`} data-flag={f.kind}>
          <Icon className="size-3.5" aria-hidden />{f.label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-sm">{f.detail}</PopoverContent>
    </Popover>
  );
}

function TeamCard({ side, season, t, info, ws, watch }: {
  side: Side; season: number; t: MatchView["red"]["teams"][number]; info: ReportTeam | null;
  ws: ReportWorkspaceProps["ws"]; watch: WatchFlag[];
}) {
  const ev = info?.event ?? null, se = info?.season ?? null;
  // The OPR that says most about this match: this event's, once it has a few matches here; else the season's.
  const here = ev && ev.opr.np != null && (ev.qualPlayed ?? 0) >= MIN_EVENT_MATCHES;
  const opr = here ? ev!.opr : se?.opr ?? null;
  const flags: (DataFlag | WatchFlag)[] = [...watch, ...(info?.flags ?? [])];
  return (
    <article className={cn("min-w-0 rounded-lg border border-l-[3px] border-border bg-card p-3", SIDE[side].edge, !t.onField && "opacity-75")} data-testid="report-team" data-team={t.number}>
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link to={`/teams/${t.number}?season=${season}`} className="font-mono text-lg font-bold hover:underline">{t.number}</Link>
        <span className="min-w-0 flex-1 truncate text-sm">{info?.name ?? ""}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {ev?.rank ? <>#{ev.rank} here{ev.wins != null && <> · {ev.wins}-{ev.losses ?? 0}-{ev.ties ?? 0}</>}</> : "Unranked here"}
        </span>
      </header>
      {(t.surrogate || t.dq || !t.onField) && (
        <p className="mt-1 flex gap-1.5 text-[11px]">
          {t.surrogate && <span className="rounded bg-muted px-1">Surrogate</span>}
          {t.dq && <span className="rounded bg-destructive/15 px-1 text-destructive">DQ</span>}
          {!t.onField && <span className="rounded bg-muted px-1">Not on field</span>}
        </p>
      )}
      {flags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${t.number} flags`}>{flags.map((f) => <FlagChip key={f.kind} f={f} />)}</div>}

      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
        <div>
          <p className="text-[11px] text-muted-foreground">{here ? "OPR here" : "Season OPR"}</p>
          <p className="font-display text-2xl font-semibold leading-tight tabular-nums">{num(opr?.np)}</p>
        </div>
        <OprSplitBar opr={opr} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {here
          ? (se ? <>Season <span className="text-foreground">{num(se.opr.np)}</span></> : "No other events this season")
          : ev?.opr.np != null ? <>Here so far <span className="text-foreground">{num(ev.opr.np)}</span> ({int(ev.qualPlayed ?? 0)} {ev.qualPlayed === 1 ? "match" : "matches"})</> : "No matches here yet"}
        {se?.rank && se.of ? <> · #{int(se.rank)} of {int(se.of)} this season</> : null}
        {se && <> · {se.wins}-{se.losses}-{se.ties}</>}
        {/* Penalty OPR can come out below zero (a team that draws fewer than average): only a real giveaway is worth a line. */}
        {opr?.pen != null && opr.pen >= 0.5 && <> · gives away <span className="text-foreground">{num(opr.pen)}</span> pen. pts a match</>}
      </p>
      {info?.reliability && <ReliabilityLine r={info.reliability} />}
      {info && info.trend.length >= 2 && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">OPR by event</span>
          <OprSpark className="w-32 shrink-0" events={info.trend.map((x) => ({ code: x.code, name: x.name, start: x.start, rank: null, opr: x.opr, auto: null, teleop: null, endgame: null, avgNp: null }))} width={128} height={24} />
          <span className="text-[11px] tabular-nums text-muted-foreground">{num(info.trend[0].opr)} → {num(info.trend[info.trend.length - 1].opr)}</span>
        </div>
      )}
      <TeamTake team={t.number} season={season} ws={ws} reliability={info?.reliability ?? null} />
    </article>
  );
}

/** Auto / driver-controlled / endgame, as one bar with the numbers under it. */
function OprSplitBar({ opr }: { opr: OprSplit | null }) {
  if (!opr || (opr.auto == null && opr.teleop == null && opr.endgame == null)) return <p className="text-xs text-muted-foreground">No OPR split yet.</p>;
  const v = { auto: Math.max(0, opr.auto ?? 0), teleop: Math.max(0, opr.teleop ?? 0), endgame: Math.max(0, opr.endgame ?? 0) };
  const sum = v.auto + v.teleop + v.endgame;
  return (
    <div className="min-w-0">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={PARTS.map((p) => `${p.label} ${num(opr[p.k])}`).join(", ")}>
        {sum > 0 && PARTS.map((p) => v[p.k] > 0 && <div key={p.k} className="h-full" style={{ width: `${(v[p.k] / sum) * 100}%`, background: p.fill }} />)}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-2.5 text-[11px] tabular-nums text-muted-foreground">
        {PARTS.map((p) => (
          <span key={p.k} className="inline-flex items-center gap-1"><span aria-hidden className="size-1.5 rounded-full" style={{ background: p.fill }} />{p.short} <span className="text-foreground">{num(opr[p.k])}</span></span>
        ))}
      </p>
    </div>
  );
}

const avg = (x: { avg: number }) => (Number.isInteger(x.avg) ? String(x.avg) : x.avg.toFixed(1));

/** The workspace's take on one team: nothing without a workspace (OPR-only), else consensus or a way to start. */
/** The public reliability estimate (match data only), with what it rests on. */
function ReliabilityLine({ r }: { r: Reliability }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground" data-testid="report-reliability">
      Reliability (est.) <span className="font-medium text-foreground">{r.index}/100</span>{r.fieldIndex != null && <> · field {r.fieldIndex}</>}
      {" "}· last {r.recent.matches}: {r.recent.noShows} no-show{r.recent.noShows === 1 ? "" : "s"}, {r.recent.nearZero} near-zero
    </p>
  );
}

function TeamTake({ team, season, ws, reliability }: { team: number; season: number; ws: ReportWorkspaceProps["ws"]; reliability: Reliability | null }) {
  if (!ws) return null;
  const d: TeamConsensus | undefined = ws.state.data?.teams.find((x) => x.team === team);
  const scout = (
    <Link to={scoutTeamHref(ws.workspace.id, team, season)} className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-accent-text underline-offset-4 hover:underline">
      <ClipboardList className="size-3.5" aria-hidden /> Scout this team
    </Link>
  );
  if (!d) return <Skeleton className="mt-3 h-12 w-full rounded-lg" />;
  if (!d.entries) {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 border-t border-border pt-2 text-xs text-muted-foreground" data-testid="no-scouting">
        <span>No scouting on {team} yet.</span>{scout}
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-2" data-testid="team-take">
      <p className="text-[11px] text-muted-foreground">
        Your scouts: {int(d.entries)} {d.entries === 1 ? "entry" : "entries"} by {int(d.scouts)} {d.scouts === 1 ? "scout" : "scouts"}{d.lastUpdated ? ` · ${agoShort(d.lastUpdated)}` : ""}
      </p>
      {reliability && d.reliabilityNotes && (
        <p className="text-[11px] text-muted-foreground" data-testid="report-reliability-blended">
          Reliability with your notes <span className="font-medium text-foreground">{blendedIndex(reliability, d.reliabilityNotes)}/100</span> · {d.reliabilityNotes.flagged} of {d.reliabilityNotes.matchEntries} match entries marked broken or disabled (only your workspace sees this)
        </p>
      )}
      {d.ratings.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-3">
          {d.ratings.slice(0, 3).map((x) => (
            <div key={`${x.kind}:${x.id}`} className="flex min-w-0 items-baseline justify-between gap-1.5">
              <dt className="truncate text-muted-foreground">{x.label}</dt>
              <dd className="shrink-0 font-medium tabular-nums">{avg(x)}<span className="font-normal text-muted-foreground">/{x.max}</span></dd>
            </div>
          ))}
        </dl>
      )}
      <TagRow icon={<ThumbsUp className="size-3.5 text-success" aria-hidden />} label="Strengths" tags={d.strengths} tone="border-success/30 bg-success/[0.08]" />
      <TagRow icon={<ThumbsDown className="size-3.5 text-danger" aria-hidden />} label="Weaknesses" tags={d.weaknesses} tone="border-danger/30 bg-danger/[0.08]" />
      {!d.strengths.length && !d.weaknesses.length && d.tags.length > 0 && <TagRow label="Most noted" tags={d.tags} tone="border-border bg-muted/50" />}
      <div className="flex justify-end">{scout}</div>
    </div>
  );
}

function TagRow({ icon, label, tags, tone }: { icon?: ReactNode; label: string; tags: TeamConsensus["strengths"]; tone: string }) {
  if (!tags.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">{icon}{label}</span>
      <ul className="contents" aria-label={label}>
        {tags.slice(0, 3).map((x) => (
          <li key={x.label} className={cn("inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-xs", tone)}>
            <span className="break-words">{x.label}</span><span className="font-mono text-[10px] text-muted-foreground" aria-label={`${x.count} ${x.count === 1 ? "entry" : "entries"}`}>×{x.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
