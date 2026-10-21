// The engine's simulation input for an event, built exactly as its own forecast builds it.
//
// Forecaster.forecast() turns an event into a SimInput (ratings with this event's fresh results
// folded in, the extra pre-event uncertainty, recorded and sampled bonus RPs, advancement slots and
// already-qualified teams, official ranks once quals are over, alliances once selected, playoff
// results) and then runs simulateEvent once. The projections need that same input but run the
// simulation their own way (core.ts), so they call the forecaster's own steps here instead of
// copying them: the numbers can't drift from the event page's simulator or Control Point's. Those
// steps are private in the shared engine; this adapter is the one place that reaches them, and
// input.test.ts fails if a new engine version renames them.
import type { EventInput, Forecaster, RatingBook, SimInput } from "@control-scout/predict-engine";
import type { ProjectionStage } from "../../src/shared/projections.js";

interface Advancement { slots: number; source: string; prequalified: number[]; ineligible: number[] }
interface ForecasterSteps {
  book(season: number): RatingBook | null;
  stageOf(ev: EventInput): ProjectionStage;
  eventBook(ev: EventInput, book: RatingBook): RatingBook;
  simInput(ev: EventInput, stage: ProjectionStage, book: RatingBook, runs: number): { input: SimInput; assumptions: string[]; adv: Advancement };
}

export const STEPS = ["book", "stageOf", "eventBook", "simInput"] as const;

export interface ProjectionInput {
  input: SimInput;
  stage: ProjectionStage;
  slots: number;
  slotsSource: string;
  assumptions: string[];
}

/** The SimInput for `ev` (null when the forecaster has no ratings for the season or can't forecast the event). */
export function projectionInput(f: Forecaster, ev: EventInput): ProjectionInput | null {
  if (f.unsupportedReason(ev)) return null;
  const steps = f as unknown as ForecasterSteps;
  for (const k of STEPS) if (typeof (steps as unknown as Record<string, unknown>)[k] !== "function") throw new Error(`predict-engine: Forecaster.${k} is missing (projections/input.ts needs it)`);
  const seasonBook = steps.book(ev.season);
  if (!seasonBook) return null;
  const book = steps.eventBook(ev, seasonBook);
  const stage = steps.stageOf(ev);
  const { input, assumptions, adv } = steps.simInput(ev, stage, book, 1);
  return { input, stage, slots: adv.slots, slotsSource: adv.source, assumptions };
}
