// A simulated qualification ranking for an event that hasn't played yet (the Rankings tab's "Simulate the
// rankings"): the engine's own event simulation (simulateEvent: its score model, ranking points, bonus RPs and
// official tiebreakers), run many times. Before a schedule is published every run draws a fresh random schedule,
// so the spread includes schedule luck, not one stand-in schedule's; once one is published every run plays it.
// Pure: the server route (server/projections/rankingSim.ts) runs it, and its tests run it directly.
import { rng, simulateEvent, type QualMatch, type SimInput } from "@control-scout/predict-engine";
import { runSeed } from "./projectionCore.js";
import type { SimRankResult, SimRankRow } from "./rankingSimView.js";

export { DEFAULT_PER_TEAM, PER_TEAM_CHOICES, type SimRankResult, type SimRankRow } from "./rankingSimView.js";

/**
 * A random qualification schedule where every team plays `perTeam` counted matches: shuffled rounds, dealt
 * four at a time, never a team twice in one match. When the slots don't fill the last match, teams already
 * done fill it as surrogates (they play, it doesn't count for them), as at a real event.
 */
export function randomSchedule(teams: number[], perTeam: number, rand: () => number): QualMatch[] {
  if (teams.length < 4) return [];
  const queue: number[] = [];
  for (let r = 0; r < perTeam; r++) queue.push(...teams.map((t) => ({ t, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.t));
  const out: QualMatch[] = [];
  while (queue.length) {
    const four: number[] = [];
    // Deal the next teams not already in this match (a round boundary can put a team twice in reach).
    for (let i = 0; i < queue.length && four.length < 4;) {
      if (four.includes(queue[i])) i++;
      else four.push(queue.splice(i, 1)[0]);
    }
    const noRank: number[] = [];
    if (four.length < 4) {
      const fill = teams.map((t) => ({ t, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.t).filter((t) => !four.includes(t));
      while (four.length < 4) { const t = fill.shift()!; four.push(t); noRank.push(t); }
    }
    out.push({ red: [four[0], four[1]], blue: [four[2], four[3]], ...(noRank.length ? { noRank } : {}) });
  }
  return out;
}

export interface SimRankOptions {
  runs: number;
  seed: number;
  /** True: every run plays the input's quals (the event's own schedule). False: a fresh random one each run. */
  published: boolean;
  /** Matches per team for a random schedule. */
  perTeam: number;
  /** Stop early (at least `minRuns` runs) once this much compute time has gone. */
  budgetMs?: number;
  minRuns?: number;
  clock?: () => number;
  /** Compute this long, then pause (yield to the event loop, so a server keeps answering other requests). */
  sliceMs?: number;
  pause?: () => Promise<void>;
}

const immediate = () => Promise.resolve();

/**
 * Simulate the rankings: `input` is the engine's input for the event before it starts (no results). Returns
 * per-team rank odds, best mean rank first.
 */
export async function simulateRankings(input: SimInput, teams: number[], o: SimRankOptions): Promise<SimRankResult> {
  const published = o.published;
  const clock = o.clock ?? (() => performance.now());
  const pause = o.pause ?? immediate;
  const sliceMs = o.sliceMs ?? 20;
  let compute = 0, sliceStart = clock();
  const n = teams.length;
  const counts = new Map(teams.map((t) => [t, new Int32Array(n + 2)]));
  // Ranks only: no awards, and a run at a time so each draw is that run's own outcome.
  const one: SimInput = { ...input, awards: { mode: "none" }, runs: 1, ranks: undefined, alliances: undefined };
  let done = 0;
  while (done < o.runs) {
    const seed = runSeed(o.seed, done);
    const quals = published ? input.quals : randomSchedule(teams, o.perTeam, rng(seed ^ 0x5bd1e995));
    const out = simulateEvent({ ...one, quals, seed });
    for (const t of teams) {
      const r = out.get(t)?.meanRank;
      if (r != null && Number.isFinite(r)) counts.get(t)![Math.min(n + 1, Math.max(1, Math.round(r)))]++;
    }
    done++;
    const now = clock();
    if (o.budgetMs != null && done >= (o.minRuns ?? 200) && compute + (now - sliceStart) > o.budgetMs) break;
    if (done < o.runs && now - sliceStart >= sliceMs) {
      compute += now - sliceStart;
      await pause();
      sliceStart = clock();
    }
  }
  const rows: SimRankRow[] = teams.map((team) => {
    const c = counts.get(team)!;
    let total = 0, sum = 0, first = 0, top4 = 0, top8 = 0;
    for (let r = 1; r < c.length; r++) { total += c[r]; sum += r * c[r]; if (r === 1) first += c[r]; if (r <= 4) top4 += c[r]; if (r <= 8) top8 += c[r]; }
    const q = (p: number) => { let acc = 0; for (let r = 1; r < c.length; r++) { acc += c[r]; if (acc >= p * total) return r; } return n; };
    const strength = { played: input.ratings.get(team)?.n ?? 0 };
    return total
      ? { team, ...strength, mean: sum / total, p10: q(0.1), p90: q(0.9), first: first / total, top4: top4 / total, top8: top8 / total }
      : { team, ...strength, mean: NaN, p10: n, p90: n, first: 0, top4: 0, top8: 0 };
  }).sort((a, b) => (Number.isFinite(a.mean) ? a.mean : Infinity) - (Number.isFinite(b.mean) ? b.mean : Infinity) || a.team - b.team);
  return { runs: done, schedule: published ? "published" : "random", perTeam: published ? null : o.perTeam, teams: rows };
}
