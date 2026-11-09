// A place's award winners: the awards won by the teams from a state, a country or a town, as the events' published
// awards list them.
//   "Michigan Inspire winners"                        → Michigan teams' 1st-place Inspire Awards, the newest season
//   "awards won by teams from <town>, <country>, this season" → every award its teams won that season
//   "did any NJ team win Inspire at worlds last year" → yes or no, at the FIRST Championship that season
//   "which Romanian team has won the most Inspire awards" → the place's teams by how many, every season
//   "fewest inspire awards in romania"                → the same board, fewest first: teams that won one, and how many won none
//   "inspire award winner"                            → no place said: the latest events' winners, newest first
//   "rarest award a NJ team won this season"          → the award its teams won that was given fewest times anywhere
//   "teams who won both Inspire and Winning Alliance at the same event" → both awards at one event (any place)
//   "NJ Inspire winners by auto"                      → the winners, by their auto OPR that season
// A judged award is won at 1st place (2nd and 3rd are listed only when every award is asked); a Winning or Finalist
// Alliance is won by each of its teams. FIRST's Leadership Award, stored as a Winner, is never a Winning Alliance.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import type { SearchAnswer, SearchPageLink } from "../../../../src/shared/api.js";
import { awardLabel, num, seasonLabel } from "../../../../src/shared/format.js";
import { all } from "../../../db.js";
import { searchSeason } from "../season.js";
import { names, type Place } from "../../query/names.js";
import { regionOf } from "../../../../src/shared/searchEventQuery.js";
import { CHAMPIONSHIP_TYPE } from "../clauses.js";
import { eventHref, shortEvent } from "../matchSet.js";

/** The awards by the words people use (awards.type). */
const AWARDS: [RegExp, string][] = [
  [/\binspire\b/, "Inspire"], [/\bthink\b/, "Think"], [/\binnovate\b/, "Innovate"], [/\bdesign\b/, "Design"], [/\bmotivate\b/, "Motivate"],
  [/\bconnect\b/, "Connect"], [/\bcontrol\b/, "Control"], [/\breach\b/, "Reach"], [/\bsustain\b/, "Sustain"], [/\bpromote\b/, "Promote"],
  [/\bcompass\b/, "Compass"], [/\bjudges?['’]?\s+choice\b/, "JudgesChoice"], [/\bdeans?\s+list\b/, "DeansList"],
  [/\bwinning\s+alliances?\b/, "Winner"], [/\bfinalist(?:\s+alliances?)?\b/, "Finalist"],
];
const ALLIANCE = new Set(["Winner", "Finalist"]);
// FIRST's Leadership Award is stored as a Winner: read as its own award ("Leadership"), never a Winning Alliance,
// and won whatever place it's stored at.
const TYPE_SQL = "CASE WHEN a.type = 'Winner' AND COALESCE(a.name, '') LIKE '%Leadership%' THEN 'Leadership' ELSE a.type END";
const WON_SQL = `(${TYPE_SQL} IN ('Winner', 'Finalist', 'Leadership') OR a.placement = 1)`;
/** The board stats a list can be ordered by (team_season_stats columns). */
const BY: Record<string, { col: string; label: string }> = {
  auto: { col: "opr_auto", label: "Auto OPR" }, teleop: { col: "opr_teleop", label: "TeleOp OPR" }, endgame: { col: "opr_endgame", label: "Endgame OPR" },
  opr: { col: "opr_np", label: "OPR" }, rating: { col: "rating_np", label: "Prediction rating" },
};
/** Words that frame the ask and name nothing. */
const FRAME = /\b(?:who|which|what|that|whats|what's|is|are|was|were|the|a|an|any|did|do|does|has|have|had|ever|teams?|from|in|at|of|by|for|and|both|or|award|awards|winners?|won|win|wins|got|get|received|recipients?|been|there|all|list|every|same|event|tournament|competition|most|fewest|rarest|least|common|rare|times?|count|number|how|many|season|year|this|last|with)\b/g;

export interface PlaceAwardsAsk {
  place: Place | null;
  /** The awards named (awards.type); none: every award. */
  types: string[];
  /** A season said: its number; "this season" is the latest completed one, "last" the one before. */
  season: number | null;
  /** How the season was said: the answer offers other seasons only when none was. */
  seasonSaid: "this" | "last" | "named" | null;
  worlds: boolean;
  /** "Did any … team make worlds finals": the stage of the FIRST Championship's playoffs reached, not an award. */
  stage?: "finals" | "playoffs";
  /** "most" and "fewest" are one count board, read from its top or its bottom. */
  mode: "list" | "most" | "fewest" | "rarest" | "any" | "same-event";
  by: keyof typeof BY | null;
}

/** A place's award winners asked, or null. `q` as typed. */
export async function readPlaceAwards(q: string): Promise<PlaceAwardsAsk | null> {
  const typed = q.replace(/[?!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  let t = ` ${typed.toLowerCase().replace(/['’]s\b/g, "")} `;
  if (/\d{1,6}(?!\d*\s*[-–/]\s*\d)/.test(t.replace(/\b20\d\d\s*[-–/]\s*\d\d\b/g, " "))) return null;
  // A state's code typed in capitals that's also a word ("IN", "OR"): kept as the place, never read as one.
  const codes = new Map<string, string>();
  t = ` ${t.trim().split(" ").map((w, i) => { const x = typed.split(" ")[i]; if (!/^[A-Z]{2}$/.test(x ?? "") || !regionOf([x])) return w; const k = `stcode${codes.size}x`; codes.set(k, x); return k; }).join(" ")} `;
  const cut = (re: RegExp) => { const m = re.exec(t); if (m) t = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)} `; return m; };
  // The season.
  const sm = cut(/\s(?:in\s+|for\s+|during\s+)?(?:the\s+)?(?:(this|current|last|previous|past)\s+(?:season|year)|(20\d\d)\s*[-–/]\s*(\d\d))(?=\s)/);
  const seasonSaid = !sm ? null : sm[2] ? "named" : /^(?:this|current)$/.test(sm[1]) ? "this" : "last";
  if (sm?.[2] && (Number(sm[2]) + 1) % 100 !== Number(sm[3])) return null;
  // Worlds' playoffs reached: "make worlds finals", "reach the playoffs at worlds".
  const WORLDS = String.raw`(?:the\s+)?(?:worlds|world\s+championships?|first\s+championship)`, REACH = String.raw`(?:make|made|makes|reach|reached|get\s+to|got\s+to|play\s+in|played\s+in|in|at)`;
  const st = cut(new RegExp(String.raw`\s${REACH}\s+${WORLDS}\s+(finals?|playoffs?)(?=\s)`)) ?? cut(new RegExp(String.raw`\s${REACH}\s+(?:the\s+)?(finals?|playoffs?)\s+(?:at|in)\s+${WORLDS}(?=\s)`));
  const stage = st ? (/^final/.test(st[1]) ? "finals" : "playoffs") : undefined;
  const worlds = !!stage || !!cut(new RegExp(String.raw`\s(?:at|in)\s+${WORLDS}(?=\s)`));
  // "This season" is search's own (the latest completed one, ../season.ts), "last season" the one before it. At
  // Worlds "last year" is the latest Championship that has finished, as the winners answer reads it (that same season);
  // "last season" keeps its meaning everywhere.
  const season = !sm ? null : sm[2] ? Number(sm[2]) : searchSeason() - (seasonSaid === "this" || (worlds && /\byear$/.test(sm[0])) ? 0 : 1);
  const byM = cut(/\s(?:by|on|ranked\s+by|sorted\s+by)\s+(auto|teleop|endgame|opr|rating)(?:\s+opr)?(?=\s)/);
  const types: string[] = [];
  for (const [re, type] of AWARDS) if (cut(re) && !types.includes(type)) types.push(type);
  if (stage && types.length) return null;
  const most = /\bmost\b/.test(t), rarest = /\b(?:rarest|least\s+common)\b/.test(t);
  // The fewest of an award: the count board's other end ("at least" counts nothing).
  const fewest = !most && !rarest && /\b(?:fewest|(?<!\bat\s)least)\b/.test(t);
  const any = /^\s*(?:did|has|have|were|was)\s+(?:any|a)\b/.test(t);
  const same = /\bsame\s+(?:event|tournament|competition)\b/.test(t);
  // An award ask: a winner word, "awards", or the most or rarest of them; or a stage of Worlds' playoffs reached.
  if (!stage && !/\b(?:winners?|won|win|got|received|recipients?|awards)\b/.test(t) && !most && !fewest && !rarest) return null;
  if (!stage && !types.length && !/\bawards?\b/.test(t)) return null;
  const mode = stage ? (any ? "any" : "list") : same ? "same-event" : rarest ? "rarest" : most ? "most" : fewest ? "fewest" : any ? "any" : "list";
  if (mode === "same-event" && types.length < 2) return null;
  if (mode === "rarest" && types.length) return null;
  // The most awards of any kind is the count leaderboard's ("which team has the most awards in NJ", ./leaderboard.ts),
  // one season's; asked over every season ("… ever", "of all time") it's counted here.
  const EVER = /\s(?:of\s+)?(?:ever|all[\s-]time|every\s+season|in\s+(?:ftc\s+)?history)(?=\s)/;
  const ever = EVER.test(t);
  const board = mode === "most" || mode === "fewest";
  if (board && !types.length && (!ever || sm)) return null;
  // The words said for every season are taken out, never left to be read as the place ("… in FTC history").
  if (board && !types.length) cut(EVER);
  // What's left is the place, the place's teams' word ("Romanian", "NJ teams") or a town and its country.
  const left = t.replace(FRAME, " ").replace(/\s+/g, " ").trim().split(" ").map((w) => codes.get(w) ?? w).join(" ");
  let place: Place | null = null;
  if (left) {
    const idx = await names();
    const typedOf = (w: string) => typed.split(" ").filter((x) => w.split(" ").includes(x.toLowerCase().replace(/['’]s$/, ""))).join(" ") || w;
    // A place's own small words kept ("District of Columbia", "Newfoundland and Labrador"): its first word to its last.
    const tw = t.trim().split(" "), ix = tw.flatMap((w, i) => (w.replace(FRAME, "").trim() ? [i] : []));
    const span = ix.length ? tw.slice(ix[0], ix[ix.length - 1] + 1).map((w) => codes.get(w) ?? w).join(" ") : "";
    place = (span !== left && idx.place(span, typedOf(span))) || idx.place(left, typedOf(left));
    // A town said with its state or country ("Cluj-Napoca Romania", "Edison NJ"): the town, when it's in that place.
    const ws = left.split(" ");
    for (let k = 1; !place && k <= 2 && k < ws.length; k++) {
      const name = ws.slice(0, -k).join(" "), within = idx.place(ws.slice(-k).join(" "), typedOf(ws.slice(-k).join(" ")));
      if (!within || within.kind === "city") continue;
      const town = idx.place(name);
      if (town?.kind === "city" && town.country === within.country && (within.kind === "country" || town.state === within.state)) place = town;
      // A town some other place shares its name with ("Springfield IL"): the one in the place said.
      else if (!town) {
        const [one, two] = await all<{ city: string; state: string | null; country: string }>(
          `SELECT DISTINCT city, state, country FROM teams WHERE lower(city) = ? AND country = ?${within.kind === "region" ? " AND state = ?" : ""} LIMIT 2`,
          [name, within.country, ...(within.kind === "region" ? [within.state] : [])]);
        if (one && !two) place = { kind: "city", country: one.country, state: one.state, city: one.city, name: one.city };
      }
    }
    if (!place || idx.teamsNamed(left).length) return null;
    // The most (or fewest) of an award with no place said is every team's ("most inspire awards"). One award's
    // winners with no place or event are the latest events' ("inspire award winner"); "any", two awards, every award and
    // Worlds (an event: its own awards answer) need a place.
  } else if (mode !== "same-event" && !board && !(mode === "list" && types.length === 1 && !byM && !worlds)) return null;
  if (stage && (!place || byM)) return null;
  return { place, types, season, seasonSaid, worlds, mode, by: (byM?.[1] as keyof typeof BY) ?? null, ...(stage ? { stage } : {}) };
}

interface Row { season: number; code: string; event: string; etype: string | null; start: string | null; type: string; placement: number; team: number; team_name: string | null; award: string | null; city: string | null; state: string | null }

const label = (r: Row) => (r.type === "Winner" ? "Winning Alliance" : r.type === "Leadership" || (r.type === "Inspire" && r.placement === 1) ? awardName(r.type) : awardLabel(r.type, r.placement));
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const awardName = (type: string) => (ALLIANCE.has(type) ? awardLabel(type, 1) : `${awardLabel(type, 1)} Award`);
const awardsName = (type: string) => `${awardName(type)}s`;
const teamLabel = (r: Row) => `${r.team}${r.team_name ? ` ${r.team_name}` : ""}`;

function placeSql(p: Place | null): { sql: string; args: (string | null)[] } {
  if (!p) return { sql: "1", args: [] };
  if (p.kind === "city") return { sql: "t.city = ? AND t.country = ? AND t.state IS ?", args: [p.city, p.country, p.state] };
  if (p.kind === "region") return { sql: "t.country = ? AND t.state = ?", args: [p.country, p.state] };
  return { sql: "t.country = ?", args: [p.country] };
}

/** The place's teams that played in Worlds' playoffs: its finals (the Championship's own event, between the division
 *  winners) or any division's playoffs. */
async function stageAnswer(ask: PlaceAwardsAsk): Promise<StatAnswer> {
  const where = placeSql(ask.place);
  // As with awards: a list is one season (the one said, else the latest completed one); "any" with none said, every season.
  const season = ask.season ?? (ask.mode === "any" ? null : searchSeason());
  const rows = await all<{ season: number; code: string; event: string; etype: string | null; team: number; team_name: string | null; won: number }>(
    `SELECT e.season, e.code, e.name event, e.type etype, mt.team, t.name team_name,
            MAX(CASE WHEN mt.on_field = 1 AND ((mt.alliance = 'red' AND m.red_total > m.blue_total) OR (mt.alliance = 'blue' AND m.blue_total > m.red_total)) THEN 1 ELSE 0 END) won
     FROM matches m JOIN match_teams mt ON mt.season = m.season AND mt.code = m.code AND mt.level = m.level AND mt.series = m.series AND mt.number = m.number
     JOIN events e ON e.season = m.season AND e.code = m.code JOIN teams t ON t.number = mt.team
     WHERE e.type = ? AND m.level = 'playoff' AND m.played = 1${ask.stage === "finals" ? " AND e.division_code IS NULL" : ""} AND ${where.sql}${season != null ? " AND e.season = ?" : ""}
     GROUP BY e.season, e.code, mt.team ORDER BY e.season DESC, e.code, mt.team`,
    [CHAMPIONSHIP_TYPE, ...where.args, ...(season != null ? [season] : [])]);
  const place = ask.place!.name;
  const what = ask.stage === "finals" ? "the Worlds finals" : "the playoffs at Worlds";
  const when = season == null ? "any season" : seasonLabel(season);
  const title = ask.mode === "any" ? `Did any team from ${place} make ${what}, ${when}?` : `Teams from ${place} in ${what}, ${when}`;
  const definition = `${ask.stage === "finals" ? "The Worlds finals: the playoff matches of the FIRST Championship's own event, between its divisions' winners." : "The playoffs at Worlds: any FIRST Championship division's playoff matches, or its finals."} A team's place is its home on FIRST's listing. From the stored matches.`;
  const base = { family: "awards" as const, intent: "place-worlds-stage", title, definition, scope: [place, "FIRST Championship", season == null ? "All seasons" : seasonLabel(season)], source: `From ${count(rows.length, "team")} in the stored playoff matches` };
  const teams = new Set(rows.map((r) => r.team)).size;
  if (!rows.length) return { ...base, blocks: [], ...(ask.mode === "any" ? { headline: { value: "No", label: `no team from ${place} played in ${what} in ${when}` } } : { none: `No team from ${place} played in ${what} in ${when} in the stored matches.` }) };
  const block: StatBlock = {
    kind: "table", title: "Each team, newest first",
    columns: [{ key: "team", label: "Team" }, { key: "event", label: "Event" }, ...(season == null ? [{ key: "season", label: "Season" }] : []), { key: "won", label: "Won a match" }],
    rows: rows.slice(0, 50).map((r) => ({ cells: { team: `${r.team}${r.team_name ? ` ${r.team_name}` : ""}`, event: shortEvent(r.event, r.etype), season: seasonLabel(Number(r.season)), won: Number(r.won) ? "Yes" : "No" }, href: eventHref(Number(r.season), r.code, Number(r.team)) })),
    ...(rows.length > 50 ? { more: `Showing 50 of ${rows.length}` } : {}),
  };
  return { ...base, headline: ask.mode === "any" ? { value: "Yes", label: count(teams, "team") } : { value: count(teams, "team"), label: `from ${place} in ${what}` }, blocks: [block] };
}

/** The answer for a place's award winners. */
export async function placeAwardsAnswer(ask: PlaceAwardsAsk): Promise<StatAnswer> {
  if (ask.stage) return stageAnswer(ask);
  const where = placeSql(ask.place);
  // A judged award is won at 1st place, unless every award is listed (each place said as such).
  // The most awards of every kind counts each one, 2nd and 3rd place too, as the season awards board and a team's card do.
  const board = ask.mode === "most" || ask.mode === "fewest";
  // One award's winners with no place said: the latest events that gave it, newest first, in any season unless one was said.
  const latest = ask.mode === "list" && !ask.place && !ask.worlds && ask.types.length === 1;
  const won = ask.types.length || (ask.mode !== "list" && !board) ? ` AND ${WON_SQL}` : "";
  const typeSql = ask.types.length ? ` AND ${TYPE_SQL} IN (${ask.types.map(() => "?").join(", ")})` : "";
  // The season: the one said, else search's default (the latest completed one, ../season.ts), never another one
  // quietly; the count boards and "any" with none said count every season. It's filtered in SQL, never after loading every season.
  const season = ask.season == null && (board || ask.mode === "any" || latest) ? null : ask.season ?? searchSeason();
  const filter = `${where.sql}${typeSql}${won}${ask.worlds ? " AND e.type = ?" : ""}${season != null ? " AND a.season = ?" : ""}`;
  const args = [...where.args, ...ask.types, ...(ask.worlds ? [CHAMPIONSHIP_TYPE] : []), ...(season != null ? [season] : [])];
  const from = "FROM awards a JOIN teams t ON t.number = a.team JOIN events e ON e.season = a.season AND e.code = a.code";
  const nCount = `COUNT(DISTINCT a.season || '|' || a.code || '|' || ${TYPE_SQL})`;
  // The count board is counted in the database (an alliance award once per event): only its top (or, for the fewest,
  // its bottom) teams come back. The fewest lists teams that won at least one; those that won none are counted apart.
  const counted = board
    ? await all<{ team: number; team_name: string | null; city: string | null; state: string | null; n: number; records: number }>(
      `SELECT a.team, t.name team_name, t.city, t.state, ${nCount} n, COUNT(*) records
       ${from} WHERE ${filter} GROUP BY a.team ORDER BY n ${ask.mode === "fewest" ? "ASC" : "DESC"}, a.team LIMIT 25`, args)
    : null;
  const LATEST_EVENTS = 25;
  const rows = counted ? [] : (await all<any>(
    `SELECT a.season, a.code, e.name event, e.type etype, e.start, ${TYPE_SQL} type, a.placement, a.team, t.name team_name, a.name award, t.city, t.state
     ${from} WHERE ${filter}${latest ? ` AND (a.season, a.code) IN (SELECT a.season, a.code ${from} WHERE ${filter} GROUP BY a.season, a.code ORDER BY MAX(e.start) DESC, a.code LIMIT ${LATEST_EVENTS})` : ""}
     ORDER BY e.start DESC, a.code, a.type = 'Winner' DESC, a.type = 'Inspire' DESC, a.placement, a.team`, latest ? [...args, ...args] : args))
    .map((r): Row => ({ ...r, season: Number(r.season), placement: Number(r.placement), team: Number(r.team) }));
  const records = counted ? Number((await all<{ n: number }>(`SELECT COUNT(*) n ${from} WHERE ${filter}`, args))[0]?.n ?? 0) : rows.length;

  const who = ask.place ? `Teams from ${ask.place.name}` : "Teams", whose = ask.place ? `teams from ${ask.place.name}` : "teams";
  const what = ask.types.length ? ask.types.map(awardName).join(" and ") : "awards";
  const whats = ask.types.length ? ask.types.map(awardsName).join(" and ") : "awards";
  const at = ask.worlds ? " at the FIRST Championship" : "";
  const when = season == null ? "every season" : seasonLabel(season);
  const scope = [ask.place?.name ?? "Every team", ...(ask.worlds ? ["FIRST Championship"] : []), season == null ? "All seasons" : seasonLabel(season)];
  const base = { family: "awards" as const, intent: "place-awards", scope, source: `From ${count(records, "award record")} in the events' published awards` };
  const rule = `${ALLIANCE.has(ask.types[0] ?? "") || !ask.types.length ? "A Winning or Finalist Alliance award counts for each of its teams. " : ""}A judged award is won at 1st place${ask.types.length ? "" : " (2nd and 3rd place are listed as such)"}. A team's place is its home on FIRST's listing. From the events' published awards.`;
  const title = ask.types.length ? `${ask.place ? `${ask.place.name} ` : ""}${what} winners${at}` : `Awards won by ${whose}${at}`;
  const none = (s: string) => ({ ...base, title, blocks: [], definition: rule, none: s });
  const ev = (r: Row) => shortEvent(r.event, r.etype);
  // `max` rows are shown; the latest winners' table (already bounded by its events) shows every one, never half an event.
  const table = (xs: Row[], heading: string, extra?: { key: string; label: string; value: (r: Row) => string | number | null }, max = 50): StatBlock => ({
    kind: "table", title: heading,
    columns: [{ key: "team", label: "Team" }, { key: "award", label: "Award" }, { key: "event", label: "Event" }, ...(season == null ? [{ key: "season", label: "Season" }] : []), ...(extra ? [{ key: extra.key, label: extra.label, num: true }] : [])],
    rows: xs.slice(0, max).map((r) => ({ cells: { team: teamLabel(r), award: label(r), event: ev(r), season: seasonLabel(r.season), ...(extra ? { [extra.key]: extra.value(r) } : {}) }, href: eventHref(r.season, r.code, r.team), strong: r.type === "Winner" || (r.type === "Inspire" && r.placement === 1) })),
    ...(xs.length > max ? { more: `Showing ${max} of ${xs.length}` } : {}),
  });

  if (ask.mode === "same-event") {
    // Teams that won every award named at one event.
    const byKey = new Map<string, Row[]>();
    for (const r of rows) byKey.set(`${r.season}|${r.code}|${r.team}`, [...(byKey.get(`${r.season}|${r.code}|${r.team}`) ?? []), r]);
    const hits = [...byKey.values()].filter((xs) => ask.types.every((ty) => xs.some((r) => r.type === ty))).map((xs) => xs.find((r) => r.type === ask.types[0])!);
    const t2 = `${who} that won ${what} at the same event${at}, ${when}`;
    if (!hits.length) return { ...none(`No team won ${what} at one event${at} in ${when}.`), title: t2 };
    return {
      ...base, title: t2,
      headline: { value: count(new Set(hits.map((r) => r.team)).size, "team"), label: `won ${what} at one event`, sub: `${when}, newest first` },
      blocks: [{ kind: "table", title: "Each team and event", columns: [{ key: "team", label: "Team" }, { key: "event", label: "Event" }, { key: "date", label: "Date" }],
        rows: hits.slice(0, 50).map((r) => ({ cells: { team: teamLabel(r), event: ev(r), date: r.start ?? "" }, href: eventHref(r.season, r.code, r.team), strong: true })), ...(hits.length > 50 ? { more: `Showing 50 of ${hits.length}` } : {}) }],
      definition: `Both awards at one event: the team won each award named there. ${rule}`,
    };
  }
  if (counted) {
    // Each team's count, from the database: an alliance award once per event.
    const ranked = counted.map((x) => ({ r: { team: Number(x.team), team_name: x.team_name, city: x.city, state: x.state } as Row, n: Number(x.n) }));
    const fewest = ask.mode === "fewest";
    const t2 = `${who} with the ${fewest ? "fewest" : "most"} ${whats}${at}, ${when}`;
    // The board's bottom: most teams won none, so they're counted (the place's teams that played a stored match that
    // season, or in any season, and won none), and the teams that won at least one are listed, fewest first.
    const bottom = fewest
      ? (await all<{ winners: number; zero: number }>(
        `SELECT (SELECT COUNT(DISTINCT a.team) ${from} WHERE ${filter}) winners,
                (SELECT COUNT(*) FROM teams t WHERE ${where.sql} AND t.number IN (SELECT s.team FROM team_season_stats s WHERE s.matches > 0${season != null ? " AND s.season = ?" : ""})
                   AND t.number NOT IN (SELECT a.team ${from} WHERE ${filter})) zero`,
        [...args, ...where.args, ...(season != null ? [season] : []), ...args])).map((x) => ({ winners: Number(x.winners), zero: Number(x.zero) }))[0]
      : null;
    const noneWon = `${ask.place ? `from ${ask.place.name} ` : ""}played and won no ${ask.types.length === 1 ? awardName(ask.types[0]) : what}${at} ${season == null ? "in any season" : `in ${when}`}`;
    const fewestDef = `Fewest won: each team's ${what}, an alliance award once per event, listed for the teams that won at least one. Teams that won none are counted: ${whose} that played a stored match ${season == null ? "in any season" : "that season"} and won none. ${rule}`;
    if (!ranked.length) {
      // Nobody won it: the fewest is none, and the teams that played are still counted.
      if (bottom?.zero) return { ...base, title: t2, headline: { value: count(bottom.zero, "team"), label: noneWon, sub: `No team ${ask.place ? `from ${ask.place.name} ` : ""}won one` }, blocks: [], definition: fewestDef };
      return { ...none(`No ${what} won by ${whose}${at} in ${when}.`), title: t2 };
    }
    const top = ranked.filter((x) => x.n === ranked[0].n);
    // Every row listed tied for the lead: more may be tied past the list's end, so they're counted, never left out.
    const tied = top.length === ranked.length
      ? Number((await all<{ n: number }>(`SELECT COUNT(*) n FROM (SELECT a.team ${from} WHERE ${filter} GROUP BY a.team HAVING ${nCount} = ?)`, [...args, ranked[0].n]))[0]?.n ?? top.length)
      : top.length;
    const won = count(ranked[0].n, ask.types.length === 1 ? awardName(ask.types[0]) : "award", ask.types.length === 1 ? awardsName(ask.types[0]) : "awards");
    const home = (x: (typeof ranked)[number]) => [x.r.city, x.r.state].filter(Boolean).join(", ");
    if (bottom) {
      const { winners, zero } = bottom;
      return {
        ...base, title: t2,
        headline: zero
          ? { value: count(zero, "team"), label: noneWon, sub: `Of the ${count(winners, "team")} that won any, ${tied} won ${won}, the fewest` }
          : { value: tied > 1 ? `${tied} teams, tied` : teamLabel(top[0].r), label: `${won}${tied > 1 ? " each" : ""}, the fewest`, ...(tied > 1 ? {} : { href: `/teams/${top[0].r.team}` }) },
        blocks: [{ kind: "table", title: `${who} that won any, fewest first`, columns: [{ key: "team", label: "Team" }, { key: "home", label: "Home" }, { key: "n", label: "Won", num: true }],
          rows: ranked.map((x) => ({ cells: { team: teamLabel(x.r), home: home(x), n: x.n }, href: `/teams/${x.r.team}`, strong: x.n === ranked[0].n })),
          ...(winners > ranked.length ? { more: `Showing the ${ranked.length} with the fewest of ${winners}` } : {}) }],
        definition: fewestDef,
      };
    }
    return {
      ...base, title: t2,
      headline: tied > top.length
        ? { value: `${tied} teams, tied`, label: `${won} each`, sub: `The first ${top.length} by number are listed` }
        : { value: top.map((x) => teamLabel(x.r)).join(", "), label: `${won}${top.length > 1 ? " each, tied" : ""}`, href: `/teams/${top[0].r.team}` },
      blocks: [{ kind: "table", title: `${who} by ${whats} won`, columns: [{ key: "team", label: "Team" }, { key: "home", label: "Home" }, { key: "n", label: "Won", num: true }],
        rows: ranked.slice(0, 25).map((x) => ({ cells: { team: teamLabel(x.r), home: home(x), n: x.n }, href: `/teams/${x.r.team}`, strong: x.n === ranked[0].n })) }],
      definition: ask.types.length
        ? `Most won: each team's ${what}, an alliance award once per event. ${rule}`
        : `Most awards: every award each team was given, 2nd and 3rd place included, an alliance award once per event. A team's place is its home on FIRST's listing. From the events' published awards.`,
    };
  }
  if (ask.mode === "rarest") {
    // The award the place's teams won that was given fewest times anywhere that season.
    if (!rows.length) return { ...none(`No awards won by ${whose}${at} in ${when}.`), title: `The rarest award ${whose} won, ${when}` };
    const types = [...new Set(rows.map((r) => r.type))];
    const given = new Map((await all<{ type: string; n: number }>(
      `SELECT ${TYPE_SQL} type, COUNT(DISTINCT a.code) n FROM awards a WHERE a.season = ? AND ${TYPE_SQL} IN (${types.map(() => "?").join(", ")}) AND ${WON_SQL} GROUP BY 1`,
      [season, ...types])).map((x) => [x.type, Number(x.n)]));
    const order = types.sort((a, b) => (given.get(a) ?? 0) - (given.get(b) ?? 0) || a.localeCompare(b));
    const rarest = order[0], xs = rows.filter((r) => r.type === rarest);
    return {
      ...base, title: `The rarest award ${whose} won, ${when}`,
      headline: { value: awardName(rarest), label: `given ${count(given.get(rarest) ?? 0, "time")} anywhere in ${when}`, sub: `won by ${[...new Set(xs.map(teamLabel))].join(", ")}` },
      blocks: [
        { kind: "table", title: "Each award they won, rarest first", columns: [{ key: "award", label: "Award" }, { key: "given", label: "Given anywhere", num: true }, { key: "won", label: `Won by ${who}`, num: true }],
          rows: order.map((ty) => ({ cells: { award: awardName(ty), given: given.get(ty) ?? 0, won: rows.filter((r) => r.type === ty).length }, strong: ty === rarest })) },
        table(xs, `${awardName(rarest)}: ${who}`),
      ],
      definition: `Rarest: the award given the fewest times that season across every event (its 1st place, once per event). ${rule}`,
    };
  }
  // A list, or whether any won: newest first, or by a board stat that season.
  let xs = rows, extra: Parameters<typeof table>[2];
  if (ask.by) {
    const b = BY[ask.by];
    const stat = new Map((await all<{ season: number; team: number; v: number | null }>(
      `SELECT season, team, ${b.col} v FROM team_season_stats WHERE team IN (${[...new Set(xs.map((r) => r.team))].map(() => "?").join(", ") || "NULL"})`, [...new Set(xs.map((r) => r.team))])).map((x) => [`${x.season}|${x.team}`, x.v == null ? null : Number(x.v)]));
    const v = (r: Row) => stat.get(`${r.season}|${r.team}`) ?? null;
    xs = [...xs].sort((a, c) => (v(c) ?? -Infinity) - (v(a) ?? -Infinity));
    extra = { key: "stat", label: `${b.label} (season)`, value: (r) => { const x = v(r); return x == null ? null : num(x); } };
  }
  const teams = new Set(xs.map((r) => r.team)).size;
  if (ask.mode === "any") {
    const t2 = `Did any team${ask.place ? ` from ${ask.place.name}` : ""} win ${ask.types.length === 1 ? `the ${what}` : what}${at} in ${when}?`;
    if (!xs.length) return { ...base, title: t2, headline: { value: "No", label: `no ${what} won by ${whose}${at} in ${when}` }, blocks: [], definition: rule };
    return { ...base, title: t2, headline: { value: "Yes", label: `${count(teams, "team")}, ${count(xs.length, "award")}` }, blocks: [table(xs, "Each one, newest first", extra)], definition: rule };
  }
  if (!xs.length) return none(`No ${what} won by ${whose}${at} in ${when} in the published awards.`);
  if (latest) {
    // The newest event's winners lead; the table is each of the latest events that gave the award.
    const first = xs.filter((r) => r.season === xs[0].season && r.code === xs[0].code);
    const events = new Set(xs.map((r) => `${r.season}|${r.code}`)).size;
    const t2 = `The latest ${what} winners${at}${season == null ? "" : `, ${when}`}`;
    return {
      ...base, title: t2, scope: [...scope.slice(0, -1), season == null ? `Latest ${count(events, "event")}` : seasonLabel(season)],
      headline: { value: [...new Set(first.map(teamLabel))].join(", "), label: `won the ${what} at ${ev(first[0])}`, sub: [first[0].start, seasonLabel(first[0].season)].filter(Boolean).join(" · "), ...(first.length === 1 ? { href: eventHref(first[0].season, first[0].code, first[0].team) } : {}) },
      blocks: [table(xs, `The latest ${count(events, "event")} that gave it, newest first`, undefined, xs.length)],
      definition: `The latest winners: the events (up to ${LATEST_EVENTS}) most recently held that gave the award, by their start date, ${season == null ? "in any season" : `in ${when}`}. ${rule}`,
    };
  }
  return {
    ...base, title: `${title}, ${when}`,
    headline: { value: count(xs.length, ask.types.length === 1 ? awardName(ask.types[0]) : "award", ask.types.length === 1 ? awardsName(ask.types[0]) : "awards"), label: `won by ${count(teams, "team")} from ${ask.place?.name ?? "anywhere"}${at}`, sub: (ask.by ? `By ${BY[ask.by].label} that season` : "Newest first") },
    blocks: [table(xs, ask.by ? `By ${BY[ask.by].label}` : "Newest first", extra)],
    definition: rule,
  };
}

/** The search answer for a place's award winners: its stat card, and the season before it to ask next when none
 *  was said. */
export async function placeAwardsSearch(q: string, ask: PlaceAwardsAsk, pages: SearchPageLink[]): Promise<SearchAnswer> {
  const stat = await placeAwardsAnswer(ask);
  const shown = stat.scope.at(-1) ?? "";
  const season = /^\d{4}–\d{2}$/.test(shown) ? Number(shown.slice(0, 4)) : null;
  if (season != null && !ask.seasonSaid) stat.blocks.push({ kind: "related", title: "Other seasons", queries: [1, 2].map((k) => `${q.replace(/[?!.]+$/, "")} ${season - k}-${String((season - k + 1) % 100).padStart(2, "0")}`) });
  return {
    q, hits: [], pages, step: "deterministic", weak: false,
    understood: { kind: "question", label: stat.title },
    intent: { kind: "stat-place-awards", pattern: "[place] [award] winners", met: true, understood: [stat.title] },
    stat,
  };
}
