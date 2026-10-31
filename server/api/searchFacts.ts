// The numbers a search asks about, for the team it found ("hypnotic ranking points" → its ranking score and
// rank at its latest event). Read from the stored stats only; a number that isn't there is left out, never guessed.
import { all, get } from "../db.js";
import type { SearchFact } from "../../src/shared/api.js";
import type { SearchTopic } from "../../src/shared/search.js";
import { awardLabel, seasonLabel } from "../../src/shared/format.js";
import { ATTENDED } from "./teams.js";

const fixed = (x: number | null | undefined, d: number) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x).toFixed(d));
const of = (rank: number | null | undefined, n: number | null | undefined) => (rank ? `#${rank}${n ? ` of ${Number(n).toLocaleString("en-US")}` : ""}` : null);
const fact = (label: string, value: string | null): SearchFact[] => (value ? [{ label, value }] : []);

// A league meet's own rank and ranking score (team_event_records), as the team page shows them: event_teams holds
// the league's running standings there. Other events' are event_teams' own.
const MEET = "e.type = 'LeagueMeet'";
const RANK = `CASE WHEN ${MEET} THEN r.rank ELSE et.rank END`;
const RP = `CASE WHEN ${MEET} THEN r.rp ELSE et.rp END`;
const ROWS = `FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
  LEFT JOIN team_event_records r ON r.season = et.season AND r.code = et.code AND r.team = et.team AND ${MEET}
  WHERE et.team = ? AND et.season = ? AND ${ATTENDED} AND ${RANK} IS NOT NULL`;

/** Up to four facts about `team` for `topic`, from its newest season with stats (that season named last), and that
 *  season, for the result's link (the team page opens on it). */
export async function teamFacts(team: number, topic: SearchTopic): Promise<{ facts: SearchFact[]; season: number | null }> {
  const none = { facts: [], season: null };
  if (topic === "odds" || topic === "playoffs") return none;
  const s = await get<any>("SELECT * FROM team_season_stats WHERE team = ? ORDER BY season DESC LIMIT 1", [team]);
  const season: number | null = s?.season ?? (await get<{ s: number | null }>("SELECT MAX(season) s FROM event_teams WHERE team = ?", [team]))?.s ?? null;
  if (season == null) return none;
  // The newest event this season the team played and was ranked at (its ranking score, and how many teams were ranked).
  const ev = await get<any>(
    `SELECT ${RANK} rank, ${RP} rp, e.name,
       CASE WHEN ${MEET} THEN (SELECT COUNT(*) FROM team_event_records x WHERE x.season = et.season AND x.code = et.code AND x.rank IS NOT NULL)
            ELSE (SELECT COUNT(*) FROM event_teams x WHERE x.season = et.season AND x.code = et.code AND x.rank IS NOT NULL) END n
     ${ROWS} ORDER BY e.start DESC LIMIT 1`, [team, season]);
  const worldRank = fact("OPR rank", of(s?.rank_np, s?.ranked_teams));
  const games = Number(s?.wins ?? 0) + Number(s?.losses ?? 0) + Number(s?.ties ?? 0);
  const record = games ? fact("Record", `${s.wins}-${s.losses}-${s.ties}`) : [];
  const eventRank = ev ? fact("Event rank", of(ev.rank, ev.n) && `${of(ev.rank, ev.n)} at ${ev.name}`) : [];
  let out: SearchFact[] = [];
  if (topic === "rp") {
    const best = await get<{ r: number | null; n: number }>(`SELECT MIN(${RANK}) r, COUNT(*) n ${ROWS}`, [team, season]);
    out = [...(ev ? fact("Ranking score", fixed(ev.rp, 2) && `${fixed(ev.rp, 2)} at ${ev.name}`) : []), ...(ev ? fact("Event rank", of(ev.rank, ev.n)) : []),
      ...(best && best.n > 1 ? fact("Best rank", of(best.r, null)) : [])];
  } else if (topic === "opr") out = [...fact("OPR", fixed(s?.opr_np, 1)), ...worldRank];
  else if (topic === "record") out = [...record, ...(games ? fact("Win rate", `${Math.round((Number(s.wins) / games) * 100)}%`) : [])];
  else if (topic === "rankings") out = [...worldRank, ...eventRank];
  else if (topic === "stats") out = [...fact("OPR", fixed(s?.opr_np, 1)), ...worldRank, ...record];
  else if (topic === "matches") out = s?.matches ? [...fact("Matches", String(s.matches)), ...fact("Avg score", fixed(s.avg_score, 1)), ...record] : [];
  else if (topic === "awards") {
    const aw = await all<any>(`SELECT a.type, a.placement, e.name FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code
      WHERE a.team = ? AND a.season = ? ORDER BY e.start DESC, a.type, a.placement`, [team, season]);
    out = aw.length ? [...fact("Awards", String(aw.length)), ...fact("Latest", `${awardLabel(aw[0].type, aw[0].placement)} at ${aw[0].name}`)] : fact("Awards", "None yet");
  }
  return out.length ? { facts: [...out.slice(0, 3), { label: "Season", value: seasonLabel(season) }], season } : none;
}
