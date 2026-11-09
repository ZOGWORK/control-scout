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
/** The predicted margin in words alone ("Blue by 3"), for where the two scores are already printed. */
export const marginWords = (red: number, blue: number): string => {
  const d = Math.round(red) - Math.round(blue);
  return d === 0 ? "Even" : d > 0 ? `Red by ${d}` : `Blue by ${-d}`;
};
export const marginText = (red: number, blue: number): string => `${marginWords(red, blue)} (${Math.round(red)} − ${Math.round(blue)})`;

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
  return `(${robots.map(d1).join(" + ")}) − ${d1(ov)} + (${pens.map(d1).join(" + ")}) = ${d1(scoreTotal(own, overlap, opp))}`;
}

/** The total scoreSum writes (its parts rounded to 0.1, then added), as a number. */
export function scoreTotal(own: { np: number }[], overlap: number, opp: { pen: number }[]): number {
  return r1(own.reduce((s, t) => s + r1(t.np), 0) - r1(overlap) + opp.reduce((s, t) => s + r1(t.pen), 0));
}

/**
 * Engine 3.5's margin calibration, written out from the two model sums (scoreTotal): both scores move toward
 * their middle so the margin is `scale` × the gap, and the total stays the same. Each step to 0.1, so the lines
 * check out by hand: { mid: "113.4", red: "113.4 + 0.95 × 7.4 = 120.4", blue: "113.4 − 0.95 × 7.4 = 106.4" }.
 */
export function marginCalibration(red: number, blue: number, scale: number): { mid: string; half: string; red: string; blue: string } {
  const mid = r1((red + blue) / 2), half = r1(Math.abs(red - blue) / 2), moved = r1(scale * half);
  const up = `${d1(mid)} + ${scale} × ${d1(half)} = ${d1(r1(mid + moved))}`, down = `${d1(mid)} − ${scale} × ${d1(half)} = ${d1(r1(mid - moved))}`;
  return { mid: d1(mid), half: d1(half), red: red >= blue ? up : down, blue: red >= blue ? down : up };
}

/** The line for a match at this level (a what-if with no level is a qualification match). */
export const matchBasis = (level: "qual" | "playoff" | undefined | null): BasisKind => (level === "playoff" ? "playoff" : "qual");
