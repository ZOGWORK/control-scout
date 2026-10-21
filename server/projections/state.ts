// An event's results state as a simulation sees it, reduced to a key. The key is taken from the
// engine's resolved input (input.ts), not the event payload: the forecaster fills in facts the payload
// doesn't carry (bonus RPs recorded by the sync, official or estimated advancement slots, teams already
// qualified elsewhere or ineligible), and a change in any of them must re-run the projection. Ratings are
// left out on purpose: they move with every other event's results, and a projection is re-run for its
// own event's news (a new engine version re-runs everything). Same key → the job skips the event, and the
// key seeds the random numbers, so repeat runs of one state agree.
import { createHash } from "node:crypto";
import type { EventInput } from "@control-scout/predict-engine";
import type { ProjectionInput } from "./input.js";

export interface EventState {
  played: number;
  scheduled: number;
  /** Label of the last played match (playoffs after quals), or null. */
  through: string | null;
}

const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 32);
const sorted = (xs: Iterable<number>) => [...xs].sort((a, b) => a - b);

/** The key of everything the simulation reads from the event and its advancement facts. */
export function inputKey(pi: ProjectionInput): string {
  const i = pi.input;
  return hash({
    stage: pi.stage, slots: pi.slots, slotsSource: pi.slotsSource, season: i.season,
    quals: i.quals, bonusSamples: i.bonusSamples ?? null,
    ranks: i.ranks ? [...i.ranks.entries()].sort((a, b) => a[0] - b[0]) : null,
    alliances: i.alliances ?? null,
    playoffs: i.playoffPlayed ? [...i.playoffPlayed.entries()].sort((a, b) => a[0] - b[0]) : null,
    prequalified: sorted(i.prequalified), ineligible: sorted(i.ineligible ?? []),
  });
}

export function eventState(ev: EventInput): EventState {
  const quals = ev.matches.filter((m) => m.level === "qual").sort((a, b) => a.number - b.number);
  const playoffs = ev.matches.filter((m) => m.level === "playoff").sort((a, b) => (a.series ?? 0) - (b.series ?? 0) || a.number - b.number);
  const lastQual = quals.filter((m) => m.played).at(-1);
  const lastPlayoff = playoffs.filter((m) => m.played).at(-1);
  return { played: quals.filter((m) => m.played).length, scheduled: quals.length, through: (lastPlayoff ?? lastQual)?.label ?? null };
}
