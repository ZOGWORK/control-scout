// A simulation input as plain JSON (Maps and Sets as arrays), for test fixtures built from real
// events (scripts/projections-replay.ts → __fixtures__/midpoint.json → replay.test.ts).
import type { SimInput, TeamRating } from "@control-scout/predict-engine";

export interface PlainInput {
  season: number;
  ratings: [number, TeamRating][];
  quals: SimInput["quals"];
  noise: SimInput["noise"];
  /** Per-team score variance inputs (engine 2.6+; absent in fixtures built before). */
  variance?: [number, { consistency: number; matches: number }][];
  band?: SimInput["band"];
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
    season: i.season, ratings: [...i.ratings.entries()], quals: i.quals, noise: i.noise,
    ...(i.variance ? { variance: [...i.variance.entries()] } : {}), ...(i.band ? { band: i.band } : {}), bonus: i.bonus, bonusSamples: i.bonusSamples, pick: i.pick,
    prequalified: [...i.prequalified], ineligible: [...(i.ineligible ?? [])], slots: i.slots,
  };
}

export function deserializeInput(p: PlainInput): SimInput {
  return {
    season: p.season, ratings: new Map(p.ratings), quals: p.quals, noise: p.noise,
    ...(p.variance ? { variance: new Map(p.variance) } : {}), ...(p.band ? { band: p.band } : {}), bonus: p.bonus, bonusSamples: p.bonusSamples, pick: p.pick,
    prequalified: new Set(p.prequalified), ineligible: new Set(p.ineligible), slots: p.slots, awards: { mode: "none" }, runs: 1,
  };
}
