// A run of seasons asked (search audit, "season ranges"): "4215 opr since 2023", "4215 last 3 seasons", "best teams
// 2023-24 to 2025-26". A stat is never set against another season's raw number: each season is read as the team's
// rank and share of that season's ranked teams, and a board over the run ranks teams by their average share. Nothing
// here names a team, a season or a place: the parse reads them (./parse.ts, time.ts `range`).
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { teamPageSql } from "../../../src/shared/teamPages.js";
import { all, get } from "../../db.js";
import { defaultSeason } from "../answers/season.js";
import type { Parsed } from "./parse.js";

/** The stats a season ranks teams by: the value and its rank in that season. */
const RANKED: Record<string, { label: string; value: string; rank: string }> = {
  opr: { label: "OPR", value: "s.opr_np", rank: "s.rank_np" },
  auto: { label: "Auto OPR", value: "s.opr_auto", rank: "s.rank_auto" },
  teleop: { label: "TeleOp OPR", value: "s.opr_teleop", rank: "s.rank_teleop" },
  endgame: { label: "Endgame OPR", value: "s.opr_endgame", rank: "s.rank_endgame" },
  rating: { label: "Prediction rating", value: "s.rating_np", rank: "s.rating_rank" },
};
/** A board over a run: a team ranked in at least this many of its seasons (every one, in a run of one or two). */
const MIN_SEASONS = 2;

/** The seasons a run names, oldest first: the ones with ranked teams, up to the latest played. */
async function seasonsOf(range: NonNullable<NonNullable<Parsed["time"]>["range"]>): Promise<number[]> {
  const latest = defaultSeason();
  const to = Math.min(range.to ?? latest, latest);
  const rows = await all<{ season: number }>("SELECT DISTINCT season FROM team_season_stats WHERE season <= ? AND rank_np IS NOT NULL ORDER BY season DESC", [to]);
  const held = rows.map((r) => Number(r.season));
  const out = range.last ? held.slice(0, range.last) : held.filter((s) => s >= (range.from ?? -Infinity));
  return out.reverse();
}

/** "Top 3%": a rank as a share of the season's ranked teams, never 0. */
const topShare = (rank: number, of: number) => { const p = (100 * rank) / of; return `Top ${p < 1 ? Math.max(0.1, Math.ceil(p * 10) / 10) : Math.ceil(p)}%`; };

/** What a run of seasons asks: one team's run ("team"), the best teams over it ("board"), or null when it asks
 *  something else of the run. `stat`: the board stat said (null: none). */
export function seasonsAsk(p: Parsed, stat: string | null): "team" | "board" | null {
  if (p.time?.kind !== "seasons" || !p.time.range || p.event || p.eventKind || p.worlds || p.states || p.award || p.alliance || p.matchNumber != null || p.level || p.leftover.length) return null;
  if (!RANKED[stat ?? "opr"]) return null;
  if (!p.teams.length && (p.intent === "leaderboard" || p.symbols.includes("thing:team"))) return "board";
  if (p.teams.length !== 1) return null;
  // A team's own run asks its stat or nothing else ("4215 last 3 seasons"), never a match or a record question.
  return p.symbols.every((s) => s.startsWith("metric:") || s.startsWith("prep:") || s === "thing:season") ? "team" : null;
}

/** What a run of seasons asks, answered; null when the question asks something else of the run (left to search's
 *  other readers). `stat`: the board stat said (null: none). */
export async function seasonsAnswer(p: Parsed, stat: string | null, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  const ask = seasonsAsk(p, stat);
  if (!ask) return null;
  const st = RANKED[stat ?? "opr"], board = ask === "board";
  const run = p.time!.label;
  const label = board ? `Best teams by ${st.label}${p.place && p.place.kind !== "city" ? ` in ${p.place.name}` : ""}, ${run}` : `${p.teams[0].name ?? `Team ${p.teams[0].number}`} (${p.teams[0].number}): ${st.label} rank each season, ${run}`;
  const read: SearchAnswer = {
    q: p.q, hits: [], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label },
    intent: { kind: board ? "stat-seasons-board" : "stat-team-seasons", pattern: board ? "best teams [seasons]" : "[team] [stat] [seasons]", met: true, understood: [label] },
  };
  if (!opts.full) return { ...read, pages: [{ title: label, href: `/search?q=${encodeURIComponent(p.q)}` }, ...opts.pages] };
  const seasons = await seasonsOf(p.time!.range!);
  const stat0: Omit<StatAnswer, "blocks"> = {
    family: "leaderboard", intent: board ? "seasons-board" : "team-seasons", title: label,
    scope: [...(seasons.length ? [`${seasonLabel(seasons[0])} to ${seasonLabel(seasons[seasons.length - 1])}`] : [run])],
    definition: `Each season is read on its own: the ${st.label} rank among that season's ranked teams, and the share of them at or above it ("Top 3%"). ${st.label} itself is never compared across seasons: each game scores differently.`,
    source: "From each season's ranked teams",
  };
  if (!seasons.length) return { ...read, stat: { ...stat0, blocks: [], none: `No season ${run} has ranked teams yet.` } };
  const marks = seasons.map(() => "?").join(", ");
  // Each season's ranked count for the stat, once.
  const counts = new Map((await all<{ season: number; n: number }>(`SELECT s.season, COUNT(*) n FROM team_season_stats s WHERE s.season IN (${marks}) AND ${st.rank} IS NOT NULL GROUP BY s.season`, seasons))
    .map((r) => [Number(r.season), Number(r.n)]));
  if (!board) return { ...read, stat: { ...stat0, team: { number: p.teams[0].number, name: p.teams[0].name ?? null }, ...(await teamRun(p.teams[0].number, seasons, st, counts)) } };
  return { ...read, stat: { ...stat0, ...(await boardRun(p, seasons, st, counts)) } };
}

/** One team's run: each season's stat, rank and share, and its best season. */
async function teamRun(team: number, seasons: number[], st: (typeof RANKED)[string], counts: Map<number, number>): Promise<Pick<StatAnswer, "blocks" | "headline" | "none">> {
  const rows = await all<{ season: number; v: number | null; r: number | null; w: number; l: number; t: number }>(
    `SELECT s.season, ${st.value} v, ${st.rank} r, s.wins w, s.losses l, s.ties t FROM team_season_stats s WHERE s.team = ? AND s.season IN (${seasons.map(() => "?").join(", ")})`, [team, ...seasons]);
  const by = new Map(rows.map((r) => [Number(r.season), r]));
  const ranked = seasons.filter((s) => by.get(s)?.r != null && counts.get(s));
  if (!ranked.length) return { blocks: [], none: `Team ${team} wasn't ranked by ${st.label} in any of these seasons.` };
  const share = (s: number) => Number(by.get(s)!.r) / counts.get(s)!;
  const best = ranked.reduce((a, b) => (share(b) < share(a) ? b : a));
  return {
    headline: { value: topShare(Number(by.get(best)!.r), counts.get(best)!), label: `Best season by ${st.label} rank: ${seasonLabel(best)}, #${by.get(best)!.r} of ${counts.get(best)!.toLocaleString("en-US")}`, sub: `${ranked.length} of ${seasons.length} seasons ranked` },
    blocks: [{
      kind: "table", title: `${st.label} rank each season`,
      columns: [{ key: "season", label: "Season" }, { key: "rank", label: "Rank", num: true }, { key: "share", label: "Share", num: true }, { key: "value", label: st.label, num: true }, { key: "record", label: "W-L-T" }],
      rows: seasons.map((s) => {
        const r = by.get(s), n = counts.get(s);
        return {
          cells: { season: seasonLabel(s), rank: r?.r != null && n ? `#${r.r} of ${n.toLocaleString("en-US")}` : r ? "Not ranked" : "Didn't play",
            share: r?.r != null && n ? topShare(Number(r.r), n) : null, value: r?.v != null ? Number(r.v).toFixed(1) : null, record: r ? `${r.w}-${r.l}-${r.t}` : null },
          href: `/teams/${team}?season=${s}`, strong: s === best,
        };
      }),
    }],
  };
}

/** The best teams over the run: by their average share of each season's ranked teams. */
async function boardRun(p: Parsed, seasons: number[], st: (typeof RANKED)[string], counts: Map<number, number>): Promise<Pick<StatAnswer, "blocks" | "headline" | "none">> {
  const need = Math.min(MIN_SEASONS, seasons.length);
  const pl = p.place && p.place.kind !== "city" ? p.place : null;
  const where = pl ? ` AND t.country = ?${pl.state ? " AND t.state = ?" : ""}` : "";
  const whereArgs = pl ? [pl.country, ...(pl.state ? [pl.state] : [])] : [];
  const n = Math.min(25, p.n ?? 10);
  const share = `(1.0 * ${st.rank} / CASE s.season ${seasons.map((s) => `WHEN ${s} THEN ${counts.get(s) ?? 0}`).join(" ")} END)`;
  const rows = await all<{ team: number; name: string | null; seasons: number; avg: number; best: number }>(
    `SELECT s.team, t.name, COUNT(*) seasons, AVG(${share}) avg, MIN(${st.rank}) best
     FROM team_season_stats s JOIN teams t ON t.number = s.team
     WHERE s.season IN (${seasons.map(() => "?").join(", ")}) AND ${st.rank} IS NOT NULL AND ${teamPageSql("s.team", "t.name")}${where}
     GROUP BY s.team HAVING COUNT(*) >= ? ORDER BY avg ASC, s.team LIMIT ?`,
    [...seasons, ...whereArgs, need, n]);
  if (!rows.length) return { blocks: [], none: `No team${pl ? ` in ${pl.name}` : ""} was ranked by ${st.label} in ${need} of these seasons.` };
  const pct = (x: number) => { const v = 100 * x; return `Top ${v < 1 ? Math.max(0.1, Math.ceil(v * 10) / 10) : Math.ceil(v)}%`; };
  const top = rows[0];
  const total = (await get<{ n: number }>(
    `SELECT COUNT(*) n FROM (SELECT s.team FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE s.season IN (${seasons.map(() => "?").join(", ")}) AND ${st.rank} IS NOT NULL AND ${teamPageSql("s.team", "t.name")}${where} GROUP BY s.team HAVING COUNT(*) >= ?)`,
    [...seasons, ...whereArgs, need]))?.n ?? rows.length;
  return {
    headline: { value: `${top.team} ${top.name ?? ""}`.trim(), label: `Average ${pct(Number(top.avg))} by ${st.label} over ${Number(top.seasons)} seasons`, sub: `#1 of ${Number(total).toLocaleString("en-US")} teams ranked in ${need}+ of these seasons`, href: `/teams/${top.team}` },
    blocks: [{
      kind: "table", title: `Average share of each season's ranked teams, ${seasonLabel(seasons[0])} to ${seasonLabel(seasons[seasons.length - 1])}`,
      columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "avg", label: "Average", num: true }, { key: "seasons", label: "Seasons", num: true }, { key: "best", label: "Best rank", num: true }],
      rows: rows.map((r, i) => ({ cells: { rank: i + 1, team: `${r.team} ${r.name ?? ""}`.trim(), avg: pct(Number(r.avg)), seasons: Number(r.seasons), best: `#${r.best}` }, href: `/teams/${r.team}`, strong: i === 0 })),
    }],
  };
}
