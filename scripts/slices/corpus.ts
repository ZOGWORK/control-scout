// The backtest ledger's corpus (server/stats/job.ts backtest), one season at a
// time: same loader, same exclusions, same match order. Shared by the slice
// report and the engine research scripts so they replay identical matches.
import type { EventRecord, MatchRecord } from "@control-scout/predict-engine";
import { all } from "../../server/db.js";
import { loadSeason, toEventRecord } from "../../server/stats/load.js";

export interface SeasonCorpus {
  season: number;
  events: EventRecord[];
  byCode: Map<string, EventRecord>;
  /** Scrimmage / off-season events: predicted, never rated. */
  unrated: Set<string>;
  /** Every match, in start-time order (stable: the backtest's order). */
  matches: MatchRecord[];
}

export async function seasonCorpus(season: number): Promise<SeasonCorpus> {
  const events = await loadSeason(season);
  const unrated = new Set(events.filter((e) => !toEventRecord(e)).map((e) => e.code));
  const recs = events.map((e) => toEventRecord(e, { anyType: true })).filter((x): x is EventRecord => !!x);
  return { season, events: recs, byCode: new Map(recs.map((e) => [e.code, e])), unrated, matches: recs.flatMap((e) => e.matches).sort((x, y) => x.time - y.time) };
}

/** FIRST rookie year per team (null when unknown). */
export async function rookieYears(): Promise<Map<number, number | null>> {
  return new Map((await all<{ number: number; rookie_year: number | null }>("SELECT number, rookie_year FROM teams")).map((r) => [Number(r.number), r.rookie_year == null ? null : Number(r.rookie_year)]));
}

/** Home region per team (FIRST region code, null when unknown). */
export async function homeRegions(): Promise<Map<number, string | null>> {
  return new Map((await all<{ number: number; home_region: string | null }>("SELECT number, home_region FROM teams")).map((r) => [Number(r.number), r.home_region ?? null]));
}

/** Only 2-robot alliances are predicted (with three listed we don't know who sits out). */
export const predictable = (m: MatchRecord) => m.red.teams.length === 2 && m.blue.teams.length === 2;

export const outcome = (m: MatchRecord) => (m.red.total > m.blue.total ? 1 : m.red.total < m.blue.total ? 0 : 0.5);

export const matchKey = (season: number, code: string, level: string, series: number, number: number) => `${season}|${code}|${level}|${series}|${number}`;
