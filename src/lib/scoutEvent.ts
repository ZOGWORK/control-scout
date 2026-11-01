// The picked event as Scout's Event day shows it: its name, dates and place for the header, its teams for the pit
// queue and the team pickers, and its schedule for the match queue. The details come from the event's own route
// (the same request the schedule makes, so one fetch); the schedule is useEventSchedule's, kept on this device for
// a venue with no signal. With no team list from the server (offline, or FIRST hasn't posted one), the teams in
// the schedule stand in, without names. Nothing is made up (AGENTS.md rule 8).
import { useMemo } from "react";
import { useApi } from "./api";
import { useEventSchedule, type EventSchedule } from "./eventSchedule";
import type { EventDetail, FieldRow } from "../shared/api";

export interface ScoutEventTeam { team: number; name: string | null }

export interface ScoutEvent {
  code: string;
  /** The event's details (null until the server or a saved season answers). */
  info: EventDetail["event"] | null;
  /** The event's teams, by number. Empty while nothing is known. */
  teams: ScoutEventTeam[];
  /** Where `teams` came from: the event's own list, the schedule (no names), or nowhere yet. */
  teamsFrom: "event" | "schedule" | "none";
  /** Each team's standing at the event (rank, record), from the event's own list. */
  rows: Map<number, FieldRow>;
  schedule: EventSchedule;
}

export function useScoutEvent(season: number, code: string | null): ScoutEvent {
  const c = code?.trim().toUpperCase() || null;
  const api = useApi<EventDetail>(c ? `/api/events/${season}/${encodeURIComponent(c)}` : null);
  const schedule = useEventSchedule(season, c);
  const info = api.data?.event ?? null;
  const field = api.data?.field;
  const { teams, teamsFrom } = useMemo(() => {
    if (field?.length) {
      return { teams: [...field].map((f) => ({ team: f.team, name: f.name })).sort((a, b) => a.team - b.team), teamsFrom: "event" as const };
    }
    const seen = new Set<number>();
    for (const m of schedule.matches) for (const t of [...m.red, ...m.blue]) seen.add(t);
    if (seen.size) return { teams: [...seen].sort((a, b) => a - b).map((team) => ({ team, name: null })), teamsFrom: "schedule" as const };
    return { teams: [] as ScoutEventTeam[], teamsFrom: "none" as const };
  }, [field, schedule.matches]);
  const rows = useMemo(() => new Map((field ?? []).map((f) => [f.team, f])), [field]);
  return { code: c ?? "", info, teams, teamsFrom, rows, schedule };
}
