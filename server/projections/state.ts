// An event's results state: everything a simulation of it reads from the event itself (field,
// schedule, played results with their breakdowns, official ranks, alliances), reduced to a key.
// Same key → same simulation input from the event's side, so the job skips re-running it, and the
// key seeds the random numbers (repeat runs of one state agree).
import { createHash } from "node:crypto";
import type { EventInput, MatchInput } from "@control-scout/predict-engine";

export interface EventState {
  /** The whole results state. */
  key: string;
  /** Field + qualification schedule only (what the pre-event baseline depends on). */
  scheduleKey: string;
  played: number;
  scheduled: number;
  /** Label of the last played match (playoffs after quals), or null. */
  through: string | null;
}

const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 32);
const lineup = (m: MatchInput) => [m.red.teams.map((t) => [t.number, t.surrogate ? 1 : 0]), m.blue.teams.map((t) => [t.number, t.surrogate ? 1 : 0])];
const score = (s: MatchInput["red"]["score"]) => (s ? [s.total, s.totalNp ?? null, s.auto ?? null, s.endgame ?? null, s.penaltiesCommitted ?? null, s.tips ?? null, s.bonusRp ? [s.bonusRp.movement, s.bonusRp.goal, s.bonusRp.pattern] : null] : null);

export function eventState(ev: EventInput): EventState {
  const quals = ev.matches.filter((m) => m.level === "qual").sort((a, b) => a.number - b.number);
  const playoffs = ev.matches.filter((m) => m.level === "playoff").sort((a, b) => (a.series ?? 0) - (b.series ?? 0) || a.number - b.number);
  const field = ev.field.map((f) => f.teamNumber).sort((a, b) => a - b);
  const scheduleKey = hash({ field, quals: quals.map((m) => [m.number, lineup(m)]) });
  const key = hash({
    scheduleKey,
    ranks: ev.field.filter((f) => f.rank != null).map((f) => [f.teamNumber, f.rank]).sort((a, b) => a[0]! - b[0]!),
    results: ev.matches.filter((m) => m.played).map((m) => [m.key, lineup(m), score(m.red.score), score(m.blue.score), [...m.red.teams, ...m.blue.teams].filter((t) => t.dq).map((t) => t.number)]),
    alliances: ev.alliances.map((a) => [a.number, a.captain, a.picks]),
  });
  const lastQual = quals.filter((m) => m.played).at(-1);
  const lastPlayoff = playoffs.filter((m) => m.played).at(-1);
  return { key, scheduleKey, played: quals.filter((m) => m.played).length, scheduled: quals.length, through: (lastPlayoff ?? lastQual)?.label ?? null };
}
