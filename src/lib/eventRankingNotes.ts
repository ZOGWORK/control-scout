// The one-line notes an event's Rankings and Odds tabs carry, so every number there says what it is: where the
// Adv. odds column comes from (and why the Odds tab's figure can differ), which teams the ranking lists, and why
// a column is empty for everyone. Pure, so the wording is pinned by tests.
import { EXCLUDED_TYPES } from "@control-scout/predict-engine";
import type { FieldRow } from "../shared/api";
import { FORECAST_RUNS, PRE_EVENT_ADVANCEMENT_RUNS, throughText, type ProjectionRun } from "../shared/projections";
import { ago } from "./format";

const runs = (n: number) => `${n.toLocaleString("en-US")} simulated events`;

/** What the Rankings tab's Adv. odds column is, and when it was computed. */
export function advOddsBasis(run: ProjectionRun | null, statsAt: string | null): string {
  if (run) {
    const through = throughText(run.through);
    return `Adv. odds: the live projection, ${runs(run.runs)} ${through ? `after ${through}` : "before the first match"}, run ${ago(run.computedAt)}. The Odds tab shows the same projection.`;
  }
  return `Adv. odds: the forecast as of the day before the event (${runs(PRE_EVENT_ADVANCEMENT_RUNS)}, ratings from earlier matches only), recomputed with each stats update${statsAt ? `, last ${ago(statsAt)}` : ""}. `
    + `The Odds tab's "Now" re-simulates the event on demand (${runs(FORECAST_RUNS)}) with its results so far, so the two can differ; its "Before the event" view is the like-for-like one.`;
}

/** The Odds tab's side of the same note, under its own figures. `hasProjection`: the event has a stored live
 *  projection, which is then what the Rankings tab's column shows. */
export function oddsTabBasis(hasProjection: boolean, mode: "current" | "pre-event"): string {
  if (hasProjection) {
    return mode === "current"
      ? "The Rankings tab's Adv. odds column shows this same projection."
      : "The Rankings tab's Adv. odds column shows the live projection (\"Now\"), not this pre-event view.";
  }
  return mode === "current"
    ? `The Rankings tab's Adv. odds column is the forecast as of the day before the event (${runs(PRE_EVENT_ADVANCEMENT_RUNS)}, no hindsight), so it can differ from these odds, which include this event's results so far.`
    : `The Rankings tab's Adv. odds column is this same kind of forecast, from its own ${runs(PRE_EVENT_ADVANCEMENT_RUNS)}, so the two can differ by a few points.`;
}

/**
 * Which teams the ranking lists: the records table has a row only for a team that has played a counted match
 * here. At a league meet that's this meet's own matches (FieldRow.meet), so the league's other teams, who
 * play at its other meets, aren't in it. Null when every team is listed (or nobody has played yet).
 */
export function rankingCoverage(field: FieldRow[]): string | null {
  const league = field.some((r) => "meet" in r);
  const played = field.filter((r) => (league ? (r.meet?.played ?? 0) > 0 : (r.qualPlayed ?? 0) > 0)).length;
  const rest = field.length - played;
  if (!played || !rest) return null;
  return league
    ? `Ranked on this meet's matches alone: ${played} of the league's ${field.length} teams played here. The other ${rest} ${rest === 1 ? "hasn't" : "haven't"} played at this meet, so ${rest === 1 ? "it isn't" : "they aren't"} listed.`
    : `${played} of ${field.length} teams have played a qualification match. The other ${rest} ${rest === 1 ? "hasn't" : "haven't"} played yet, so ${rest === 1 ? "it isn't" : "they aren't"} listed.`;
}

/** The glance card's top-seed cell: at a league meet, this meet's own #1 (as the ranking table shows it). */
export function topSeed(field: FieldRow[]): { row: FieldRow; label: string } | null {
  const league = field.some((r) => "meet" in r);
  const row = league ? field.find((r) => r.meet?.rank === 1) : field.find((r) => r.rank === 1);
  return row ? { row, label: league ? "#1 at this meet" : "#1 seed" } : null;
}

/**
 * An event type the ratings leave out (scrimmages and the like: the engine's EXCLUDED_TYPES). Two separate rules:
 * the event records (ranking, OPR, averages) are computed from its played matches like any event's, so its tables
 * fill and wait for the stats update as usual; only the ratings, and so the predictions, never learn from it.
 * Null for every other event.
 */
export function unofficialNote(type: string | null | undefined, typeLabel: string): string | null {
  if (!type || !EXCLUDED_TYPES.has(type)) return null;
  return `No official record: a ${typeLabel.toLowerCase()} is unofficial. Its ranking and stats below come from its own matches, but team ratings and predictions never learn from them.`;
}

/** Columns empty for every row shown (null or missing): the ones a legend needs to explain. */
export function emptyColumns(rows: { stats: Record<string, unknown> }[], cols: string[]): string[] {
  if (!rows.length) return [];
  return cols.filter((k) => rows.every((r) => r.stats[k] == null));
}
