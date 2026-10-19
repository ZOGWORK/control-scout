// The event page hero's "At a glance" card: the call record as the headline, then a dense grid of event
// stats (progress, scoring, close games, penalties, upsets, category leaders, what's next or how it ended)
// computed from the detail already loaded (lib/eventGlance.ts). Stats that don't apply are left out.
// Two columns once the card is wide enough (a container query), one on a phone.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Trophy } from "lucide-react";
import type { EventDetail, MatchView } from "../shared/api";
import { matchReportHref } from "../shared/matchReport";
import { glanceStats, type GlanceStats, type Phase } from "../lib/eventGlance";
import { usePredictable } from "../lib/meta";
import { dateRange, matchTime, num } from "../lib/format";
import { Button } from "./ui/button";
import { Meter, TONES, type Tone } from "./StatTile";
import { cn } from "./cn";

const PHASE: Record<Phase, string> = { upcoming: "Not started", quals: "Qualification", playoffs: "Playoffs", done: "Complete" };

/** A team number in the house style (bold mono), linking to its page for this season. */
export function TeamNo({ team, season, className }: { team: number; season: number; className?: string }) {
  return <Link to={`/teams/${team}?season=${season}`} className={cn("font-mono font-semibold tabular-nums hover:text-accent-text", className)}>{team}</Link>;
}

/** One stat cell. In a narrow card (a phone) it's a one-line row, label left and value right; from 22rem
 *  it's a small tile (label over value) in a grid of 2, from 25rem of 3. `wide` spans the whole row. */
function Cell({ label, children, hint, wide, tone, testId }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean; tone?: Tone; testId?: string }) {
  return (
    <div data-glance={testId} className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 border-t border-border/60 py-1.5 @min-[22rem]:grid-cols-1 @min-[22rem]:content-start @min-[22rem]:pb-0 @min-[22rem]:pt-2", wide && "@min-[22rem]:col-span-full")}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tone && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONES[tone].bar)} />}{label}
      </dt>
      <dd className="min-w-0 text-right text-sm font-semibold tabular-nums text-foreground [overflow-wrap:anywhere] @min-[22rem]:mt-0.5 @min-[22rem]:text-left">{children}</dd>
      {hint && <dd className="col-span-full min-w-0 text-right text-xs text-muted-foreground [overflow-wrap:anywhere] @min-[22rem]:text-left">{hint}</dd>}
    </div>
  );
}

const pctCall = (p: number) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`;

/** Live mode: the match the LIVE panel counts down to (the user's teams' next one when they have one, else the
 *  event's), so "Next match" here names the same match the panel opens on. */
export interface GlanceLive { match: MatchView | null; mine: boolean; open: () => void }

export function EventGlance({ d, onTab, live }: { d: EventDetail; onTab: (t: string) => void; live?: GlanceLive }) {
  const predictable = usePredictable(d.event.season);
  const e = d.event;
  const s: GlanceStats = glanceStats(d);
  const season = e.season;
  const seed1 = d.field.find((f) => f.rank === 1) ?? null;
  const topOpr = [...d.field].filter((f) => f.opr.np != null).sort((a, b) => b.opr.np! - a.opr.np!)[0] ?? null;
  // inline-block with padding offset by negative margin: a 24px-tall target (WCAG 2.5.8) in the same line box.
  const reportLink = (key: string, children: ReactNode) => <Link to={matchReportHref({ season, code: e.code, key })} className="-my-1 inline-block py-1 hover:text-accent-text">{children}</Link>;

  const cells: ReactNode[] = [];
  const next = live ? live.match : s.next;
  if (next) {
    const when = matchTime(next.startsAt ?? next.time);
    const body = <>{next.label}{when && <span className="font-normal text-muted-foreground"> · {when}</span>} <ArrowRight className="inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden /></>;
    cells.push(<Cell key="next" testId="next" label={live?.mine ? "Your next match" : "Next match"} wide>
      {live ? <button type="button" onClick={live.open} className="text-left hover:text-accent-text">{body}</button> : <Link to={`?tab=matches&match=${encodeURIComponent(next.key)}`} className="hover:text-accent-text">{body}</Link>}
    </Cell>);
  }
  if (s.avgScore != null) cells.push(<Cell key="avg" testId="avg-score" label="Avg alliance score">{num(s.avgScore)}</Cell>);
  if (s.avgMargin != null) cells.push(<Cell key="margin" testId="avg-margin" label="Avg winning margin">{num(s.avgMargin)}</Cell>);
  if (s.high) cells.push(<Cell key="high" testId="high" label="High score" tone="accent"
    hint={<>{s.high.teams.map((t, i) => <span key={t}>{i > 0 && " · "}<TeamNo team={t} season={season} className="font-medium" /></span>)}</>}>
    {reportLink(s.high.key, <>{s.high.score} <span className="font-normal text-muted-foreground">in {s.high.label}{e.remote ? "" : `, ${s.high.alliance}`}</span></>)}
  </Cell>);
  if (s.closest) cells.push(<Cell key="closest" testId="closest" label="Closest match">
    {reportLink(s.closest.key, <>{s.closest.label} <span className="font-normal text-muted-foreground">{s.closest.margin === 0 ? "tie" : `by ${s.closest.margin}`}</span></>)}
  </Cell>);
  if (s.avgPenalty != null) cells.push(<Cell key="pen" testId="penalties" label="Penalties / match">{num(s.avgPenalty)} <span className="font-normal text-muted-foreground">pts</span></Cell>);
  if (s.upsets) {
    const u = s.upsets;
    cells.push(<Cell key="upsets" testId="upsets" label={u.kind === "live" ? "Upsets (live calls)" : "Upsets (replayed)"}
      hint={u.biggest ? <>Biggest: {reportLink(u.biggest.key, u.biggest.label)} ({pctCall(u.biggest.pFav)} favourite lost)</> : "Every favourite won"}>
      {u.n} <span className="font-normal text-muted-foreground">of {u.of}</span>
    </Cell>);
  }
  const leaders: [string, keyof GlanceStats["leaders"], Tone][] = [["Top auto", "auto", "sky"], ["Top TeleOp", "teleop", "violet"], ["Top endgame", "endgame", "amber"]];
  for (const [label, k, tone] of leaders) {
    const l = s.leaders[k];
    if (l) cells.push(<Cell key={k} testId={`top-${k}`} label={label} tone={tone}><TeamNo team={l.team} season={season} /> <span className="font-normal text-muted-foreground">{num(l.value)}</span></Cell>);
  }
  if (s.strongest.length) cells.push(<Cell key="strongest" testId="strongest" label="Strongest by rating" wide tone="accent">
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">{s.strongest.map((t) => <span key={t.team}><TeamNo team={t.team} season={season} /> <span className="font-normal text-muted-foreground">{num(t.value)}</span></span>)}</span>
  </Cell>);
  if (s.avgSeasonOpr != null) cells.push(<Cell key="field-opr" testId="avg-season-opr" label="Avg team OPR" hint="this season so far">{num(s.avgSeasonOpr)}</Cell>);

  // How it ended and who stood out: near the top of the grid.
  const lead: ReactNode[] = [];
  if (s.winners) lead.push(<Cell key="won" testId="won" label="Won by" wide tone="accent">
    {s.winners.alliance != null && <><span className="font-normal text-muted-foreground">Alliance {s.winners.alliance}</span>{" "}</>}
    {s.winners.teams.map((t, i) => <span key={t}>{i > 0 && <span className="font-normal text-muted-foreground"> · </span>}<TeamNo team={t} season={season} /></span>)}
  </Cell>);
  if (s.inspire) lead.push(<Cell key="inspire" testId="inspire" label="Inspire" hint={s.inspire.name}><TeamNo team={s.inspire.team} season={season} /></Cell>);
  if (seed1) lead.push(<Cell key="seed" testId="seed" label="#1 seed" hint={seed1.name}><TeamNo team={seed1.team} season={season} /></Cell>);
  if (topOpr) lead.push(<Cell key="opr" testId="top-opr" label="Top OPR"><TeamNo team={topOpr.team} season={season} /> <span className="font-normal text-muted-foreground">{topOpr.opr.np!.toFixed(1)}</span></Cell>);
  cells.splice(next ? 1 : 0, 0, ...lead); // after the next match (live), before the scoring stats
  if (d.advancement?.slots) cells.push(<Cell key="adv" testId="advancing" label="Advancing" wide>
    <button type="button" onClick={() => onTab(predictable ? "odds" : "awards")} className="text-left hover:text-accent-text">
      {d.advancement.slots} slots{d.advancement.advancesTo ? <span className="font-normal text-muted-foreground"> → {d.advancement.advancesTo}</span> : null}
    </button>
  </Cell>);

  const oddsButton = predictable && e.status !== "finished";
  return (
    <div className="@container flex min-w-0 flex-col rounded-xl border border-border/70 bg-background/40 p-4 backdrop-blur-sm" data-glance-card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">At a glance</p>
        <span data-glance="phase" className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {s.ended ? `Ended ${dateRange(s.ended)}` : PHASE[s.phase]}
        </span>
      </div>
      {s.record.length > 0 ? (
        // Live calls and backtest replays are never blended: one line each, named.
        <button type="button" onClick={() => onTab("matches")} className="mt-2 block w-full space-y-1 text-left">
          {s.record.map((x, i) => (
            <span key={x.kind} className="block">
              <span className={cn("font-display font-semibold tabular-nums", i === 0 ? "text-3xl text-accent-text" : "text-lg")}>{Math.round((x.right / x.n) * 100)}%</span>
              <span className="ml-2 text-sm text-muted-foreground">of {x.n} {x.kind === "live" ? "calls made before the match" : "matches predicted from earlier data (replayed)"}</span>
            </span>
          ))}
          <span className="sr-only">: see the matches</span>
        </button>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {!predictable ? "Results, rankings and awards from the official record." : e.status === "upcoming" ? "Every match here gets a prediction before it's played, scored afterwards on the public track record." : "No decided matches with predictions here yet."}
        </p>
      )}
      {(s.progress || s.teams > 0) && (
        <div data-glance="progress" className="mt-3">
          <p className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <span>{s.progress ? <><span className="text-sm font-semibold tabular-nums text-foreground">{s.progress.played}</span> / <span className="tabular-nums">{s.progress.total}</span> matches played</> : "No schedule yet"}</span>
            {s.teams > 0 && <span><span className="text-sm font-semibold tabular-nums text-foreground">{s.teams}</span> teams</span>}
          </p>
          {s.progress && <div className="mt-1.5"><Meter parts={[{ pc: (s.progress.played / s.progress.total) * 100, cls: "bg-accent" }]} /></div>}
        </div>
      )}
      {cells.length > 0 && <dl className="mt-3 grid grid-cols-1 gap-x-4 @min-[22rem]:grid-cols-2 @min-[22rem]:gap-y-2.5 @min-[25rem]:grid-cols-3">{cells}</dl>}
      {oddsButton && (
        <div className="mt-auto pt-3">
          <Button size="sm" className="w-full" onClick={() => onTab("odds")}>
            <Trophy /> {d.forecastUnsupported ? "See the match predictions" : "Who advances? See the odds"}
          </Button>
        </div>
      )}
    </div>
  );
}
