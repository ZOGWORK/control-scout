// Slice tags for the engine error report (Prediction Engine program, Part 1).
// Every tag is computed from what was known before the match, except the
// volatility quartile cut, which is a reporting threshold over the season's
// matches (it labels matches, it never feeds a prediction).
//
// Data tags describe the match and its robots and are shared by every model
// replayed over the corpus, so two models are always compared on the same
// matches in the same slice. Model tags (probability band, margin band)
// depend on the model's own call.

/** Least experienced robot on the field: its program's season count. */
export type Experience = "rookie" | "year2" | "veteran" | "unknown";

export interface DataTags {
  season: number;
  level: "qual" | "playoff";
  /** Qualification match number band within the event; "playoff" for playoff matches. */
  eventMatch: "q1-10" | "q11-25" | "q26+" | "playoff";
  /** Lowest event ordinal of the season among the robots (1st = some robot's first event). */
  teamEvent: "1st" | "2nd" | "3rd+";
  experience: Experience;
  /** Fewest rated matches this season among the robots, before this match. */
  teamMatches: "0-5" | "6-15" | "16+";
  /** All robots' rated matches this season, summed (thin < 24, i.e. under 6 a robot on average; dense ≥ 64). */
  density: "thin" | "normal" | "dense";
  /** Highest residual-variance EMA among robots with ≥ 6 rated matches, before this match (null: none qualifies). */
  volatilityScore: number | null;
  eventSize: "small" | "mid" | "large";
  eventType: "league meet" | "qualifier" | "championship" | "world" | "unrated";
}

export interface ModelTags {
  /** Favourite's stated probability band. */
  probBand: "50-60" | "60-70" | "70-80" | "80-90" | "90-100";
  /** |expected margin| in standard deviations of the margin. */
  margin: "close" | "clear" | "lopsided";
}

export const qualBand = (level: string, number: number): DataTags["eventMatch"] =>
  level !== "qual" ? "playoff" : number <= 10 ? "q1-10" : number <= 25 ? "q11-25" : "q26+";

export const ordinalBand = (k: number): DataTags["teamEvent"] => (k <= 1 ? "1st" : k === 2 ? "2nd" : "3rd+");

export function experienceOf(rookieYear: number | null | undefined, season: number): Experience {
  if (rookieYear == null || !Number.isFinite(rookieYear)) return "unknown";
  return rookieYear >= season ? "rookie" : rookieYear === season - 1 ? "year2" : "veteran";
}

const EXP_ORDER: Experience[] = ["rookie", "year2", "unknown", "veteran"];
/** The least experienced of the robots (unknown ranks just above veteran: it is usually an old record gap). */
export const leastExperienced = (xs: Experience[]): Experience =>
  xs.reduce((a, b) => (EXP_ORDER.indexOf(b) < EXP_ORDER.indexOf(a) ? b : a), "veteran" as Experience);

export const matchesBand = (n: number): DataTags["teamMatches"] => (n <= 5 ? "0-5" : n <= 15 ? "6-15" : "16+");

export const densityBand = (total: number): DataTags["density"] => (total < 24 ? "thin" : total < 64 ? "normal" : "dense");

export const sizeBand = (teams: number): DataTags["eventSize"] => (teams <= 16 ? "small" : teams <= 32 ? "mid" : "large");

export function typeGroup(type: string): DataTags["eventType"] {
  switch (type) {
    case "LeagueMeet": return "league meet";
    case "LeagueTournament": case "Qualifier": return "qualifier";
    case "Championship": case "SuperQualifier": case "Premier": return "championship";
    case "FIRSTChampionship": return "world";
    default: return "unrated";
  }
}

export function probBand(pRed: number): ModelTags["probBand"] {
  const f = Math.max(pRed, 1 - pRed);
  return f < 0.6 ? "50-60" : f < 0.7 ? "60-70" : f < 0.8 ? "70-80" : f < 0.9 ? "80-90" : "90-100";
}

export function marginBand(muR: number, muB: number, sdR: number, sdB: number): ModelTags["margin"] {
  const s = Math.sqrt(sdR * sdR + sdB * sdB);
  const z = s > 0 ? Math.abs(muR - muB) / s : 0;
  return z < 0.25 ? "close" : z < 1 ? "clear" : "lopsided";
}

/** Season bookkeeping the engine doesn't keep: the order of events each robot attended. */
export class EventOrdinals {
  private seen = new Map<number, string[]>();
  reset(): void { this.seen.clear(); }
  /** The robot's event ordinal for a match at `code` (registers the event on first sight). */
  ordinal(team: number, code: string): number {
    let evs = this.seen.get(team);
    if (!evs) { evs = []; this.seen.set(team, evs); }
    let i = evs.indexOf(code);
    if (i < 0) { evs.push(code); i = evs.length - 1; }
    return i + 1;
  }
}

/** Volatility tag from the season's quartile cut (null score: no robot has enough matches to measure). */
export const volatilityTag = (score: number | null, cut: number): "top quartile" | "rest" | "not measured" =>
  score == null ? "not measured" : score >= cut ? "top quartile" : "rest";

/** The q-quantile (linear interpolation) of finite values; NaN when empty. */
export function quantile(xs: number[], q: number): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
