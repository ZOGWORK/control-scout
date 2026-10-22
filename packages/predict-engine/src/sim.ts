// Predict — Layer 3: Monte Carlo simulation of a whole event.
//
// One run = one plausible version of the event:
//   1. each robot's true strength for the day ~ N(rating, rating uncertainty)
//      (drawn once per run — uncertainty about a team persists across matches);
//      each alliance score then adds game noise, spread per team (engine 2.6:
//      the score ranges' gameVariance, so erratic or low-sample robots spread wider);
//   2. unplayed qualification matches are simulated (played ones keep their
//      real results); ranking points + tiebreakers per season rules;
//   3. alliance selection: captains in rank order pick by a softmax over
//      perceived strength (fitted pick model), where a team that would
//      otherwise captain a later alliance may decline (captainAccept);
//   4. double-elimination playoffs on the real bracket;
//   5. advancement: 2025+ points (quals + alliance + playoffs + awards) or the
//      2024 fixed order, then slots, skipping teams that already qualified.
import type { TeamRating } from "./types.js";
import { DEFAULT_BAND, gameVariance, type BandParams, type NoiseParams } from "./matchModel.js";
import type { MatchContext } from "./contextual.js";
import {
  BRACKETS, ORDER_2024, allianceCount, allianceSelectionPoints, awardPoints, compareAdvancement, playoffPoints, qualPoints, rankingPoints, tiebreakKeys,
  type AdvancementEntry, type Slot,
} from "./rules.js";
import { npOf } from "./rating.js";

// ---------------------------------------------------------------------------
// Random numbers (seeded, so results are reproducible)
// ---------------------------------------------------------------------------

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One alliance of a played match. `bonus` is the recorded bonus RPs (flags, or a count); when
 *  it is missing (not reported) a 2025+ simulation samples it every run. */
export interface PlayedSide { total: number; np: number; auto: number; endgame: number; bonus?: { movement: boolean; goal: boolean; pattern: boolean } | number; tips?: number }
export interface PlayedResult { red: PlayedSide; blue: PlayedSide }

export interface QualMatch {
  red: number[];
  blue: number[];
  result?: PlayedResult;
  /** Surrogates: they play, but the match doesn't count toward their rank. */
  noRank?: number[];
  /** Disqualified in this (played) match: 0 ranking points and 0 for every sort
   *  criterion for that team only (T601); the match still counts as played. */
  dq?: number[];
}

/** P(bonus RP) = logistic(c0 + c1 · alliance non-penalty score), per bonus (2025+). */
export interface BonusModel { movement: [number, number]; goal: [number, number]; pattern: [number, number] }

/**
 * Captain's pick: softmax over candidates of (strength / tau − rankWeight · rank / n).
 * A candidate who would captain a later alliance if left unpicked can
 * decline the invitation; captainAccept (0–1, default 1 = never declines)
 * scales that candidate's weight by the chance they accept.
 */
export interface PickModel { tau: number; rankWeight: number; captainAccept?: number }

export const DEFAULT_PICK: PickModel = { tau: 12, rankWeight: 0 };

/**
 * Pick weights for the captain of alliance `k` (0-based) of `A`, over the
 * still-unpicked `cands` in rank order. Shared by the simulation and the
 * pick-model fit so both describe the same choice.
 */
export function pickWeights(pm: PickModel, cands: number[], k: number, A: number, strength: (t: number) => number, rank: (t: number) => number, n: number): number[] {
  // Left unpicked, the best-ranked remaining teams captain the alliances still to form.
  const laterCaptains = new Set(cands.slice(0, Math.max(0, A - k - 1)));
  const accept = pm.captainAccept ?? 1;
  return cands.map((t) => Math.exp(strength(t) / pm.tau - pm.rankWeight * (rank(t) / n)) * (laterCaptains.has(t) ? accept : 1));
}

export type AwardInput =
  | { mode: "none" }
  | { mode: "actual"; awards: Map<number, { type: string; placement: number }[]> }
  | { mode: "sample"; sample: (r: () => number) => Map<number, { type: string; placement: number }[]> };

export interface SimInput {
  season: number;
  ratings: Map<number, TeamRating>;
  quals: QualMatch[];
  noise: NoiseParams;
  /**
   * Per-robot score variance inputs (engine 2.6), read from the rating book
   * (teamScoreVariance): the per-team variance factor and matches played.
   * With it, every simulated alliance score's game noise is gameVariance —
   * the spread the stated score ranges are drawn from (per-team consistency,
   * small samples, playoffs) — so an alliance of erratic or new robots spreads
   * wider. Without it, the plain σ = a + b·mean of engine 2.5 and earlier.
   * A robot missing from the map counts as consistency 1 with 0 matches.
   */
  variance?: Map<number, { consistency: number; matches: number }>;
  /** Band parameters for `variance` (default DEFAULT_BAND, the same as FITTED_MODEL.band). */
  band?: BandParams;
  bonus?: BonusModel;
  /**
   * Seasons without a fitted bonus model: recorded bonus-RP counts of this
   * event's played qualification alliances. Unplayed (or unreported)
   * alliances draw from them, so played and simulated matches count bonus
   * RPs on the same scale. Empty or missing = no bonus RPs simulated.
   */
  bonusSamples?: number[];
  pick?: PickModel;
  /** Alliances already selected (captain first), if selection has happened. */
  alliances?: number[][];
  /** Final quals ranks, if quals are over (skips simulating rankings). */
  ranks?: Map<number, number>;
  awards: AwardInput;
  /** Teams already qualified elsewhere (their slot passes down). */
  prequalified: Set<number>;
  ineligible?: Set<number>;
  slots: number;
  /** Partner scenario: force `team`'s alliance to include `partner`. */
  forcePartner?: { team: number; partner: number };
  /**
   * Playoff matches already played: bracket match number (1-based; for a
   * 2-alliance final, the game number) → winning alliance number. These keep
   * their real result; only the rest of the bracket is simulated.
   */
  playoffPlayed?: Map<number, number>;
  runs: number;
  seed?: number;
}

export interface TeamOutcome {
  team: number;
  pAdvance: number;
  pCaptain: number;
  pPicked: number;
  pWin: number;
  pFinalist: number;
  meanRank: number;
  rankP10: number;
  rankP90: number;
  /** 2025+: expected advancement points by component. */
  points: { quals: number; alliance: number; playoffs: number; awards: number; total: number };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const QUAL: MatchContext = { level: "qual" };
const PLAYOFF: MatchContext = { level: "playoff" };

export function simulateEvent(input: SimInput): Map<number, TeamOutcome> {
  const r = rng(input.seed ?? 1);
  // Every team that can matter: scheduled, ranked or already on an alliance.
  const teams = [...new Set([
    ...input.quals.flatMap((m) => [...m.red, ...m.blue]),
    ...(input.ranks ? [...input.ranks.keys()] : []),
    ...(input.alliances ?? []).flat(),
  ])];
  const pick = input.pick ?? DEFAULT_PICK;
  const vr = input.variance, band = input.band ?? DEFAULT_BAND;
  const acc = new Map(teams.map((t) => [t, { adv: 0, cap: 0, picked: 0, win: 0, fin: 0, ranks: [] as number[], q: 0, a: 0, p: 0, w: 0 }]));
  const rating = (t: number): TeamRating => input.ratings.get(t) ?? { auto: 0, teleop: 0, endgame: 0, pen: 0, n: 0, uncertainty: 400 };
  // Bonus RPs for an alliance whose achievements aren't known: the season's
  // fitted model (from its non-penalty score) or this event's recorded mix.
  const sampleBonus = (np: number): { movement: boolean; goal: boolean; pattern: boolean } | number | undefined => {
    if (input.season < 2025) return undefined;
    const bm = input.bonus;
    if (bm) return { movement: r() < logistic(bm.movement[0] + bm.movement[1] * np), goal: r() < logistic(bm.goal[0] + bm.goal[1] * np), pattern: r() < logistic(bm.pattern[0] + bm.pattern[1] * np) };
    const xs = input.bonusSamples;
    return xs?.length ? xs[Math.floor(r() * xs.length)] : undefined;
  };

  for (let run = 0; run < input.runs; run++) {
    // 1. True strength for this run.
    const str = new Map<number, { np: number; autoShare: number; egShare: number; pen: number; cons: number; games: number }>();
    for (const t of teams) {
      const rt = rating(t);
      const np = Math.max(0, npOf(rt) + normal(r) * Math.sqrt(rt.uncertainty));
      const base = Math.max(1e-6, npOf(rt));
      const v = vr?.get(t);
      str.set(t, { np, autoShare: rt.auto / base, egShare: rt.endgame / base, pen: rt.pen, cons: v ? v.consistency : 1, games: v ? v.matches : 0 });
    }
    const playScore = (own: number[], opp: number[], playoff = false) => {
      let mean = 0, pen = 0, auto = 0, eg = 0, cons = 0, fewest = Infinity;
      for (const t of own) { const s = str.get(t)!; mean += s.np; auto += s.np * s.autoShare; eg += s.np * s.egShare; cons += s.cons; if (s.games < fewest) fewest = s.games; }
      for (const t of opp) pen += str.get(t)!.pen;
      const sd = vr
        ? Math.sqrt(gameVariance(mean + pen, own.length ? cons / own.length : 1, own.length ? fewest : 0, input.noise, band, playoff ? PLAYOFF : QUAL))
        : input.noise.a + input.noise.b * Math.max(0, mean + pen);
      const np = Math.max(0, mean + normal(r) * sd);
      const f = mean > 0 ? np / mean : 1;
      return { np, total: np + Math.max(0, pen + normal(r) * Math.sqrt(Math.max(pen, 1))), auto: auto * f, endgame: eg * f };
    };

    // 2. Quals → ranks. Per-team qualification stats feed the ranking
    // tiebreaks and, for 2025+, the advancement tiebreaks; with official
    // ranks they come from the played matches alone.
    const st = new Map(teams.map((t) => [t, { rp: 0, n: 0, np: 0, auto: 0, eg: 0, tips: 0, best: 0, second: 0 }]));
    const ZERO = { np: 0, auto: 0, endgame: 0, tips: 0 };
    const tally = (t: number, own: { np: number; auto: number; endgame: number; tips?: number }, rp: number, dq = false) => {
      const s = st.get(t)!;
      if (dq) { own = ZERO; rp = 0; } // T601: counts as a match with zeros for this team only
      s.rp += rp; s.n++; s.np += own.np; s.auto += own.auto; s.eg += own.endgame; s.tips += own.tips ?? 0;
      if (own.np > s.best) { s.second = s.best; s.best = own.np; } else if (own.np > s.second) s.second = own.np;
    };
    let rankOf: Map<number, number>;
    if (input.ranks) {
      rankOf = input.ranks;
      if (input.season >= 2025) for (const m of input.quals) {
        if (!m.result) continue;
        for (const [side, own] of [[m.red, m.result.red], [m.blue, m.result.blue]] as const) for (const t of side) if (!m.noRank?.includes(t)) tally(t, own, 0, !!m.dq?.includes(t));
      }
    } else {
      for (const m of input.quals) {
        let res = m.result;
        if (!res) {
          const red = playScore(m.red, m.blue), blue = playScore(m.blue, m.red);
          res = { red: { ...red, bonus: sampleBonus(red.np) }, blue: { ...blue, bonus: sampleBonus(blue.np) } };
        }
        for (const [side, own, opp] of [[m.red, res.red, res.blue], [m.blue, res.blue, res.red]] as const) {
          // A played alliance whose bonus RPs weren't reported: sample them.
          const scored = own.bonus !== undefined || input.season < 2025 ? own : { ...own, bonus: sampleBonus(own.np) };
          const rp = rankingPoints(input.season, scored, opp);
          for (const t of side) { if (m.noRank?.includes(t)) continue; tally(t, own, rp, !!m.dq?.includes(t)); }
        }
      }
      const order = teams.filter((t) => st.get(t)!.n > 0).sort((x, y) => {
        const a = st.get(x)!, b = st.get(y)!;
        const d = b.rp / b.n - a.rp / a.n;
        if (Math.abs(d) > 1e-9) return d;
        const ka = tiebreakKeys(input.season, { np: a.np / a.n, auto: a.auto / a.n, endgame: a.eg / a.n, tips: a.tips / a.n });
        const kb = tiebreakKeys(input.season, { np: b.np / b.n, auto: b.auto / b.n, endgame: b.eg / b.n, tips: b.tips / b.n });
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
        return r() - 0.5;
      });
      rankOf = new Map(order.map((t, i) => [t, i + 1]));
    }
    const ranked = [...rankOf.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
    const n = ranked.length;
    for (const [t, rk] of rankOf) acc.get(t)?.ranks.push(rk);

    // 3. Alliance selection.
    let alliances: number[][];
    if (input.alliances) alliances = input.alliances;
    else {
      const A = allianceCount(n);
      const taken = new Set<number>();
      alliances = [];
      const fpair = input.forcePartner;
      for (let k = 0; k < A; k++) {
        let captain = ranked.find((t) => !taken.has(t));
        // A forced pair must get an alliance: if it is still unplaced when the
        // last alliance is formed, its higher-seeded team captains it.
        if (fpair && k === A - 1 && !taken.has(fpair.team) && !taken.has(fpair.partner)) {
          captain = (rankOf.get(fpair.team) ?? Infinity) <= (rankOf.get(fpair.partner) ?? Infinity) ? fpair.team : fpair.partner;
        }
        if (captain == null) break;
        taken.add(captain);
        let partner: number | undefined;
        const fp = input.forcePartner;
        // Partner scenario: the pair is protected — whichever of the two is
        // seeded first captains and takes the other; no one else can pick them.
        const forced = fp && (captain === fp.team || captain === fp.partner) ? (captain === fp.team ? fp.partner : fp.team) : undefined;
        if (forced != null && !taken.has(forced)) partner = forced;
        else {
          const cands = ranked.filter((t) => !taken.has(t) && !(fp && (t === fp.team || t === fp.partner)));
          if (cands.length) {
            const w = pickWeights(pick, cands, k, A, (t) => str.get(t)!.np, (t) => rankOf.get(t)!, n);
            const sum = w.reduce((a, b) => a + b, 0);
            let x = r() * sum, i = 0;
            while (i < w.length - 1 && (x -= w[i]) > 0) i++;
            partner = cands[i];
          }
        }
        if (partner != null) taken.add(partner);
        alliances.push(partner != null ? [captain, partner] : [captain]);
      }
    }
    alliances.forEach((al, i) => {
      const c = acc.get(al[0]); if (c) c.cap++;
      for (const t of al.slice(1)) { const p = acc.get(t); if (p) p.picked++; }
      void i;
    });

    // 4. Playoffs → place per alliance number (1-based).
    const place = new Map<number, number>();
    const A = alliances.length;
    // Only two robots of an alliance play a match. A three-team alliance (a
    // second pick) fields its two strongest robots of this run; all members
    // still share the alliance's place for advancement.
    const lineups = alliances.map((al) => (al.length <= 2 ? al : [...al].sort((x, y) => (str.get(y)?.np ?? 0) - (str.get(x)?.np ?? 0)).slice(0, 2)));
    const strengthOf = (k: number) => lineups[k - 1];
    const playMatch = (a: number, b: number) => {
      const sa = playScore(strengthOf(a), strengthOf(b), true), sb = playScore(strengthOf(b), strengthOf(a), true);
      return sa.total === sb.total ? (r() < 0.5 ? a : b) : sa.total > sb.total ? a : b;
    };
    const played = input.playoffPlayed;
    if (A === 2) {
      let w1 = 0, w2 = 0, game = 0;
      while (w1 < 2 && w2 < 2) { game++; ((played?.get(game) ?? playMatch(1, 2)) === 1 ? w1++ : w2++); }
      place.set(w1 === 2 ? 1 : 2, 1); place.set(w1 === 2 ? 2 : 1, 2);
    } else if (BRACKETS[A]) {
      const br = BRACKETS[A];
      const win: number[] = [], lose: number[] = [];
      const who = (s: Slot) => ("seed" in s ? s.seed : "winnerOf" in s ? win[s.winnerOf] : lose[s.loserOf]);
      // A played match keeps its real winner (if it's one of the two alliances in that slot).
      const decide = (k: number, a: number, b: number) => { const real = played?.get(k); return real === a || real === b ? real : playMatch(a, b); };
      br.matches.forEach((m, i) => {
        const a = who(m.red), b = who(m.blue);
        const w = decide(i + 1, a, b);
        win[i + 1] = w; lose[i + 1] = w === a ? b : a;
      });
      const gf = br.matches.length;
      const upper = who(br.matches[gf - 1].red);
      let champ = win[gf], runner = lose[gf];
      if (champ !== upper) { const w = decide(gf + 1, upper, champ); champ = w; runner = w === upper ? win[gf] : upper; }
      place.set(champ, 1); place.set(runner, 2);
      br.places.forEach((ms, i) => { for (const m of ms) place.set(lose[m], 3 + i); });
    }

    // 5. Awards + advancement.
    const awards = input.awards.mode === "actual" ? input.awards.awards : input.awards.mode === "sample" ? input.awards.sample(r) : new Map();
    const seatOf = new Map<number, { k: number; seat: "captain" | "pick1" | "other" }>();
    alliances.forEach((al, i) => al.forEach((t, j) => seatOf.set(t, { k: i + 1, seat: j === 0 ? "captain" : j === 1 ? "pick1" : "other" })));
    for (const [k, p] of place) for (const t of alliances[k - 1] ?? []) { const c = acc.get(t); if (!c) continue; if (p === 1) c.win++; if (p === 2) c.fin++; }

    const advanced: number[] = [];
    const eligible = (t: number) => !input.prequalified.has(t) && !input.ineligible?.has(t) && !advanced.includes(t);
    if (input.season >= 2025) {
      const pts = ranked.map((t) => {
        const s = seatOf.get(t);
        const q = qualPoints(rankOf.get(t)!, n);
        const a = allianceSelectionPoints(s?.k ?? null, s?.seat ?? null);
        const p = s ? playoffPoints(place.get(s.k) ?? null) : 0;
        const w = awardPoints(awards.get(t) ?? []);
        const c = acc.get(t);
        if (c) { c.q += q; c.a += a; c.p += p; c.w += w; }
        const qs = st.get(t);
        const games = qs?.n ?? 0;
        const entry: AdvancementEntry = {
          total: q + a + p + w, awards: w, playoffs: p, alliance: a, quals: q,
          avgNp: games ? qs!.np / games : 0, avgAuto: games ? qs!.auto / games : 0, bestNp: qs?.best ?? 0, secondNp: qs?.second ?? 0,
        };
        return { t, entry };
      });
      // Official order (Table 4-2); teams tied on every criterion are drawn in
      // a uniformly random order (a shuffle of each tied group, not a random
      // comparator, which would be biased by the sort's comparison order).
      pts.sort((x, y) => compareAdvancement(x.entry, y.entry));
      for (let i = 0; i < pts.length;) {
        let j = i + 1;
        while (j < pts.length && compareAdvancement(pts[i].entry, pts[j].entry) === 0) j++;
        for (let k = j - 1; k > i; k--) { const m = i + Math.floor(r() * (k - i + 1)); [pts[k], pts[m]] = [pts[m], pts[k]]; }
        i = j;
      }
      for (const p of pts) { if (advanced.length >= input.slots) break; if (eligible(p.t)) advanced.push(p.t); }
    } else {
      const byPlace = (pl: number) => { for (const [k, p] of place) if (p === pl) return alliances[k - 1]; return undefined; };
      const awardWinner = (type: string, placement: number) => { for (const [t, as] of awards) if (as.some((a) => a.type === type && a.placement === placement)) return t; return undefined; };
      for (const slot of ORDER_2024) {
        if (advanced.length >= input.slots) break;
        let t: number | undefined;
        if ("award" in slot) t = awardWinner(slot.award, slot.placement);
        else if ("alliance" in slot) { const al = byPlace(slot.alliance === "winner" ? 1 : slot.alliance === "finalist" ? 2 : 3); t = al?.[slot.seat === "captain" ? 0 : 1]; }
        else t = ranked.find(eligible);
        if (t != null && eligible(t)) advanced.push(t);
      }
      // Remaining slots go down the ranking (next highest not yet advanced).
      for (const t of ranked) { if (advanced.length >= input.slots) break; if (eligible(t)) advanced.push(t); }
    }
    for (const t of advanced) { const c = acc.get(t); if (c) c.adv++; }
  }

  const out = new Map<number, TeamOutcome>();
  const R = input.runs;
  for (const [t, c] of acc) {
    const rs = [...c.ranks].sort((a, b) => a - b);
    const q = (p: number) => rs.length ? rs[Math.min(rs.length - 1, Math.floor(p * rs.length))] : NaN;
    out.set(t, {
      team: t,
      pAdvance: c.adv / R, pCaptain: c.cap / R, pPicked: c.picked / R, pWin: c.win / R, pFinalist: c.fin / R,
      meanRank: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN, rankP10: q(0.1), rankP90: q(0.9),
      points: { quals: c.q / R, alliance: c.a / R, playoffs: c.p / R, awards: c.w / R, total: (c.q + c.a + c.p + c.w) / R },
    });
  }
  return out;
}
