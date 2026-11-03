// One plain line per prediction surface: which matches the prediction learns from and what changes in
// playoffs. Every fact is the engine's (packages/predict-engine), checked there:
// - ratings fold in every played match of a rated event, quals and playoffs (server/stats/load.ts
//   toEventRecord), a playoff result at playoffWeight (0.5) of a qualification one (rating.ts fold);
// - the alliance overlap cut (engine 2.11) applies to 2-robot qualification alliances only
//   (rating.ts allianceOverlap; sim.ts playScore);
// - playoff score ranges multiply the game-noise variance by band.playoff (0.72): tighter (matchModel.ts);
// - bonus RP odds are for qualification matches only (server/predict/engine.ts explain), fitted on
//   qualification alliances (bonus.ts);
// - the simulator draws each robot's strength once per run from its current rating and never updates it
//   inside a run; simulated playoffs use the playoff settings above (sim.ts).
// The methodology page's "Quals and playoffs" section says the same at length (BASIS_HREF).

export type BasisKind = "qual" | "playoff" | "event" | "bracket";

export const BASIS_HREF = "/methodology#quals-playoffs";

export const BASIS: Record<BasisKind, string> = {
  qual: "Learned from every played match, quals and playoffs; a playoff result counts half.",
  playoff: "Playoff call: the same ratings (a playoff result counts half), but partners add up in full, the score range is tighter and there are no bonus RPs.",
  event: "Simulated from team ratings, learned from quals and playoffs (a playoff result counts half). Simulated playoffs add partners up in full and draw tighter scores.",
  bracket: "Each series uses the playoff call: the same ratings (a playoff result counts half), partners added up in full.",
};

/** The predicted margin from the two shown (rounded) scores, so it adds up by hand: "Red by 12 (118 − 106)". */
export const marginText = (red: number, blue: number): string => {
  const r = Math.round(red), b = Math.round(blue), d = r - b;
  return `${d === 0 ? "Even" : d > 0 ? `Red by ${d}` : `Blue by ${-d}`} (${r} − ${b})`;
};

/** An alliance's overlap loss over its three phases (engine explain overlapA/overlapB). */
export const overlapTotal = (o: { auto: number; teleop: number; endgame: number } | null | undefined): number => (o ? o.auto + o.teleop + o.endgame : 0);

const r1 = (x: number) => Math.round(x * 10) / 10;
const d1 = (x: number) => r1(x).toFixed(1);

/**
 * One alliance's predicted score written out from its parts (matchModel.ts: Σ robots' np − overlap + Σ the
 * opponents' penalties), every part rounded to 0.1 and the sum taken of the parts as written, so the line's own
 * arithmetic is exact: "(72.4 + 51.0) − 6.1 + (2.0 + 1.5) = 120.8". The shown score is rounded from the unrounded
 * parts, so it can differ from this sum by a rounding step; the caller says so.
 */
export function scoreSum(own: { np: number }[], overlap: number, opp: { pen: number }[]): string {
  const robots = own.map((t) => r1(t.np)), pens = opp.map((t) => r1(t.pen)), ov = r1(overlap);
  const total = robots.reduce((s, x) => s + x, 0) - ov + pens.reduce((s, x) => s + x, 0);
  return `(${robots.map(d1).join(" + ")}) − ${d1(ov)} + (${pens.map(d1).join(" + ")}) = ${d1(total)}`;
}

/** The line for a match at this level (a what-if with no level is a qualification match). */
export const matchBasis = (level: "qual" | "playoff" | undefined | null): BasisKind => (level === "playoff" ? "playoff" : "qual");
