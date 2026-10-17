// The event page's LIVE panel (v1.6 Task 3): shown while an event is running (lib/liveMode.ts). A
// countdown to the next match for the teams that matter to you (your team, teams assigned to you in
// your workspace, your tracked teams), who's in it, red and blue, and the win prediction with its
// confidence tier. How fresh the results are, and a manual check for the impatient.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import type { EventDetail, MatchView } from "../shared/api";
import { matchReportHref } from "../shared/matchReport";
import { usePersonal } from "../lib/personal";
import { useFlag } from "../lib/flags";
import { readRememberedSpace, resolveScoutSpace, workspacesOf } from "../lib/scoutSpace";
import { useAssignments } from "../lib/assignments";
import { countdownWords, formatCountdown, nextMatch, pollInterval, REASON_LABEL, relevantTeams, venueClock, type RelevantReason } from "../lib/liveMode";
import { agoSeconds, oddsPct } from "../lib/format";
import { Button } from "./ui/button";
import { TierMark, WinBar } from "./predict";
import { cn } from "./cn";
import { LivestreamButton, TrackEventButton, type TrackControl } from "./EventActions";

export interface RefreshControl { busy: boolean; note: string | null; at: number; run: () => Promise<unknown> }

/**
 * Teams assigned to me at this event, in my active workspace (the scout space this device last showed,
 * resolved as the Scout page does). Fetched once when the panel opens; none when signed out, workspace
 * scouting is off, or Personal is the active space.
 */
export function useMyAssignedTeams(season: number, code: string, on: boolean): number[] {
  const { user } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const me = user?.controlPoint?.accountId ?? null;
  const space = useMemo(() => {
    const { list, known } = workspacesOf(user);
    return resolveScoutSpace({ signedIn: !!user, enabled, workspaces: list, known, account: user?.id ?? null, url: null, remembered: readRememberedSpace() }).space;
  }, [user, enabled]);
  const { list } = useAssignments(on && me != null ? space : null, season, "off");
  return useMemo(() => {
    const ev = code.toUpperCase();
    if (!on) return [];
    return list.filter((a) => a.assigneeAccountId === me && a.season === season && a.eventCode.toUpperCase() === ev).map((a) => a.team);
  }, [list, me, season, code, on]);
}

export interface LiveTarget {
  /** The relevant teams at this event, and why each one is. */
  teams: ReadonlyMap<number, RelevantReason>;
  /** The next unplayed match for one of them. */
  mine: MatchView | null;
  /** What the countdown shows: `mine`, else the event's next match. */
  next: MatchView | null;
}

/** What the LIVE panel counts down to (lib/liveMode.ts has the rules). `on`: live mode (else nothing is fetched). */
export function useLiveTarget(d: EventDetail, on: boolean): LiveTarget {
  const { state } = usePersonal();
  const assigned = useMyAssignedTeams(d.event.season, d.event.code, on);
  const reasons = useMemo(() => relevantTeams({ myTeam: state.myTeam, tracked: state.tracked.teams, assigned }), [state.myTeam, state.tracked.teams, assigned]);
  const teams = useMemo(() => {
    const here = new Set(d.field.map((f) => f.team));
    for (const m of d.matches) for (const t of [...m.red.teams, ...m.blue.teams]) here.add(t.number);
    return new Map([...reasons].filter(([t]) => here.has(t)));
  }, [reasons, d.field, d.matches]);
  return useMemo(() => {
    const mine = teams.size ? nextMatch(d.matches, teams) : null;
    return { teams, mine, next: mine ?? nextMatch(d.matches, null) };
  }, [teams, d.matches]);
}

/** The clock for the countdown: ticks every second only while there's a time to count down to. */
function useSecondClock(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

/** `track`: the page's tracked state and toggle for this event, shown beside the panel's other actions. */
export function LivePanel({ d, target, refresh, track }: { d: EventDetail; target: LiveTarget; refresh: RefreshControl; track?: TrackControl }) {
  const e = d.event;
  const live = d.live!;
  const { teams: atEvent, mine, next: any } = target;
  const at = any?.startsAt ? Date.parse(any.startsAt) : NaN;
  const now = useSecondClock(Number.isFinite(at) || !!live.checkedAt);
  const left = Number.isFinite(at) ? at - now : NaN;
  const countdown = Number.isFinite(left) ? formatCountdown(left) : null;
  const clock = any ? venueClock(any, e.timezone) : null;
  const every = Math.round(pollInterval(d) / 1000);
  const title = mine ? "Up next for you" : atEvent.size ? "Your teams are done for now" : "Next match";

  return (
    <section aria-labelledby="live-now" className="mt-4 rounded-xl border border-destructive/35 bg-destructive/[0.06] p-3 sm:p-4" data-live-panel>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="live-now" className="inline-flex items-center gap-2 font-display text-lg font-bold tracking-wide text-destructive">
          <span aria-hidden className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
          </span>
          LIVE
        </h2>
        <span className="text-xs text-muted-foreground">
          {live.checkedAt ? <>Results updated <time dateTime={live.checkedAt} className="tabular-nums">{agoSeconds(live.checkedAt, Math.max(now, refresh.at))}</time></> : "Results not checked yet today"}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void refresh.run()} disabled={refresh.busy} aria-busy={refresh.busy}>
          {refresh.busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {refresh.busy ? "Checking…" : "Check now"}
        </Button>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {any ? (
          <>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono text-2xl font-bold">{any.label}</span>
              {countdown ? (
                <span className="font-display text-3xl font-bold tabular-nums text-foreground sm:text-4xl" role="timer" aria-label={`Starts in ${countdownWords(left)}`}>
                  <span className="mr-1.5 text-base font-medium text-muted-foreground">in</span>{countdown}
                </span>
              ) : Number.isFinite(left) ? (
                <span className="text-base font-semibold text-foreground">Due now</span>
              ) : null}
              {clock && <span className="text-xs text-muted-foreground">{Number.isFinite(at) ? `${clock} venue time` : `Scheduled ${clock}`}</span>}
            </div>
            {!Number.isFinite(at) && <p className="mt-0.5 text-xs text-muted-foreground">{any.time ? "No time zone for this event, so no countdown." : "No start time published for this match."}</p>}
            <Lineup m={any} reasons={atEvent} />
            <Call m={any} />
          </>
        ) : (
          <p className="mt-1 text-sm text-foreground">{d.matches.length ? "Every scheduled match has a result. Playoffs or awards may still come." : "No schedule published yet. It appears here as soon as FIRST posts it."}</p>
        )}
        {/* The panel's actions, together where the eye already is: the next match's scouting report (v1.6 Task 2),
            the stream and tracking. While live they appear only here; the header below drops its copies. */}
        <div className="mt-2.5 flex flex-wrap gap-2 empty:hidden" data-live-actions>
          {any && (
            <Button variant="secondary" size="sm" asChild className="max-sm:h-10 max-sm:basis-full">
              <Link to={matchReportHref(any)} data-live-report><ClipboardList /> Know your match</Link>
            </Button>
          )}
          <LivestreamButton url={e.livestream} className="max-sm:h-10 max-sm:flex-1" />
          {track && <TrackEventButton track={track} className="max-sm:h-10 max-sm:flex-1" />}
        </div>
        {!mine && (atEvent.size ? (
          <p className="mt-2 text-xs text-muted-foreground">No more scheduled matches for {[...atEvent.keys()].join(", ")}{any ? ", so this is the event's next match" : ""}.</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Set <Link to="/settings" className="underline underline-offset-2 hover:text-foreground">your team</Link> or track a team here to count down to its matches.</p>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {every ? `Scores and rankings refresh on their own every ${every} s while this tab is open.` : "Check now to look for new results."}
      </p>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground empty:hidden">{refresh.note}</p>
    </section>
  );
}

/** Red and blue, side by side (stacked on phones), with the teams that matter to you marked. */
function Lineup({ m, reasons }: { m: MatchView; reasons: ReadonlyMap<number, RelevantReason> }) {
  return (
    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {(["red", "blue"] as const).map((side) => (
        <div key={side} className={cn("flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border-l-[3px] px-2.5 py-1.5",
          side === "red" ? "border-red-alliance bg-red-alliance/[0.08]" : "border-blue-alliance bg-blue-alliance/[0.08]")}>
          <span className={cn("text-[11px] font-semibold", side === "red" ? "text-red-alliance" : "text-blue-alliance")}>{side === "red" ? "Red" : "Blue"}</span>
          {m[side].teams.length ? m[side].teams.map((t) => {
            const why = reasons.get(t.number);
            return (
              <Link key={t.number} to={`/teams/${t.number}?season=${m.season}`}
                className={cn("inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-mono text-sm hover:underline", why ? "bg-accent/15 font-bold text-accent-text ring-1 ring-accent/60" : "text-foreground")}>
                {t.number}{why && <span className="font-sans text-[10px] font-medium">{REASON_LABEL[why]}</span>}
              </Link>
            );
          }) : <span className="text-xs text-muted-foreground">Lineup TBD</span>}
        </div>
      ))}
    </div>
  );
}

/** The win prediction, never without its confidence tier. */
function Call({ m }: { m: MatchView }) {
  const p = m.prediction;
  if (!p) return <p className="mt-2 text-xs text-muted-foreground">No prediction for this match (it needs a full 2-against-2 lineup).</p>;
  const fav = p.pRed >= 0.5 ? "red" : "blue";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted-foreground">Predicted</span>
      <span className={cn("font-semibold tabular-nums", fav === "red" ? "text-red-alliance" : "text-blue-alliance")}>{fav === "red" ? "Red" : "Blue"} {oddsPct(fav === "red" ? p.pRed : 1 - p.pRed)} to win</span>
      <WinBar pRed={p.pRed} size="sm" className="w-24" />
      {!p.noScoreBasis && <span className="text-xs tabular-nums text-muted-foreground">~{Math.round(p.redMean)}–{Math.round(p.blueMean)}</span>}
      <TierMark tier={p.tier} className="text-xs" />
    </div>
  );
}

/** The phone's sticky bar while live: the countdown, one tap back to the panel. */
export function LiveCountdownChip({ target, onClick }: { target: LiveTarget; onClick: () => void }) {
  const m = target.next;
  const at = m?.startsAt ? Date.parse(m.startsAt) : NaN;
  const now = useSecondClock(Number.isFinite(at));
  const cd = Number.isFinite(at) ? formatCountdown(at - now) : null;
  return (
    <Button variant="destructive" onClick={onClick} aria-label={m ? `${m.label} ${cd ? `starts in ${countdownWords(at - now)}` : Number.isFinite(at) ? "is due now" : "is up next"}. Show the live panel` : "Show the live panel"}>
      <span aria-hidden className="size-2 rounded-full bg-current" />
      {m ? <>{m.label}{cd ? <span className="tabular-nums"> in {cd}</span> : Number.isFinite(at) ? " due now" : " up next"}</> : "Live"}
    </Button>
  );
}
