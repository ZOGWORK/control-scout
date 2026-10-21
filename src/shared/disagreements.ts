// Model vs field: the biggest gaps between the model's rating order and the official seeding at one
// event (server/api/disagreements.ts feeds it; components/ModelVsField.tsx shows it). A model call with
// its numbers attached, never a verdict on a team: seeding also rewards the schedule, partners and
// ranking points, which a rating of points scored doesn't see.
//
// Pure: the server works out the inputs (ratings, ranks, each team's seed at its last event) and this
// picks the gaps worth showing. Thin data is left out rather than shown with a caveat: small fields, too
// few matches here, ratings on too few matches, and gaps the model can't tell apart from its own doubt.
import type { ConfidenceTier } from "./api";

/** What the model's order is compared with. */
export type DisagreementMode =
  /** Qualification under way: the current seeding here. */
  | "quals"
  /** Qualification over: the final seeding here. */
  | "final"
  /** Before seeding here means much: each team's seed at its last event, scaled to this field. */
  | "pre-quals";

export interface DisagreementInput {
  team: number;
  name: string | null;
  /** Official rank here (null before it has one). */
  rank: number | null;
  qualPlayed: number | null;
  wins: number | null; losses: number | null; ties: number | null;
  rp: number | null;
  /** OPR (np) here, else null. */
  opr: number | null;
  /** Season OPR (np) so far: the evidence before a team has played here. */
  seasonOpr: number | null;
  /** The model's rating (np points a match), its uncertainty (sd, points) and the matches behind it. */
  rating: { np: number; sd: number; matches: number } | null;
  /** The team's seed at its most recent earlier event this season (pre-quals only). */
  prior: { rank: number; of: number; code: string; name: string } | null;
}

export interface DisagreementRow {
  team: number;
  name: string | null;
  /** model-higher: the model rates them above their seed; seed-higher: seeded above the model's rating. */
  direction: "model-higher" | "seed-higher";
  /** Place in the model's rating order among the teams compared (1 = highest rated). */
  modelPlace: number;
  /** The seed shown: the official rank here, or (pre-quals) the rank at the team's last event. */
  seed: { rank: number; of: number; event: { code: string; name: string } | null };
  /** The seed as a place in this comparison (pre-quals: the last-event seed scaled to this field). */
  seedPlace: number;
  /** Places between the two (always positive). */
  gap: number;
  rating: { np: number; sd: number; matches: number };
  /** The rating of the team the model places at `seedPlace`: the "typical seed-slot" team it's measured against. */
  slotRating: number;
  /** Points a match between the two ratings (positive), and that difference over their combined uncertainty. */
  margin: number;
  z: number;
  opr: number | null;
  /** OPR here, or season OPR (pre-quals). */
  oprKind: "event" | "season";
  record: { wins: number; losses: number; ties: number } | null;
  rp: number | null;
  tier: ConfidenceTier;
  reason: string;
}

export interface DisagreementsView {
  season: number;
  code: string;
  mode: DisagreementMode;
  /** Ratings as of: now (the live ratings) or the end of the event (finished events, replayed to then). */
  ratingsAsOf: "now" | "event-end";
  /** Teams in the comparison (rated, seeded, enough matches). */
  compared: number;
  fieldSize: number;
  /** Why nothing is shown, when nothing is (a small field, too early, history season). */
  hidden: string | null;
  rows: DisagreementRow[];
  rules: typeof RULES & { minGap: number };
}

export const RULES = {
  /** Fewer teams in the comparison than this: a tiny event, nothing shown. */
  minTeams: 12,
  /** A team's rating needs this many matches behind it. */
  minRatingMatches: 5,
  /** Fewer matches than this and the call is provisional. */
  confidentMinMatches: 8,
  /** Qualification matches played here before a team's seed here counts (and the event's median before "quals" mode). */
  minQualPlayed: 3,
  /** The smallest gap in places, and as a share of the field (the larger wins). */
  minGapPlaces: 4,
  minGapShare: 0.2,
  /** The last event's seeding counts only from a field this size, with this many matches played. */
  minPriorField: 8,
  minPriorPlayed: 4,
  /** Rating margin over combined uncertainty: shown from 0.84 (the model's order holds about 4 in 5 times), confident from 1.64 (19 in 20). */
  zShow: 0.84,
  zConfident: 1.64,
  /** Rows per direction. */
  perSide: 5,
} as const;

export const minGapFor = (n: number) => Math.max(RULES.minGapPlaces, Math.ceil(n * RULES.minGapShare));

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** "quals" once most of the field has played enough here to have a real seed; "pre-quals" before. */
export function disagreementMode(field: DisagreementInput[], finished: boolean): DisagreementMode {
  const played = field.filter((f) => f.rank != null).map((f) => f.qualPlayed ?? 0);
  if (played.length && median(played) >= RULES.minQualPlayed) return finished ? "final" : "quals";
  return "pre-quals";
}

export function findDisagreements(
  field: DisagreementInput[],
  opts: { season: number; code: string; finished: boolean; ratingsAsOf: "now" | "event-end" },
): DisagreementsView {
  const mode = disagreementMode(field, opts.finished);
  const base = { season: opts.season, code: opts.code, mode, ratingsAsOf: opts.ratingsAsOf, fieldSize: field.length };
  // Over without a seeding of its own (a championship split into divisions, a meet without rankings): nothing to compare.
  if (opts.finished && mode === "pre-quals") {
    return { ...base, mode: "final", compared: 0, hidden: "No official seeding here to compare with. Where an event plays in divisions, each division's page has its own.", rows: [], rules: { ...RULES, minGap: minGapFor(0) } };
  }
  type Cand = DisagreementInput & { rating: NonNullable<DisagreementInput["rating"]>; seedKey: number };
  const cands: Cand[] = [];
  for (const f of field) {
    if (!f.rating || f.rating.matches < RULES.minRatingMatches || !Number.isFinite(f.rating.np)) continue;
    if (mode === "pre-quals") {
      const p = f.prior;
      if (!p || p.of < RULES.minPriorField || p.rank < 1 || p.rank > p.of) continue;
      cands.push({ ...f, rating: f.rating, seedKey: (p.rank - 1) / (p.of - 1) });
    } else {
      if (f.rank == null || (f.qualPlayed ?? 0) < RULES.minQualPlayed) continue;
      cands.push({ ...f, rating: f.rating, seedKey: f.rank });
    }
  }
  const n = cands.length;
  const minGap = minGapFor(n);
  const rules = { ...RULES, minGap };
  if (n < RULES.minTeams) {
    const hidden = field.length < RULES.minTeams
      ? `Only ${field.length} team${field.length === 1 ? "" : "s"} here: too small a field for gaps in the order to mean much.`
      : mode === "pre-quals"
        ? "Too few teams here have both a rating on enough matches and a seed from an earlier event yet. This fills in once qualification matches are played."
        : "Too few teams here have a rating on enough matches yet.";
    return { ...base, compared: n, hidden, rows: [], rules };
  }
  // The model's order (highest rating first; team number breaks ties so the order is stable).
  const byModel = [...cands].sort((a, b) => b.rating.np - a.rating.np || a.team - b.team);
  const modelPlace = new Map(byModel.map((c, i) => [c.team, i + 1]));
  // Seed places in this comparison: the official order here, or the last-event seed share scaled to n.
  const seedPlace = new Map<number, number>();
  if (mode === "pre-quals") {
    for (const c of cands) seedPlace.set(c.team, 1 + Math.round(c.seedKey * (n - 1)));
  } else {
    [...cands].sort((a, b) => a.seedKey - b.seedKey || a.team - b.team).forEach((c, i) => seedPlace.set(c.team, i + 1));
  }
  const rows: DisagreementRow[] = [];
  for (const c of cands) {
    const mp = modelPlace.get(c.team)!, sp = seedPlace.get(c.team)!;
    const gap = Math.abs(sp - mp);
    if (gap < minGap) continue;
    const slot = byModel[sp - 1];
    if (!slot || slot.team === c.team) continue;
    const direction = mp < sp ? "model-higher" : "seed-higher";
    const margin = direction === "model-higher" ? c.rating.np - slot.rating.np : slot.rating.np - c.rating.np;
    const spread = Math.sqrt(c.rating.sd ** 2 + slot.rating.sd ** 2);
    const z = spread > 0 ? margin / spread : margin > 0 ? Infinity : 0;
    if (!(z >= RULES.zShow)) continue;
    const tier: ConfidenceTier = c.rating.matches < RULES.confidentMinMatches ? "provisional" : z >= RULES.zConfident ? "confident" : "moderate";
    const reason = tier === "provisional"
      ? `Rated on only ${c.rating.matches} matches, so the rating is still settling.`
      : `Rated on ${c.rating.matches} matches; the gap to the model's #${sp} is ${r1(margin)} points a match, ${r1(z)}× the combined uncertainty${tier === "confident" ? "" : " (confident from 1.6×)"}.`;
    const pre = mode === "pre-quals";
    rows.push({
      team: c.team, name: c.name, direction, modelPlace: mp, seedPlace: sp, gap,
      seed: pre ? { rank: c.prior!.rank, of: c.prior!.of, event: { code: c.prior!.code, name: c.prior!.name } } : { rank: c.rank!, of: field.filter((f) => f.rank != null).length, event: null },
      rating: { np: r1(c.rating.np), sd: r1(c.rating.sd), matches: c.rating.matches },
      slotRating: r1(slot.rating.np), margin: r1(margin), z: r2(z),
      opr: pre ? c.seasonOpr : c.opr, oprKind: pre ? "season" : "event",
      record: !pre && c.wins != null && c.losses != null ? { wins: c.wins, losses: c.losses, ties: c.ties ?? 0 } : null,
      rp: pre ? null : c.rp,
      tier, reason,
    });
  }
  // Biggest gaps first; the surer call breaks ties.
  const pick = (dir: DisagreementRow["direction"]) => rows.filter((r) => r.direction === dir).sort((a, b) => b.gap - a.gap || b.z - a.z || a.team - b.team).slice(0, RULES.perSide);
  return { ...base, compared: n, hidden: null, rows: [...pick("model-higher"), ...pick("seed-higher")], rules };
}
