// Schedule difficulty on the server (src/shared/scheduleDifficulty.ts does the work).
//
// The event page gets it with its detail (server/api/events.ts, from the detail's own engine input). Team pages
// and the offline packs need it for events whose detail nobody is building, so this reads a lean engine input
// straight from the database (the field, the qualification lineups, played results) and hands it to the same
// eventScheduleDifficulty: the same ratings and schedule the event page and the Monte Carlo projections read.
import type { EventInput, Forecaster, MatchInput } from "@control-scout/predict-engine";
import { all } from "../db.js";
import { isLegacy } from "../data/seasons.js";
import { ROSTER } from "../data/registrations.js";
import { dataVersion, liveForecaster, liveVersion } from "./engine.js";
import { registerCache } from "../caches.js";
import { eventScheduleDifficulty, type ScheduleDifficulty } from "../../src/shared/scheduleDifficulty.js";

const side = (r: any, p: "red" | "blue") => (r[`${p}_total`] == null ? null : {
  total: Number(r[`${p}_total`]), totalNp: r[`${p}_np`] == null ? null : Number(r[`${p}_np`]), auto: r[`${p}_auto`], teleop: r[`${p}_teleop`], endgame: r[`${p}_endgame`],
  penaltiesCommitted: r[`${p}_pen`],
});

/** Lean engine inputs for a season's events (or the listed ones): field, lineups and results, nothing else. */
export async function leanEventInputs(season: number, codes?: string[]): Promise<EventInput[]> {
  const only = codes?.length ? ` AND code IN (${codes.map(() => "?").join(",")})` : "";
  const args = [season, ...(codes ?? [])];
  const [events, roster, matches, lineups] = await Promise.all([
    all<any>(`SELECT code, name, type, start, "end" FROM events WHERE season = ?${only}`, args),
    all<any>(`SELECT code, team, rank FROM ${ROSTER} r WHERE season = ?${only}`, args),
    all<any>(`SELECT code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen FROM matches WHERE season = ?${only}`, args),
    all<any>(`SELECT code, level, series, number, team, alliance, surrogate, dq, on_field FROM match_teams WHERE season = ?${only} ORDER BY station, team`, args),
  ]);
  const byEvent = new Map<string, EventInput>(events.map((e) => [e.code, { season, code: e.code, name: e.name, type: e.type, start: e.start, end: e.end, field: [], matches: [], alliances: [] }]));
  for (const r of roster) byEvent.get(r.code)?.field.push({ teamNumber: Number(r.team), rank: r.rank == null ? null : Number(r.rank) });
  const byMatch = new Map<string, MatchInput>();
  for (const m of matches) {
    const ev = byEvent.get(m.code);
    if (!ev) continue;
    const key = `${m.level}:${m.series}:${m.number}`;
    const mi: MatchInput = { key, label: m.label ?? key, level: m.level, series: Number(m.series), number: Number(m.number), time: m.time, played: !!Number(m.played), red: { teams: [], score: side(m, "red") }, blue: { teams: [], score: side(m, "blue") } };
    ev.matches.push(mi);
    byMatch.set(`${m.code}|${key}`, mi);
  }
  for (const l of lineups) {
    const m = byMatch.get(`${l.code}|${l.level}:${l.series}:${l.number}`);
    // Played matches: only the robots that were on the field (as the event page's input; playoff alliances list 3).
    if (!m || (m.played && !Number(l.on_field))) continue;
    (l.alliance === "red" ? m.red : m.blue).teams.push({ number: Number(l.team), surrogate: !!Number(l.surrogate), dq: !!Number(l.dq) });
  }
  for (const ev of byEvent.values()) ev.matches.sort((a, b) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || (a.series ?? 0) - (b.series ?? 0) || a.number - b.number);
  return [...byEvent.values()];
}

/** Every event of a season with figures, from one forecaster (the offline packs). */
export function seasonScheduleDifficulty(f: Forecaster, events: EventInput[]): Map<string, ScheduleDifficulty> {
  const out = new Map<string, ScheduleDifficulty>();
  for (const ev of events) {
    const sd = eventScheduleDifficulty(f, ev);
    if (sd) out.set(ev.code, sd);
  }
  return out;
}

const cache = new Map<string, Promise<ScheduleDifficulty | null>>();
const CACHE_MAX = 500;
registerCache("Schedule difficulty", () => cache.clear());

/** One event's figures with the ratings pages answer with (cached per data version); null when there are none. */
export async function eventSchedule(season: number, code: string): Promise<ScheduleDifficulty | null> {
  if (isLegacy(season)) return null;
  const key = `${await dataVersion()}|${await liveVersion(season)}|${season}|${code}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const [ev] = await leanEventInputs(season, [code]);
      const f = ev ? await liveForecaster(season).catch(() => null) : null;
      return ev && f ? eventScheduleDifficulty(f, ev) : null;
    })();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return hit;
}
