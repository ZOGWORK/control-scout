// The playoff bracket predictor: series-by-series calls and championship odds per alliance, read off the
// event's posted bracket and conditioned on the series already played.
//
// No new model. Every match probability is the engine's own playoff-level call (the caller's `price`, which
// on the server is the forecaster's explain at level "playoff": additive alliances, no overlap); a series
// of best-of-N is priced from that single-match chance; the bracket's shape is the engine's BRACKETS; and
// the championship odds are a small Monte Carlo over that bracket, seeded like the projections (runSeed).
//
// The format is read from what was posted, never assumed:
// - 2 alliances: one best-of-3 final;
// - 2024–25 on, 4/6/8 alliances: the engine's double-elimination brackets (single matches; the grand final
//   is replayed once if the lower-bracket alliance wins it);
// - 2023–24 and before, 4 alliances: two best-of-3 semifinals (1 v 4, 2 v 3) and a best-of-3 final;
// - anything else, or a posted result that doesn't fit the expected shape: "unknown", and only the posted
//   series are priced (calls, no championship odds).
//
// Pure (no Node APIs, no database): the server prices it per posted result (server/api/bracket.ts), the
// replay measures it (scripts/bracket-replay.ts), and the tests run it on fixtures.
import { BRACKETS, rng, type ConfidenceTier, type Slot } from "@control-scout/predict-engine";
import { runSeed, textSeed } from "./projectionCore.js";

export type BracketFormat = "double" | "final" | "classic" | "unknown";

/** One posted playoff match, reduced to what the bracket reads. */
export interface BracketMatch {
  series: number;
  number: number;
  red: number[];
  blue: number[];
  /** Final scores, when played. */
  redScore: number | null;
  blueScore: number | null;
}

export interface BracketAlliance {
  number: number;
  /** Captain and picks: the robots it fields. */
  teams: number[];
  /** A backup robot it brought in: counts as the alliance in posted line-ups, never fielded by the simulation. */
  backup?: number | null;
}

/** One single-match chance: P(the first alliance's lineup beats the second's), with the call's tier. */
export type Price = (a: number[], b: number[]) => { p: number; tier: ConfidenceTier };

export interface BracketSlotView {
  /** Where the side comes from: "Seed 1", "Winner M3", "Loser M5". */
  source: string;
  /** The alliance, once known. */
  alliance: number | null;
  /** While unknown: the likeliest alliance to fill it and how likely (simulated). */
  likely: { alliance: number; p: number } | null;
}

export interface BracketSeriesView {
  /** The bracket position (1-based), M1, M2, … */
  index: number;
  /** The series number the event posts for it. */
  series: number;
  label: string;
  stage: string;
  bestOf: number;
  red: BracketSlotView;
  blue: BracketSlotView;
  /** Series wins so far, red side then blue side. */
  wins: [number, number];
  /** The winning alliance, once decided. */
  winner: number | null;
  /** Both sides known and undecided: the favourite and its chance to win the series (from the current score). */
  call: { alliance: number; p: number; tier: ConfidenceTier } | null;
  /** A side still unknown: the likeliest winner of this series and how likely, from the simulation. */
  likely: { alliance: number; p: number } | null;
  /** The grand final's replay, played only if the lower-bracket alliance wins the first one. */
  ifNeeded: boolean;
  /** Not going to be played (an if-needed replay the upper alliance made unnecessary). */
  skipped: boolean;
  /** An if-needed replay whose grand final hasn't been decided yet: no call until it is. */
  pending: boolean;
}

export interface BracketAllianceOdds {
  alliance: number;
  status: "alive" | "out" | "champion";
  /** P(wins the event), from the simulation (exactly 0 or 1 once decided). */
  pChampion: number;
  /** P(plays in the final). */
  pFinal: number;
  /** Its toughest likely series still to play: where it most often loses (over every opponent there), its likeliest
   *  opponent in it, how often it plays that series, and its chance to win the series when it does. */
  danger: { index: number; label: string; opponent: number; pMeet: number; pWin: number } | null;
}

export interface BracketOdds {
  format: BracketFormat;
  /** Simulations behind the championship odds (0 for an unknown format). */
  runs: number;
  /** The weakest tier among the calls the odds rest on. */
  tier: ConfidenceTier;
  series: BracketSeriesView[];
  /** Per alliance, by number; empty for an unknown format. */
  alliances: BracketAllianceOdds[];
  /** A sentence when the format couldn't be read (why only calls show). */
  note: string | null;
}

// ---------------------------------------------------------------------------
// The bracket's shape

/** A node of the bracket: a series between two slots. */
interface Node { series: number; red: Slot; blue: Slot; bestOf: number; label: string; stage: string; ifNeeded?: boolean }

interface Shape { format: Exclude<BracketFormat, "unknown">; nodes: Node[] }

/** The first season of double-elimination playoffs (2024–25). */
export const DOUBLE_ELIM_FROM = 2024;

/** Stage names for a double-elimination bracket: upper and lower rounds, their finals, the grand final. */
function doubleStages(n: number): string[] {
  const br = BRACKETS[n];
  const lower: boolean[] = [];
  br.matches.forEach((m, i) => {
    const fromLower = (s: Slot) => "loserOf" in s || ("winnerOf" in s && lower[s.winnerOf - 1]);
    lower[i] = fromLower(m.red) || fromLower(m.blue);
  });
  const gf = br.matches.length - 1;
  const lastUpper = lower.slice(0, gf).lastIndexOf(false), lastLower = lower.slice(0, gf).lastIndexOf(true);
  return br.matches.map((_, i) => (i === gf ? "Grand final" : i === lastUpper ? "Upper final" : i === lastLower ? "Lower final" : lower[i] ? "Lower bracket" : "Upper bracket"));
}

/**
 * The bracket for this event, from its season, alliance count and posted series numbers (null: unknown).
 * A double-elimination event that numbers its series from 0 is shifted to the bracket's 1-based positions.
 */
export function bracketShape(season: number, alliances: number, postedSeries: number[]): Shape | null {
  const posted = [...new Set(postedSeries)].sort((a, b) => a - b);
  if (alliances === 2) {
    if (posted.length > 1) return null;
    return { format: "final", nodes: [{ series: posted[0] ?? 0, red: { seed: 1 }, blue: { seed: 2 }, bestOf: 3, label: "Final", stage: "Final" }] };
  }
  if (season < DOUBLE_ELIM_FROM) {
    if (alliances !== 4 || posted.some((s) => s < 0 || s > 2)) return null;
    return {
      format: "classic",
      nodes: [
        { series: 1, red: { seed: 1 }, blue: { seed: 4 }, bestOf: 3, label: "SF1", stage: "Semifinal" },
        { series: 2, red: { seed: 2 }, blue: { seed: 3 }, bestOf: 3, label: "SF2", stage: "Semifinal" },
        { series: 0, red: { winnerOf: 1 }, blue: { winnerOf: 2 }, bestOf: 3, label: "Final", stage: "Final" },
      ],
    };
  }
  const br = BRACKETS[alliances];
  if (!br) return null;
  const offset = posted[0] === 0 ? 1 : 0;
  const count = br.matches.length + 1; // + the if-needed replay
  if (posted.some((s) => s + offset < 1 || s + offset > count)) return null;
  const stages = doubleStages(alliances);
  const nodes: Node[] = br.matches.map((m, i) => ({ series: i + 1 - offset, red: m.red, blue: m.blue, bestOf: 1, label: `M${i + 1}`, stage: stages[i] }));
  const gf = br.matches.length;
  // The replay: the upper-bracket alliance (the grand final's red slot) against the lower one (its blue slot).
  nodes.push({ series: gf + 1 - offset, red: br.matches[gf - 1].red, blue: br.matches[gf - 1].blue, bestOf: 1, label: `M${gf + 1}`, stage: "Final (if needed)", ifNeeded: true });
  return { format: "double", nodes };
}

const slotSource = (s: Slot) => ("seed" in s ? `Seed ${s.seed}` : "winnerOf" in s ? `Winner M${s.winnerOf}` : `Loser M${s.loserOf}`);

// ---------------------------------------------------------------------------
// Series maths

/** P(an alliance wins a best-of-N series from a `w`–`l` score, each match won with chance p (ties replayed). */
export function seriesWinProb(p: number, bestOf: number, w = 0, l = 0): number {
  const k = Math.ceil(bestOf / 2);
  if (w >= k) return 1;
  if (l >= k) return 0;
  return p * seriesWinProb(p, bestOf, w + 1, l) + (1 - p) * seriesWinProb(p, bestOf, w, l + 1);
}

/** Who won a series so far: wins per alliance from its played, decisive matches (a tie decides nothing; it is replayed). */
function seriesWins(ms: BracketMatch[], allianceOf: (teams: number[]) => number | null): Map<number, number> {
  const wins = new Map<number, number>();
  for (const m of ms) {
    if (m.redScore == null || m.blueScore == null || m.redScore === m.blueScore) continue;
    const a = allianceOf(m.redScore > m.blueScore ? m.red : m.blue);
    if (a != null) wins.set(a, (wins.get(a) ?? 0) + 1);
  }
  return wins;
}

/** The two alliances that played a series (from its matches' line-ups), when they can be told. */
function seriesSides(ms: BracketMatch[], allianceOf: (teams: number[]) => number | null): [number, number] | null {
  for (const m of ms) {
    const r = allianceOf(m.red), b = allianceOf(m.blue);
    if (r != null && b != null && r !== b) return [r, b];
  }
  return null;
}

/** The playing line-up of an alliance: its two strongest robots by rating (as the engine's simulator fields them). */
export function lineup(teams: number[], strength: (t: number) => number | null): number[] {
  return teams.length <= 2 ? teams : [...teams].sort((x, y) => (strength(y) ?? -Infinity) - (strength(x) ?? -Infinity)).slice(0, 2);
}

const TIER_ORDER: ConfidenceTier[] = ["provisional", "moderate", "confident"];
const weakest = (ts: ConfidenceTier[]) => TIER_ORDER.find((t) => ts.includes(t)) ?? "provisional";

// ---------------------------------------------------------------------------
// The predictor

export interface BracketInput {
  season: number;
  alliances: BracketAlliance[];
  matches: BracketMatch[];
  price: Price;
  /** Rating strength per team (non-penalty points), to pick a three-robot alliance's line-up. */
  strength: (t: number) => number | null;
  runs?: number;
  /** Seeds the simulation (stateKey of the results it's conditioned on). */
  seed?: number;
}

/** A key for the posted state the odds are conditioned on: the alliances and every played playoff result. */
export function bracketStateKey(alliances: BracketAlliance[], matches: BracketMatch[]): string {
  return JSON.stringify({
    a: alliances.map((a) => [a.number, a.backup ?? null, ...a.teams]),
    m: matches.filter((m) => m.redScore != null && m.blueScore != null).map((m) => [m.series, m.number, m.red, m.blue, m.redScore, m.blueScore]).sort((x, y) => (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number)),
  });
}

export const BRACKET_RUNS = 10_000;

export function bracketOdds(input: BracketInput): BracketOdds {
  const { alliances, matches, price } = input;
  const byNumber = new Map(alliances.map((a) => [a.number, a]));
  const teamAlliance = new Map<number, number>();
  for (const a of alliances) for (const t of [...a.teams, ...(a.backup != null ? [a.backup] : [])]) teamAlliance.set(t, a.number);
  const allianceOf = (teams: number[]) => { for (const t of teams) { const a = teamAlliance.get(t); if (a != null) return a; } return null; };
  const bySeries = new Map<number, BracketMatch[]>();
  for (const m of [...matches].sort((x, y) => x.number - y.number)) bySeries.set(m.series, [...(bySeries.get(m.series) ?? []), m]);

  // Single-match chance of alliance a over b, both sides' calls averaged (red/blue order out of it).
  const lineups = new Map(alliances.map((a) => [a.number, lineup(a.teams, input.strength)]));
  const pairCache = new Map<string, { p: number; tier: ConfidenceTier }>();
  const pMatch = (a: number, b: number) => {
    const k = `${a}|${b}`;
    let hit = pairCache.get(k);
    if (!hit) {
      const x = price(lineups.get(a)!, lineups.get(b)!), y = price(lineups.get(b)!, lineups.get(a)!);
      hit = { p: (x.p + 1 - y.p) / 2, tier: weakest([x.tier, y.tier]) };
      pairCache.set(k, hit);
      pairCache.set(`${b}|${a}`, { p: 1 - hit.p, tier: hit.tier });
    }
    return hit;
  };

  // Alliances numbered 1..A, as the seeds the bracket's slots name.
  const numbered = alliances.every((a, i) => a.number === i + 1);
  const shape = numbered ? bracketShape(input.season, alliances.length, [...bySeries.keys()]) : null;
  const resolved = shape ? resolve(shape, bySeries, allianceOf, byNumber) : null;
  if (!shape || !resolved || resolved === "ahead") return unknownOdds(input.season, shape, bySeries, allianceOf, pMatch, resolved === "ahead"
    ? "A later series is posted before an earlier result, so only each series' own call shows until that result is in."
    : shape ? "The posted playoff results don't fit the usual bracket, so only each series' own call shows." : alliances.length === 2 || BRACKETS[alliances.length] || input.season < DOUBLE_ELIM_FROM
    ? "This event's playoff format isn't one we can map, so only each series' own call shows."
    : `A ${alliances.length}-alliance bracket isn't one we can map, so only each series' own call shows.`);

  // Simulate the rest of the bracket from where it stands.
  const runs = input.runs ?? BRACKET_RUNS;
  const seed = input.seed ?? textSeed(bracketStateKey(alliances, matches));
  const N = shape.nodes.length;
  const nums = alliances.map((a) => a.number);
  const champ = new Map(nums.map((n) => [n, 0])), final = new Map(nums.map((n) => [n, 0]));
  const occ = Array.from({ length: N }, () => [new Map<number, number>(), new Map<number, number>()]);
  /** Match-ups per node ("a|b" → runs), so an unknown slot names the likeliest pairing's alliance, never the same one twice. */
  const pairs = Array.from({ length: N }, () => new Map<string, number>());
  const wonAt = Array.from({ length: N }, () => new Map<number, number>());
  /** meet[a][node] → opponent → [met, lost] */
  const meet = new Map(nums.map((n) => [n, Array.from({ length: N }, () => new Map<number, [number, number]>())]));
  const finalIdx = shape.format === "double" ? N - 2 : N - 1;
  for (let i = 0; i < runs; i++) {
    const r = rng(runSeed(seed, i));
    const win: number[] = [], lose: number[] = [];
    const who = (s: Slot) => ("seed" in s ? s.seed : "winnerOf" in s ? win[s.winnerOf] : lose[s.loserOf]);
    let champion = 0;
    for (let k = 0; k < N; k++) {
      const node = shape.nodes[k], st = resolved[k];
      // A side the posted results already fix stays fixed; the rest follow this run's results.
      const a = st.sides[0] ?? who(node.red), b = st.sides[1] ?? who(node.blue);
      if (node.ifNeeded) {
        // Played only if the lower-bracket alliance (the grand final's blue side) won the grand final.
        if (win[k] !== b) { champion = win[k]; break; }
      }
      let w: number;
      if (st.winner != null) w = st.winner;
      else {
        const wa = st.wins.get(a) ?? 0, wb = st.wins.get(b) ?? 0;
        w = r() < seriesWinProb(pMatch(a, b).p, node.bestOf, wa, wb) ? a : b;
      }
      win[k + 1] = w; lose[k + 1] = w === a ? b : a;
      occ[k][0].set(a, (occ[k][0].get(a) ?? 0) + 1); occ[k][1].set(b, (occ[k][1].get(b) ?? 0) + 1);
      pairs[k].set(`${a}|${b}`, (pairs[k].get(`${a}|${b}`) ?? 0) + 1);
      wonAt[k].set(w, (wonAt[k].get(w) ?? 0) + 1);
      if (st.winner == null) for (const [x, y] of [[a, b], [b, a]]) {
        const m = meet.get(x)![k], c = m.get(y) ?? [0, 0];
        c[0]++; if (w !== x) c[1]++;
        m.set(y, c);
      }
      if (k === finalIdx) { final.set(a, final.get(a)! + 1); final.set(b, final.get(b)! + 1); }
      champion = w;
    }
    champ.set(champion, (champ.get(champion) ?? 0) + 1);
  }

  const top = (m: Map<number, number>) => { let best: [number, number] | null = null; for (const [a, c] of m) if (!best || c > best[1] || (c === best[1] && a < best[0])) best = [a, c]; return best; };
  const tiers: ConfidenceTier[] = [];
  const series: BracketSeriesView[] = shape.nodes.map((node, k) => {
    const st = resolved[k];
    let pair: number[] | null = null, best = 0;
    for (const [key, c] of pairs[k]) if (c > best) { best = c; pair = key.split("|").map(Number); }
    const sides = [node.red, node.blue].map((s, j): BracketSlotView => {
      const known = st.sides[j];
      const t = known == null && pair ? pair[j] : null;
      return { source: node.ifNeeded ? (j === 0 ? "Upper bracket" : "Lower bracket") : slotSource(s), alliance: known, likely: t != null ? { alliance: t, p: (occ[k][j].get(t) ?? 0) / runs } : null };
    });
    const [a, b] = st.sides;
    let call: BracketSeriesView["call"] = null, likely: BracketSeriesView["likely"] = null;
    if (st.winner == null && !st.skipped && !st.pending) {
      if (a != null && b != null) {
        const pm = pMatch(a, b), pa = seriesWinProb(pm.p, node.bestOf, st.wins.get(a) ?? 0, st.wins.get(b) ?? 0);
        call = pa >= 0.5 ? { alliance: a, p: pa, tier: pm.tier } : { alliance: b, p: 1 - pa, tier: pm.tier };
        tiers.push(pm.tier);
      } else {
        const t = top(wonAt[k]);
        if (t) likely = { alliance: t[0], p: t[1] / runs };
      }
    }
    return {
      index: k + 1, series: node.series, label: node.label, stage: node.stage, bestOf: node.bestOf, red: sides[0], blue: sides[1],
      wins: [a != null ? st.wins.get(a) ?? 0 : 0, b != null ? st.wins.get(b) ?? 0 : 0], winner: st.winner, call, likely, ifNeeded: !!node.ifNeeded, skipped: st.skipped, pending: st.pending,
    };
  });
  // The odds rest on every pair that can still meet: their weakest tier.
  const alive = nums.filter((n) => resolved.alive.has(n));
  for (const x of alive) for (const y of alive) if (x < y) tiers.push(pMatch(x, y).tier);

  const out: BracketAllianceOdds[] = nums.map((n) => {
    const status = resolved.champion === n ? "champion" : resolved.alive.has(n) ? "alive" : "out";
    let danger: BracketAllianceOdds["danger"] = null;
    if (status === "alive") {
      // The series it loses most often, over every opponent it can meet there; then its likeliest opponent in it.
      let best = 0;
      meet.get(n)!.forEach((m, k) => {
        let met = 0, lost = 0, opp = 0, oppMet = 0;
        for (const [o, [c, l]] of m) { met += c; lost += l; if (c > oppMet || (c === oppMet && o < opp)) { opp = o; oppMet = c; } }
        if (lost > best) { best = lost; danger = { index: k + 1, label: shape.nodes[k].label, opponent: opp, pMeet: met / runs, pWin: 1 - lost / met }; }
      });
    }
    return {
      alliance: n, status,
      pChampion: status === "champion" ? 1 : status === "out" ? 0 : champ.get(n)! / runs,
      pFinal: final.get(n)! / runs,
      danger,
    };
  });
  return { format: shape.format, runs, tier: weakest(tiers.length ? tiers : ["confident"]), series, alliances: out, note: null };
}

interface NodeState { sides: [number | null, number | null]; wins: Map<number, number>; winner: number | null; skipped: boolean; pending: boolean }
type Resolved = NodeState[] & { alive: Set<number>; champion: number | null };

/**
 * The bracket as it stands: each node's known sides, series score and winner. Null when a posted result
 * contradicts the shape (a series played by alliances other than the ones its slots hold); "ahead" when a series
 * is posted before the result that decides who plays it (the simulation couldn't keep both consistent).
 */
function resolve(shape: Shape, bySeries: Map<number, BracketMatch[]>, allianceOf: (teams: number[]) => number | null, byNumber: Map<number, BracketAlliance>): Resolved | "ahead" | null {
  const win: (number | null)[] = [], lose: (number | null)[] = [];
  const who = (s: Slot) => ("seed" in s ? (byNumber.has(s.seed) ? s.seed : null) : "winnerOf" in s ? win[s.winnerOf] ?? null : lose[s.loserOf] ?? null);
  const states: NodeState[] = [];
  const losses = new Map<number, number>();
  let champion: number | null = null;
  for (let k = 0; k < shape.nodes.length; k++) {
    const node = shape.nodes[k];
    const ms = bySeries.get(node.series) ?? [];
    let a = who(node.red), b = who(node.blue);
    const posted = seriesSides(ms, allianceOf);
    if (posted) {
      // A posted series must be between the alliances its slots hold (either colour).
      if ((a != null && !posted.includes(a)) || (b != null && !posted.includes(b))) return null;
      // Its line-up is posted but an earlier result that feeds it isn't in yet.
      if (a == null || b == null) return "ahead";
    }
    const wins = seriesWins(ms, allianceOf);
    const need = Math.ceil(node.bestOf / 2);
    let winner: number | null = null;
    for (const [x, c] of wins) if (c >= need && (x === a || x === b)) winner = x;
    let skipped = false, pending = false;
    if (node.ifNeeded) {
      const gf = states[k - 1];
      // The upper alliance won the grand final: no replay, and it is champion.
      if (gf.winner != null && gf.winner === gf.sides[0]) { skipped = true; champion = gf.winner; }
      else if (gf.winner == null) pending = true;
    }
    states.push({ sides: [a, b], wins, winner, skipped, pending });
    win[k + 1] = winner; lose[k + 1] = winner == null ? null : winner === a ? b : a;
    if (winner != null) { const l = winner === a ? b : a; if (l != null) losses.set(l, (losses.get(l) ?? 0) + 1); }
  }
  // The last series' winner is champion (the replay's, in a double bracket that needed one).
  champion ??= states.at(-1)!.winner;
  // Out: two losses in a double bracket (one for the upper-bracket finalist is not enough before the replay), one elsewhere.
  const alive = new Set<number>();
  for (const n of byNumber.keys()) {
    const l = losses.get(n) ?? 0;
    if (champion != null) { if (n === champion) alive.add(n); continue; }
    if (l < (shape.format === "double" ? 2 : 1)) alive.add(n);
  }
  return Object.assign(states, { alive, champion });
}

/** Unknown format: each posted series priced on its own (who's in it, its score), no bracket. */
function unknownOdds(season: number, shape: Shape | null, bySeries: Map<number, BracketMatch[]>, allianceOf: (teams: number[]) => number | null, pMatch: (a: number, b: number) => { p: number; tier: ConfidenceTier }, note: string): BracketOdds {
  const tiers: ConfidenceTier[] = [];
  // A known bracket (calls only while a result is missing) keeps its own order, lengths and names per series.
  const nodeOf = new Map((shape?.nodes ?? []).map((n, k) => [n.series, { node: n, k }]));
  const order = (s: number) => nodeOf.get(s)?.k ?? (s || Infinity);
  const series: BracketSeriesView[] = [...bySeries.entries()].sort((x, y) => order(x[0]) - order(y[0])).map(([s, ms], i) => {
    const known = nodeOf.get(s)?.node;
    const sides = seriesSides(ms, allianceOf);
    const wins = seriesWins(ms, allianceOf);
    // Best-of-3: every series before double elimination (2023–24's semifinals and finals), the final (series 0), and a
    // series with two decisive results or more than one game posted without a tie to replay. Else a single match.
    const decisive = [...wins.values()].reduce((x, y) => x + y, 0);
    const tie = ms.some((m) => m.redScore != null && m.redScore === m.blueScore);
    const bestOf = known ? known.bestOf : season < DOUBLE_ELIM_FROM || s === 0 || decisive >= 2 || (ms.length > 1 && !tie) ? 3 : 1;
    const need = Math.ceil(bestOf / 2);
    let winner: number | null = null;
    for (const [x, c] of wins) if (c >= need) winner = x;
    let call: BracketSeriesView["call"] = null;
    if (sides && winner == null) {
      const [a, b] = sides, pm = pMatch(a, b), pa = seriesWinProb(pm.p, bestOf, wins.get(a) ?? 0, wins.get(b) ?? 0);
      call = pa >= 0.5 ? { alliance: a, p: pa, tier: pm.tier } : { alliance: b, p: 1 - pa, tier: pm.tier };
      tiers.push(pm.tier);
    }
    const slot = (a: number | null): BracketSlotView => ({ source: a != null ? `Alliance ${a}` : "To be decided", alliance: a, likely: null });
    return {
      index: known ? nodeOf.get(s)!.k + 1 : i + 1, series: s, label: known?.label ?? (s === 0 ? "Final" : `M${s}`), stage: known?.stage ?? (s === 0 ? "Final" : "Series"), bestOf, red: slot(sides?.[0] ?? null), blue: slot(sides?.[1] ?? null),
      wins: [sides ? wins.get(sides[0]) ?? 0 : 0, sides ? wins.get(sides[1]) ?? 0 : 0], winner, call, likely: null, ifNeeded: false, skipped: false, pending: false,
    };
  });
  return { format: "unknown", runs: 0, tier: weakest(tiers.length ? tiers : ["confident"]), series, alliances: [], note };
}
