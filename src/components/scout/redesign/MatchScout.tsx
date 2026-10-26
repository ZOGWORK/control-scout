// The Scout page's Match tab: the session's event, its schedule, and one match at a time for the teams this
// scout watches (team tabs, one phase at a time, the match timer), saved as one entry per team with one Save
// that moves on to the next match. The pieces are the redesign's own (MatchHeader, TeamTabs, PhaseForm,
// SaveMatchBar, useMatchDraft); this joins them to the page's state.
import { useMemo, useState } from "react";
import { MatchHeader, ScheduleState } from "./MatchHeader";
import { TeamTabs } from "./TeamTabs";
import { PhaseForm } from "./PhaseForm";
import { SaveMatchBar } from "./SaveMatchBar";
import { MatchesList, type OtherScout } from "./MatchesList";
import { useMatchTimer } from "./useMatchTimer";
import { useEventSchedule } from "../../../lib/eventSchedule";
import { useMatchDraft } from "../../../lib/matchDraft";
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
}

export function MatchScout(p: MatchScoutProps) {
  const { season, session, entries } = p;
  const schedule = useEventSchedule(season, session.eventCode);
  const scouted = useMemo(() => scoutedByMatch(entries, session.eventCode), [entries, session.eventCode]);
  const next = useMemo(() => nextMatchIndex(schedule.matches, session.watching, scouted), [schedule.matches, session.watching, scouted]);
  const wanted = normalizeMatchLabel(p.matchLabel);
  const found = wanted ? schedule.matches.findIndex((m) => normalizeMatchLabel(m.label) === wanted) : -1;
  const index = found >= 0 ? found : next;

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
        onSaved={(i) => { p.onMatch(schedule.matches[i].label); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
    </div>
  );
}

function OneMatch({ space, season, session, entries, template, author, readOnly, spaceName, match, nextLabel, nextIndex, onSaved }: MatchScoutProps & {
  match: ScheduleMatch; nextLabel: string | null; nextIndex: number; onSaved: (nextIndex: number) => void;
}) {
  const teams = useMemo(() => teamsWatched(match, session.watching), [match, session.watching]);
  const draft = useMatchDraft({ space, season, eventCode: session.eventCode, match, teams, template, existing: entries, author, readOnly, spaceName });
  const [phase, setPhase] = useState<FieldPhase>("auto");
  // One timer for the match: switching team tabs keeps it running, and its phase moves every team's form.
  const timer = useMatchTimer(setPhase);
  const [active, setActive] = useState(teams[0]?.team ?? 0);
  if (!teams.length) return <p className="text-sm text-muted-foreground">None of the teams you watch are in {match.label}.</p>;
  return (
    <>
      <TeamTabs teams={draft.teams.map((t) => ({ watched: t.watched, status: t.status }))} active={active} onSelect={setActive}
        renderForm={(w) => {
          const t = draft.teams.find((x) => x.watched.team === w.team)!;
          return (
            <PhaseForm template={t.template} value={t.data} onChange={(d) => draft.setData(w.team, d)} notes={t.notes} onNotes={(n) => draft.setNotes(w.team, n)}
              notesLabel={`Notes on ${w.team}`} phase={phase} onPhase={setPhase} timer={timer} />
          );
        }} />
      <SaveMatchBar label={match.label} teamCount={teams.length} nextLabel={nextLabel} nextIndex={nextIndex} emptyTeams={draft.emptyTeams}
        toPersonal={draft.toPersonal} onSave={draft.saveMatch} onSaved={onSaved} />
    </>
  );
}

/** The Matches tab: every match at the session's event with how far this scout is, from the same schedule and entries. */
export function MatchesTab({ season, session, entries, matchLabel, onMatch, onManual, others }: Pick<MatchScoutProps, "season" | "session" | "entries" | "matchLabel" | "onMatch" | "onManual"> & { others?: Map<string, OtherScout[]> }) {
  const schedule = useEventSchedule(season, session.eventCode);
  const scouted = useMemo(() => scoutedByMatch(entries, session.eventCode), [entries, session.eventCode]);
  const next = useMemo(() => nextMatchIndex(schedule.matches, session.watching, scouted), [schedule.matches, session.watching, scouted]);
  if (schedule.status !== "ready" || !schedule.matches.length) {
    return <ScheduleState status={schedule.status === "ready" ? "none" : schedule.status} error={schedule.error} onManual={onManual} onRetry={() => void schedule.reload()} />;
  }
  const wanted = normalizeMatchLabel(matchLabel);
  const found = wanted ? schedule.matches.findIndex((m) => normalizeMatchLabel(m.label) === wanted) : -1;
  return (
    <div className="grid gap-3">
      <ScheduleState status="ready" fromDevice={schedule.fromDevice} />
      <MatchesList schedule={schedule.matches} watching={session.watching} scouted={scouted} currentIndex={found >= 0 ? found : next} nextIndex={next}
        onOpen={(i) => onMatch(schedule.matches[i].label)} others={others} />
    </div>
  );
}
