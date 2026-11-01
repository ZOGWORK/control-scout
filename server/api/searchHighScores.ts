// "World record score bio buzz", "highest score this season", "4215 high score in DECODE": the best match scores of a
// season, or of one team in it, from the stored matches (docs/search.md). A record is the alliance's score without
// penalties (fouls the other alliance committed aren't the alliance's own points), highest first, the score with
// penalties beside it; only official events count (qualifiers, league play, championships, premier events), never
// scrimmages, off-season or demo events (before a season's first official match, its scrimmages' best are shown as
// the closest records, said plainly). With no season named: the latest season with played matches (the team's,
// for a team). Scores of different games are never compared, so there is no all-time record.
import type { SearchAnswer, SearchCard, SearchCardLine, SearchHit } from "../../src/shared/api.js";
import { dateRange, place, seasonLabel } from "../../src/shared/format.js";
import { get, all } from "../db.js";
import { CURRENT_SEASON, SEASONS, ownScorePenalties } from "../data/seasons.js";

/** Events whose matches count for a record. */
const RECORD_TYPES = ["Qualifier", "LeagueMeet", "LeagueTournament", "Championship", "FIRSTChampionship", "Premier", "SuperQualifier", "Official"];
/** Early in a season only these have been played: shown as the closest records, never as the record. */
const PRACTICE_TYPES = ["Scrimmage", "OffSeason"];
/** The best this many scores are listed. */
export const HIGH_SCORE_LINES = 5;

// The question: a record or a high score. "record" alone is a team's win-loss record, never this.
const ASKED = /\b(?:world[\s-]+records?|records?\s+scores?|score\s+records?|(?:high(?:est)?|best|top|max(?:imum)?|biggest|most)\s+(?:match\s+)?(?:scores?|points)|highest[\s-]+scoring(?:\s+match(?:es)?)?)\b/i;
const FRAME = /\b(?:what|whats|what's|is|was|the|a|an|of|in|for|during|ever|this|current|last|season|year|game|ftc|match|matches|by|team|their|its|score|scores|scored|points|world|record|records|now|so|far|has|have|had|did|does)\b/gi;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export interface HighScoreQuestion {
  /** The season asked about, or null: the latest with played matches. */
  season: number | null;
  /** The game's name when it was named ("BIOBUZZ"). */
  game: string | null;
  /** What's left: a team ("4215", "hypnotic robotics"), or "" for the whole season. */
  core: string;
}

/** A game's name as typed: any spacing between its letters ("bio buzz", "BIOBUZZ", "into the deep", "center stage"). */
const gameRe = (game: string) => new RegExp(`\\b${[...game.replace(/\s+/g, "").toLowerCase()].join("[\\s-]?")}\\b`, "i");

/** The high-score question `q` asks, or null when it isn't one. */
export function parseHighScore(q: string): HighScoreQuestion | null {
  const asked = ASKED.exec(q);
  if (!asked) return null;
  let rest = q.replace(asked[0], " "), season: number | null = null, game: string | null = null;
  for (const s of SEASONS) {
    const m = gameRe(s.game).exec(rest);
    if (m) { season = s.season; game = s.game; rest = rest.replace(m[0], " "); break; }
  }
  const label = /\b(20\d\d)\s*[-–/]\s*(\d\d)\b/.exec(rest);
  if (season == null && label && (Number(label[1]) + 1) % 100 === Number(label[2])) { season = Number(label[1]); rest = rest.replace(label[0], " "); }
  const rel = /\b(?:last|previous|past)\s+(?:year|season)'?s?\b|\b(?:this|current)\s+(?:year|season)'?s?\b/i.exec(rest);
  if (rel) { season ??= /^(?:last|previous|past)/i.test(rel[0]) ? CURRENT_SEASON - 1 : CURRENT_SEASON; rest = rest.replace(rel[0], " "); }
  return { season, game, core: squash(rest.replace(/['’]s\b/gi, " ").replace(/[?!.,]/g, " ").replace(FRAME, " ")) };
}

interface ScoreRow { season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; name: string; start: string | null; end: string | null; city: string | null; state: string | null; side: string; total: number | null; np: number | null }

/** The season to read: the one asked, else the latest with played matches at a record event (the team's, for a team). */
async function seasonFor(asked: number | null, team: number | null): Promise<number | null> {
  if (asked != null) return asked;
  const r = team != null
    ? await get<{ s: number | null }>(`SELECT MAX(m.season) s FROM match_teams x JOIN matches m ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number WHERE x.team = ? AND x.on_field = 1 AND m.played = 1`, [team])
    : await get<{ s: number | null }>("SELECT MAX(season) s FROM matches WHERE played = 1");
  return r?.s ?? null;
}

const sideSql = (side: "red" | "blue", team: boolean, types: number) => `SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.name, e.start, e.end, e.city, e.state, '${side}' side, m.${side}_total total, m.${side}_np np
  FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
  ${team ? `JOIN match_teams x ON x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number AND x.alliance = '${side}' AND x.team = ? AND x.on_field = 1` : ""}
  WHERE m.season = ? AND m.played = 1 AND COALESCE(m.${side}_np, m.${side}_total) IS NOT NULL AND e.type IN (${Array(types).fill("?").join(", ")})`;

/** The card: the season's best scores (`team` null) or the team's, each a link to its match. */
export async function highScoreCard(it: HighScoreQuestion, team: { number: number; name: string | null } | null): Promise<SearchCard> {
  const season = await seasonFor(it.season, team?.number ?? null);
  const label = season != null ? `${seasonLabel(season)}${it.game ? ` (${it.game})` : ""}` : "";
  const card: SearchCard = { kind: "high-scores", title: label ? `Highest scores in ${label}` : "Highest scores", ...(team ? { team } : {}), lines: [] };
  if (season == null) { card.none = team ? `No played matches found for ${team.name ?? `team ${team.number}`}.` : "No played matches are recorded yet."; return card; }
  card.lines = await best(season, team?.number ?? null, RECORD_TYPES);
  if (!card.lines.length) {
    const who = team ? ` for ${team.name ?? `team ${team.number}`}` : "";
    card.closest = await best(season, team?.number ?? null, PRACTICE_TYPES);
    card.none = card.closest.length
      ? `No official ${label} matches${who} have been played yet, only scrimmages, so there is no record yet. The best scrimmage scores so far:`
      : `No played ${label} matches${who} are recorded yet.`;
  }
  return card;
}

/** The best scores (without penalties) at events of `types`, as card lines, each a link to its match. */
async function best(season: number, team: number | null, types: string[]): Promise<SearchCardLine[]> {
  const args = (side: "red" | "blue") => [...(team != null ? [team] : []), season, ...types];
  const rows = await all<ScoreRow>(
    // select-star: the derived table's own columns (sideSql names each one), not a table's.
    `SELECT * FROM (${sideSql("red", team != null, types.length)} UNION ALL ${sideSql("blue", team != null, types.length)}) ORDER BY COALESCE(np, total) DESC, total DESC, start, code, label LIMIT ?`,
    [...args("red"), ...args("blue"), HIGH_SCORE_LINES]);
  const lineups = await alliances(rows);
  return rows.map((r): SearchCardLine => ({
    text: `${r.np ?? r.total} points: ${r.label} at ${r.name}`,
    detail: [seasonLabel(r.season), dateRange(r.start, r.end), place(r.city, r.state)].filter(Boolean).join(" · "),
    results: [
      `${r.side === "red" ? "Red" : "Blue"} alliance: ${lineups.get(key(r, r.side))?.join(", ") || "teams not posted"}`,
      r.np == null ? "Penalties not posted" : r.total != null && r.total !== r.np ? `${r.total} ${ownScorePenalties(r.season) ? "after its own penalties" : "with the other alliance's penalties"}` : "",
    ].filter(Boolean),
    href: `/events/${r.season}/${encodeURIComponent(r.code)}?match=${r.level}:${r.series}:${r.number}`,
  }));
}

/** The answer: the card, then the team (when one was asked about) and the rest of search's hits. */
export async function highScoreAnswer(q: string, it: HighScoreQuestion, team: SearchHit | null, rest: SearchHit[], pages: SearchAnswer["pages"]): Promise<SearchAnswer> {
  const name = team ? team.title.replace(/^\d+\s*/, "").trim() || null : null;
  // The season read once, so the team's link opens the same season as the card.
  const season = await seasonFor(it.season, team ? Number(team.ref) : null);
  const card = await highScoreCard({ ...it, season }, team ? { number: Number(team.ref), name } : null);
  const understood = [team ? `Team ${team.title}` : "", `Highest match scores without penalties${season != null ? ` in ${seasonLabel(season)}${it.game ? ` (${it.game})` : ""}` : ""}`].filter(Boolean);
  return {
    q, hits: team ? [{ ...team, section: "matches", ...(season != null ? { linkSeason: season } : {}), facts: undefined, events: undefined }, ...rest.filter((h) => !(h.kind === "team" && h.ref === team.ref))] : [],
    pages, step: "deterministic", weak: false, card,
    intent: { kind: "question-high-scores", pattern: team ? "[team] high score [season]" : "world record score [season]", met: card.lines.length > 0, understood },
  };
}

const key = (r: { season: number; code: string; level: string; series: number; number: number }, side: string) => `${r.season}|${r.code}|${r.level}|${r.series}|${r.number}|${side}`;

/** Each listed alliance's teams that played ("4215 Hypnotic Robotics"), by match and side: a playoff alliance's team
 *  sitting the match out isn't on it, and never gets its score as a team's best (on_field, above too). */
async function alliances(rows: ScoreRow[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!rows.length) return out;
  const ts = await all<{ season: number; code: string; level: string; series: number; number: number; alliance: string; team: number; name: string | null }>(
    `SELECT x.season, x.code, x.level, x.series, x.number, x.alliance, x.team, t.name FROM match_teams x LEFT JOIN teams t ON t.number = x.team
     WHERE x.on_field = 1 AND (${rows.map(() => "(x.season = ? AND x.code = ? AND x.level = ? AND x.series = ? AND x.number = ? AND x.alliance = ?)").join(" OR ")})
     ORDER BY x.station, x.team`,
    rows.flatMap((r) => [r.season, r.code, r.level, r.series, r.number, r.side]));
  for (const t of ts) { const k = key(t, t.alliance); out.set(k, [...(out.get(k) ?? []), t.name ? `${t.team} ${t.name}` : String(t.team)]); }
  return out;
}
