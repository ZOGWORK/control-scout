// GET /api/events/:season/:code/simulated-rankings: the Rankings tab's "Simulate the rankings" for an event whose
// qualification matches haven't started (src/shared/rankingSim.ts runs the engine's event simulation). Only on a
// click, so it runs on request: one at a time across the server, within a time budget, and kept per event, matches
// per team and data version, so a second click or another visitor gets the same numbers at once.
import { cachedEventDetail, toEventInput } from "../api/events.js";
import { dataVersion, forecasterFor, liveVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import { rankingInput } from "./input.js";
import { DEFAULT_PER_TEAM, PER_TEAM_CHOICES, simulateRankings, type SimRankResult } from "../../src/shared/rankingSim.js";
import { projectionSeed } from "./core.js";

/** Simulations wanted, the fewest kept when the budget runs out, and the compute budget. */
export const SIM_RANK_RUNS = 2000;
const MIN_RUNS = 300;
const BUDGET_MS = 2500;

export type SimRankAnswer =
  | ({ status: "ok" } & SimRankResult)
  | { status: "unavailable"; reason: string };

const MAX_KEPT = 200;
const kept = new Map<string, Promise<SimRankAnswer>>();
registerCache("Simulated rankings", () => kept.clear());
// One simulation at a time: the VM is small and shared, and each holds the event loop for up to BUDGET_MS.
let queue: Promise<unknown> = Promise.resolve();

export const perTeamOf = (v: unknown): number => {
  const n = Number(v);
  return (PER_TEAM_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_PER_TEAM;
};

export async function simulatedRankings(season: number, code: string, perTeam: number): Promise<SimRankAnswer | null> {
  const d = await cachedEventDetail(season, code);
  if (!d) return null;
  if (d.matches.some((m) => m.level === "qual" && m.played)) {
    return { status: "unavailable", reason: "Qualification matches have started, so the official ranking and the Odds tab's projection take over." };
  }
  if (d.field.length < 4) return { status: "unavailable", reason: "Fewer than 4 teams are registered, too few to simulate a ranking." };
  const hasSchedule = d.matches.some((m) => m.level === "qual");
  const key = `${await dataVersion()}|${await liveVersion(season)}|${season}|${code}|${hasSchedule ? "published" : perTeam}`;
  const hit = kept.get(key);
  if (hit) return hit;
  const run = queue.then(async (): Promise<SimRankAnswer> => {
    const f = await forecasterFor(season);
    const input = rankingInput(f, toEventInput(d.event, d.field, d.matches, d.alliances));
    if (!input) return { status: "unavailable", reason: "There are no ratings for this season yet, so there's nothing to simulate from." };
    const r = simulateRankings(input, d.field.map((t) => t.team), {
      runs: SIM_RANK_RUNS, minRuns: MIN_RUNS, budgetMs: BUDGET_MS, published: hasSchedule, perTeam,
      seed: projectionSeed(season, code, "ranking", hasSchedule ? "published" : `random${perTeam}`),
    });
    return { status: "ok", ...r };
  });
  queue = run.catch(() => {});
  kept.set(key, run);
  run.catch(() => { if (kept.get(key) === run) kept.delete(key); });
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
  return run;
}
