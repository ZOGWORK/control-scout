// Schedule difficulty on the server (src/shared/scheduleDifficulty.ts does the work).
//
// The event page gets it with its detail (server/api/events.ts, from the detail's own engine input). Team pages
// and the offline packs need it for events whose detail nobody is building, so this reads a lean engine input
// straight from the database (the field, the lineups, played results) and hands it to the same
// eventScheduleDifficulty: the same ratings and posted draw the event page reads.
import type { EventInput, Forecaster, MatchInput } from "@control-scout/predict-engine";
import { all, get } from "../db.js";
import { isLegacy } from "../data/seasons.js";
import { ROSTER } from "../data/registrations.js";
import { dataVersion, liveForecaster, liveVersion } from "./engine.js";
import { registerCache } from "../caches.js";
import { eventOver, eventScheduleDifficulty, type ScheduleDifficulty, type ScheduleMatch } from "../../src/shared/scheduleDifficulty.js";
import type { EventCalendar } from "../../src/shared/eventDay.js";

const side = (r: any, p: "red" | "blue") => (r[`${p}_total`] == null ? null : {
  total: Number(r[`${p}_total`]), totalNp: r[`${p}_np`] == null ? null : Number(r[`${p}_np`]), auto: r[`${p}_auto`], teleop: r[`${p}_teleop`], endgame: r[`${p}_endgame`],
  penaltiesCommitted: r[`${p}_pen`],
});

/** One event as schedule difficulty reads it: the engine input (played matches list the robots that took the field,
 *  as the ratings learn them), the posted qualification draw (every scheduled team) and its venue calendar. */
export interface LeanEvent { ev: EventInput; posted: ScheduleMatch[]; calendar: EventCalendar }

/** Lean inputs for a season's events (or the listed ones): field, lineups and results, nothing else. */
export async function leanEvents(season: number, codes?: string[]): Promise<LeanEvent[]> {
  const only = codes?.length ? ` AND code IN (${codes.map(() => "?").join(",")})` : "";
  const args = [season, ...(codes ?? [])];
  const [events, roster, matches, lineups] = await Promise.all([
    all<any>(`SELECT code, name, type, start, "end", timezone FROM events WHERE season = ?${only}`, args),
    all<any>(`SELECT code, team, rank FROM ${ROSTER} r WHERE season = ?${only}`, args),
    all<any>(`SELECT code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen FROM matches WHERE season = ?${only}`, args),
    all<any>(`SELECT code, level, series, number, team, alliance, surrogate, dq, on_field FROM match_teams WHERE season = ?${only} ORDER BY station, team`, args),
  ]);
  const byEvent = new Map<string, LeanEvent>(events.map((e) => [e.code, {
    ev: { season, code: e.code, name: e.name, type: e.type, start: e.start, end: e.end, field: [], matches: [], alliances: [] },
    posted: [], calendar: { start: e.start ?? null, end: e.end ?? null, timezone: e.timezone ?? null },
  }]));
  for (const r of roster) byEvent.get(r.code)?.ev.field.push({ teamNumber: Number(r.team), rank: r.rank == null ? null : Number(r.rank) });
  const byMatch = new Map<string, { mi: MatchInput; posted: ScheduleMatch | null }>();
  for (const m of matches) {
    const le = byEvent.get(m.code);
    if (!le) continue;
    const key = `${m.level}:${m.series}:${m.number}`;
    const mi: MatchInput = { key, label: m.label ?? key, level: m.level, series: Number(m.series), number: Number(m.number), time: m.time, played: !!Number(m.played), red: { teams: [], score: side(m, "red") }, blue: { teams: [], score: side(m, "blue") } };
    le.ev.matches.push(mi);
    byMatch.set(`${m.code}|${key}`, { mi, posted: m.level === "qual" ? { red: [], blue: [], played: mi.played } : null });
  }
  for (const l of lineups) {
    const hit = byMatch.get(`${l.code}|${l.level}:${l.series}:${l.number}`);
    if (!hit) continue;
    const { mi, posted } = hit;
    const red = l.alliance === "red";
    // The posted draw: every scheduled team (a surrogate appearance doesn't count toward its rank).
    if (posted) {
      (red ? posted.red : posted.blue).push(Number(l.team));
      if (Number(l.surrogate)) (posted.noRank ??= []).push(Number(l.team));
    }
    // The engine input: played matches list only the robots on the field (as the event page's input).
    if (mi.played && !Number(l.on_field)) continue;
    (red ? mi.red : mi.blue).teams.push({ number: Number(l.team), surrogate: !!Number(l.surrogate), dq: !!Number(l.dq) });
  }
  const order = (a: MatchInput, b: MatchInput) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || (a.series ?? 0) - (b.series ?? 0) || a.number - b.number;
  for (const le of byEvent.values()) {
    le.ev.matches.sort(order);
    le.posted = le.ev.matches.filter((m) => m.level === "qual").map((m) => byMatch.get(`${le.ev.code}|${m.key}`)!.posted!);
  }
  return [...byEvent.values()];
}

/** Events read per batch by seasonScheduleDifficulty: a whole season's matches and lineups at once is the memory
 *  spike stats/load.ts loadSeason batches away (it crashed a 512 MB host); one batch of raw rows at a time instead. */
const SEASON_BATCH = 120;

/** Every event of a season with figures, from one forecaster (the stats job's records and the offline packs). */
export async function seasonScheduleDifficulty(f: Forecaster, season: number, now = Date.now()): Promise<Map<string, ScheduleDifficulty>> {
  const codes = (await all<{ code: string }>("SELECT DISTINCT code FROM matches WHERE season = ? AND level = 'qual' ORDER BY code", [season])).map((r) => r.code);
  const out = new Map<string, ScheduleDifficulty>();
  for (let i = 0; i < codes.length; i += SEASON_BATCH) {
    for (const le of await leanEvents(season, codes.slice(i, i + SEASON_BATCH))) {
      const sd = eventScheduleDifficulty(f, le.ev, { posted: le.posted, over: eventOver(le.calendar, now) });
      if (sd) out.set(le.ev.code, sd);
    }
    // The local database answers on this thread: let waiting requests in between batches.
    await new Promise<void>((r) => setImmediate(r));
  }
  return out;
}

const cache = new Map<string, Promise<ScheduleDifficulty | null>>();
const CACHE_MAX = 500;
registerCache("Schedule difficulty", () => cache.clear());

/** One event's figures with the ratings pages answer with (cached per data version, and per whether the event is
 *  over by its venue's calendar, so "still to play" goes at the venue's midnight); null when there are none. */
export async function eventSchedule(season: number, code: string, now = Date.now()): Promise<ScheduleDifficulty | null> {
  if (isLegacy(season)) return null;
  const cal = await get<EventCalendar>(`SELECT start, "end", timezone FROM events WHERE season = ? AND code = ?`, [season, code]);
  if (!cal) return null;
  const over = eventOver(cal, now);
  const key = `${await dataVersion()}|${await liveVersion(season)}|${season}|${code}|${over}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const [le] = await leanEvents(season, [code]);
      const f = le ? await liveForecaster(season).catch(() => null) : null;
      return le && f ? eventScheduleDifficulty(f, le.ev, { posted: le.posted, over }) : null;
    })();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return hit;
}
