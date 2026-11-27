// What Bruno knows about each team a Discord message is about, as labelled lines (bot/ask.ts sends them with search's
// own facts). The 2026-11-26 audit of the bot found search's facts carried one team at most, unlabelled:
//   - "who has the better auto OPR, 4215 or 19666" compared 4215's 2026–27 auto (1.4) against nothing, since 19666 had
//     no line, and said 4215 led (19666's is 31.8);
//   - "compare 4215 and 23314" said "not enough data for 23314" minutes after giving it three times;
//   - numbers drifted (6980's auto 0.1 here, 0.2 in the compare card; 4215's endgame 5.5 vs 5.6) because these lines
//     used toFixed(1) on 0.15 and 5.55 while the site rounds half up;
//   - 4215's 101.6 and 28.3 were cited "at the New Jersey Championship" with no season, beside 2026–27 numbers;
//   - "show me 4215's OPR over the season as a trend", "what did they change between events", "were they on Behind the
//     Bot", "how did they do at Worlds", "when do they play next": none had a line to answer from.
// So every team named gets the same block, every number carries its season (and its event when it is one event's), the
// current season is said once, and every OPR goes through `opr` — the site's own rounding — so a number reads the same
// in every answer and every card.
import { all, get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { seasonLabel } from "../../src/shared/format.js";
import { featuredFor } from "../videos/creatorVideos.js";

/** One decimal, half up, as every Control Scout page and card shows an OPR (0.15 → "0.2", 5.55 → "5.6"). */
export const opr = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? "–" : (Math.round(v * 10) / 10).toFixed(1));
/** A count with thousands separators, as the site writes a rank's field ("#612 of 8,308"). */
const n = (v: number) => v.toLocaleString("en-US");
/** "this season", "last season", or the season's label: what each line is about, said where it's read. */
export const seasonWord = (s: number) => (s === CURRENT_SEASON ? `${seasonLabel(s)} (this season)` : s === CURRENT_SEASON - 1 ? `${seasonLabel(s)} (last season)` : seasonLabel(s));
/** An OPR and its phases, read the same way on every line: "16.0 (Auto 1.4, TeleOp 14.7, Endgame 5.6)". */
const phases = (r: { opr_np: number | null; opr_auto: number | null; opr_teleop: number | null; opr_endgame: number | null }) =>
  `${opr(r.opr_np)} (Auto ${opr(r.opr_auto)}, TeleOp ${opr(r.opr_teleop)}, Endgame ${opr(r.opr_endgame)})`;
const record = (r: { wins: number | null; losses: number | null; ties: number | null }) => `${r.wins ?? 0}-${r.losses ?? 0}-${r.ties ?? 0}`;

/** Longest line sent: Control Point takes 600 characters a fact. */
export const DOSSIER_LINE = 590;
/** Lines past the cap are split at "; " into more lines with the same lead, never cut. */
export function splitLine(lead: string, items: string[], max = DOSSIER_LINE): string[] {
  const out: string[] = [];
  const head = `${lead}: `;
  let line = head;
  for (const it of items) {
    const sep = line === head ? "" : "; ";
    if (line !== head && line.length + sep.length + it.length > max) { out.push(`${line}.`); line = `${lead} (cont.): ${it}`; continue; }
    line += sep + it;
  }
  if (line !== head) out.push(`${line}.`);
  return out;
}

/** What "this season" means, said once for every chat: the line every season label is read against. */
export const seasonNowLine = () =>
  `It is now the ${seasonLabel(CURRENT_SEASON)} FTC season: "this season", "now" and "rn" mean ${seasonLabel(CURRENT_SEASON)}; "last season" is ${seasonLabel(CURRENT_SEASON - 1)}. Every number below says its season.`;

interface SeasonRow { season: number; opr_np: number | null; opr_auto: number | null; opr_teleop: number | null; opr_endgame: number | null; rank_np: number | null; ranked_teams: number | null; events: number; matches: number; wins: number; losses: number; ties: number }
interface EventRow { season: number; code: string; name: string | null; type: string | null; division_code: string | null; start: string | null; opr_np: number | null; opr_auto: number | null; opr_teleop: number | null; opr_endgame: number | null; wins: number | null; losses: number | null; ties: number | null; rank: number | null; ranked: number | null }
interface MatchRow { season: number; code: string; label: string; level: string; series: number; number: number; time: string | null; alliance: string; red_total: number | null; blue_total: number | null; played: number; red: string | null; blue: string | null }

/**
 * Every line Bruno gets about one team: who and where, this season (or that it has played none), every season before
 * it, each event this season and last in order (a trend, and "what changed between events"), every match at its
 * latest event, what's next, Worlds, and Behind the Bot. Empty for a number that is no team. `now`: for tests.
 */
export async function teamDossier(team: number, now = Date.now()): Promise<string[]> {
  const t = await get<{ number: number; name: string | null; city: string | null; state: string | null; country: string | null; rookie_year: number | null }>(
    "SELECT number, name, city, state, country, rookie_year FROM teams WHERE number = ?", [team]);
  if (!t) return [];
  const who = `${team}${t.name ? ` ${t.name}` : ""}`;
  const out: string[] = [];
  const place = [t.city, t.state, t.country].filter(Boolean).join(", ");
  const seasons = await all<SeasonRow>(
    `SELECT season, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, events, matches, wins, losses, ties
       FROM team_season_stats WHERE team = ? AND matches > 0 ORDER BY season DESC`, [team]);
  const now_ = seasons.find((s) => s.season === CURRENT_SEASON);
  const seasonText = (s: SeasonRow) => `${s.matches} matches at ${s.events} event${s.events === 1 ? "" : "s"}, record ${record(s)}, season OPR ${phases(s)}${s.rank_np && s.ranked_teams ? `, OPR rank ${n(s.rank_np)} of ${n(s.ranked_teams)}` : ""}`;
  out.push(`Team ${who}${place ? ` (${place}${t.rookie_year ? `; rookie year ${t.rookie_year}` : ""})` : ""}. In ${seasonWord(CURRENT_SEASON)}: ${now_ ? seasonText(now_) : `no matches played yet — every number for ${team} below is from an earlier season and says which`}.`);
  const earlier = seasons.filter((s) => s.season !== CURRENT_SEASON);
  if (earlier.length) out.push(...splitLine(`${team} in earlier seasons`, earlier.map((s) => `${seasonWord(s.season)}: ${seasonText(s)}`)));

  // Each event this season and last, in order: the trend, and what changed from one to the next.
  const events = await all<EventRow>(
    `SELECT s.season, s.code, e.name, e.type, e.division_code, e.start, s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame,
            s.wins, s.losses, s.ties, et.rank, (SELECT MAX(x.rank) FROM event_teams x WHERE x.season = s.season AND x.code = s.code) ranked
       FROM team_event_stats s LEFT JOIN events e ON e.season = s.season AND e.code = s.code
       LEFT JOIN event_teams et ON et.season = s.season AND et.code = s.code AND et.team = s.team
      WHERE s.team = ? AND s.season >= ? AND COALESCE(s.matches, 0) > 0
      ORDER BY s.season DESC, COALESCE(e.start, '') ASC`, [team, CURRENT_SEASON - 1]);
  for (const season of [CURRENT_SEASON, CURRENT_SEASON - 1]) {
    const these = events.filter((e) => e.season === season);
    if (!these.length) continue;
    out.push(...splitLine(`${team}'s events in ${seasonWord(season)}, in order (event OPR, record there, rank there)`,
      these.map((e) => `${e.name ?? e.code}${e.start ? ` (${e.start.slice(0, 10)})` : ""}: OPR ${phases(e)}, ${record(e)}${e.rank ? `, ranked ${e.rank} of ${e.ranked}` : ""}`)));
  }

  // Every match at its latest event with matches (this season's when it has one).
  const latest = await get<{ season: number; code: string; name: string | null }>(
    `SELECT t.season, t.code, e.name FROM match_teams t JOIN matches m ON m.season = t.season AND m.code = t.code AND m.level = t.level AND m.series = t.series AND m.number = t.number
       JOIN events e ON e.season = t.season AND e.code = t.code
      WHERE t.team = ? AND t.on_field = 1 AND m.played = 1 ORDER BY t.season DESC, e.start DESC LIMIT 1`, [team]);
  if (latest) {
    const ms = await all<MatchRow>(
      `SELECT m.season, m.code, m.label, m.level, m.series, m.number, m.time, t.alliance, m.red_total, m.blue_total, m.played,
              (SELECT group_concat(x.team) FROM match_teams x WHERE x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number AND x.alliance = 'red' AND x.on_field = 1) red,
              (SELECT group_concat(x.team) FROM match_teams x WHERE x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number AND x.alliance = 'blue' AND x.on_field = 1) blue
         FROM match_teams t JOIN matches m ON m.season = t.season AND m.code = t.code AND m.level = t.level AND m.series = t.series AND m.number = t.number
        WHERE t.team = ? AND t.season = ? AND t.code = ? AND t.on_field = 1 AND m.played = 1
        ORDER BY m.level = 'playoff', m.series, m.number`, [team, latest.season, latest.code]);
    const said = ms.map((m) => {
      const mine = m.alliance === "red" ? m.red_total : m.blue_total;
      const theirs = m.alliance === "red" ? m.blue_total : m.red_total;
      const res = mine == null || theirs == null ? "played" : mine > theirs ? "won" : mine < theirs ? "lost" : "tied";
      const partners = (m.alliance === "red" ? m.red : m.blue)?.split(",").filter((x) => x !== String(team)) ?? [];
      const opp = (m.alliance === "red" ? m.blue : m.red)?.split(",") ?? [];
      return `${m.label} ${res} ${mine ?? "?"}-${theirs ?? "?"}${partners.length ? ` with ${partners.join(", ")}` : ""}${opp.length ? ` vs ${opp.join(", ")}` : ""}`;
    });
    if (said.length) out.push(...splitLine(`${team}'s matches at its latest event, ${latest.name ?? latest.code}, in ${seasonWord(latest.season)} (its alliance's score first)`, said));
  }

  // What's next: the earliest event this season that isn't over, and its first unplayed match with the team, if posted.
  const today = new Date(now).toISOString().slice(0, 10);
  const next = await get<{ code: string; name: string; start: string | null }>(
    `SELECT e.code, e.name, e.start FROM event_teams t JOIN events e ON e.season = t.season AND e.code = t.code
      WHERE t.team = ? AND t.season = ? AND COALESCE(e.end, e.start, '9999') >= ? ORDER BY COALESCE(e.start, '9999') LIMIT 1`, [team, CURRENT_SEASON, today]);
  if (next) {
    const m = await get<{ label: string; time: string | null }>(
      `SELECT m.label, m.time FROM match_teams t JOIN matches m ON m.season = t.season AND m.code = t.code AND m.level = t.level AND m.series = t.series AND m.number = t.number
        WHERE t.team = ? AND t.season = ? AND t.code = ? AND m.played = 0 ORDER BY m.level = 'playoff', m.series, m.number LIMIT 1`, [team, CURRENT_SEASON, next.code]);
    out.push(`${team}'s next event: ${next.name}${next.start ? ` (starts ${next.start.slice(0, 10)})` : ""}; ${m ? `its next match there is ${m.label}${m.time ? ` at ${m.time}` : ""}` : "no match schedule posted for it yet"}.`);
  } else out.push(`${team} has no upcoming ${seasonLabel(CURRENT_SEASON)} event entered yet.`);

  // Worlds: the FIRST Championship, by season and division.
  const worlds = await all<{ season: number; name: string }>(
    `SELECT DISTINCT e.season, e.name FROM event_teams t JOIN events e ON e.season = t.season AND e.code = t.code
      WHERE t.team = ? AND e.type = 'FIRSTChampionship' AND (e.division_code IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM events d WHERE d.season = e.season AND d.division_code = e.code)) ORDER BY e.season`, [team]);
  const first = (await get<{ s: number | null }>("SELECT MIN(season) s FROM events"))?.s ?? CURRENT_SEASON;
  out.push(worlds.length
    ? `${team} at Worlds (the FIRST Championship): ${worlds.map((w) => `${seasonLabel(w.season)}${/division/i.test(w.name) ? `, ${w.name.replace(/^.*?-\s*(?=[^-]*Division)/i, "").trim()}` : ""}`).join("; ")}.`
    : `${team} has not played at Worlds (the FIRST Championship) in Control Scout's records, which start with ${seasonLabel(first)}.`);

  // Behind the Bot and the other creator series Control Scout tracks (a video whose title names the team).
  const featured = await featuredFor(team).catch(() => []);
  const series = featured.filter((f) => f.series);
  if (series.length) {
    const by = new Map<string, typeof series>();
    for (const f of series) by.set(f.series!, [...(by.get(f.series!) ?? []), f]);
    out.push(...splitLine(`${team} featured in creator videos`, [...by].map(([s, vs]) => `${s}: ${vs.length} episode${vs.length === 1 ? "" : "s"} (${vs.map((v) => `"${v.title.slice(0, 80)}"${v.season ? `, ${seasonLabel(v.season)}` : ""}`).join(", ")})`)));
  } else out.push(`${team} has never been featured on Behind the Bot (or another creator series Control Scout tracks).`);
  return out;
}

/** A number that counts something ("top 5", "100 points", "last 3 matches"), never a team. */
const COUNT_AFTER = /^\s*(?:%|(?:pts?|points?|matches|games|events?|teams|seasons?|wins?|losses|min(?:ute)?s?|seconds?|secs?|hours?|days?|weeks?|times|percent|place|th|st|nd|rd)\b)/i;
const COUNT_BEFORE = /\b(?:top|best|worst|last|bottom|at\s+least|more\s+than|less\s+than|ranked)\s*$/i;

/**
 * The teams a message names, in the order it names them: a 3 to 5 digit number that is a team, or any team number
 * after "team" or "#" ("team 11", "#50"). Never a year, a season ("2024-25"), a decimal ("101.6"), or a count ("top
 * 50", "100 points", "last 3 matches": the audit's Q73 read "top 50" as team 50).
 */
export async function namedTeams(q: string): Promise<number[]> {
  const text = q.replace(/\b(?:19|20)\d{2}\s*[-–—/]\s*\d{2,4}\b/g, " ");
  const nums: number[] = [];
  for (const m of text.matchAll(/(?<![\d.])(\d{1,5})(?!\d|\.\d)/g)) {
    const x = Number(m[1]);
    const before = text.slice(0, m.index), after = text.slice(m.index! + m[1].length);
    const marked = /(?:\bteams?|#)\s*$/i.test(before);
    if (x < 1 || (x >= 1990 && x <= 2099 && !marked)) continue;
    if (!marked && (m[1].length < 3 || COUNT_AFTER.test(after) || COUNT_BEFORE.test(before))) continue;
    if (!nums.includes(x)) nums.push(x);
  }
  if (!nums.length) return [];
  const known = await all<{ number: number }>(`SELECT number FROM teams WHERE number IN (${nums.map(() => "?").join(", ")})`, nums);
  const set = new Set(known.map((r) => Number(r.number)));
  return nums.filter((x) => set.has(x));
}
