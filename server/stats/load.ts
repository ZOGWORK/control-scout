// Load a season from the database in the shapes the stats job and the
// engine need. Mirrors the engine's own FTC Scout parser rules
// (packages/predict-engine/src/scoutData.ts → parseScoutEventRecord):
// official in-person competitions only, played matches with scores, robots
// that were on the field, surrogates flagged.
import { all } from "../db.js";
import { EXCLUDED_TYPES, type EventRecord, type MatchRecord, type AllianceResult } from "@control-scout/predict-engine";
import type { MatchForOpr } from "./opr.js";

export interface DbMatch extends MatchForOpr {
  code: string;
  level: "qual" | "playoff";
  series: number;
  number: number;
  label: string;
  time: string | null;
  redScore: (MatchForOpr["redScore"] & { total: number; bonus: { movement: boolean; goal: boolean; pattern: boolean } | null }) | null;
  blueScore: (MatchForOpr["blueScore"] & { total: number; bonus: { movement: boolean; goal: boolean; pattern: boolean } | null }) | null;
  video: string | null;
}

export interface DbEvent {
  season: number;
  code: string;
  name: string;
  type: string | null;
  region: string | null;
  start: string | null;
  end: string | null;
  remote: boolean;
  hybrid: boolean;
  matches: DbMatch[];
  ranks: Map<number, number>;
  teams: number[];
  awards: { type: string; placement: number; team: number }[];
}

const score = (r: any, p: "red" | "blue") => r[`${p}_np`] == null ? null : {
  total: Number(r[`${p}_total`]), np: Number(r[`${p}_np`]), auto: Number(r[`${p}_auto`] ?? 0), teleop: Number(r[`${p}_teleop`] ?? 0),
  endgame: Number(r[`${p}_endgame`] ?? 0), pen: Number(r[`${p}_pen`] ?? 0), bonus: r[`${p}_bonus`] ? JSON.parse(r[`${p}_bonus`]) : null,
};

/** Every event of a season with its matches, lineups, ranks and awards. */
/** Events per query when loading a whole season. Loading everything at once
 *  peaked at ~420 MB for 2025–26 (the raw rows dwarf the records kept), which
 *  crashed a 512 MB host; batches keep the peak to one batch of raw rows. */
const LOAD_BATCH = 120;

export async function loadSeason(season: number, codes?: string[]): Promise<DbEvent[]> {
  if (!codes) {
    const all_ = (await all<{ code: string }>("SELECT code FROM events WHERE season = ? ORDER BY code", [season])).map((r) => r.code);
    const out: DbEvent[] = [];
    for (let i = 0; i < all_.length; i += LOAD_BATCH) out.push(...(await loadSeason(season, all_.slice(i, i + LOAD_BATCH))));
    return out;
  }
  if (!codes.length) return [];
  const where = codes?.length ? ` AND code IN (${codes.map(() => "?").join(",")})` : "";
  const args = [season, ...(codes ?? [])];
  const [evs, ms, mts, ets, aws] = await Promise.all([
    all<any>(`SELECT season, code, name, type, region, start, end, remote, hybrid FROM events WHERE season = ?${where}`, args),
    all<any>(`SELECT * FROM matches WHERE season = ?${where}`, args),
    all<any>(`SELECT code, level, series, number, team, alliance, surrogate, dq, on_field FROM match_teams WHERE season = ?${where}`, args),
    all<any>(`SELECT code, team, rank FROM event_teams WHERE season = ?${where}`, args),
    all<any>(`SELECT code, type, placement, team FROM awards WHERE season = ?${where}`, args),
  ]);
  const byCode = new Map<string, DbEvent>();
  for (const e of evs) byCode.set(e.code, { season, code: e.code, name: e.name, type: e.type, region: e.region, start: e.start, end: e.end, remote: !!e.remote, hybrid: !!e.hybrid, matches: [], ranks: new Map(), teams: [], awards: [] });
  const lineup = new Map<string, { red: DbMatch["red"]; blue: DbMatch["blue"] }>();
  for (const t of mts) {
    const k = `${t.code}|${t.level}:${t.series}:${t.number}`;
    let l = lineup.get(k);
    if (!l) { l = { red: [], blue: [] }; lineup.set(k, l); }
    (t.alliance === "red" ? l.red : l.blue).push({ team: Number(t.team), surrogate: !!t.surrogate, dq: !!t.dq, onField: !!t.on_field });
  }
  for (const m of ms) {
    const ev = byCode.get(m.code);
    if (!ev) continue;
    const l = lineup.get(`${m.code}|${m.level}:${m.series}:${m.number}`) ?? { red: [], blue: [] };
    ev.matches.push({
      code: m.code, level: m.level, series: Number(m.series), number: Number(m.number), label: m.label, time: m.time, played: !!m.played,
      red: l.red, blue: l.blue, redScore: score(m, "red"), blueScore: score(m, "blue"), video: m.video ?? null,
    });
  }
  for (const e of ets) {
    const ev = byCode.get(e.code);
    if (!ev) continue;
    ev.teams.push(Number(e.team));
    if (e.rank != null) ev.ranks.set(Number(e.team), Number(e.rank));
  }
  for (const a of aws) byCode.get(a.code)?.awards.push({ type: a.type, placement: Number(a.placement), team: Number(a.team) });
  for (const ev of byCode.values()) ev.matches.sort((a, b) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number);
  return [...byCode.values()];
}

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

/**
 * Match time → epoch ms, the same on every machine. FIRST reports event-local
 * times without a zone; read them as UTC (only order and gaps matter to the
 * engine). Times that carry a zone (FTC Scout) are read as given.
 */
export function matchTimeMs(t: string | null | undefined): number {
  if (!t) return NaN;
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(t) ? t : `${t}Z`);
}

/** DbEvent → the engine's EventRecord (null for events the engine ignores).
 *  `anyType`: also excluded event types (scrimmages), for predicting their
 *  matches; the ratings still never learn from them. */
export function toEventRecord(ev: DbEvent, opts: { anyType?: boolean } = {}): EventRecord | null {
  if (ev.remote || ev.hybrid || (!opts.anyType && ev.type && EXCLUDED_TYPES.has(ev.type)) || !ev.start) return null;
  const startTime = day(ev.start);
  const matches: MatchRecord[] = [];
  for (const m of ev.matches) {
    if (!m.played || !m.redScore || !m.blueScore) continue;
    const side = (ts: DbMatch["red"], sc: NonNullable<DbMatch["redScore"]>): AllianceResult => {
      const on = ts.filter((t) => t.onField);
      const sur = on.filter((t) => t.surrogate).map((t) => t.team);
      const r: AllianceResult = { teams: on.map((t) => t.team), auto: sc.auto, teleop: sc.teleop, endgame: sc.endgame, np: sc.np, penCommitted: sc.pen, total: sc.total };
      if (sur.length) r.surrogates = sur;
      if (ev.season >= 2025 && sc.bonus) r.bonusRp = sc.bonus;
      return r;
    };
    const red = side(m.red, m.redScore), blue = side(m.blue, m.blueScore);
    if (!red.teams.length || !blue.teams.length) continue;
    const t = matchTimeMs(m.time) || startTime + (m.level === "playoff" ? 1e6 : 0) + m.series * 1e3 + m.number;
    matches.push({ season: ev.season, eventCode: ev.code, level: m.level, series: m.series, number: m.number, time: t, red, blue });
  }
  if (!matches.length) return null;
  matches.sort((a, b) => a.time - b.time || (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number);
  return {
    season: ev.season, code: ev.code, type: ev.type ?? "", region: ev.region ?? undefined, start: ev.start, end: ev.end ?? ev.start, startTime,
    teams: ev.teams, ranks: ev.ranks, awards: ev.awards, matches,
  };
}
