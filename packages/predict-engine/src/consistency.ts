// Consistency ("swing"): Control Scout's one consistency stat for a team, the
// same function in Control Scout and Control Point so both apps show the same
// number for the same matches.
//
// From recorded qualification results only, a number a reader can redo by hand:
//   share        an average robot's share of an alliance's non-penalty score at
//                the event: Σ alliance non-penalty points ÷ Σ robots on the field;
//   contribution a robot's estimated points in one match, in shares:
//                (alliance non-penalty score − the partner's event OPR) ÷ share.
//                Only matches with exactly two robots on the field and the
//                partner's OPR known;
//   swing        the spread of those contributions around the team's own mean
//                at each event (pooled over a season's events):
//                √( (Σ (c − event mean)² + PRIOR × field variance) ÷ (n + PRIOR) )
//                i.e. the team's variance pulled toward the field's as if it had
//                PRIOR more matches at the field's level, then the square root.
// Lower = steadier: 0.3 means a typical match lands within about a third of an
// average robot's share of the team's own average. Shown only from
// CONSISTENCY_MIN_MATCHES contributions on; below that the number is still
// used inside Control Scout's reliability index (shrunk, so it reads near the
// field) but never shown on its own.
//
// Why this and not the rating's residual variance (ReliabilityState.vol): that
// one is an EMA of the model's standardized misses, so it depends on the
// fitted model, decays with time and can't be checked from the score sheet.
// Swing needs only the published scores and the event OPR.
//
// Pure: no I/O, no clock. Prediction numbers don't read it.

/** Contributions needed before the stat is shown. */
export const CONSISTENCY_MIN_MATCHES = 5;
/** Prior weight (matches) pulling a team's variance toward the field's. */
export const CONSISTENCY_PRIOR = 10;

/** Raw tally of one team's contributions: how many, and Σ squared deviations from the team's own event mean. */
export interface ConsistencyTally { n: number; ss: number }

export interface Consistency {
  /** √ of the shrunk variance: always a number (the field's with no matches). What the reliability index uses. */
  swing: number;
  /** `swing` once there are CONSISTENCY_MIN_MATCHES contributions, else null (show "—"). */
  value: number | null;
  /** Contributions it rests on. */
  matches: number;
  /** Unshrunk sd √(ss ÷ n), null with no contributions. */
  rawSd: number | null;
  /** Why `value` is null. */
  reason: string | null;
}

/** An average robot's share at an event: Σ np ÷ Σ robots on the field, over played qualification alliances (0 if none). */
export function averageRobotShare(alliances: readonly { np: number; robots: number }[]): number {
  let np = 0, robots = 0;
  for (const a of alliances) if (a.robots) { np += a.np; robots += a.robots; }
  return robots ? np / robots : 0;
}

/** A robot's estimated contribution in one match, in average-robot shares. */
export const estimatedContribution = (allianceNp: number, partnerOpr: number, share: number) => (allianceNp - partnerOpr) / share;

/** One event's contributions → n and Σ squared deviations from their own mean. */
export function tallyContributions(contribs: readonly number[]): ConsistencyTally {
  const mean = contribs.reduce((s, x) => s + x, 0) / Math.max(1, contribs.length);
  return { n: contribs.length, ss: contribs.reduce((s, x) => s + (x - mean) ** 2, 0) };
}

/** Event tallies pooled (each event keeps its own centring), in the order given. */
export function poolTallies(xs: readonly ConsistencyTally[]): ConsistencyTally {
  let n = 0, ss = 0;
  for (const t of xs) { n += t.n; ss += t.ss; }
  return { n, ss };
}

/** The field's variance from a pooled tally of every team (0 with none). */
export const fieldVariance = (pooled: ConsistencyTally) => (pooled.n ? pooled.ss / pooled.n : 0);

/** x over n observations pulled toward f with a prior worth k observations. */
export const shrinkToward = (x: number | null, n: number, f: number, k: number) => (x == null || n <= 0 ? f : (n * x + k * f) / (n + k));

/** The stat from a team's (pooled) tally and the field's variance. */
export function consistency(t: ConsistencyTally, fieldVar: number, opts: { prior?: number; minMatches?: number } = {}): Consistency {
  const k = opts.prior ?? CONSISTENCY_PRIOR, min = opts.minMatches ?? CONSISTENCY_MIN_MATCHES;
  const n = t.n;
  const swing = Math.sqrt(Math.max(0, shrinkToward(n ? t.ss / n : null, n, fieldVar, k)));
  return { swing, rawSd: n ? Math.sqrt(Math.max(0, t.ss / n)) : null, ...shownConsistency(swing, n, min) };
}

/** Why the stat isn't shown with n contributions (null: it is). */
export const consistencyReason = (n: number, min = CONSISTENCY_MIN_MATCHES): string | null =>
  n >= min ? null : `${n === 0 ? "No" : `Only ${n}`} qualification match${n === 1 ? "" : "es"} with a partner's OPR known (needs ${min})`;

/** The shown part of the stat from a stored swing and its contribution count (the minimum-match rule). */
export function shownConsistency(swing: number | null, n: number, min = CONSISTENCY_MIN_MATCHES): Pick<Consistency, "value" | "matches" | "reason"> {
  const reason = swing == null ? consistencyReason(0, min) : consistencyReason(n, min);
  return { value: reason == null ? swing : null, matches: n, reason };
}

/** One played qualification alliance: its non-penalty score and the robots that were on the field (in listed order). */
export interface ConsistencyAlliance { np: number; onField: readonly number[] }

/**
 * Every team's contributions at one event, from its played qualification alliances in play order (red then blue
 * per match). `opr(team)`: the team's event non-penalty OPR, null when unknown. Teams on the field with no
 * usable match get an empty list.
 */
export function eventContributions(alliances: readonly ConsistencyAlliance[], opr: (team: number) => number | null): { share: number; contribs: Map<number, number[]> } {
  const share = averageRobotShare(alliances.map((a) => ({ np: a.np, robots: a.onField.length })));
  const contribs = new Map<number, number[]>();
  for (const a of alliances) {
    for (const t of a.onField) {
      let xs = contribs.get(t); if (!xs) { xs = []; contribs.set(t, xs); }
      const partner = a.onField.length === 2 ? a.onField.find((x) => x !== t) : undefined;
      const p = partner != null ? opr(partner) : null;
      if (p != null && share > 0) xs.push(estimatedContribution(a.np, p, share));
    }
  }
  return { share, contribs };
}

/**
 * The stat for every team at one event, shrunk toward `fieldVar` (Control Scout uses the season's field variance,
 * the same prior its stored event rows use; pass `fieldVariance` of the event's own pooled tallies when the
 * season's isn't known).
 */
export function eventConsistency(alliances: readonly ConsistencyAlliance[], opr: (team: number) => number | null, fieldVar: number): Map<number, Consistency> {
  const { contribs } = eventContributions(alliances, opr);
  return new Map([...contribs].map(([t, xs]) => [t, consistency(tallyContributions(xs), fieldVar)]));
}
