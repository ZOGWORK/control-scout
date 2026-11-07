// Matches a low-ranked team won against a high-ranked one ("matches where a team ranked below 1000 beat a team ranked
// top 100"): played matches at official events whose winning alliance had a team ranked past one line and whose losing
// alliance had a team ranked inside another, by the season's world rating rank. The biggest rank gap first.
import type { StatAnswer, StatLink, StatMatchRow } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { all, get } from "../../../db.js";
import { OFFICIAL_TYPES } from "../clauses.js";
import { eventHref, matchHref, shortEvent, teamLinks } from "../matchSet.js";

/** Winner: a team ranked worse than `below` (rank > below). Loser: a team ranked `top` or better (rank <= top). */
export interface RankUpsetQuestion { below: number; top: number; season: number | null }

// "below 1000", "lower than 1000", "outside the top 1000", "ranked 1000 or lower"
const LOW = String.raw`(?:ranked\s+)?(?:(?:below|lower\s+than|worse\s+than|beyond|past|over|outside(?:\s+of)?(?:\s+the)?\s+top)\s+#?(\d{1,5})|#?(\d{1,5})\s+or\s+(?:lower|worse|below))`;
// "top 100", "in the top 100", "above 100", "better than 100", "ranked 100 or higher"
const HIGH = String.raw`(?:ranked\s+)?(?:(?:in\s+the\s+|inside\s+the\s+|within\s+the\s+)?top\s+(\d{1,5})|(?:above|higher\s+than|better\s+than|under)\s+#?(\d{1,5})|#?(\d{1,5})\s+or\s+(?:higher|better|above))`;
const A = String.raw`(?:an?\s+|any\s+)?(?:team|robot)s?\s+`;
const FRAME = String.raw`^(?:(?:show|list|find|give)\s+(?:me\s+)?)?(?:all\s+)?(?:the\s+)?(?:(?:match(?:es)?|games?|times?|upsets?)\s+)?(?:(?:where|when|in\s+which)\s+)?`;
const SEASON = String.raw`(?:\s+(?:in\s+)?(?:the\s+)?(20\d\d)\s*[-–/]\s*\d\d(?:\s+season)?)?`;
const BEAT = String.raw`(?:beat|beats|defeated|defeats|upset|upsets|won\s+against|wins\s+against|knocked\s+off)`;
const LOST = String.raw`(?:lost\s+to|loses\s+to|was\s+beaten\s+by|got\s+beaten\s+by|fell\s+to)`;
const WON = new RegExp(`${FRAME}${A}${LOW}\\s+${BEAT}\\s+${A}${HIGH}${SEASON}$`, "i");
const FELL = new RegExp(`${FRAME}${A}${HIGH}\\s+${LOST}\\s+${A}${LOW}${SEASON}$`, "i");

export function readRankUpset(q0: string): RankUpsetQuestion | null {
  const q = q0.replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim();
  const w = WON.exec(q);
  // "N or lower" takes N in (a rank past N - 1); "above N" leaves N out (N - 1 or better).
  if (w) return check(w[1] != null ? Number(w[1]) : Number(w[2]) - 1, w[3] != null ? Number(w[3]) : w[4] != null ? Number(w[4]) - 1 : Number(w[5]), w[6]);
  const f = FELL.exec(q);
  if (f) return check(f[4] != null ? Number(f[4]) : Number(f[5]) - 1, f[1] != null ? Number(f[1]) : f[2] != null ? Number(f[2]) - 1 : Number(f[3]), f[6]);
  return null;
}

/** Only lines that make an upset: the winner's line below the loser's. */
const check = (below: number, top: number, season?: string): RankUpsetQuestion | null =>
  below > 0 && top > 0 && below >= top ? { below, top, season: season ? Number(season) : null } : null;

type Row = { season: number; code: string; level: string; series: number; number: number; label: string; name: string; type: string | null; start: string | null; time: string | null; red_total: number; blue_total: number; gap: number };

const SAME = (x: string) => `${x}.season = m.season AND ${x}.code = m.code AND ${x}.level = m.level AND ${x}.series = m.series AND ${x}.number = m.number AND ${x}.on_field = 1`;
const WIN = "CASE WHEN m.red_total > m.blue_total THEN 'red' ELSE 'blue' END";
const LOSE = "CASE WHEN m.red_total > m.blue_total THEN 'blue' ELSE 'red' END";
const RANK = (side: string, agg: "MAX" | "MIN") => `(SELECT ${agg}(s.rating_rank) FROM match_teams x JOIN team_season_stats s ON s.season = x.season AND s.team = x.team WHERE ${SAME("x")} AND x.alliance = ${side})`;

export async function rankUpsetAnswer(qn: RankUpsetQuestion): Promise<StatAnswer> {
  // No season said: the latest one with world ranks.
  const season = qn.season ?? Number((await get<{ s: number }>("SELECT MAX(season) s FROM team_season_stats WHERE rating_rank IS NOT NULL"))?.s ?? 0);
  const where = `m.season = ? AND m.played = 1 AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL AND m.red_total <> m.blue_total
    AND COALESCE(e.remote, 0) = 0 AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")})`;
  const args = [season, ...OFFICIAL_TYPES];
  const hit = `${RANK(WIN, "MAX")} > ? AND ${RANK(LOSE, "MIN")} <= ?`;
  const [rows, count, played] = await Promise.all([
    all<Row>(`SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.name, e.type, e.start, m.red_total, m.blue_total, ${RANK(WIN, "MAX")} - ${RANK(LOSE, "MIN")} gap
      FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE ${where} AND ${hit} ORDER BY gap DESC, e.start, m.code, m.label LIMIT 25`, [...args, qn.below, qn.top]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE ${where} AND ${hit}`, [...args, qn.below, qn.top]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE ${where}`, args),
  ]);
  const n = Number(count?.n ?? 0), all0 = Number(played?.n ?? 0);
  const S = seasonLabel(season);
  const title = `Matches a team ranked below ${qn.below.toLocaleString("en-US")} beat a top-${qn.top.toLocaleString("en-US")} team, ${S}`;
  const base = {
    family: "superlative" as const, intent: "rank-upsets", title, scope: [S, `Winner: a team ranked below ${qn.below.toLocaleString("en-US")}`, `Loser: a team in the top ${qn.top.toLocaleString("en-US")}`, "Official events"],
    definition: `Ranks are each team's ${S} world rank by its prediction rating. A match counts when the winning alliance had a team ranked below ${qn.below.toLocaleString("en-US")} and the losing alliance a team ranked ${qn.top.toLocaleString("en-US")} or better; the biggest rank gap between those two teams first. Ties never count. Only played matches at official events held in person.`,
    source: `From ${all0.toLocaleString("en-US")} decided matches in ${S}`,
  };
  if (!rows.length) return { ...base, blocks: [], none: all0 ? `None of the ${all0.toLocaleString("en-US")} decided matches in ${S} had a team ranked below ${qn.below.toLocaleString("en-US")} beat a top-${qn.top.toLocaleString("en-US")} team.` : `No decided matches in ${S} yet.` };
  const ups = await all<{ season: number; code: string; level: string; series: number; number: number; alliance: string; team: number; rank: number | null }>(
    `SELECT x.season, x.code, x.level, x.series, x.number, x.alliance, x.team, s.rating_rank rank FROM match_teams x LEFT JOIN team_season_stats s ON s.season = x.season AND s.team = x.team
     WHERE x.on_field = 1 AND (${rows.map(() => "(x.season = ? AND x.code = ? AND x.level = ? AND x.series = ? AND x.number = ?)").join(" OR ")}) ORDER BY x.station, x.team`,
    rows.flatMap((r) => [r.season, r.code, r.level, r.series, r.number]));
  const links = await teamLinks(ups.map((u) => Number(u.team)));
  const side = (r: Row, a: string): StatLink[] => ups.filter((u) => u.season === r.season && u.code === r.code && u.level === r.level && u.series === r.series && u.number === r.number && u.alliance === a)
    .map((u) => { const l = links.get(Number(u.team)) ?? { label: String(u.team), href: `/teams/${u.team}` }; return { ...l, label: `${l.label}${u.rank != null ? ` (#${Number(u.rank).toLocaleString("en-US")})` : ""}` }; });
  const row = (r: Row): StatMatchRow => {
    const red = r.red_total > r.blue_total, win = red ? "red" : "blue";
    return {
      label: r.label, href: matchHref(r), event: { label: shortEvent(r.name, r.type), href: eventHref(r.season, r.code) }, season: S, date: (r.time ?? r.start)?.slice(0, 10) ?? null,
      alliance: win, own: red ? r.red_total : r.blue_total, opp: red ? r.blue_total : r.red_total, result: "W", partners: side(r, win), opponents: side(r, red ? "blue" : "red"), type: r.type,
    } as StatMatchRow;
  };
  const top = rows[0];
  return {
    ...base,
    headline: { value: `${n.toLocaleString("en-US")} match${n === 1 ? "" : "es"}`, label: `The biggest: a rank gap of ${Number(top.gap).toLocaleString("en-US")}, ${top.label} at ${shortEvent(top.name, top.type)}`, href: matchHref(top), type: top.type },
    blocks: [{ kind: "matches", title: n > rows.length ? `The ${rows.length} biggest rank gaps of ${n.toLocaleString("en-US")}` : "Biggest rank gap first", rows: rows.map(row) }],
  };
}
