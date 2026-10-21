// Predict — partnership memory (engine 2.2): what two teams have actually
// done together (same alliance) and against each other, across seasons.
//
// For every played match, each alliance's standardized residual is measured
// against the expectation of a rating book that has seen only earlier
// matches (allianceResidual: (actual NP − expected NP) / σ). That residual is
// season-free — a DECODE point and a CENTERSTAGE point are never compared —
// so pairs from 2019–20 onward share one scale. Per pair we keep:
//   together: matches, W–L–T, the season-decayed residual sum, and the best
//             final score the two posted together (with where);
//   against:  meetings, the first team's W–L–T, the decayed margin residual.
//
// A pair's effect is SHRUNK toward zero: effect = Σ w·z / (Σ w + k), with w =
// decay^(seasons ago). One match together barely moves it; k is fitted on
// held-out seasons (scripts/partnership-fit.ts). The model then nudges the win
// probability on the logit scale:
//   logit P' = logit P + βT · (effect(red pair) − effect(blue pair)) + βA · Σ effect(red i vs blue j)
// β = 0 is "facts only": the history is shown as a reason, the odds don't move.
//
// Pure, deterministic, browser-safe: the same table gives the same answer on
// the server and on a device (the offline pack ships it).
import { RatingBook, allianceResidual, type RatingBookData, type RatingParams } from "./rating.js";
import type { MatchRecord } from "./types.js";

export interface PartnershipParams {
  /** Shrinkage strength: pseudo-matches of "no effect" every pair starts with. */
  k: number;
  /** Weight of a match s seasons before the one predicted: decay^s. */
  seasonDecay: number;
  /** Logit shift per unit of (red pair effect − blue pair effect). 0 = facts only. */
  betaTogether: number;
  /** Logit shift per unit of summed head-to-head effect (red i vs blue j). 0 = facts only. */
  betaAgainst: number;
  /** Same-alliance pairs with fewer matches together are dropped at each season's end. */
  minMatches: number;
  /** Opponent pairs with fewer meetings are dropped at each season's end (they dominate the table). */
  minMeetings: number;
  /** Pairs last seen more than this many seasons ago are dropped. */
  maxSeasonsAgo: number;
}

/** Frozen 2.2 settings (Control Scout docs/partnership-memory.md, scripts/partnership-fit.ts):
 *  β fitted on 2023–24, decay and k chosen on 2024–25 (decay 1, k 4), then judged on held-out
 *  2025–26. There the fitted shift made the odds slightly WORSE (Brier +0.000083, 95% interval
 *  [+0.00002, +0.00016]), so both β are 0: 2.2 shows the history as a reason and never moves
 *  the odds. k = 4 is the fitted shrinkage; decay 0.5 (the fitted 1 tied it on the select
 *  block) only ranks and words the fact, favouring recent seasons. */
export const PARTNERSHIP_PARAMS: PartnershipParams = {
  k: 4,
  seasonDecay: 0.5,
  betaTogether: 0,
  betaAgainst: 0,
  minMatches: 2,
  minMeetings: 3,
  maxSeasonsAgo: 6,
};

/** Same alliance: matches, record, decayed residual sum, best final score together. */
export interface TogetherStat {
  n: number; wins: number; losses: number; ties: number;
  /** Decayed weight Σ w and residual Σ w·z, as of season `season`. */
  w: number; z: number;
  /** Season of the pair's latest match together. */
  season: number;
  /** Best final score together, and the season + event code it came at. */
  best: number; bestSeason: number; bestEvent: string;
}

/** Opposite alliances, from the LOWER team number's side. */
export interface AgainstStat {
  n: number; wins: number; losses: number; ties: number;
  w: number; z: number;
  season: number;
}

/** A PartnershipBook's whole state (to resume accumulating later, e.g. after the finished seasons). */
export interface PartnershipState {
  version: 1;
  params: PartnershipParams;
  season: number | null;
  book: RatingBookData;
  together: [number, TogetherStat][];
  against: [number, AgainstStat][];
  names: [string, string][];
}

/** Read-only view the prediction uses (a live PartnershipBook, or a table loaded from data). */
export interface PairLookup {
  together(a: number, b: number): TogetherStat | undefined;
  against(a: number, b: number): AgainstStat | undefined;
  /** Display name of an event ("NJ Championship"), when known. */
  eventName(season: number, code: string): string | null;
}

/** Serialized table (offline pack, server cache). Rows are flat arrays to keep it small. */
export interface PartnershipData {
  version: 1;
  /** Season the table was built through. */
  season: number | null;
  /** [a, b, n, wins, losses, ties, w, z, season, best, bestSeason, bestEventIndex] */
  together: number[][];
  /** [a, b, n, wins, losses, ties, w, z, season] (a < b; record is a's) */
  against: number[][];
  /** [season, code, name] referenced by together rows' bestEventIndex. */
  events: [number, string, string][];
}

const key = (a: number, b: number) => (a < b ? a * 1e6 + b : b * 1e6 + a);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** A shrunk pair effect at `season` (0 for unknown or too-old pairs). */
export function shrunkEffect(s: { n: number; w: number; z: number; season: number } | undefined, season: number, p: PartnershipParams, min = p.minMatches): number {
  if (!s || s.n < min) return 0;
  const ago = Math.max(0, season - s.season);
  if (ago > p.maxSeasonsAgo) return 0;
  const f = p.seasonDecay ** ago;
  return (s.z * f) / (s.w * f + p.k);
}

/** The logit shift for red vs blue (0 when both β are 0 or nothing is known). */
export function partnershipShift(t: PairLookup, red: number[], blue: number[], season: number, p: PartnershipParams = PARTNERSHIP_PARAMS): number {
  if (!p.betaTogether && !p.betaAgainst) return 0;
  const { together, against } = partnershipFeatures(t, red, blue, season, p);
  return p.betaTogether * together + p.betaAgainst * against;
}

/** The two model inputs: pair-effect difference and summed head-to-head effect (red's view). */
export function partnershipFeatures(t: PairLookup, red: number[], blue: number[], season: number, p: PartnershipParams = PARTNERSHIP_PARAMS): { together: number; against: number } {
  const pairs = (xs: number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) s += shrunkEffect(t.together(xs[i], xs[j]), season, p);
    return s;
  };
  let h2h = 0;
  for (const r of red) for (const b of blue) {
    const e = shrunkEffect(t.against(r, b), season, p, p.minMeetings);
    h2h += r < b ? e : -e;
  }
  return { together: pairs(red) - pairs(blue), against: h2h };
}

/** Accumulates the pair table from played matches, in time order (seasons ascending). */
export class PartnershipBook implements PairLookup {
  /** Its own rating book: expectations come from earlier matches only (walk-forward). */
  private book: RatingBook;
  season: number | null = null;
  private tog = new Map<number, TogetherStat>();
  private ag = new Map<number, AgainstStat>();
  private names = new Map<string, string>();

  constructor(rating: Partial<RatingParams> = {}, readonly params: PartnershipParams = PARTNERSHIP_PARAMS) {
    this.book = new RatingBook(rating);
  }

  /** Remember an event's display name (used in the facts). */
  nameEvent(season: number, code: string, name: string): void { this.names.set(`${season}|${code}`, name); }
  eventName(season: number, code: string): string | null { return this.names.get(`${season}|${code}`) ?? null; }

  together(a: number, b: number): TogetherStat | undefined { return this.tog.get(key(a, b)); }
  against(a: number, b: number): AgainstStat | undefined { return this.ag.get(key(a, b)); }
  get size(): { together: number; against: number } { return { together: this.tog.size, against: this.ag.size }; }

  /** Everything needed to carry on observing (JSON-safe: a pair's best is finite once it has played). */
  toState(): PartnershipState {
    return {
      version: 1, params: this.params, season: this.season, book: this.book.toData(),
      together: [...this.tog].map(([k, t]) => [k, { ...t }]), against: [...this.ag].map(([k, a]) => [k, { ...a }]), names: [...this.names],
    };
  }

  static fromState(s: PartnershipState): PartnershipBook {
    const b = new PartnershipBook(s.book.params, s.params);
    b.book = RatingBook.fromData(s.book);
    b.season = s.season;
    for (const [k, t] of s.together) b.tog.set(k, { ...t });
    for (const [k, a] of s.against) b.ag.set(k, { ...a });
    for (const [k, n] of s.names) b.names.set(k, n);
    return b;
  }

  clone(): PartnershipBook { return PartnershipBook.fromState(this.toState()); }

  /** Fold one played match in (call in time order). Scrimmages should not be passed. */
  observe(m: MatchRecord): void {
    if (this.season !== m.season) this.startSeason(m.season);
    const s = m.season;
    const red = this.book.allianceExpectation(m.red.teams), blue = this.book.allianceExpectation(m.blue.teams);
    const zr = allianceResidual(red, m.red.np).z, zb = allianceResidual(blue, m.blue.np).z;
    const clip = (z: number) => Math.max(-4, Math.min(4, z));
    const cr = clip(zr), cb = clip(zb);
    const res = m.red.total > m.blue.total ? 1 : m.red.total < m.blue.total ? -1 : 0;
    for (const [side, z, total, won] of [[m.red, cr, m.red.total, res], [m.blue, cb, m.blue.total, -res]] as const) {
      const ts = side.teams;
      for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
        const k = key(ts[i], ts[j]);
        let t = this.tog.get(k);
        if (!t) { t = { n: 0, wins: 0, losses: 0, ties: 0, w: 0, z: 0, season: s, best: -Infinity, bestSeason: s, bestEvent: m.eventCode }; this.tog.set(k, t); }
        decay(t, s, this.params.seasonDecay);
        t.n++; t.w += 1; t.z += z;
        if (won > 0) t.wins++; else if (won < 0) t.losses++; else t.ties++;
        if (total > t.best) { t.best = total; t.bestSeason = s; t.bestEvent = m.eventCode; }
      }
    }
    // Head to head: the margin residual (red − blue) / √2, from the lower number's side.
    const zm = clip((zr - zb) / Math.SQRT2);
    for (const r of m.red.teams) for (const b of m.blue.teams) {
      if (r === b) continue;
      const k = key(r, b), sign = r < b ? 1 : -1;
      let a = this.ag.get(k);
      if (!a) { a = { n: 0, wins: 0, losses: 0, ties: 0, w: 0, z: 0, season: s }; this.ag.set(k, a); }
      decay(a, s, this.params.seasonDecay);
      a.n++; a.w += 1; a.z += sign * zm;
      const lowWon = res * sign;
      if (lowWon > 0) a.wins++; else if (lowWon < 0) a.losses++; else a.ties++;
    }
    this.book.update(m);
  }

  /** Close the current season: drop its weak pairs now (exactly what starting the next season
   *  would do), e.g. before storing the state. Only between seasons. */
  endSeason(): void {
    if (this.season != null) this.prune(this.season + 1);
  }

  private startSeason(season: number): void {
    if (this.season != null) this.prune(season);
    this.book.startSeason(season);
    this.season = season;
  }

  /** Drop weak pairs (fewer than minMatches / minMeetings) and old ones (beyond maxSeasonsAgo of `season`). */
  private prune(season: number): void {
    const p = this.params;
    for (const [k, t] of this.tog) if (t.n < p.minMatches || season - t.season > p.maxSeasonsAgo) this.tog.delete(k);
    for (const [k, a] of this.ag) if (a.n < p.minMeetings || season - a.season > p.maxSeasonsAgo) this.ag.delete(k);
    const used = new Set([...this.tog.values()].map((t) => `${t.bestSeason}|${t.bestEvent}`));
    for (const k of this.names.keys()) if (!used.has(k)) this.names.delete(k);
  }

  /**
   * The pruned table as data (what predictions read). Predictions ignore pairs
   * under minMatches / minMeetings and beyond maxSeasonsAgo, so dropping them here changes
   * no answer. `teams`, when given, keeps only pairs whose both teams are in it.
   */
  toData(opts: { teams?: Set<number> } = {}): PartnershipData {
    const p = this.params, season = this.season ?? 0;
    const keep = (a: number, b: number, n: number, s: number, min: number) =>
      (!opts.teams || (opts.teams.has(a) && opts.teams.has(b))) && season - s <= p.maxSeasonsAgo && n >= min;
    const events: [number, string, string][] = [];
    const evIndex = new Map<string, number>();
    const together: number[][] = [];
    for (const [k, t] of this.tog) {
      const a = Math.floor(k / 1e6), b = k % 1e6;
      if (!keep(a, b, t.n, t.season, p.minMatches)) continue;
      const ek = `${t.bestSeason}|${t.bestEvent}`;
      let ei = evIndex.get(ek);
      if (ei == null) { ei = events.length; evIndex.set(ek, ei); events.push([t.bestSeason, t.bestEvent, this.names.get(ek) ?? t.bestEvent]); }
      together.push([a, b, t.n, t.wins, t.losses, t.ties, r4(t.w), r4(t.z), t.season, t.best, t.bestSeason, ei]);
    }
    const against: number[][] = [];
    for (const [k, x] of this.ag) {
      const a = Math.floor(k / 1e6), b = k % 1e6;
      if (!keep(a, b, x.n, x.season, p.minMeetings)) continue;
      against.push([a, b, x.n, x.wins, x.losses, x.ties, r4(x.w), r4(x.z), x.season]);
    }
    return { version: 1, season: this.season, together, against, events };
  }
}

/** Bring a stat's decayed sums forward to `season`. */
function decay(s: { w: number; z: number; season: number }, season: number, d: number): void {
  if (season > s.season) { const f = d ** (season - s.season); s.w *= f; s.z *= f; s.season = season; }
}

/** A table loaded from PartnershipData (offline pack, server cache). */
export class PartnershipTable implements PairLookup {
  private tog = new Map<number, TogetherStat>();
  private ag = new Map<number, AgainstStat>();
  private names = new Map<string, string>();
  readonly season: number | null;

  constructor(d: PartnershipData) {
    this.season = d.season;
    for (const [season, code, name] of d.events) this.names.set(`${season}|${code}`, name);
    for (const r of d.together) {
      const ev = d.events[r[11]];
      this.tog.set(key(r[0], r[1]), { n: r[2], wins: r[3], losses: r[4], ties: r[5], w: r[6], z: r[7], season: r[8], best: r[9], bestSeason: r[10], bestEvent: ev?.[1] ?? "" });
    }
    for (const r of d.against) this.ag.set(key(r[0], r[1]), { n: r[2], wins: r[3], losses: r[4], ties: r[5], w: r[6], z: r[7], season: r[8] });
  }

  static fromData(d: PartnershipData | null | undefined): PartnershipTable | null {
    return d && d.version === 1 ? new PartnershipTable(d) : null;
  }

  together(a: number, b: number): TogetherStat | undefined { return this.tog.get(key(a, b)); }
  against(a: number, b: number): AgainstStat | undefined { return this.ag.get(key(a, b)); }
  eventName(season: number, code: string): string | null { return this.names.get(`${season}|${code}`) ?? null; }
}

// ---------------------------------------------------------------------------
// The fact shown with a prediction
// ---------------------------------------------------------------------------

export interface PartnershipFact {
  kind: "together" | "against";
  /** The two teams (together: same side; against: [side A team, side B team]). */
  teams: [number, number];
  /** Which side of the prediction the fact is about ("A" = red / the first alliance). */
  side: "A" | "B";
  matches: number;
  record: { wins: number; losses: number; ties: number };
  /** Together facts: best final score together and where. */
  best?: { score: number; season: number; event: string; eventName: string | null };
  /** Shrunk effect (residual σ units; + = better than ratings expected for `side`). */
  effect: number;
  /** Logit shift this match's odds took from the history (0 when facts only). */
  shift: number;
  /** Plain-language sentence. */
  label: string;
}

const seasonLabel = (s: number) => `${s}–${String((s + 1) % 100).padStart(2, "0")}`;
const rec = (x: { wins: number; losses: number; ties: number }) => `${x.wins}–${x.losses}${x.ties ? `–${x.ties}` : ""}`;

/**
 * The strongest real history between the robots in a lineup: a pair on the
 * same alliance (preferred: the brief's "scored 132 together at NJ Champs"),
 * else a head-to-head record. Ranked by recency-weighted matches, then by
 * how far the results ran from the ratings. Null when no pair has met.
 */
export function partnershipFact(t: PairLookup, teamsA: number[], teamsB: number[], season: number, p: PartnershipParams = PARTNERSHIP_PARAMS, shift = 0): PartnershipFact | null {
  type Cand = { score: number; fact: Omit<PartnershipFact, "label" | "shift"> };
  const cands: Cand[] = [];
  const weight = (n: number, s: number) => n * p.seasonDecay ** Math.max(0, season - s);
  for (const [side, xs] of [["A", teamsA], ["B", teamsB]] as const) {
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      const st = t.together(xs[i], xs[j]);
      if (!st || st.n < p.minMatches || season - st.season > p.maxSeasonsAgo) continue;
      const e = shrunkEffect(st, season, p);
      cands.push({
        score: 2 * weight(st.n, st.season) + Math.abs(e),
        fact: { kind: "together", teams: [xs[i], xs[j]], side, matches: st.n, record: { wins: st.wins, losses: st.losses, ties: st.ties },
          best: { score: st.best, season: st.bestSeason, event: st.bestEvent, eventName: t.eventName(st.bestSeason, st.bestEvent) }, effect: e },
      });
    }
  }
  for (const a of teamsA) for (const b of teamsB) {
    const st = t.against(a, b);
    if (!st || st.n < p.minMeetings || season - st.season > p.maxSeasonsAgo) continue;
    const flip = a > b; // stored from the lower number's side
    const e = shrunkEffect(st, season, p, p.minMeetings) * (flip ? -1 : 1);
    const record = flip ? { wins: st.losses, losses: st.wins, ties: st.ties } : { wins: st.wins, losses: st.losses, ties: st.ties };
    cands.push({ score: weight(st.n, st.season) + Math.abs(e), fact: { kind: "against", teams: [a, b], side: "A", matches: st.n, record, effect: e } });
  }
  if (!cands.length) return null;
  cands.sort((x, y) => y.score - x.score || x.fact.teams[0] - y.fact.teams[0] || x.fact.teams[1] - y.fact.teams[1]);
  const f = cands[0].fact;
  return { ...f, shift, label: factLabel(f, season) };
}

function factLabel(f: Omit<PartnershipFact, "label" | "shift">, season: number): string {
  const [a, b] = f.teams;
  const vsRatings = Math.abs(f.effect) >= 0.15 ? `, ${f.effect > 0 ? "above" : "below"} what their ratings expected` : "";
  if (f.kind === "together") {
    const best = f.best!;
    const where = `${best.eventName ?? best.event}${best.season === season ? "" : ` (${seasonLabel(best.season)})`}`;
    return `${a} and ${b} have played ${f.matches} match${f.matches === 1 ? "" : "es"} together (${rec(f.record)})${vsRatings}; best ${best.score} at ${where}`;
  }
  const lead = f.record.wins > f.record.losses ? `${a} leads ${b}` : f.record.wins < f.record.losses ? `${b} leads ${a}` : `${a} and ${b} are even`;
  const r = f.record.wins >= f.record.losses ? rec(f.record) : rec({ wins: f.record.losses, losses: f.record.wins, ties: f.record.ties });
  return `${lead} ${r} in ${f.matches} earlier meeting${f.matches === 1 ? "" : "s"}`;
}
