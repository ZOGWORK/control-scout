// A simulation input as plain JSON (Maps and Sets as arrays), for test fixtures built from real
// events (scripts/projections-replay.ts → __fixtures__/midpoint.json → replay.test.ts).
import type { SimInput, TeamRating } from "@control-scout/predict-engine";

export interface PlainInput {
  season: number;
  ratings: [number, TeamRating][];
  quals: SimInput["quals"];
  noise: SimInput["noise"];
  bonus?: SimInput["bonus"];
  bonusSamples?: number[];
  pick?: SimInput["pick"];
  prequalified: number[];
  ineligible: number[];
  slots: number;
}

export interface FixtureEvent { code: string; input: PlainInput; actual: [number, number][] }

export function serializeInput(i: SimInput): PlainInput {
  return {
    season: i.season, ratings: [...i.ratings.entries()], quals: i.quals, noise: i.noise, bonus: i.bonus, bonusSamples: i.bonusSamples, pick: i.pick,
    prequalified: [...i.prequalified], ineligible: [...(i.ineligible ?? [])], slots: i.slots,
  };
}

export function deserializeInput(p: PlainInput): SimInput {
  return {
    season: p.season, ratings: new Map(p.ratings), quals: p.quals, noise: p.noise, bonus: p.bonus, bonusSamples: p.bonusSamples, pick: p.pick,
    prequalified: new Set(p.prequalified), ineligible: new Set(p.ineligible), slots: p.slots, awards: { mode: "none" }, runs: 1,
  };
}
