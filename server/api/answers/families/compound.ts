// Compound questions (../compound.ts reads them): several filters, or two answers, on one card. Every number is a
// stored one the team page (or the Teams and Rankings pages) already shows: season numbers (team_season_stats), event
// numbers (team_event_stats, event_teams), awards, reliability and the match rows. Nothing is recomputed here, OPR
// least of all: an OPR "without its worst event" is the average of the team's stored per-event OPRs, said so.
// The rules every answer below states:
//   A team list ranks teams with 3+ matches that season (as Rankings), every filter named on the card and applied.
//   Margins, wins and losses: the official scores, penalties included, by the site's one record rule.
//   A world rank is the opponent's final stored rank that season: by prediction rating (as Rankings), or by OPR.
import type { StatAnswer, StatBlock, LeaderboardRow } from "../../../../src/shared/searchStat.js";
import { dateRange, possessive as possessiveOf, seasonLabel } from "../../../../src/shared/format.js";
import { RANKED_MIN_MATCHES } from "../../../../src/shared/rankings.js";
import { countryOf } from "../../../../src/shared/countries.js";
import { teamPageSql } from "../../../../src/shared/teamPages.js";
import { all, get } from "../../../db.js";
import { reportedTeleopIncludesEndgame } from "../../../data/seasons.js";
import { ATTENDED, teamReliability } from "../../teams.js";
import { CHAMPIONSHIP_TYPE, inScope, officialClause, scopeChips, scopePhrase, type Scope } from "../clauses.js";
import type { CompoundQuestion, Threshold } from "../compound.js";
import type { TeamEvent, TeamSeason } from "../eventSet.js";
import { eventHref, matchRow, teamHref, teamLinks, type TeamMatch } from "../matchSet.js";
import { searchSeason, searchSeasonWhy } from "../season.js";
import { BOARD_STATS, statWords } from "./leaderboard.js";
import { LIST_CAP, RESULT_RULE, SCORE_RULE, pct, recText, record, sourceOf, whoOf, type AnswerTeam } from "./matches.js";

const num1 = (x: number | null | undefined) => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${num1(Math.abs(x))}`;
const plural = (k: number, w: string, ws = `${w}s`) => `${k} ${k === 1 ? w : ws}`;
const OP_WORDS: Record<Threshold["op"], string> = { gt: "over", ge: "of at least", lt: "under", le: "of at most" };
export const opText = (t: Threshold, unit = "") => `${OP_WORDS[t.op]} ${t.value}${unit}`;
export const passes = (v: number | null, t: Threshold) => v != null && (t.op === "gt" ? v > t.value : t.op === "ge" ? v >= t.value : t.op === "lt" ? v < t.value : v <= t.value);
const SQL_OP: Record<Threshold["op"], string> = { gt: ">", ge: ">=", lt: "<", le: "<=" };
/** The team's matches at official events in the scope that its record counts (a qualification no-show too), as the
 *  record answer reads them; `scored`: only those its robot was on the field for, as the score answers read them. */
const onRecord = (ms: TeamMatch[], scope: Scope, scored = false) => { const keep = inScope(scope); return ms.filter((m) => m.counted && (!scored || m.onField) && keep(m)); };
/** The team's events in a season with a stored OPR (official events it played). */
const playedEvents = (evs: TeamEvent[], season: number) => evs.filter((e) => e.season === season && officialClause()(e) && e.matches > 0);
const evDate = (e: TeamEvent) => (e.start ? dateRange(e.start.slice(0, 10), e.end?.slice(0, 10)) : "–");
const evRec = (e: TeamEvent) => (e.record ? recText(e.record) : "–");
const evRank = (e: TeamEvent) => (e.rank != null ? `#${e.rank}${e.of ? ` of ${e.of}` : ""}` : "–");

// ---------------------------------------------------------------------------------------------------------------
// Team lists: a place, an award won, Worlds, a stat threshold, sorted by a stat.

const listPlace = (c: ListQuestion, city: string | null) => (c.region ? `in ${c.region.name}` : c.country ? `in ${c.country.name}` : city ? `from ${city}` : "worldwide");
function listWords(c: ListQuestion, season: number) {
  const tst = c.threshold ? BOARD_STATS[c.threshold.stat] : null;
  return {
    awardWords: c.award ? (c.award.type === "Winner" ? "on a winning alliance" : `that won the ${c.award.label}`) : "",
    worldsWords: c.worlds ? `at Worlds ${season + 1}` : "",
    thWords: c.threshold && tst ? `with ${tst.label} ${opText(c.threshold, tst.unit === "%" ? "%" : "")}` : "",
  };
}
/** "Top 5 teams in New Jersey that won the Inspire Award, by Auto OPR · 2025–26": every filter, in words. */
export function listTitle(c: ListQuestion, city: string | null, season = c.season ?? searchSeason()): string {
  const st = BOARD_STATS[c.stat ?? c.threshold?.stat ?? c.outputs[0] ?? "opr"];
  const w = listWords(c, season);
  return [`${c.n ? `Top ${c.n} teams` : "Teams"} ${listPlace(c, city)}`, w.worldsWords, w.awardWords, w.thWords].filter(Boolean).join(" ") + `, by ${statWords(st)} · ${seasonLabel(season)}`;
}
type ListQuestion = Extract<CompoundQuestion, { kind: "list" }>;

export async function listAnswer(c: ListQuestion): Promise<StatAnswer | null> {
  const season = c.season ?? searchSeason();
  const S = seasonLabel(season);
  const sortBy = c.stat ?? c.threshold?.stat ?? c.outputs[0] ?? "opr";
  const st = BOARD_STATS[sortBy], tst = c.threshold ? BOARD_STATS[c.threshold.stat] : null;
  // Ranked as Rankings ranks: by rated matches when the rating orders or filters the list.
  const rated = st.id === "rating" || tst?.id === "rating";
  const where: string[] = [`s.season = ?`, `${rated ? "s.rating_matches" : "s.matches"} >= ?`, `${st.sql} IS NOT NULL`, teamPageSql("s.team", "t.name")];
  const args: (string | number)[] = [season, RANKED_MIN_MATCHES];
  if (c.region) { where.push("t.country = ? AND t.state = ?"); args.push(c.region.country, c.region.state); }
  if (c.country) {
    // The directory's own labels for the country ("USA", "United States"), each one the country's.
    const labels = (await all<{ country: string }>("SELECT DISTINCT country FROM teams WHERE country IS NOT NULL")).map((r) => r.country).filter((l) => countryOf(l)?.code === c.country!.code);
    if (!labels.length) return null;
    where.push(`t.country IN (${labels.map(() => "?").join(",")})`); args.push(...labels);
  }
  let city: string | null = null;
  if (c.city) {
    const row = await get<{ city: string; state: string | null }>("SELECT city, state FROM teams WHERE lower(city) = lower(?) LIMIT 1", [c.city]);
    // A place no team lists as its home city isn't one: left to search.
    if (!row) return null;
    city = row.city;
    where.push("lower(t.city) = lower(?)"); args.push(c.city);
  }
  const placeWords = listPlace(c, city);
  // Filters that say which teams, before the threshold (so a list with none over it can name the closest).
  const filters: string[] = [], filterArgs: (string | number)[] = [];
  if (c.award) {
    // Placement 1: the award's winner (a 2nd or 3rd place is its own line on the team page); FIRST also stores its
    // Leadership Award as a Winner, never a winning alliance.
    filters.push(`EXISTS (SELECT 1 FROM awards a WHERE a.season = s.season AND a.team = s.team AND a.type = ?${c.award.type === "Winner" ? " AND COALESCE(a.name, '') NOT LIKE '%eadership%'" : " AND a.placement = 1"})`);
    filterArgs.push(c.award.type);
  }
  if (c.worlds) {
    filters.push(`EXISTS (SELECT 1 FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE et.season = s.season AND et.team = s.team AND e.type = ? AND ${ATTENDED})`);
    filterArgs.push(CHAMPIONSHIP_TYPE);
  }
  const unit = (x: typeof st) => (x.unit === "%" ? "%" : "");
  const thSql = c.threshold && tst ? `${tst.sql} ${SQL_OP[c.threshold.op]} ?` : null;
  const thArg = c.threshold && tst ? (tst.unit === "%" ? c.threshold.value / 100 : c.threshold.value) : null;
  const joins = [...new Set([st.join, tst?.join].filter(Boolean))].join(" ");
  const from = `team_season_stats s JOIN teams t ON t.number = s.team${joins ? ` ${joins}` : ""}`;
  const base = [...where, ...filters].join(" AND ");
  const cap = Math.min(50, c.n ?? 50);
  const select = `SELECT s.team, t.name, t.city, t.state, t.country, ${st.sql} v, s.opr_np opr, s.opr_auto auto, s.opr_teleop teleop, s.opr_endgame endgame, s.opr_pen pen, s.wins, s.losses, s.ties${tst ? `, ${tst.sql} tv` : ""} FROM ${from}`;
  const order = `ORDER BY v DESC, s.wins DESC, s.team`;
  type Row = { team: number; name: string | null; city: string | null; state: string | null; country: string | null; v: number | null; tv?: number | null; opr: number | null; auto: number | null; teleop: number | null; endgame: number | null; pen: number | null; wins: number; losses: number; ties: number };
  const fullWhere = thSql ? `${base} AND ${thSql}` : base;
  const fullArgs = [...args, ...filterArgs, ...(thArg != null ? [thArg] : [])];
  const [rows, count, pool] = await Promise.all([
    all<Row>(`${select} WHERE ${fullWhere} ${order} LIMIT ?`, [...fullArgs, cap]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM ${from} WHERE ${fullWhere}`, fullArgs),
    get<{ n: number }>(`SELECT COUNT(*) n FROM ${from} WHERE ${base}`, [...args, ...filterArgs]),
  ]);
  const total = Number(count?.n ?? 0), checked = Number(pool?.n ?? 0);
  // The card's words: each filter as a chip, and in the title.
  const { awardWords, worldsWords, thWords } = listWords(c, season);
  const title = listTitle(c, city, season);
  const chips = [c.region?.name ?? c.country?.name ?? city ?? "Worldwide", S, ...(c.award ? [c.award.type === "Winner" ? "Winning alliance" : `Won the ${c.award.label}`] : []), ...(c.worlds ? [`Went to Worlds (FIRST Championship ${season + 1})`] : []),
    ...(c.threshold && tst ? [`${tst.label} ${opText(c.threshold, unit(tst))}`] : []), `Sorted by ${st.label}`, ...(c.n ? [`Top ${c.n}`] : [])];
  const why = c.season == null ? ` ${searchSeasonWhy(season)}` : c.worlds && /\d/.test(String(c.season)) ? ` Worlds ${season + 1} is the ${S} season's FIRST Championship, so every number is from ${S}.` : "";
  const definition = [
    `Teams ${placeWords === "worldwide" ? "anywhere" : `whose home is ${c.region?.name ?? c.country?.name ?? city}, as FIRST lists it,`} with ${RANKED_MIN_MATCHES}+ matches in ${S}, from the season numbers each team page shows (OPR without penalties).`,
    c.award ? (c.award.type === "Winner" ? " On a winning alliance: a Winning Alliance award at any event that season." : ` Won the ${c.award.label}: its winner (1st place) at any event that season, from the events' published awards.`) : "",
    c.worlds ? ` Went to Worlds: played at a FIRST Championship division in ${S}.` : "",
    c.threshold && tst ? ` ${tst.label} ${opText(c.threshold, unit(tst))}: the team's stored ${S} ${tst.label}.` : "",
    why,
  ].join("");
  const answer = { family: "leaderboard" as const, intent: "filtered-list", title, scope: chips, definition, source: `${plural(total, "team")} of ${checked.toLocaleString("en-US")} ranked ${placeWords} that ${c.award || c.worlds ? "pass the filters above" : "were checked"}` };
  if (!rows.length) {
    // None over the threshold: the closest team checked, named, so the answer says what was there.
    const best = thSql && tst ? await get<Row>(`${select.replace(`${st.sql} v`, `${tst.sql} v`)} WHERE ${base} ORDER BY v DESC, s.team LIMIT 1`, [...args, ...filterArgs]) : null;
    const closest = best ? ` The highest ${tst!.label} among them is ${num1(tst!.unit === "%" ? Number(best.v) * 100 : best.v)}${unit(tst!)} (${best.team} ${best.name ?? ""}).`.replace(" )", ")") : "";
    return { ...answer, blocks: [], none: `No team ${placeWords}${worldsWords ? ` ${worldsWords}` : ""}${awardWords ? ` ${awardWords}` : ""}${thWords ? ` ${thWords}` : ""} in ${S}: ${checked ? `${plural(checked, "ranked team")} checked.${closest}` : "none of the teams there pass the other filters."}` };
  }
  const n = (v: unknown) => (v == null ? null : Number(v));
  const fmt = (v: number | null) => (v == null ? "–" : st.unit === "%" ? `${Math.round(v * 100)}%` : st.digits ? num1(v) : String(Math.round(v)));
  const board: StatBlock = {
    kind: "leaderboard", title: `${rows.length === total ? (total === 1 ? "1 team" : `All ${total} teams`) : `Top ${rows.length} of ${total} teams`}, by ${st.label}`, stat: { id: st.id, label: st.label, ...(st.unit ? { unit: st.unit } : {}) },
    ...(reportedTeleopIncludesEndgame(season) ? { teleopWithEndgame: true } : {}),
    note: `${S} · ${chips.slice(2).join(" · ")}`,
    rows: rows.map((r, i): LeaderboardRow => ({
      rank: i + 1, team: { label: `${r.team} ${r.name ?? ""}`.trim(), href: teamHref(Number(r.team), season) },
      location: [r.city, r.state, r.country && r.country !== "USA" ? r.country : null].filter(Boolean).join(", ") || null,
      record: `${r.wins}-${r.losses}-${r.ties}`, opr: n(r.opr), value: n(r.v), display: fmt(n(r.v)),
      parts: r.auto != null || r.teleop != null || r.endgame != null ? { auto: n(r.auto), teleop: n(r.teleop), endgame: n(r.endgame), pen: n(r.pen) } : null,
    })),
  };
  const blocks: StatBlock[] = [board];
  const shown = rows.map((r) => Number(r.team));
  const inList = `(${shown.map(() => "?").join(",")})`;
  if (c.award) {
    // Where each team won it: the award's event, with a link.
    const wins = await all<{ team: number; code: string; name: string; start: string | null }>(
      `SELECT a.team, e.code, e.name, e.start FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code
       WHERE a.season = ? AND a.type = ?${c.award.type === "Winner" ? " AND COALESCE(a.name, '') NOT LIKE '%eadership%'" : " AND a.placement = 1"} AND a.team IN ${inList} ORDER BY e.start`, [season, c.award.type, ...shown]);
    blocks.push({ kind: "table", title: `${c.award.type === "Winner" ? "Winning alliances" : `${c.award.label} wins`}, ${S}`,
      columns: [{ key: "team", label: "Team" }, { key: "event", label: "Event" }, { key: "date", label: "Date" }],
      rows: wins.map((w) => ({ cells: { team: String(w.team), event: w.name, date: w.start ? dateRange(String(w.start).slice(0, 10)) : "–" }, href: `${eventHref(season, w.code)}?tab=awards` })) });
  }
  if (c.worlds) {
    // Each team's Worlds division: its rank, record and OPR there.
    const at = await all<{ team: number; code: string; name: string; rank: number | null; opr: number | null; wins: number | null; losses: number | null; ties: number | null }>(
      `SELECT et.team, e.code, e.name, et.rank, s.opr_np opr, s.wins, s.losses, s.ties FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
       LEFT JOIN team_event_stats s ON s.season = et.season AND s.code = et.code AND s.team = et.team
       WHERE et.season = ? AND e.type = ? AND e.division_code IS NOT NULL AND et.team IN ${inList} AND ${ATTENDED} ORDER BY e.name, et.rank`, [season, CHAMPIONSHIP_TYPE, ...shown]);
    if (at.length) blocks.push({ kind: "table", title: `At Worlds ${season + 1}`,
      columns: [{ key: "team", label: "Team" }, { key: "division", label: "Division" }, { key: "rank", label: "Rank", num: true }, { key: "record", label: "W-L-T" }, { key: "opr", label: "OPR there", num: true }],
      rows: at.map((r) => ({ cells: { team: String(r.team), division: (r.name.split(/\s+-\s+/).pop() ?? r.name).replace(/\s+Division$/i, ""), rank: r.rank != null ? `#${r.rank}` : "–", record: r.wins != null ? `${r.wins}-${r.losses ?? 0}-${r.ties ?? 0}` : "–", opr: num1(r.opr) }, href: eventHref(season, r.code, Number(r.team)) })) });
  }
  // Stats asked for beside the list ("… and their rating") that the leaderboard's columns don't show: a table of them.
  const shownCols = new Set<string>(["opr", "auto", "teleop", "endgame", "record", sortBy]);
  const extra = [...new Set(c.outputs.filter((o) => !shownCols.has(o)))];
  if (extra.length) {
    const vals = await Promise.all(extra.map((o) => { const x = BOARD_STATS[o]; return all<{ team: number; v: number | null }>(`SELECT s.team, ${x.sql} v FROM team_season_stats s${x.join ? ` ${x.join}` : ""} WHERE s.season = ? AND s.team IN ${inList}`, [season, ...shown]); }));
    const fmtOf = (o: string, v: number | null) => { const x = BOARD_STATS[o]; return v == null ? "–" : x.unit === "%" ? `${Math.round(v * 100)}%` : x.digits ? num1(v) : String(Math.round(v)); };
    blocks.splice(1, 0, { kind: "table", title: extra.map((o) => BOARD_STATS[o].label).join(" and ") + `, ${S}`,
      columns: [{ key: "team", label: "Team" }, ...extra.map((o) => ({ key: o, label: BOARD_STATS[o].label, num: true }))],
      rows: rows.map((r) => ({ cells: { team: `${r.team} ${r.name ?? ""}`.trim(), ...Object.fromEntries(extra.map((o, i) => [o, fmtOf(o, vals[i].find((x) => Number(x.team) === Number(r.team))?.v ?? null)])) }, href: teamHref(Number(r.team), season) })) });
  }
  const top = rows[0];
  return {
    ...answer,
    headline: { value: plural(total, "team"), label: `${placeWords}${worldsWords ? ` ${worldsWords}` : ""}${awardWords ? ` ${awardWords}` : ""}${thWords ? ` ${thWords}` : ""}`, sub: `Highest ${st.label}: ${top.team} ${top.name ?? ""} (${fmt(n(top.v))})`.replace(" (", " (").replace(/\s+\(/, " ("), href: teamHref(Number(top.team), season) },
    blocks,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One team: two answers on one card, its events picked or averaged, its matches filtered.

const base = (intent: string, title: string, team: AnswerTeam, scope: Scope, definition: string, source: string) =>
  ({ family: "aggregate" as const, intent, title, team, scope: scopeChips(scope), definition, source });

/** "4215 opr at their first event this season compared to last season": the first (or last) event of each season with
 *  a stored OPR there, side by side. */
export function eventPairAnswer(team: AnswerTeam, evs: TeamEvent[], seasons: TeamSeason[], which: "first" | "last", pair: [number, number]): StatAnswer {
  const pick = (s: number) => { const xs = playedEvents(evs, s).filter((e) => e.opr != null); return which === "first" ? xs[0] : xs[xs.length - 1]; };
  const [a, b] = pair.map(pick);
  const [Sa, Sb] = pair.map(seasonLabel);
  const word = which === "first" ? "First" : "Last";
  const out = { ...base(`${which}-event-opr-pair`, `OPR at their ${word.toLowerCase()} event: ${Sa} against ${Sb}`, team, { season: null }, `${word} event: the ${word.toLowerCase()} official event of each season (by date) where the team played and has a stored OPR, as its team page lists its events. Event OPR: the team's OPR from that event's matches only, without penalties. Every season is a different game, so the two OPRs are on different scales: the change is said, not ranked.`, `From ${possessive(team)} events in ${Sa} and ${Sb}`), scope: [Sa, Sb, `${word} event`] };
  if (!a || !b) return { ...out, blocks: [], none: `${whoOf(team)} has no ${!a && !b ? `${Sa} or ${Sb}` : !a ? Sa : Sb} event with a stored OPR.` };
  const d = a.opr! - b.opr!;
  const seasonOf = (s: number) => seasons.find((x) => x.season === s);
  const tile = (e: TeamEvent, S: string) => ({ label: `${word} event, ${S}`, value: num1(e.opr), sub: `${e.name} · ${evDate(e)}`, href: eventHref(e.season, e.code, team.number) });
  return {
    ...out,
    headline: { value: `${num1(a.opr)} vs ${num1(b.opr)}`, label: `OPR at their ${word.toLowerCase()} event, ${Sa} against ${Sb}`, sub: `${signed(d)} points (${a.name} against ${b.name})` },
    blocks: [
      { kind: "kpis", items: [{ ...tile(a, Sa), tone: "accent" as const }, tile(b, Sb), { label: "Change", value: signed(d), sub: `${Sb} to ${Sa}` }] },
      { kind: "bars", title: `OPR by phase, ${word.toLowerCase()} event`, unit: "pts", groups: (["auto", "teleop", "endgame"] as const).map((k) => ({ label: k === "auto" ? "Auto" : k === "teleop" ? "TeleOp" : "Endgame", items: [{ label: Sa, value: a[k] == null ? null : Math.round(a[k]! * 10) / 10, tone: "a" as const }, { label: Sb, value: b[k] == null ? null : Math.round(b[k]! * 10) / 10, tone: "b" as const }] })) },
      { kind: "table", title: `${word} events`, columns: [{ key: "season", label: "Season" }, { key: "event", label: "Event" }, { key: "record", label: "W-L-T" }, { key: "opr", label: "OPR", num: true }, { key: "season-opr", label: "Season OPR", num: true }],
        rows: [a, b].map((e) => ({ cells: { season: seasonLabel(e.season), event: e.name, record: evRec(e), opr: num1(e.opr), "season-opr": num1(seasonOf(e.season)?.opr) }, href: eventHref(e.season, e.code, team.number), strong: e === a })) },
    ],
  };
}

const possessive = (t: AnswerTeam) => possessiveOf(t.name ?? `Team ${t.number}`);

/** "4215 matches where they lost by less than 10 points": the team's wins or losses by a margin. */
export async function marginAnswer(team: AnswerTeam, msAll: TeamMatch[], scope: Scope, result: "W" | "L", margin: Threshold): Promise<StatAnswer> {
  const ms = onRecord(msAll, scope);
  const same = ms.filter((m) => m.result === result);
  const hit = same.filter((m) => passes(Math.abs(m.own - m.opp), margin)).reverse();
  const word = result === "W" ? "Wins" : "Losses";
  const phrase = `${word} by ${opText(margin, " points")}`;
  const out = base(`${result === "W" ? "wins" : "losses"}-by-margin`, `${phrase}${scopePhrase(scope)}`, team, scope,
    `${word}: matches on the team's record it ${result === "W" ? "won" : "lost"}, by the official scores. Margin: the difference between the two alliances' official scores. ${RESULT_RULE} ${SCORE_RULE}`, sourceOf(ms));
  if (!same.length) return { ...out, blocks: [], none: `${whoOf(team)} has no ${word.toLowerCase()} on record${scopePhrase(scope)}.` };
  const links = await teamLinks(hit.flatMap((m) => [...m.partners, ...m.opponents]));
  const all = record(ms);
  return {
    ...out,
    headline: { value: String(hit.length), label: `${hit.length === 1 ? word.replace(/es$|s$/, "") : word.toLowerCase()} by ${opText(margin, " points")}${scopePhrase(scope)}`, sub: `of ${plural(same.length, result === "W" ? "win" : "loss", result === "W" ? "wins" : "losses")} · record ${recText(all)} (${pct(all)})` },
    blocks: [
      { kind: "kpis", items: [{ label: phrase, value: String(hit.length), tone: result === "W" ? "good" as const : "bad" as const }, { label: `All ${word.toLowerCase()}`, value: String(same.length) }, { label: "Record", value: recText(all), sub: `${pct(all)} in ${ms.length} matches` }] },
      ...(hit.length ? [{ kind: "matches" as const, title: `${phrase}, newest first`, rows: hit.slice(0, LIST_CAP).map((m) => matchRow(m, links, team.number)), ...(hit.length > LIST_CAP ? { more: `${hit.length - LIST_CAP} more` } : {}) }] : []),
    ],
    ...(hit.length ? {} : { none: `None of ${possessive(team)} ${same.length} ${word.toLowerCase()}${scopePhrase(scope)} were by ${opText(margin, " points")}.` }),
  };
}

/** "4215 opr if you exclude their worst event": the season's stored per-event OPRs, averaged with and without the
 *  worst (or best) one, beside the stored season OPR. */
export function oprExcludingAnswer(team: AnswerTeam, evs: TeamEvent[], seasons: TeamSeason[], season: number, drop: "worst" | "best", why?: string): StatAnswer {
  const S = seasonLabel(season);
  const xs = playedEvents(evs, season).filter((e) => e.opr != null);
  const seasonOpr = seasons.find((s) => s.season === season)?.opr ?? null;
  const out = base(`opr-without-${drop}-event`, `OPR without their ${drop} event in ${S}`, team, { season },
    `Each event's OPR is the one stored for that event (its matches only, without penalties), as the team page lists them; nothing is recomputed. The average is those event OPRs averaged, then again with the ${drop} one (the ${drop === "worst" ? "lowest" : "highest"}) left out. The season OPR is the stored one from every match that season, as the team page shows it.${why ? ` ${why}` : ""}`,
    `From ${plural(xs.length, "event")} with a stored OPR in ${S}`);
  if (xs.length < 2) return { ...out, blocks: [], none: `${whoOf(team)} has ${xs.length ? "only one event" : "no events"} with a stored OPR in ${S}, so there is no ${drop} event to leave out.` };
  const pick = xs.reduce((x, e) => (drop === "worst" ? e.opr! < x.opr! : e.opr! > x.opr!) ? e : x);
  const mean = (es: TeamEvent[]) => es.reduce((t, e) => t + e.opr!, 0) / es.length;
  const allAvg = mean(xs), without = mean(xs.filter((e) => e !== pick));
  return {
    ...out,
    headline: { value: num1(without), label: `Average event OPR without their ${drop} event, ${S}`, sub: `${num1(allAvg)} with all ${xs.length} events · ${drop} event ${pick.name} (${num1(pick.opr)})` },
    blocks: [
      { kind: "kpis", items: [
        { label: `Without ${drop} event`, value: num1(without), sub: `average of ${plural(xs.length - 1, "event")}`, tone: "accent" as const },
        { label: "All events", value: num1(allAvg), sub: `average of ${xs.length} events` },
        { label: `${drop === "worst" ? "Worst" : "Best"} event`, value: num1(pick.opr), sub: pick.name, href: eventHref(pick.season, pick.code, team.number) },
        ...(seasonOpr != null ? [{ label: `Season OPR, ${S}`, value: num1(seasonOpr), sub: "stored, every match" }] : []),
      ] },
      { kind: "series", title: `OPR by event, ${S}`, points: xs.map((e) => ({ x: e.name, y: Math.round(e.opr! * 10) / 10, href: eventHref(e.season, e.code, team.number), ...(e === pick ? { note: `${drop === "worst" ? "Worst" : "Best"}: left out` } : {}) })) },
      { kind: "table", title: `Events, ${S}`, columns: [{ key: "event", label: "Event" }, { key: "record", label: "W-L-T" }, { key: "opr", label: "OPR", num: true }, { key: "kept", label: "Counted" }],
        rows: xs.map((e) => ({ cells: { event: e.name, record: evRec(e), opr: num1(e.opr), kept: e === pick ? `No (${drop})` : "Yes" }, href: eventHref(e.season, e.code, team.number), strong: e === pick })) },
    ],
  };
}

/** "4215 best event by rank and worst event by opr in same season": two picks from one season's events. */
export function eventPicksAnswer(team: AnswerTeam, evs: TeamEvent[], season: number, picks: { pick: "best" | "worst"; by: "rank" | "opr" | "record" }[], why?: string): StatAnswer {
  const S = seasonLabel(season);
  const xs = playedEvents(evs, season);
  const rate = (e: TeamEvent) => { const r = e.record; const n = r ? r.wins + r.losses + r.ties : 0; return n ? r!.wins / n : null; };
  const value = (e: TeamEvent, by: "rank" | "opr" | "record") => (by === "rank" ? (e.rank != null ? -e.rank : null) : by === "opr" ? e.opr : rate(e));
  const choose = (p: (typeof picks)[number]) => {
    const ok = xs.filter((e) => value(e, p.by) != null);
    if (!ok.length) return null;
    // Ties: the better OPR for a best pick, the worse for a worst one; then the earlier event.
    return ok.reduce((x, e) => { const a = value(e, p.by)!, b = value(x, p.by)!; return (p.pick === "best" ? a > b : a < b) || (a === b && (p.pick === "best" ? (e.opr ?? 0) > (x.opr ?? 0) : (e.opr ?? 0) < (x.opr ?? 0))) ? e : x; });
  };
  const by = (b: string) => (b === "rank" ? "rank" : b === "opr" ? "OPR" : "record");
  const names = picks.map((p) => `${p.pick} event by ${by(p.by)}`);
  const out = base("event-picks", `${names.map((n, i) => (i ? n : n[0].toUpperCase() + n.slice(1))).join(" and ")}, ${S}`, team, { season },
    `From the official events the team played in ${S}, as its team page lists them. Rank: its qualification rank there (league meets have no rank of their own: the league's standing isn't a finish, so they aren't ranked here); ties go to the better event OPR. OPR: its stored OPR at that event, without penalties. Record: its win rate there, every counted match.${why ? ` ${why}` : ""}`,
    `From ${plural(xs.length, "event")} in ${S}`);
  if (!xs.length) return { ...out, blocks: [], none: `${whoOf(team)} played no official events in ${S}.` };
  const chosen = picks.map(choose);
  const show = (e: TeamEvent | null, p: (typeof picks)[number]) => (e ? (p.by === "rank" ? evRank(e) : p.by === "opr" ? `OPR ${num1(e.opr)}` : evRec(e)) : "–");
  const mark = (e: TeamEvent) => picks.map((p, i) => (chosen[i] === e ? `${p.pick === "best" ? "Best" : "Worst"} by ${by(p.by)}` : "")).filter(Boolean).join(", ");
  return {
    ...out,
    headline: chosen[0] ? { value: chosen[0].name, label: `${names[0][0].toUpperCase()}${names[0].slice(1)}: ${show(chosen[0], picks[0])}`, sub: chosen[1] ? `${names[1][0].toUpperCase()}${names[1].slice(1)}: ${chosen[1].name}, ${show(chosen[1], picks[1])}` : undefined, href: eventHref(chosen[0].season, chosen[0].code, team.number) } : undefined,
    blocks: [
      { kind: "kpis", items: picks.map((p, i) => ({ label: `${p.pick === "best" ? "Best" : "Worst"} event by ${by(p.by)}`, value: show(chosen[i], p), sub: chosen[i] ? `${chosen[i]!.name} · ${evDate(chosen[i]!)}` : "No event has one", ...(chosen[i] ? { href: eventHref(chosen[i]!.season, chosen[i]!.code, team.number) } : {}), tone: p.pick === "best" ? "good" as const : "bad" as const })) },
      { kind: "table", title: `Events, ${S}`, columns: [{ key: "event", label: "Event" }, { key: "rank", label: "Rank" }, { key: "record", label: "W-L-T" }, { key: "opr", label: "OPR", num: true }, { key: "pick", label: "Pick" }],
        rows: xs.map((e) => ({ cells: { event: e.name, rank: evRank(e), record: evRec(e), opr: num1(e.opr), pick: mark(e) || "" }, href: eventHref(e.season, e.code, team.number), strong: !!mark(e) })) },
    ],
    ...(chosen.every(Boolean) ? {} : { none: `${picks.filter((_, i) => !chosen[i]).map((p) => `No ${S} event has a ${by(p.by)} to pick by.`).join(" ")}` }),
  };
}

/** "4215 average score when they win versus when they lose". */
export function winLossAverageAnswer(team: AnswerTeam, msAll: TeamMatch[], scope: Scope): StatAnswer {
  const ms = onRecord(msAll, scope, true);
  const w = ms.filter((m) => m.result === "W"), l = ms.filter((m) => m.result === "L");
  const avg = (xs: TeamMatch[], f: (m: TeamMatch) => number) => (xs.length ? Math.round((xs.reduce((t, m) => t + f(m), 0) / xs.length) * 10) / 10 : null);
  const out = base("average-score-win-loss", `Average score in wins and losses${scopePhrase(scope)}`, team, scope,
    `Average score: the alliance's official score, penalties included, averaged over the team's wins and then its losses (the other alliance's average beside it). ${RESULT_RULE} ${SCORE_RULE}`, sourceOf(ms));
  if (!w.length && !l.length) return { ...out, blocks: [], none: `${whoOf(team)} has no wins or losses on record${scopePhrase(scope)}.` };
  const aw = avg(w, (m) => m.own), al = avg(l, (m) => m.own);
  const ow = avg(w, (m) => m.opp), ol = avg(l, (m) => m.opp);
  const events = [...new Map(ms.map((m) => [`${m.season}|${m.code}`, m])).values()];
  return {
    ...out,
    headline: { value: `${num1(aw)} vs ${num1(al)}`, label: `Average score in wins against losses${scopePhrase(scope)}`, sub: aw != null && al != null ? `${signed(aw - al)} points in wins · ${plural(w.length, "win")}, ${plural(l.length, "loss", "losses")}` : `${plural(w.length, "win")}, ${plural(l.length, "loss", "losses")}` },
    blocks: [
      { kind: "kpis", items: [
        { label: "In wins", value: num1(aw), sub: `${plural(w.length, "win")} · opponents ${num1(ow)}`, tone: "good" as const },
        { label: "In losses", value: num1(al), sub: `${plural(l.length, "loss", "losses")} · opponents ${num1(ol)}`, tone: "bad" as const },
        ...(aw != null && al != null ? [{ label: "Difference", value: signed(aw - al), sub: "wins minus losses" }] : []),
      ] },
      { kind: "bars", title: "Average score", unit: "pts", groups: [{ label: "Their alliance", items: [{ label: "Wins", value: aw, tone: "a" as const }, { label: "Losses", value: al, tone: "b" as const }] }, { label: "Opponents", items: [{ label: "Wins", value: ow, tone: "a" as const }, { label: "Losses", value: ol, tone: "b" as const }] }] },
      { kind: "table", title: "By event", columns: [{ key: "event", label: "Event" }, { key: "w", label: "Wins", num: true }, { key: "aw", label: "Avg in wins", num: true }, { key: "l", label: "Losses", num: true }, { key: "al", label: "Avg in losses", num: true }],
        rows: events.map((e) => { const xs = ms.filter((m) => m.season === e.season && m.code === e.code); const ew = xs.filter((m) => m.result === "W"), el = xs.filter((m) => m.result === "L"); return { cells: { event: e.event, w: ew.length, aw: num1(avg(ew, (m) => m.own)), l: el.length, al: num1(avg(el, (m) => m.own)) }, href: eventHref(e.season, e.code, team.number) }; }) },
    ],
  };
}

/** "Did 4215 ever beat a team ranked top 10 worldwide": its wins over an opponent ranked in the world's top N that
 *  season (the opponent's final stored rank), and every meeting with one. */
export async function beatTopAnswer(team: AnswerTeam, msAll: TeamMatch[], scope: Scope, n: number, by: "rating" | "opr"): Promise<StatAnswer> {
  const ms = onRecord(msAll, scope);
  const ids = [...new Set(ms.flatMap((m) => m.opponents))];
  // Both stored world ranks of every opponent ranked in the top N that season: the one asked leads, the other is said.
  const ranks = { rating: new Map<string, number>(), opr: new Map<string, number>() };
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    const rows = await all<{ season: number; team: number; rr: number | null; orr: number | null }>(`SELECT season, team, rating_rank rr, rank_np orr FROM team_season_stats WHERE (rating_rank <= ? OR rank_np <= ?) AND team IN (${part.map(() => "?").join(",")})`, [n, n, ...part]);
    for (const r of rows) {
      if (r.rr != null && Number(r.rr) <= n) ranks.rating.set(`${r.season}|${r.team}`, Number(r.rr));
      if (r.orr != null && Number(r.orr) <= n) ranks.opr.set(`${r.season}|${r.team}`, Number(r.orr));
    }
  }
  const seasons = [...new Set(ms.map((m) => m.season))];
  const rankedSeasons = seasons.length ? (await all<{ season: number }>(`SELECT DISTINCT season FROM team_season_stats WHERE ${by === "rating" ? "rating_rank" : "rank_np"} IS NOT NULL AND season IN (${seasons.map(() => "?").join(",")})`, seasons)).map((r) => Number(r.season)).sort() : [];
  const topOf = (m: TeamMatch, k: "rating" | "opr" = by) => m.opponents.filter((o) => ranks[k].has(`${m.season}|${o}`));
  const met = ms.filter((m) => topOf(m).length).reverse();
  const won = met.filter((m) => m.result === "W");
  const other = by === "rating" ? "opr" : "rating";
  const otherWon = ms.filter((m) => m.result === "W" && topOf(m, other).length).length;
  const rankWords = (k: "rating" | "opr") => (k === "rating" ? "prediction rating (as Rankings ranks the world)" : "OPR (as the Teams page ranks it)");
  const label = `a top-${n} team worldwide`;
  const out = base("beat-top-ranked", `Wins against ${label}${scopePhrase(scope)}`, team, scope,
    `A top-${n} team: an opponent whose final world rank by ${rankWords(by)} that season, as stored for its team page, is ${n} or better; the count by ${rankWords(other)} is said beside it. Wins: matches on the team's record it won with such a team on the other alliance. Seasons with world ranks: ${rankedSeasons.length ? rankedSeasons.map(seasonLabel).join(", ") : "none"}. ${RESULT_RULE}`, sourceOf(ms));
  const rec = record(met);
  const links = await teamLinks(met.flatMap((m) => [...m.partners, ...m.opponents]));
  // The top teams faced: each one's rank that season and the record against it.
  const faced = new Map<string, { team: number; season: number; rank: number; ms: TeamMatch[] }>();
  for (const m of met) for (const o of topOf(m)) { const k = `${m.season}|${o}`; const f = faced.get(k) ?? { team: o, season: m.season, rank: ranks[by].get(k)!, ms: [] }; f.ms.push(m); faced.set(k, f); }
  const yes = won.length > 0;
  const otherName = other === "opr" ? "OPR" : "rating";
  return {
    ...out,
    headline: { value: yes ? "Yes" : "No", label: yes ? `${plural(won.length, "win")} against ${label}${scopePhrase(scope)}` : met.length ? `No wins against ${label}${scopePhrase(scope)}` : `Never played ${label}${scopePhrase(scope)}`, sub: `${met.length ? `${plural(met.length, "match", "matches")} against one: ${recText(rec)}` : `${plural(ms.length, "match", "matches")} checked`} · by ${otherName} rank: ${plural(otherWon, "win")}` },
    blocks: [
      { kind: "kpis", items: [{ label: `Wins vs top ${n}`, value: String(won.length), tone: yes ? "good" as const : "bad" as const }, { label: `Matches vs top ${n}`, value: String(met.length), sub: met.length ? recText(rec) : undefined }, { label: "Top teams faced", value: String(faced.size) }, { label: `Wins vs top ${n} by ${otherName}`, value: String(otherWon) }] },
      ...(faced.size ? [{ kind: "table" as const, title: `Top-${n} teams faced`, columns: [{ key: "team", label: "Team" }, { key: "season", label: "Season" }, { key: "rank", label: "World rank", num: true }, { key: "record", label: "W-L-T vs them" }],
        rows: [...faced.values()].sort((a, b) => b.season - a.season || a.rank - b.rank).map((f) => ({ cells: { team: links.get(f.team)?.label ?? String(f.team), season: seasonLabel(f.season), rank: `#${f.rank}`, record: recText(record(f.ms)) }, href: teamHref(f.team, f.season) })) }] : []),
      ...(won.length ? [{ kind: "matches" as const, title: `Wins against ${label}, newest first`, rows: won.slice(0, LIST_CAP).map((m) => matchRow(m, links, team.number)), ...(won.length > LIST_CAP ? { more: `${won.length - LIST_CAP} more` } : {}) }] : []),
      ...(!won.length && met.length ? [{ kind: "matches" as const, title: `Matches against ${label}, newest first`, rows: met.slice(0, LIST_CAP).map((m) => matchRow(m, links, team.number)) }] : []),
    ],
  };
}

/** "4215 partners at NJ championship who had opr over 80": the team's partners (or opponents) at the event, with
 *  their OPR there (in a season: their season OPR), the ones over the threshold listed. */
export async function sideThresholdAnswer(team: AnswerTeam, msAll: TeamMatch[], scope: Scope, side: "partners" | "opponents", t: Threshold, finals: string | null = null): Promise<StatAnswer> {
  const ev = scope.event;
  // A championship (`finals`, its parent event): the finals and every division, so a team from another division is
  // read at its own division.
  const codes = ev && finals ? (await all<{ code: string }>("SELECT code FROM events WHERE season = ? AND (code = ? OR division_code = ?)", [ev.season, finals, finals])).map((r) => r.code) : ev ? [ev.code] : [];
  const ms = ev && finals ? onRecord(msAll, { ...scope, event: undefined, season: ev.season }).filter((m) => codes.includes(m.code)) : onRecord(msAll, scope);
  const tally = new Map<number, TeamMatch[]>();
  for (const m of ms) for (const o of m[side]) tally.set(o, [...(tally.get(o) ?? []), m]);
  const ids = [...tally.keys()];
  const oprs = new Map<number, number | null>(), seasonOprs = new Map<number, number | null>();
  const season = ev?.season ?? scope.season;
  if (ids.length && season != null) {
    const qs = ids.map(() => "?").join(",");
    const at = codes;
    // At an event: each team's OPR from that event's matches; at a championship, the row with the most matches (its
    // own division's, never the finals' few).
    const [er, sr] = await Promise.all([
      ev ? all<{ team: number; opr: number | null }>(`SELECT team, opr_np opr FROM team_event_stats WHERE season = ? AND code IN (${at.map(() => "?").join(",")}) AND team IN (${qs}) AND opr_np IS NOT NULL ORDER BY matches`, [ev.season, ...at, ...ids]) : Promise.resolve([]),
      all<{ team: number; opr: number | null }>(`SELECT team, opr_np opr FROM team_season_stats WHERE season = ? AND team IN (${qs})`, [season, ...ids]),
    ]);
    for (const r of er) oprs.set(Number(r.team), r.opr == null ? null : Number(r.opr));
    for (const r of sr) seasonOprs.set(Number(r.team), r.opr == null ? null : Number(r.opr));
  }
  const oprOf = (n: number) => (ev ? oprs.get(n) ?? null : seasonOprs.get(n) ?? null);
  const word = side === "partners" ? "Partners" : "Opponents";
  const where = ev ? "OPR there" : season != null ? `${seasonLabel(season)} OPR` : "OPR";
  const phrase = `${word} with ${where} ${opText(t)}`;
  const out = base(`${side}-opr-threshold`, `${word}${scopePhrase(scope)} with OPR ${opText(t)}`, team, scope,
    `${word}: the teams on ${side === "partners" ? "the team's own" : "the other"} alliance in its matches on record${ev ? ` at the event${finals ? " (its division and the finals)" : ""}` : ""}, robots on the field. ${ev ? "OPR there: each team's stored OPR from that event's matches (at a championship, its own division's), without penalties, as its event page shows it; its season OPR beside it." : "OPR: each team's stored season OPR, without penalties, as its team page shows it."} ${RESULT_RULE}`, sourceOf(ms));
  if (ev) out.scope = [...out.scope, seasonLabel(ev.season)];
  if (!ids.length) return { ...out, blocks: [], none: `${whoOf(team)} has no matches on record${scopePhrase(scope)}.` };
  if (season == null) return { ...out, blocks: [], none: "Name a season or an event: an OPR belongs to one season." };
  const links = await teamLinks(ids);
  const rows = ids.map((n) => ({ n, opr: oprOf(n), ms: tally.get(n)! })).sort((a, b) => (b.opr ?? -1) - (a.opr ?? -1) || a.n - b.n);
  const hit = rows.filter((r) => passes(r.opr, t));
  const best = rows[0];
  return {
    ...out,
    headline: { value: `${hit.length} of ${ids.length}`, label: `${side}${scopePhrase(scope)} had ${where} ${opText(t)}`, sub: best.opr != null ? `Highest: ${links.get(best.n)?.label ?? best.n} (${num1(best.opr)})` : undefined },
    blocks: [
      { kind: "kpis", items: [{ label: phrase, value: String(hit.length), tone: "accent" as const }, { label: `All ${side}`, value: String(ids.length) }, { label: "Matches", value: String(ms.length), sub: recText(record(ms)) }] },
      { kind: "table", title: hit.length ? phrase : `${word}: none ${opText(t)}`,
        columns: [{ key: "team", label: "Team" }, { key: "opr", label: ev ? "OPR there" : "OPR", num: true }, ...(ev ? [{ key: "season", label: "Season OPR", num: true }] : []), { key: "record", label: side === "partners" ? "W-L-T with" : "W-L-T vs" }],
        rows: (hit.length ? hit : rows).map((r) => ({ cells: { team: links.get(r.n)?.label ?? String(r.n), opr: num1(r.opr), ...(ev ? { season: num1(seasonOprs.get(r.n)) } : {}), record: recText(record(r.ms)) }, href: teamHref(r.n, season), strong: passes(r.opr, t) })) },
    ],
    ...(hit.length ? {} : { none: `None of ${possessive(team)} ${plural(ids.length, side.slice(0, -1), side)}${scopePhrase(scope)} had ${where} ${opText(t)}.` }),
  };
}

/** "4215 vs 6980 vs 33950 which has highest reliability": three or four teams' reliability side by side, the season
 *  named, else the latest completed season when every team has one, else the latest they all have. */
export async function reliabilitySetAnswer(teams: AnswerTeam[], season: number | null): Promise<StatAnswer> {
  const rows = await all<{ season: number; team: number }>(`SELECT season, team FROM team_reliability WHERE code = '' AND team IN (${teams.map(() => "?").join(",")})${season != null ? " AND season = ?" : ""} ORDER BY season DESC`, [...teams.map((t) => t.number), ...(season != null ? [season] : [])]);
  const has = (s: number) => teams.every((t) => rows.some((r) => Number(r.season) === s && Number(r.team) === t.number));
  const def = searchSeason();
  const s = season ?? (has(def) ? def : rows.map((r) => Number(r.season)).find(has) ?? null);
  const why = season != null ? "" : s === def ? ` ${searchSeasonWhy(def)}` : s != null ? ` The season is ${seasonLabel(s)}, the latest season every team has a reliability for.` : "";
  const out = { family: "two-team" as const, intent: "reliability-set", title: `Reliability: ${teams.map((t) => t.number).join(" vs ")}${s != null ? ` in ${seasonLabel(s)}` : ""}`, team: teams[0], teams, scope: s != null ? [seasonLabel(s)] : ["No common season"],
    definition: `Reliability (0–100, higher = more dependable), as each team page shows it: from public match data only (no-shows, disqualifications, near-zero matches, how much its contribution swings, penalties given away and how far its scores land from the engine's calls). The most reliable team is the highest index.${why}`,
    source: s != null ? `From the teams' ${seasonLabel(s)} qualification matches` : "No season every team has a reliability for" };
  if (s == null) return { ...out, blocks: [], none: `${teams.map(whoOf).join(", ")} have no season with a reliability for every team.` };
  const rs = await Promise.all(teams.map((t) => teamReliability(s, t.number)));
  const missing = teams.filter((_, i) => !rs[i]);
  if (missing.length) return { ...out, blocks: [], none: `No ${seasonLabel(s)} reliability for ${missing.map(whoOf).join(" and ")} yet.` };
  const R = rs as NonNullable<(typeof rs)[number]>[];
  const top = Math.max(...R.map((r) => r.index));
  const leaders = teams.filter((_, i) => R[i].index === top);
  const parts: [string, (r: (typeof R)[number]) => string | number][] = [["Index", (r) => r.index], ["Matches", (r) => r.matches], ["No-shows", (r) => r.noShows], ["Disqualified", (r) => r.dqs], ["Near-zero matches", (r) => r.nearZero], ["Swing", (r) => r.parts.swing.toFixed(2)], ["Penalties given away vs field", (r) => `${r.parts.penaltyRatio.toFixed(2)}×`]];
  const sorted = teams.map((t, i) => ({ t, r: R[i] })).sort((a, b) => b.r.index - a.r.index);
  return {
    ...out,
    headline: { value: leaders.length > 1 ? `Tied: ${leaders.map((t) => t.number).join(", ")}` : whoOf(leaders[0]), label: `Highest reliability: ${top} out of 100`, sub: `${sorted.map((x) => `${x.t.number} ${x.r.index}`).join(" · ")}${R[0].fieldIndex != null ? ` · field average ${R[0].fieldIndex}` : ""}`, ...(leaders.length === 1 ? { href: teamHref(leaders[0].number, s) } : {}) },
    blocks: [
      { kind: "kpis", items: sorted.map(({ t, r }) => ({ label: whoOf(t), value: String(r.index), sub: `out of 100 · ${r.matches} qualification matches`, href: teamHref(t.number, s), ...(r.index === top ? { tone: "accent" as const } : {}) })) },
      { kind: "bars", title: "Reliability index", groups: [{ label: seasonLabel(s), items: teams.map((t, i) => ({ label: String(t.number), value: R[i].index, tone: (["a", "b", "c", "d"] as const)[i % 4] })) }] },
      { kind: "table", title: "Breakdown", columns: [{ key: "part", label: "Part" }, ...teams.map((t) => ({ key: String(t.number), label: String(t.number), num: true }))],
        rows: parts.map(([part, f]) => ({ cells: { part, ...Object.fromEntries(teams.map((t, i) => [String(t.number), f(R[i])])) } })) },
    ],
  };
}

/** "4215 awards and record in 2025-26 combined": the answers asked for, one after the other on one card, with a
 *  summary row of each one's number first. */
export function combinedAnswer(team: AnswerTeam, scope: Scope, parts: StatAnswer[], summary: { label: string; value: string; sub?: string; href?: string }[]): StatAnswer {
  const names = parts.map((p) => p.title.replace(scopePhrase(scope), "").trim());
  const title = `${names.map((n, i) => (i ? n.toLowerCase() : n)).join(" and ")}${scopePhrase(scope)}`;
  return {
    family: "aggregate", intent: "combined", title, team, scope: scopeChips(scope),
    headline: { value: summary.map((s) => s.value).join(" · "), label: summary.map((s) => s.label).join(" · "), ...(summary[0]?.href ? { href: summary[0].href } : {}) },
    blocks: [
      { kind: "kpis", items: summary },
      // Each answer's own blocks, its plain "none" said as a table row so nothing asked goes missing.
      ...parts.flatMap((p): StatBlock[] => (p.blocks.length ? p.blocks : [{ kind: "table", title: p.title, columns: [{ key: "none", label: p.title }], rows: [{ cells: { none: p.none ?? "Nothing on record." } }] }])),
    ],
    definition: parts.map((p) => p.definition).join(" "),
    source: parts.map((p) => p.source).join(" · "),
  };
}
