// The Scout page's Scout tab: the session's event, its schedule, and one match at a time for the teams this
// scout watches (team tabs, one phase at a time, the match timer), saved as one entry per team with one Save
// that moves on to the next match. The pieces are the redesign's own (MatchHeader, TeamTabs, PhaseForm,
// SaveMatchBar, useMatchDraft); this joins them to the page's state.
import { useEffect, useMemo, useState } from "react";
import { MatchHeader, ScheduleState } from "./MatchHeader";
import { StatusDot, TeamTabs } from "./TeamTabs";
import { ScoreStrip } from "../forms/ScoreStrip";
import type { SaveSync } from "../forms/SaveState";
import { useMediaQuery } from "../../../lib/meta";
import { cn } from "../../cn";
import { PhaseForm } from "./PhaseForm";
import { SaveMatchBar } from "./SaveMatchBar";
import { QuickMatchForm } from "./QuickMatchForm";
import { ChevronLeft } from "lucide-react";
import { Button } from "../../ui/button";
import { useMatchTimer } from "./useMatchTimer";
import { useEventSchedule } from "../../../lib/eventSchedule";
import { useMatchDraft } from "../../../lib/matchDraft";
import { useSavedToLine } from "../../../lib/adminCopies";
import type { ScoutEntry, ScoutSpace } from "../../../lib/scouting";
import type { ScoutSession } from "../../../lib/scoutSession";
import type { FieldPhase, ScoutTemplate } from "../../../shared/scoutTemplate";
import { matchProgress, nextMatchIndex, normalizeMatchLabel, scoutedByMatch, teamsWatched, type ScheduleMatch } from "../../../shared/scoutMatch";

export interface MatchScoutProps {
  space: ScoutSpace;
  season: number;
  session: ScoutSession;
  /** The space's entries on this device (the page's useScouting list). */
  entries: ScoutEntry[];
  /** The space's current match template. */
  template: ScoutTemplate;
  /** Your shared account id in a workspace (only your entries are edited here). */
  author: number | null;
  readOnly: boolean;
  spaceName: string | null;
  /** The match open (its label, from the URL), or null: where scouting picks up. */
  matchLabel: string | null;
  onMatch: (label: string) => void;
  /** No schedule to scout from: the old form, with the event filled in. */
  onManual: () => void;
  /** A match came on screen (its normalized label): the page checks for newer questions, as opening the old form did. */
  onShown?: (label: string) => void;
  /** Where saving stands (the page's sync state), for the Save bar. */
  sync: SaveSync;
  /** A save has been made on this screen this visit. */
  savedHere?: boolean;
  /** After any save (the page remembers that this visit has saved). */
  onAnySave?: () => void;
}

export function MatchScout(p: MatchScoutProps) {
  const { season, session, entries } = p;
  const schedule = useEventSchedule(season, session.eventCode);
  const scouted = useMemo(() => scoutedByMatch(entries, session.eventCode), [entries, session.eventCode]);
  const next = useMemo(() => nextMatchIndex(schedule.matches, session.watching, scouted), [schedule.matches, session.watching, scouted]);
  // The match on screen: the one asked for, else where scouting picked up when the screen opened. Fixed once
  // open: entries arriving from other scouts move `next`, and must never move the match (or its timer) mid-scout.
  const [opened, setOpened] = useState<{ event: string; label: string } | null>(null);
  const wanted = normalizeMatchLabel(p.matchLabel) ?? (opened?.event === session.eventCode ? opened.label : null);
  const found = wanted ? schedule.matches.findIndex((m) => normalizeMatchLabel(m.label) === wanted) : -1;
  const index = found >= 0 ? found : next;
  const shownLabel = index >= 0 ? normalizeMatchLabel(schedule.matches[index]?.label) : null;
  useEffect(() => {
    if (shownLabel && (opened?.event !== session.eventCode || opened.label !== shownLabel)) setOpened({ event: session.eventCode, label: shownLabel });
  }, [shownLabel, session.eventCode, opened]);
  const { onShown } = p;
  useEffect(() => { if (shownLabel) onShown?.(shownLabel); }, [shownLabel, session.eventCode, onShown]);

  if (schedule.status !== "ready" || index < 0) {
    return <ScheduleState status={schedule.status === "ready" ? "none" : schedule.status} error={schedule.error} onManual={p.onManual} onRetry={() => void schedule.reload()} />;
  }
  return (
    <div className="grid gap-4 max-sm:gap-3">
      <ScheduleState status="ready" fromDevice={schedule.fromDevice} />
      <MatchHeader schedule={schedule.matches} index={index} watching={session.watching} nextIndex={next}
        progress={(i) => matchProgress(schedule.matches[i], session.watching, scouted)} onIndex={(i) => p.onMatch(schedule.matches[i].label)} />
      {/* A match of its own: its timer, phase and open tab start fresh. */}
      <OneMatch key={`${session.eventCode}:${schedule.matches[index].key}`} {...p} match={schedule.matches[index]}
        nextLabel={index + 1 < schedule.matches.length ? schedule.matches[index + 1].label : null} nextIndex={Math.min(index + 1, schedule.matches.length - 1)}
        onSaved={(i) => { p.onAnySave?.(); p.onMatch(schedule.matches[i].label); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
    </div>
  );
}

function OneMatch({ space, season, session, entries, template, author, readOnly, spaceName, match, nextLabel, nextIndex, onSaved, sync, savedHere }: MatchScoutProps & {
  match: ScheduleMatch; nextLabel: string | null; nextIndex: number; onSaved: (nextIndex: number) => void;
}) {
  const teams = useMemo(() => teamsWatched(match, session.watching), [match, session.watching]);
  const draft = useMatchDraft({ space, season, eventCode: session.eventCode, match, teams, template, existing: entries, author, readOnly, spaceName });
  const [phase, setPhase] = useState<FieldPhase>("auto");
  const savedTo = useSavedToLine(space);
  // One timer for the match: switching team tabs keeps it running, and its phase moves every team's form.
  const timer = useMatchTimer(setPhase);
  const [active, setActive] = useState(teams[0]?.team ?? 0);
  // All four teams: quick rows, one team's full form on request (and back).
  const [full, setFull] = useState(false);
  const quick = session.watching.kind === "all" && !full;
  // A wide screen shows the robots side by side (one phase and one timer for all); a phone, one tab each.
  const wide = useMediaQuery("(min-width: 1024px)");
  if (!teams.length) return <p className="text-sm text-muted-foreground">None of the teams you watch are in {match.label}.</p>;
  const robotForm = (team: number, i: number) => {
    const t = draft.teams.find((x) => x.watched.team === team)!;
    return (
      <div className="grid gap-3">
        {t.locked && (
          <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {team} was saved with an earlier version of the workspace's fields, which this device hasn't loaded yet. Its answers are kept as they are; you can still change the notes.
          </p>
        )}
        <PhaseForm template={t.template} value={t.data} onChange={(d) => draft.setData(team, d)} notes={t.notes} onNotes={(n) => draft.setNotes(team, n)}
          notesLabel={`Notes on ${team}`} phase={phase} onPhase={setPhase} timer={timer} lockFields={t.locked} hideTimer={i > 0} />
      </div>
    );
  };
  const sideBySide = !quick && wide && draft.teams.length > 1;
  return (
    <>
      <ScoreStrip robots={draft.teams.map((t) => ({ team: t.watched.team, side: t.watched.side, station: t.watched.station, data: t.data, template: t.template }))} />
      {session.watching.kind === "all" && full && (
        <Button variant="ghost" size="sm" className="-ml-2 justify-self-start text-muted-foreground" onClick={() => setFull(false)}><ChevronLeft /> Back to all 4 teams</Button>
      )}
      {quick ? (
        <QuickMatchForm teams={draft.teams} onChange={(team, d) => draft.setData(team, d)} onOpenFull={(team) => { setActive(team); setFull(true); }} />
      ) : sideBySide ? (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(draft.teams.length, 2)}, minmax(0, 1fr))` }}>
          {draft.teams.map((t, i) => (
            <section key={t.watched.team} aria-label={`${t.watched.team}, ${t.watched.side} ${t.watched.station}`}
              className={cn("min-w-0 rounded-2xl border-t-[3px] bg-card/40 p-3", t.watched.side === "red" ? "border-red-alliance" : "border-blue-alliance")}>
              <p className="mb-2 flex items-center gap-2 font-mono text-base font-bold"><StatusDot status={t.status} />{t.watched.team}
                <span className="font-sans text-xs font-medium text-muted-foreground">{t.watched.side === "red" ? "Red" : "Blue"} {t.watched.station}</span></p>
              {robotForm(t.watched.team, i)}
            </section>
          ))}
        </div>
      ) : <TeamTabs teams={draft.teams.map((t) => ({ watched: t.watched, status: t.status }))} active={active} onSelect={setActive} renderForm={(w) => robotForm(w.team, 0)} />}
      <SaveMatchBar label={match.label} teamCount={teams.length} nextLabel={nextLabel} nextIndex={nextIndex} emptyTeams={draft.emptyTeams}
        toPersonal={draft.toPersonal} savedTo={savedTo} onSave={draft.saveMatch} onSaved={onSaved} sync={sync} savedHere={savedHere} />
    </>
  );
}
