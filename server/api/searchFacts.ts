// The numbers a search asks about, for the team it found ("hypnotic ranking points" → its ranking score and
// rank at its latest event). Read from the stored stats only; a number that isn't there is left out, never guessed.
import { all, get } from "../db.js";
import type { SearchEventPick, SearchFact } from "../../src/shared/api.js";
import { fuzzyScore } from "./fuzzy.js";
import type { SearchTopic } from "../../src/shared/search.js";
import { awardLabel, seasonLabel } from "../../src/shared/format.js";
import { ATTENDED, teamSchedule } from "./teams.js";
import { isEnabled } from "../flags.js";
import { scheduleRankText } from "../../src/shared/scheduleDifficulty.js";

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

/** The events a team played in a season, oldest first, each with its event OPR (team_event_stats): what the visitor
 *  picks from when a question names no event ("hypnotic OPR at this event"). */
export async function teamEvents(team: number, season: number): Promise<SearchEventPick[]> {
  const rows = await all<any>(
    `SELECT e.season, e.code, e.name, s.opr_np opr FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
     LEFT JOIN team_event_stats s ON s.season = et.season AND s.code = et.code AND s.team = et.team
     WHERE et.team = ? AND et.season = ? AND ${ATTENDED} AND s.matches > 0 ORDER BY e.start`, [team, season]);
  return rows.map((r) => ({ season: Number(r.season), code: r.code, name: r.name, opr: r.opr == null ? null : Math.round(Number(r.opr) * 10) / 10 }));
}

/** The team_season_stats columns teamFacts reads, and the season. */
const FACT_STATS = "season, opr_np, rank_np, ranked_teams, wins, losses, ties, matches, avg_score";

/** The team's newest season with stats (or registration), or `asked`, the season a query named. */
export async function teamSeason(team: number, asked?: number | null): Promise<{ s: any; season: number | null }> {
  if (asked != null) return { s: await get<any>(`SELECT ${FACT_STATS} FROM team_season_stats WHERE team = ? AND season = ?`, [team, asked]), season: asked };
  const s = await get<any>(`SELECT ${FACT_STATS} FROM team_season_stats WHERE team = ? ORDER BY season DESC LIMIT 1`, [team]);
  return { s, season: s?.season ?? (await get<{ s: number | null }>("SELECT MAX(season) s FROM event_teams WHERE team = ?", [team]))?.s ?? null };
}

/**
 * "hypnotic OPR at <event>": the team's numbers at the one event of its newest season whose name best matches
 * `eventWords` (its event OPR, rank and ranking score). Null when no event of the team's matches: the caller then
 * lists its events for the visitor to pick, never a guess.
 */
export async function teamAtEvent(team: number, eventWords: string, asked?: number | null): Promise<{ event: SearchEventPick; facts: SearchFact[] } | { ambiguous: true } | null> {
  const { season } = await teamSeason(team, asked);
  if (season == null) return null;
  const evs = await teamEvents(team, season);
  const [best, next] = evs.map((e) => ({ e, s: Math.max(fuzzyScore(eventWords, e.name), fuzzyScore(eventWords, e.code)) })).sort((a, b) => b.s - a.s);
  if (!best || best.s < 0.75) return null;
  // Two events match about as well ("Northern League Meet" names every meet): not a pick to make for the visitor.
  if (next && next.s >= 0.75 && best.s - next.s < 0.05) return { ambiguous: true };
  const at = await get<any>(`SELECT ${RANK} rank, ${RP} rp ${ROWS.replace("AND et.season = ?", "AND et.season = ? AND et.code = ?")}`, [team, season, best.e.code]);
  return {
    event: best.e,
    facts: [...fact("Event OPR", best.e.opr == null ? null : best.e.opr.toFixed(1)), ...fact("Event rank", of(at?.rank, null)), ...fact("Ranking score", fixed(at?.rp, 2)),
      { label: "Event", value: best.e.name }],
  };
}

/** Up to four facts about `team` for `topic`, from its newest season with stats (that season named last), and that
 *  season, for the result's link (the team page opens on it). OPR also lists each event's OPR (`events`). */
export async function teamFacts(team: number, topic: SearchTopic, asked?: number | null): Promise<{ facts: SearchFact[]; season: number | null; events?: SearchEventPick[] }> {
  const none = { facts: [], season: null };
  if (topic === "odds" || topic === "playoffs") return none;
  const { s, season } = await teamSeason(team, asked);
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
  let events: SearchEventPick[] | undefined;
  // The ranking line: ranking score and rank at the latest event, and the season's record.
  if (topic === "rp") out = [...(ev ? fact("Ranking score", fixed(ev.rp, 2) && `${fixed(ev.rp, 2)} at ${ev.name}`) : []), ...(ev ? fact("Event rank", of(ev.rank, ev.n)) : []), ...record];
  // The OPR line: the season's OPR and its rank, the latest event's OPR, and every event's OPR to pick from.
  else if (topic === "opr") {
    events = await teamEvents(team, season);
    const last = [...events].reverse().find((e) => e.opr != null);
    out = [...fact("OPR", fixed(s?.opr_np, 1)), ...worldRank, ...(last ? fact("Event OPR", `${last.opr!.toFixed(1)} at ${last.name}`) : [])];
  }
  // Schedule difficulty (the team page's section, behind its own switch): the latest event's, and the hardest one's.
  else if (topic === "difficulty") {
    if (await isEnabled("scheduleDifficulty").catch(() => false)) {
      const rated = (await teamSchedule(season, team)).filter((x) => x.full);
      const names = new Map((await teamEvents(team, season)).map((e) => [e.code, e.name]));
      const at = (x: (typeof rated)[number]) => `${scheduleRankText(x.full!)} at ${names.get(x.code) ?? x.code}`;
      const last = rated.at(-1), hardest = rated.reduce<(typeof rated)[number] | undefined>((a, b) => (!a || b.full!.z > a.full!.z ? b : a), undefined);
      out = last ? [...fact("Latest", at(last)), ...(hardest && hardest !== last ? fact("Hardest", at(hardest)) : []), ...fact("Events rated", String(rated.length))] : [];
    }
  }
  else if (topic === "record") out = [...record, ...(games ? fact("Win rate", `${Math.round((Number(s.wins) / games) * 100)}%`) : [])];
  else if (topic === "rankings") out = [...worldRank, ...eventRank];
  else if (topic === "stats") out = [...fact("OPR", fixed(s?.opr_np, 1)), ...worldRank, ...record];
  else if (topic === "matches") out = s?.matches ? [...fact("Matches", String(s.matches)), ...fact("Avg score", fixed(s.avg_score, 1)), ...record] : [];
  else if (topic === "awards") {
    const aw = await all<any>(`SELECT a.type, a.placement, e.name FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code
      WHERE a.team = ? AND a.season = ? ORDER BY e.start DESC, a.type, a.placement`, [team, season]);
    out = aw.length ? [...fact("Awards", String(aw.length)), ...fact("Latest", `${awardLabel(aw[0].type, aw[0].placement)} at ${aw[0].name}`)] : fact("Awards", "None yet");
  }
  return out.length ? { facts: [...out.slice(0, 3), { label: "Season", value: seasonLabel(season) }], season, ...(events?.length ? { events } : {}) } : none;
}
