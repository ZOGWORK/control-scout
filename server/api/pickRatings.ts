// GET /api/events/:season/:code/pick-ratings: what Scout's pick helper (src/shared/pickRadar.ts) works from.
// Each team at the event with the engine's rating components the stats job already stored
// (team_season_stats.rating_*: the same ratings predictions use), and the playoff alliances as posted. Read
// only: no rating is computed here. The radar math runs in the browser. Kept per data version, so a busy
// alliance selection asks the database once per sync.
import { all, get, kvGet } from "../db.js";
import { ROSTER } from "../data/registrations.js";
import { dataVersion, liveVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import type { PickAlliance, PickRatings, PickTeam } from "../../src/shared/pickRadar.js";

const MAX_KEPT = 200;
const kept = new Map<string, Promise<PickRatings | null>>();
registerCache("Pick ratings", () => kept.clear());

const num = (x: unknown) => (x == null ? null : Number(x));
const r1 = (x: unknown) => Math.round(Number(x) * 10) / 10;

export async function pickRatings(season: number, code: string): Promise<PickRatings | null> {
  const key = `${await dataVersion()}|${(await kvGet<string>("data:settled")) ?? ""}|${await liveVersion(season)}|${season}|${code}`;
  const hit = kept.get(key);
  if (hit) return hit;
  const value = build(season, code);
  kept.set(key, value);
  value.catch(() => { if (kept.get(key) === value) kept.delete(key); });
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
  return value;
}

async function build(season: number, code: string): Promise<PickRatings | null> {
  const ev = await get<{ code: string; name: string | null }>("SELECT code, name FROM events WHERE season = ? AND code = ?", [season, code]);
  if (!ev) return null;
  const [rows, alliances] = await Promise.all([
    all<any>(`SELECT et.team, et.rank, t.name, s.rating_auto, s.rating_teleop, s.rating_endgame, s.rating_pen, s.rating_matches
      FROM ${ROSTER} et LEFT JOIN teams t ON t.number = et.team LEFT JOIN team_season_stats s ON s.season = et.season AND s.team = et.team
      WHERE et.season = ? AND et.code = ?`, [season, code]),
    all<any>("SELECT number, captain, pick1, pick2 FROM alliances WHERE season = ? AND code = ? ORDER BY number", [season, code]),
  ]);
  const teams: PickTeam[] = [];
  const unrated: number[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    const team = Number(r.team);
    if (seen.has(team)) continue;
    seen.add(team);
    if (r.rating_auto == null || r.rating_teleop == null || r.rating_endgame == null) { unrated.push(team); continue; }
    teams.push({
      team, name: r.name ?? null, rank: num(r.rank),
      // To one decimal, as the page shows them: every number on it adds up from what it shows.
      auto: r1(r.rating_auto), teleop: r1(r.rating_teleop), endgame: r1(r.rating_endgame),
      fouls: r1(r.rating_pen ?? 0), matches: Number(r.rating_matches ?? 0),
    });
  }
  teams.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.team - b.team);
  unrated.sort((a, b) => a - b);
  const posted: PickAlliance[] = alliances.map((a) => ({ number: Number(a.number), captain: num(a.captain), pick1: num(a.pick1), pick2: num(a.pick2) }));
  const three = posted.some((a) => a.pick2 != null);
  return {
    season, code: ev.code, name: ev.name ?? ev.code, teams, unrated, alliances: posted,
    size: three ? 3 : 2, sizeFrom: posted.length ? "alliances" : "default",
  };
}
