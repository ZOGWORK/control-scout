// The engine's view of an event (same fields Control Point passes from FtcEventFull), from the event
// page's payload. Shared: the server forecasts and projects from it (server/api/events.ts), and the
// device's local estimate builds the very same input from the payload it already has.
import type { EventInput } from "@control-scout/predict-engine";
import type { EventDetail, EventSummary, FieldRow } from "./api.js";

type AllianceRow = Pick<EventDetail["alliances"][number], "number" | "captain" | "pick1" | "pick2">;

export function toEventInput(ev: EventSummary, field: FieldRow[], matches: EventDetail["matches"], alliances: AllianceRow[]): EventInput {
  return {
    season: ev.season, code: ev.code, name: ev.name, type: ev.type, start: ev.start, end: ev.end,
    field: field.map((f) => ({ teamNumber: f.team, rank: f.rank })),
    matches: matches.map((m) => ({
      key: m.key, label: m.label, level: m.level, series: m.series, number: m.number, time: m.time, played: m.played,
      // Played matches: robots that were on the field (playoff alliances list 3).
      red: { teams: (m.played ? m.red.teams.filter((t) => t.onField) : m.red.teams).map((t) => ({ number: t.number, surrogate: t.surrogate, dq: t.dq })), score: m.red.score ? { total: m.red.score.total, totalNp: m.red.score.np, auto: m.red.score.auto, teleop: m.red.score.teleop, endgame: m.red.score.endgame, penaltiesCommitted: m.red.score.pen, tips: m.red.score.tips ?? null } : null },
      blue: { teams: (m.played ? m.blue.teams.filter((t) => t.onField) : m.blue.teams).map((t) => ({ number: t.number, surrogate: t.surrogate, dq: t.dq })), score: m.blue.score ? { total: m.blue.score.total, totalNp: m.blue.score.np, auto: m.blue.score.auto, teleop: m.blue.score.teleop, endgame: m.blue.score.endgame, penaltiesCommitted: m.blue.score.pen, tips: m.blue.score.tips ?? null } : null },
    })),
    alliances: alliances.filter((a) => a.captain).map((a) => ({ number: a.number, captain: a.captain, picks: [a.pick1, a.pick2].filter((x): x is number => x != null) })),
  };
}
