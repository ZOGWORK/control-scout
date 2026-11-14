// Family 6, two teams (the brief's "two-team set"): the matches a team played with or against another, read from the
// first team's match set (../matchSet.ts) under the scope clauses (../clauses.ts), and two teams' season numbers side
// by side from the stored season rows (team_season_stats: OPR and the prediction rating are never worked out here).
// The rules every answer below states:
//   Head to head: the matches the two teams played on opposite alliances, both robots on the field, at official
//     events; the record is the first team's, by the site's one record rule (src/shared/eventRecord.ts).
//   Toughest opponent: of the opponents met 3 times or more, the one with the best record against the team.
//   Best partner: the partner the team scored the most points with together (the alliance's own points, without the
//     other alliance's penalties), any number of matches; a tie goes to more matches together, then the better record.
//   Teams never played: teams from the team's state that played official matches that season, never met as an
//     opponent in any recorded match.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { RECORD_RULE } from "../../../../src/shared/eventRecord.js";
import { predictHref } from "../../../../src/shared/predictUrl.js";
import { isLegacy } from "../../../data/seasons.js";
import { all, get } from "../../../db.js";
import { OFFICIAL_TYPES, inScope, scopeChips, scopePhrase, type Scope } from "../clauses.js";
import { matchHref, matchRow, teamHref, teamLinks, type TeamMatch } from "../matchSet.js";
import type { TwoTeamId, IntentId } from "../read.js";
import { teamReliability } from "../../teams.js";
import { currentSeason, seasonWhy } from "../season.js";
import { sourceOf, whoOf, type AnswerTeam } from "./matches.js";
import { awardScale, compareBlock, decidedText, leadHeadline, seasonScale, winShare, type CompareInput, type StatColumn } from "../compareBlock.js";
import { COMPARE_SCALE_COLS, SEASON_COLS, compareStat, pickSeasonRows, type PickedSeason, type SeasonRow } from "../../../../src/shared/searchVersus.js";

const LIST_CAP = 25, TOP = 10;
/** Meetings an opponent (or matches a partner) needs before "toughest" or "best" ranks it. */
export const MIN_MEETINGS = 3;

const H2H_RULE = `Head to head: the matches the two teams played on opposite alliances, both robots on the field, at official events (never scrimmages or off-season events). Results use the official scores, penalties included. ${RECORD_RULE}`;
const SEASON_RULE = "From each team's stored season numbers, as their team pages show them: OPR is the season's offensive power rating without penalties, by game phase; the prediction rating is the engine's points-per-match strength (± its uncertainty).";
const RECORD_VERDICT = `A season's record is the team's matches that season (wins-losses-ties); the better record is the higher win rate (wins over matches played, ties counted as played). ${RECORD_RULE}`;

type Rec = { wins: number; losses: number; ties: number };
const recOf = (ms: TeamMatch[]): Rec => ({ wins: ms.filter((m) => m.result === "W").length, losses: ms.filter((m) => m.result === "L").length, ties: ms.filter((m) => m.result === "T").length });
const recText = (r: Rec) => `${r.wins}-${r.losses}-${r.ties}`;
const played = (r: Rec) => r.wins + r.losses + r.ties;
const rateOf = (r: Rec) => (played(r) ? r.wins / played(r) : 0);
const pct = (r: Rec) => (played(r) ? `${Math.round(100 * rateOf(r))}%` : "–");
const num1 = (x: number | null | undefined) => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));

/** A team's counted matches in scope with its robot on the field (a no-show is no meeting), newest first. */
const counted = (ms: TeamMatch[], scope: Scope) => { const keep = inScope(scope); return ms.filter((m) => m.counted && m.onField && keep(m)).reverse(); };

/** "A vs B head to head": the matches they met in, the record, and how often they were partners. `wins`: "12345 wins
 *  against 67890" leads with the first team's wins in those meetings. */
export async function headToHead(a: AnswerTeam, b: AnswerTeam, msA: TeamMatch[], scope: Scope, opts: { wins?: boolean } = {}): Promise<StatAnswer> {
  const ms = counted(msA, scope);
  const met = ms.filter((m) => m.opponents.includes(b.number));
  const together = ms.filter((m) => m.partners.includes(b.number));
  const r = recOf(met), rt = recOf(together);
  const where = scopePhrase(scope);
  // The page's heading names both teams ("Head to head: … vs …"); the card's says what it holds.
  const title = `Their meetings and partnerships${where}`;
  const base = { family: "two-team" as const, intent: "head-to-head", title, team: a, teams: [a, b], scope: scopeChips(scope), definition: H2H_RULE, source: sourceOf(met.length ? met : ms) };
  const links = await teamLinks([...met, ...together].flatMap((m) => [...m.partners, ...m.opponents]).slice(0, 2000));
  const row = (m: TeamMatch) => ({ ...matchRow(m, links, a.number), ownNp: undefined });
  const togetherBlock: StatBlock[] = together.length ? [{ kind: "matches", title: `As partners: ${recText(rt)} in ${together.length} match${together.length === 1 ? "" : "es"}, newest first`, rows: together.slice(0, 5).map(row), ...(together.length > 5 ? { more: `Showing 5 of ${together.length}` } : {}) }] : [];
  if (!met.length) {
    return { ...base, none: `${whoOf(a)} and ${whoOf(b)} have never played each other${where}.`, blocks: togetherBlock };
  }
  const lead = r.wins === r.losses ? `Even, ${r.wins}–${r.losses}` : r.wins > r.losses ? `${a.number} leads ${r.wins}–${r.losses}` : `${b.number} leads ${r.losses}–${r.wins}`;
  return {
    ...base,
    headline: opts.wins
      ? { value: `${r.wins} win${r.wins === 1 ? "" : "s"}`, label: `for ${a.number} in ${met.length} meeting${met.length === 1 ? "" : "s"} with ${b.number} (${recText(r)})`, sub: `Last met ${met[0].label} at ${met[0].event}, ${seasonLabel(met[0].season)}`, href: row(met[0]).href }
      : { value: lead, label: `${met.length} meeting${met.length === 1 ? "" : "s"}${r.ties ? `, ${r.ties} tied` : ""}`, sub: `Last met ${met[0].label} at ${met[0].event}, ${seasonLabel(met[0].season)}`, href: row(met[0]).href },
    blocks: [
      { kind: "kpis", items: [
        { label: `${a.number} wins`, value: String(r.wins), href: teamHref(a.number), tone: r.wins > r.losses ? "good" : undefined },
        { label: `${b.number} wins`, value: String(r.losses), href: teamHref(b.number), tone: r.losses > r.wins ? "good" : undefined },
        { label: "As partners", value: String(together.length), sub: together.length ? recText(rt) : undefined },
      ] },
      { kind: "record", title: `${a.number}'s record against ${b.number}`, ...r },
      { kind: "matches", title: "Meetings, newest first", rows: met.slice(0, LIST_CAP).map(row), ...(met.length > LIST_CAP ? { more: `Showing ${LIST_CAP} of ${met.length}` } : {}) },
      ...togetherBlock,
    ],
  };
}



/** The season a compare card reads when none is named (seasonRows' choice). */
export async function compareSeason(teams: number[]): Promise<number | null> {
  return (await seasonRows(teams, null)).season;
}

/** Every team's row for the season named, else for the latest completed season (../season.ts) when all of them played
 *  it, else the latest season all of them played (said so). */
async function seasonRows(teams: number[], season: number | null): Promise<PickedSeason> {
  const rows = await all<SeasonRow>(`SELECT ${SEASON_COLS} FROM team_season_stats WHERE team IN (${teams.map(() => "?").join(",")}) AND matches > 0${season != null ? " AND season = ?" : ""} ORDER BY season DESC`, season != null ? [...teams, season] : teams);
  return pickSeasonRows(teams, rows, season, currentSeason());
}

/** Both teams' rows (seasonRows for two). */
async function bothSeasons(a: number, b: number, season: number | null): Promise<{ season: number | null; why?: string; ra?: SeasonRow; rb?: SeasonRow }> {
  const s = await seasonRows([a, b], season);
  return { season: s.season, why: s.why, ra: s.rows[0], rb: s.rows[1] };
}

/** OPR, the prediction rating, the better record, or the win-chance question: two teams' season numbers side by side. */
export async function seasonSideBySide(id: TwoTeamId, a: AnswerTeam, b: AnswerTeam, scope: Scope): Promise<StatAnswer> {
  const s = await bothSeasons(a.number, b.number, scope.season);
  const sc: Scope = { ...scope, season: s.season };
  const phrase = s.season != null ? ` in ${seasonLabel(s.season)}` : "";
  const what = id === "opr-vs" ? "OPR" : id === "better-record" ? "Better record" : id === "win-chance" ? "Win chance" : "Prediction rating";
  const title = id === "better-record" ? `Better record: ${a.number} or ${b.number}${phrase}` : `${what}: ${a.number} vs ${b.number}${phrase}`;
  const base = { family: "two-team" as const, intent: id, title, team: a, teams: [a, b], scope: scopeChips(sc), definition: `${id === "better-record" ? RECORD_VERDICT : SEASON_RULE}${s.why ? ` ${s.why}` : ""}`, source: s.season != null ? `From both teams' ${seasonLabel(s.season)} season numbers` : "No season both teams played" };
  const { ra, rb } = s;
  if (!ra || !rb) {
    const missing = [!ra ? whoOf(a) : "", !rb ? whoOf(b) : ""].filter(Boolean).join(" and ");
    return { ...base, blocks: [], none: s.season == null ? `${whoOf(a)} and ${whoOf(b)} have no season they both played.` : `No ${seasonLabel(s.season)} matches on record for ${missing}.` };
  }
  // Predict covers 2023–24 on; an older season is Compare only.
  const predict: StatBlock = { kind: "links", title: "Try it", items: [...(isLegacy(s.season!) ? [] : [{ label: "Open in Predict", href: predictHref({ mode: "match", season: s.season!, red: [a.number], blue: [b.number] }) }]), { label: "Compare side by side", href: `/compare?teams=${[a.number, b.number].sort((x, y) => x - y).join(",")}&season=${s.season}` }] };

  if (id === "better-record") {
    const rA: Rec = { wins: ra.wins, losses: ra.losses, ties: ra.ties }, rB: Rec = { wins: rb.wins, losses: rb.losses, ties: rb.ties };
    // The win rate on its own scale, 0 to 100%; the records and matches played as the context line.
    const block = compareBlock("Win rate", [a, b], [
      { label: "Win rate", total: true, values: [rateOf(rA), rateOf(rB)], max: 1, show: (v) => (v == null ? "–" : `${Math.round(100 * v)}%`), better: "higher", gap: (g) => `+${Math.round(100 * g)}%` },
    ], s.season, "100%");
    const rows = block.kind === "compare" ? block.rows : [];
    return {
      ...base,
      headline: leadHeadline([a, b], rows[0], [`${recText(rA)} in ${played(rA)} matches`, `${recText(rB)} in ${played(rB)}`], rows[0].best != null ? teamHref([a, b][rows[0].best].number, s.season) : undefined),
      blocks: [block, predict],
    };
  }

  const opr = id === "opr-vs";
  const vals = (r: SeasonRow) => (opr ? [r.opr_np, r.opr_auto, r.opr_teleop, r.opr_endgame] : [r.rating_np, r.rating_auto, r.rating_teleop, r.rating_endgame]);
  const [va, vb] = [vals(ra), vals(rb)];
  if (va[0] == null || vb[0] == null) {
    const missing = [va[0] == null ? whoOf(a) : "", vb[0] == null ? whoOf(b) : ""].filter(Boolean).join(" and ");
    return { ...base, blocks: [], none: `No ${opr ? "OPR" : "prediction rating"} for ${missing} in ${seasonLabel(s.season!)} yet.` };
  }
  // A row per phase, each on the season's own scale from zero (the highest any team reached, rounded up); the world
  // ranks go in the context line, said once.
  const cols = (opr ? ["opr_np", "opr_auto", "opr_teleop", "opr_endgame"] : ["rating_np", "rating_auto", "rating_teleop", "rating_endgame"]) as StatColumn[];
  const scale = await seasonScale(s.season!, cols);
  const bars: StatBlock = compareBlock(opr ? "OPR" : "Prediction rating", [a, b], (["Total", "Auto", "TeleOp", "Endgame"] as const).map((label, i) => ({ label, total: i === 0, values: [va[i], vb[i]], max: scale[cols[i]], better: "higher" as const })), s.season, `the ${seasonLabel(s.season!)} high, rounded up`);
  const rows = bars.kind === "compare" ? bars.rows : [];
  const rankText = (r: SeasonRow) => (opr ? (r.rank_np ? `#${r.rank_np.toLocaleString("en-US")} of ${(r.ranked_teams ?? 0).toLocaleString("en-US")}` : "unranked") : r.rating_rank ? `#${r.rating_rank.toLocaleString("en-US")} worldwide` : "unranked");
  const context = [rankText(ra), rankText(rb), decidedText(rows), opr ? null : `±${Math.round(ra.rating_sd ?? 0)} and ±${Math.round(rb.rating_sd ?? 0)} uncertainty`];
  const lead = rows[0].best != null ? teamHref([a, b][rows[0].best].number, s.season) : undefined;
  if (id === "win-chance") {
    // FTC matches are two alliances, never one team against another: the ratings say who is stronger, and Predict works
    // out a real match's chances once its alliances are set.
    return {
      ...base,
      headline: leadHeadline([a, b], rows[0], context, lead),
      blocks: [bars, predict],
      definition: `${SEASON_RULE} No one-on-one win chance is given: every FTC match is two alliances against each other, so Predict works it out for any lineup.${s.why ? ` ${s.why}` : ""}`,
    };
  }
  return { ...base, headline: leadHeadline([a, b], rows[0], context, lead), blocks: [bars, predict] };
}

type Tally = { team: number; ms: TeamMatch[] };
const tally = (ms: TeamMatch[], side: "partners" | "opponents"): Tally[] => {
  const g = new Map<number, TeamMatch[]>();
  for (const m of ms) for (const t of m[side]) g.set(t, [...(g.get(t) ?? []), m]);
  return [...g.entries()].map(([team, xs]) => ({ team, ms: xs }));
};

/** The alliance's own points in a match (without the other alliance's penalties, as records count them). */
const ownPoints = (m: TeamMatch) => m.ownNp ?? m.own;
/** A partner's best match together: the highest own points, the earlier on a tie (the first to reach it). */
const bestTogether = (x: Tally): TeamMatch => x.ms.reduce((b, m) => (ownPoints(m) > ownPoints(b) || (ownPoints(m) === ownPoints(b) && String(m.date ?? "") < String(b.date ?? "")) ? m : b));

/** The best alliance partner: the partner the team scored the most with together, its best match named, the
 *  matches together and the record together beside it. */
async function bestPartnerAnswer(team: AnswerTeam, ms: TeamMatch[], scope: Scope): Promise<StatAnswer> {
  const where = scopePhrase(scope);
  const recent = (x: Tally) => String(x.ms[0]?.date ?? "");
  const ranked = tally(ms, "partners").map((x) => ({ ...x, best: bestTogether(x) }))
    .sort((x, y) => ownPoints(y.best) - ownPoints(x.best) || y.ms.length - x.ms.length || rateOf(recOf(y.ms)) - rateOf(recOf(x.ms)) || recent(y).localeCompare(recent(x)));
  const base = {
    family: "two-team" as const, intent: "best-partner" as const, title: `Best alliance partner${where}`, team, scope: scopeChips(scope), source: sourceOf(ms),
    definition: `Best alliance partner: the partner the team scored the most points with on one alliance (the alliance's own points, without the other alliance's penalties; any number of matches together). A tie goes to more matches together, then the better record together. Matches at official events, both robots on the field. ${RECORD_RULE}`,
  };
  const top = ranked[0];
  if (!top) return { ...base, blocks: [], none: `No partner played with${where} found for ${whoOf(team)}.` };
  const links = await teamLinks(ranked.slice(0, TOP).map((x) => x.team));
  const name = (n: number) => links.get(n)?.label ?? String(n);
  const at = (m: TeamMatch) => `${m.label} at ${m.event}`;
  const r = recOf(top.ms);
  return {
    ...base,
    headline: { value: name(top.team), label: `${ownPoints(top.best)} points together in ${at(top.best)}, ${seasonLabel(top.best.season)}`, sub: `${recText(r)} together in ${top.ms.length} match${top.ms.length === 1 ? "" : "es"}`, href: matchHref(top.best) },
    blocks: [{
      kind: "table", title: `Top ${Math.min(TOP, ranked.length)}, by the highest score together`,
      columns: [{ key: "team", label: "Team" }, { key: "best", label: "Best score together", num: true }, { key: "match", label: "Match" }, { key: "n", label: "Together", num: true }, { key: "record", label: "W-L-T together" }],
      rows: ranked.slice(0, TOP).map((x) => ({ cells: { team: name(x.team), best: ownPoints(x.best), match: at(x.best), n: x.ms.length, record: recText(recOf(x.ms)) }, href: teamHref(x.team), strong: x === top })),
    }],
  };
}

/** Most played or toughest opponent, best or most frequent partner. */
export async function opponentsAnswer(id: IntentId, team: AnswerTeam, msAll: TeamMatch[], scope: Scope): Promise<StatAnswer> {
  const ms = counted(msAll, scope);
  if (id === "best-partner") return bestPartnerAnswer(team, ms, scope);
  const partners = id === "frequent-partner";
  const where = scopePhrase(scope);
  const t = tally(ms, partners ? "partners" : "opponents");
  // From the team's side: an opponent's record against it is the team's losses-wins-ties.
  const theirs = (x: Tally): Rec => { const r = recOf(x.ms); return partners ? r : { wins: r.losses, losses: r.wins, ties: r.ties }; };
  const recent = (x: Tally) => String(x.ms[0]?.date ?? "");
  const ranked = id === "toughest-opponent"
    ? t.filter((x) => x.ms.length >= MIN_MEETINGS).sort((x, y) => rateOf(theirs(y)) - rateOf(theirs(x)) || y.ms.length - x.ms.length || recent(y).localeCompare(recent(x)))
    : t.sort((x, y) => y.ms.length - x.ms.length || rateOf(theirs(y)) - rateOf(theirs(x)) || recent(y).localeCompare(recent(x)));
  const titles: Record<string, string> = { "most-played-opponent": "Most played opponent", "toughest-opponent": "Toughest opponent", "best-partner": "Best alliance partner", "frequent-partner": "Most frequent partner" };
  const rules: Record<string, string> = {
    "most-played-opponent": "Most played opponent: the team met most often on the other alliance (a tie goes to the better record against the team).",
    "toughest-opponent": `Toughest opponent: of the opponents met ${MIN_MEETINGS} times or more, the one with the best record against the team (wins over meetings; a tie goes to more meetings).`,
    "frequent-partner": "Most frequent partner: the team played with most often on the same alliance (a tie goes to the better record together).",
  };
  const title = `${titles[id]}${where}`;
  const base = { family: "two-team" as const, intent: id, title, team, scope: scopeChips(scope), definition: `${rules[id]} Matches at official events, both robots on the field. ${RECORD_RULE}`, source: sourceOf(ms) };
  const top = ranked[0];
  if (!top) {
    const need = id === "toughest-opponent" ? ` ${MIN_MEETINGS} or more times` : "";
    return { ...base, blocks: [], none: `No ${partners ? "partner played with" : "opponent met"}${need}${where} found for ${whoOf(team)}.` };
  }
  const links = await teamLinks(ranked.slice(0, TOP).map((x) => x.team));
  const name = (n: number) => links.get(n)?.label ?? String(n);
  const r = theirs(top);
  const label = partners ? `${recText(r)} together in ${top.ms.length} match${top.ms.length === 1 ? "" : "es"}` : `met ${top.ms.length} time${top.ms.length === 1 ? "" : "s"}, ${recText(r)} against ${team.number}`;
  return {
    ...base,
    headline: { value: name(top.team), label, sub: `Last ${partners ? "together" : "met"} ${top.ms[0].label} at ${top.ms[0].event}, ${seasonLabel(top.ms[0].season)}`, href: teamHref(top.team) },
    blocks: [{
      kind: "table", title: `Top ${Math.min(TOP, ranked.length)}`,
      columns: [{ key: "team", label: "Team" }, { key: "n", label: partners ? "Together" : "Met", num: true }, { key: "record", label: partners ? "W-L-T together" : `W-L-T vs ${team.number}` }, { key: "rate", label: "Win rate", num: true }],
      rows: ranked.slice(0, TOP).map((x) => ({ cells: { team: name(x.team), n: x.ms.length, record: recText(theirs(x)), rate: pct(theirs(x)) }, href: teamHref(x.team), strong: x === top })),
    }],
  };
}

/** Teams from the team's state that played that season and that it never met as an opponent. */
export async function neverPlayedAnswer(team: AnswerTeam, msAll: TeamMatch[], scope: Scope): Promise<StatAnswer> {
  const home = await get<{ state: string | null; country: string | null }>("SELECT state, country FROM teams WHERE number = ?", [team.number]);
  const season = scope.season;
  const sc: Scope = { ...scope, season };
  const title = `Teams ${team.number} never played${season != null ? ` in ${seasonLabel(season)}` : ""}`;
  const where = home?.state ? `${home.state}${home.country ? `, ${home.country}` : ""}` : null;
  const base = { family: "two-team" as const, intent: "never-played", title, team, scope: scopeChips(sc), definition: `Teams never played: teams from ${where ?? "the team's state"} with matches at official events that season, never met as an opponent in any recorded match (every season, official or not). Ordered by the season's OPR rank.`, source: "" };
  if (!home?.state || season == null) return { ...base, blocks: [], source: "No state or season on record", none: `No ${!home?.state ? "state" : "season with matches"} on record for ${whoOf(team)}.` };
  // Only matches the team took the field in: a playoff it sat out never met anyone.
  const met = new Set(msAll.filter((m) => m.onField).flatMap((m) => m.opponents));
  const peers = await all<{ number: number; name: string | null; opr_np: number | null; rank_np: number | null }>(
    `SELECT t.number, t.name, s.opr_np, s.rank_np FROM team_season_stats s JOIN teams t ON t.number = s.team
     WHERE s.season = ? AND s.matches > 0 AND t.state = ?
       AND EXISTS (SELECT 1 FROM team_event_stats es JOIN events e ON e.season = es.season AND e.code = es.code
                   WHERE es.team = s.team AND es.season = s.season AND es.matches > 0 AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(",")})) AND COALESCE(t.country, '') = COALESCE(?, '') AND t.number <> ?
     ORDER BY s.rank_np IS NULL, s.rank_np, t.number`, [season, home.state, ...OFFICIAL_TYPES, home.country, team.number]);
  const never = peers.filter((p) => !met.has(Number(p.number)));
  const out = { ...base, source: `${peers.length} ${home.state} teams with matches in ${seasonLabel(season)}` };
  if (!peers.length) return { ...out, blocks: [], none: `No other ${home.state} teams with matches in ${seasonLabel(season)}.` };
  if (!never.length) return { ...out, blocks: [], none: `${whoOf(team)} has played against every ${home.state} team with matches in ${seasonLabel(season)}.` };
  return {
    ...out,
    headline: { value: `${never.length} team${never.length === 1 ? "" : "s"}`, label: `of ${peers.length} ${home.state} teams in ${seasonLabel(season)} never met`, sub: `Met ${peers.length - never.length}` },
    blocks: [{
      kind: "table", title: "Never met, by season OPR rank", columns: [{ key: "team", label: "Team" }, { key: "opr", label: "OPR", num: true }, { key: "rank", label: "OPR rank", num: true }],
      rows: never.slice(0, LIST_CAP).map((p) => ({ cells: { team: p.name ? `${p.number} ${p.name}` : String(p.number), opr: num1(p.opr_np), rank: p.rank_np ? `#${p.rank_np}` : "–" }, href: teamHref(Number(p.number), season) })),
      ...(never.length > LIST_CAP ? { more: `Showing ${LIST_CAP} of ${never.length}` } : {}),
    }],
  };
}

const PHASE_NAME = { auto: "Auto", teleop: "TeleOp", endgame: "Endgame" } as const;
const PHASE_RULE = "Each phase's OPR is the team's season number for that phase (the points it adds to its alliance in that phase, without penalties), as its team page shows it. The better team is the higher one.";

/** "12345 vs 67890 who is better at auto": both teams' season OPR for the phase, the team page's tiles, the higher named. */
export async function phaseSideBySide(phase: "auto" | "teleop" | "endgame", a: AnswerTeam, b: AnswerTeam, scope: Scope): Promise<StatAnswer> {
  const s = await bothSeasons(a.number, b.number, scope.season);
  const P = PHASE_NAME[phase];
  const phrase = s.season != null ? ` in ${seasonLabel(s.season)}` : "";
  const base = { family: "two-team" as const, intent: "phase-vs", title: `${P}: ${a.number} vs ${b.number}${phrase}`, team: a, teams: [a, b], scope: scopeChips({ ...scope, season: s.season }), definition: `${PHASE_RULE}${s.why ? ` ${s.why}` : ""}`, source: s.season != null ? `From both teams' ${seasonLabel(s.season)} season numbers` : "No season both teams played" };
  const v = (r?: SeasonRow) => (r ? r[`opr_${phase}`] : null), rk = (r?: SeasonRow) => (r ? r[`rank_${phase}`] : null);
  const va = v(s.ra), vb = v(s.rb);
  if (va == null || vb == null) return { ...base, blocks: [], none: s.season == null ? `${whoOf(a)} and ${whoOf(b)} have no season they both played.` : `No ${seasonLabel(s.season)} ${P} OPR for ${[va == null ? whoOf(a) : "", vb == null ? whoOf(b) : ""].filter(Boolean).join(" and ")}.` };
  const col = `opr_${phase}` as StatColumn;
  const scale = await seasonScale(s.season!, [col]);
  const block = compareBlock(`${P} OPR`, [a, b], [{ label: P, total: true, values: [va, vb], max: scale[col], better: "higher" }], s.season, `the ${seasonLabel(s.season!)} high, rounded up`);
  const rows = block.kind === "compare" ? block.rows : [];
  const rankText = (r?: SeasonRow) => (rk(r) ? `#${rk(r)!.toLocaleString("en-US")} of ${(r!.ranked_teams ?? 0).toLocaleString("en-US")} in ${P}` : `unranked in ${P}`);
  return {
    ...base,
    headline: leadHeadline([a, b], rows[0], [rankText(s.ra), rankText(s.rb)], rows[0].best != null ? teamHref([a, b][rows[0].best].number, s.season) : undefined),
    blocks: [block],
  };
}

const PEN_RULE = "Penalties a match: the penalty points the robot alone gives away a match, its prediction rating's estimate as each team page shows it (fewer is better); beside it, the points its alliances gave away a match. Rated once 3 matches are rated.";

/** "Who has better penalties, 12345 or 67890": both teams' season penalty points given away a match, fewer named. */
export async function penaltiesSideBySide(a: AnswerTeam, b: AnswerTeam, scope: Scope): Promise<StatAnswer> {
  const s = await bothSeasons(a.number, b.number, scope.season);
  const phrase = s.season != null ? ` in ${seasonLabel(s.season)}` : "";
  const base = { family: "two-team" as const, intent: "penalties-vs", title: `Penalties: ${a.number} vs ${b.number}${phrase}`, team: a, teams: [a, b], scope: scopeChips({ ...scope, season: s.season }),
    definition: `${PEN_RULE}${s.why ? ` ${s.why}` : ""}`, source: s.season != null ? `From both teams' ${seasonLabel(s.season)} matches` : "No season both teams played" };
  if (s.season == null) return { ...base, blocks: [], none: `${whoOf(a)} and ${whoOf(b)} have no season they both played.` };
  const rows = await all<{ team: number; rating_pen: number | null; avg_pen: number | null; rating_matches: number | null }>(
    "SELECT team, rating_pen, avg_pen, rating_matches FROM team_season_stats WHERE season = ? AND team IN (?, ?)", [s.season, a.number, b.number]);
  const of = (t: number) => rows.find((r) => Number(r.team) === t);
  const ra = of(a.number), rb = of(b.number);
  const rated = (r?: (typeof rows)[number]) => r?.rating_pen != null && Number(r.rating_matches ?? 0) >= 3;
  if (!rated(ra) || !rated(rb)) return { ...base, blocks: [], none: `No ${seasonLabel(s.season)} penalty estimate for ${[!rated(ra) ? whoOf(a) : "", !rated(rb) ? whoOf(b) : ""].filter(Boolean).join(" and ")} yet.` };
  const scale = await seasonScale(s.season, ["rating_pen", "avg_pen"]);
  const fewer = (g: number) => `${g.toFixed(1)} fewer`;
  const block = compareBlock("Penalty points given away a match", [a, b], [
    { label: "Robot's own", total: true, values: [ra!.rating_pen, rb!.rating_pen], max: scale.rating_pen, better: "lower", gap: fewer },
    { label: "Its alliances'", values: [ra!.avg_pen, rb!.avg_pen], max: scale.avg_pen, better: "lower", gap: fewer },
  ], s.season, `the ${seasonLabel(s.season)} high, rounded up`);
  const crow = block.kind === "compare" ? block.rows : [];
  return {
    ...base,
    headline: leadHeadline([a, b], crow[0], ["fewer is better"], crow[0].best != null ? teamHref([a, b][crow[0].best].number, s.season) : undefined),
    blocks: [block],
  };
}

type Reliability = NonNullable<Awaited<ReturnType<typeof teamReliability>>>;
/** Reliability's rows: the index on its own 0–100 scale, then the parts that count against a team (fewer is better),
 *  values only: four, so the card keeps five rows. */
export function reliabilityRows(rs: Reliability[]): CompareInput[] {
  const parts: [string, (r: Reliability) => number, (r: Reliability) => string][] = [
    ["No-shows and DQs", (r) => r.noShows + r.dqs, (r) => String(r.noShows + r.dqs)],
    ["Near-zero matches", (r) => r.nearZero, (r) => String(r.nearZero)],
    ["Swing", (r) => r.parts.swing, (r) => r.parts.swing.toFixed(2)],
    ["Penalties vs field", (r) => r.parts.penaltyRatio, (r) => `${r.parts.penaltyRatio.toFixed(2)}×`],
  ];
  return [
    { label: "Reliability", total: true, values: rs.map((r) => r.index), max: 100, show: (v) => String(v ?? "–"), better: "higher", gap: (g) => `+${Math.round(g)}` },
    // The gap says which way is better: "4 fewer", "0.10 lower".
    ...parts.map(([label, v, show]): CompareInput => ({ label, values: rs.map(v), show: (_, i) => show(rs[i]), better: "lower", gap: (g) => (Number.isInteger(g) ? `${g} fewer` : `${g.toFixed(2)} lower`) })),
  ];
}

/** "12345 vs 67890 who has higher reliability": both teams' stored season reliability (the team page's), the higher named. */
export async function reliabilitySideBySide(a: AnswerTeam, b: AnswerTeam, scope: Scope): Promise<StatAnswer> {
  const s = await bothSeasons(a.number, b.number, scope.season);
  const phrase = s.season != null ? ` in ${seasonLabel(s.season)}` : "";
  const base = { family: "two-team" as const, intent: "reliability-vs", title: `Reliability: ${a.number} vs ${b.number}${phrase}`, team: a, teams: [a, b], scope: scopeChips({ ...scope, season: s.season }),
    definition: `Reliability (0–100, higher = more dependable), as each team page shows it: from public match data only (no-shows, disqualifications, near-zero matches, how much its contribution swings, penalties given away and how far its scores land from the engine's calls).${s.why ? ` ${s.why}` : ""}`, source: s.season != null ? `From both teams' ${seasonLabel(s.season)} qualification matches` : "No season both teams played" };
  if (s.season == null) return { ...base, blocks: [], none: `${whoOf(a)} and ${whoOf(b)} have no season they both played.` };
  const [ra, rb] = await Promise.all([teamReliability(s.season, a.number), teamReliability(s.season, b.number)]);
  if (!ra || !rb) return { ...base, blocks: [], none: `No ${seasonLabel(s.season)} reliability for ${[!ra ? whoOf(a) : "", !rb ? whoOf(b) : ""].filter(Boolean).join(" and ")} yet.` };
  const block = compareBlock("Reliability", [a, b], reliabilityRows([ra, rb]), s.season, "100");
  const rows = block.kind === "compare" ? block.rows : [];
  return {
    ...base,
    headline: leadHeadline([a, b], rows[0], [`${ra.matches} and ${rb.matches} qualification matches`, ra.fieldIndex != null ? `field average ${ra.fieldIndex}` : null], rows[0].best != null ? teamHref([a, b][rows[0].best].number, s.season) : undefined),
    blocks: [block],
  };
}

/** "12345 vs 67890 who has won more awards": every award each team won, every season, as its team page's Awards counts them. */
export async function awardsSideBySide(a: AnswerTeam, b: AnswerTeam, season: number | null = null): Promise<StatAnswer> {
  const rows = await all<{ team: number; season: number; n: number }>(`SELECT a.team, a.season, COUNT(*) n FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code WHERE a.team IN (?, ?)${season != null ? " AND a.season = ?" : ""} GROUP BY a.team, a.season`, season != null ? [a.number, b.number, season] : [a.number, b.number]);
  const where = season != null ? seasonLabel(season) : "all seasons";
  const total = (t: number) => rows.filter((r) => Number(r.team) === t).reduce((x, r) => x + Number(r.n), 0);
  const na = total(a.number), nb = total(b.number), ahead = na >= nb ? a : b;
  const seasons = [...new Set(rows.map((r) => Number(r.season)))].sort((x, y) => y - x);
  const of = (t: number, s: number) => Number(rows.find((r) => Number(r.team) === t && Number(r.season) === s)?.n ?? 0);
  const count = (n: number) => `${n} award${n === 1 ? "" : "s"}`;
  // The total on the scale of the most awards any team has won (that season, or in all seasons), then the seasons
  // with the largest gaps on each season's own scale: five rows at most.
  const [allMax, ...seasonMax] = await Promise.all([awardScale(season), ...seasons.map((x) => awardScale(x))]);
  const block = compareBlock("Awards", [a, b], [
    { label: "Total", total: true, values: [na, nb], max: allMax, show: (v) => String(v ?? 0), better: "higher", gap: (g) => `+${g}` },
    ...(seasons.length > 1 ? seasons.map((x, i) => ({ label: seasonLabel(x), values: [of(a.number, x), of(b.number, x)], max: seasonMax[i], show: (v: number | null | undefined) => String(v ?? 0), better: "higher" as const, gap: (g: number) => `+${g}` })) : []),
  ], null, "the most any team has won, rounded up");
  if (block.kind === "compare" && block.rows.length > 5) block.rows = block.rows.slice(0, 5);
  const crow = block.kind === "compare" ? block.rows : [];
  return {
    family: "two-team", intent: "awards-vs", title: `Awards: ${a.number} vs ${b.number}${season != null ? ` in ${where}` : ""}`, team: a, teams: [a, b], scope: [season != null ? where : "All seasons"],
    definition: "Every award in the events' published awards, the season named or every season we cover, as each team page's Awards section counts them (an alliance award counts once for each of its teams).", source: `From ${na + nb} award records`,
    headline: na === nb ? { value: "Even", label: `${count(na)} each` } : leadHeadline([a, b], crow[0], [seasons.length > 4 ? `${crow.length - 1} of ${seasons.length} seasons shown, largest gaps first` : seasons.length > 1 ? `${seasons.length} seasons` : null], na === nb ? undefined : `${teamHref(ahead.number)}#awards`),
    blocks: [block],
  };
}

/** "12345 vs 67890 compare", "12345 67890 33950 compare": the teams' season numbers in one card (src/shared/searchVersus.ts
 *  compareStat, which the event pack runs with no signal too), from their stored season rows and the season's scales. */
export async function compareAnswer(teams: AnswerTeam[], scope: Scope): Promise<StatAnswer> {
  const s = await seasonRows(teams.map((t) => t.number), scope.season);
  const scale = s.season != null && !teams.some((_, i) => !s.rows[i]) ? await seasonScale(s.season, COMPARE_SCALE_COLS) : {};
  return compareStat(teams, scope, s, scale, isLegacy);
}

const PARTNER_IDS = new Set<IntentId>(["worst-partner", "partners", "partner-top-opr", "partner-win-rate", "pick-partner"]);
/** Season OPR answers: a season is needed. */
const OPR_IDS = new Set<IntentId>(["partner-top-opr", "opponent-top-opr", "pick-partner"]);
const LIST_RULES: Partial<Record<IntentId, string>> = {
  "worst-partner": `Worst alliance partner: of the partners played with ${MIN_MEETINGS} times or more, the one with the worst record together (wins over matches; a tie goes to more matches).`,
  partners: "Alliance partners: every team played with on the same alliance, most matches first.",
  opponents: "Opponents: every team met on the other alliance, most meetings first.",
  "beat-most": "Teams beaten most often: opponents by how many times the team beat them (a tie goes to fewer meetings).",
  "lost-to-most": "Teams lost to most often: opponents by how many times they beat the team (a tie goes to fewer meetings).",
  "partner-top-opr": "Partner with the highest combined OPR: each partner's season OPR added to the team's own (both as their team pages show them), highest first.",
  "opponent-top-opr": "Highest-OPR opponent: the opponents met, by their season OPR as their team pages show it, highest first.",
  "partner-win-rate": "Win rate with alliance partners: the team's record in the matches it played with a partner, and with each partner.",
  "opponent-win-rate": "Opponents' win rate against the team: the meetings its opponents won, over all the meetings, and each opponent's own.",
  "pick-partner": "Pick suggestion: of the partners played with 2 times or more that season, the best record together, then the higher season OPR. It reads past partnerships only: who is at an event, and who is still free to pick, is that event's own.",
};
const LIST_TITLES: Partial<Record<IntentId, string>> = { "worst-partner": "Worst alliance partner", partners: "Alliance partners", opponents: "Opponents", "beat-most": "Teams beaten most often", "lost-to-most": "Teams lost to most often", "partner-top-opr": "Partner with the highest combined OPR", "opponent-top-opr": "Highest-OPR opponent", "partner-win-rate": "Win rate with alliance partners", "opponent-win-rate": "Opponents' win rate against them", "pick-partner": "Who to pick as an alliance partner" };

/** Season OPR of each team, read from the stored rows (the team page's). */
async function oprsOf(season: number, teams: number[]): Promise<Map<number, { opr: number | null; rank: number | null }>> {
  if (!teams.length) return new Map();
  const rows = await all<{ team: number; opr_np: number | null; rank_np: number | null }>(`SELECT team, opr_np, rank_np FROM team_season_stats WHERE season = ? AND team IN (${teams.map(() => "?").join(",")})`, [season, ...teams]);
  return new Map(rows.map((r) => [Number(r.team), { opr: r.opr_np == null ? null : Number(r.opr_np), rank: r.rank_np == null ? null : Number(r.rank_np) }]));
}

const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : /(?:ch|sh|s|x)$/.test(w) ? "es" : "s"}`;

/** The team's partners and opponents beyond the four above: the lists, the worst partner, teams beaten most and lost
 *  to most, partners and opponents by season OPR, win rates with partners and against opponents, and a pick. */
export async function partnerListAnswer(id: IntentId, team: AnswerTeam, msAll: TeamMatch[], scope: Scope): Promise<StatAnswer> {
  const ms = counted(msAll, scope);
  // Season OPR: the season named, else the named event's (its meetings still only that event's).
  const oprSeason = scope.season ?? scope.event?.season ?? null;
  const partners = PARTNER_IDS.has(id);
  const where = scopePhrase(scope);
  const t = tally(ms, partners ? "partners" : "opponents");
  const base = { family: "two-team" as const, intent: id, title: `${LIST_TITLES[id]}${where}`, team, scope: scopeChips(scope), definition: `${LIST_RULES[id]} Matches at official events, both robots on the field. ${RECORD_RULE}`, source: sourceOf(ms) };
  if (OPR_IDS.has(id) && oprSeason == null) return { ...base, blocks: [], none: "Season OPR needs one season: name one (for example 2025-26)." };
  // The team's own record with (or against) each; an opponent's own record against the team is its mirror.
  const rec = (x: Tally): Rec => recOf(x.ms);
  const theirs = (x: Tally): Rec => { const r = recOf(x.ms); return partners ? r : { wins: r.losses, losses: r.wins, ties: r.ties }; };
  const recent = (x: Tally) => String(x.ms[0]?.date ?? "");
  const oprs = OPR_IDS.has(id) ? await oprsOf(oprSeason!, [team.number, ...t.map((x) => x.team)]) : new Map<number, { opr: number | null; rank: number | null }>();
  const oprOf = (n: number) => oprs.get(n)?.opr ?? null;
  const own = oprOf(team.number);
  // Both OPRs or no total: a missing one is never counted as zero.
  const sum = (n: number) => { const o = oprOf(n); return own != null && o != null ? own + o : null; };
  const byOpr = (x: Tally, y: Tally) => (oprOf(y.team) ?? -Infinity) - (oprOf(x.team) ?? -Infinity);
  const ranked =
    id === "worst-partner" ? t.filter((x) => x.ms.length >= MIN_MEETINGS).sort((x, y) => rateOf(rec(x)) - rateOf(rec(y)) || y.ms.length - x.ms.length || recent(y).localeCompare(recent(x)))
    : id === "beat-most" ? t.filter((x) => rec(x).wins > 0).sort((x, y) => rec(y).wins - rec(x).wins || x.ms.length - y.ms.length || recent(y).localeCompare(recent(x)))
    : id === "lost-to-most" ? t.filter((x) => rec(x).losses > 0).sort((x, y) => rec(y).losses - rec(x).losses || x.ms.length - y.ms.length || recent(y).localeCompare(recent(x)))
    : id === "partner-top-opr" || id === "opponent-top-opr" ? t.filter((x) => oprOf(x.team) != null).sort((x, y) => byOpr(x, y) || y.ms.length - x.ms.length)
    : id === "pick-partner" ? t.filter((x) => x.ms.length >= 2).sort((x, y) => rateOf(rec(y)) - rateOf(rec(x)) || byOpr(x, y) || y.ms.length - x.ms.length)
    : t.sort((x, y) => y.ms.length - x.ms.length || rateOf(theirs(y)) - rateOf(theirs(x)) || recent(y).localeCompare(recent(x)));
  const top = ranked[0];
  if (!top) {
    const need = id === "worst-partner" ? ` ${MIN_MEETINGS} or more times` : id === "pick-partner" ? " 2 or more times" : "";
    const what = id === "beat-most" ? " that it beat" : id === "lost-to-most" ? " that beat it" : "";
    return { ...base, blocks: [], none: `No ${partners ? "partner played with" : "opponent met"}${need}${what}${where} found for ${whoOf(team)}.` };
  }
  const list = id === "partners" || id === "opponents";
  // The two full lists keep every team (a season's opponents run to a few dozen); the rest show their top rows.
  const shown = list ? ranked : ranked.slice(0, LIST_CAP);
  const links = await teamLinks(shown.map((x) => x.team));
  const name = (n: number) => links.get(n)?.label ?? String(n);
  const eventsOf = (x: Tally) => { const es = [...new Set(x.ms.map((m) => m.event))]; return es.slice(0, 3).join(", ") + (es.length > 3 ? ", …" : ""); };
  const last = (x: Tally) => `Last ${partners ? "together" : "met"} ${x.ms[0].label} at ${x.ms[0].event}, ${seasonLabel(x.ms[0].season)}`;
  const recCol = { key: "record", label: partners ? "W-L-T together" : `W-L-T for ${team.number}` };
  const nCol = { key: "n", label: partners ? "Together" : "Met", num: true };
  const more = ranked.length > shown.length ? { more: `Showing ${shown.length} of ${ranked.length}` } : {};
  const row = (x: Tally, cells: Record<string, string | number | null>) => ({ cells: { team: name(x.team), ...cells }, href: teamHref(x.team, oprSeason), strong: x === top });

  if (id === "partner-win-rate" || id === "opponent-win-rate") {
    const whole = recOf(ms.filter((m) => (partners ? m.partners : m.opponents).length > 0));
    const said = partners ? whole : { wins: whole.losses, losses: whole.wins, ties: whole.ties };
    return {
      ...base,
      headline: { value: pct(said), label: partners ? `${team.number} won ${whole.wins} of ${plural(played(whole), "match")} with a partner${where}` : `opponents won ${whole.losses} of ${plural(played(whole), "match")} against ${team.number}${where}`, sub: `${team.number}: ${recText(whole)} · ${plural(t.length, partners ? "partner" : "opponent")}` },
      blocks: [
        { kind: "record", title: `${team.number}'s record${partners ? " with partners" : " against them"}${where}`, ...whole },
        { kind: "table", title: partners ? "By partner, most matches first" : "By opponent, most meetings first", columns: [{ key: "team", label: "Team" }, nCol, recCol, { key: "rate", label: partners ? "Win rate together" : "Their win rate", num: true }],
          rows: shown.map((x) => row(x, { n: x.ms.length, record: recText(rec(x)), rate: pct(theirs(x)) })), ...more },
      ],
    };
  }
  if (OPR_IDS.has(id)) {
    const S = seasonLabel(oprSeason!);
    const o = oprOf(top.team);
    const head = id === "partner-top-opr"
      ? { value: name(top.team), label: `combined OPR ${num1(sum(top.team))} (${num1(own)} + ${num1(o)}) in ${S}`, sub: `${recText(rec(top))} together in ${plural(top.ms.length, "match")}` }
      : id === "opponent-top-opr"
        ? { value: name(top.team), label: `OPR ${num1(o)} in ${S}${oprs.get(top.team)?.rank ? ` (#${oprs.get(top.team)!.rank})` : ""}`, sub: `Met ${plural(top.ms.length, "time")}, ${recText(rec(top))} for ${team.number}` }
        : { value: name(top.team), label: `${recText(rec(top))} together (${pct(rec(top))} wins) in ${plural(top.ms.length, "match")}${o != null ? ` · OPR ${num1(o)}` : ""}`, sub: `Why: the best record together of ${team.number}'s ${S} partners${ranked[1] ? `; next ${name(ranked[1].team)}, ${recText(rec(ranked[1]))}` : ""}` };
    return {
      ...base,
      headline: { ...head, href: teamHref(top.team, oprSeason) },
      blocks: [{ kind: "table", title: id === "pick-partner" ? "Past partners, best record together first" : id === "partner-top-opr" ? "Partners by combined OPR" : "Opponents by OPR",
        columns: [{ key: "team", label: "Team" }, { key: "opr", label: "OPR", num: true }, ...(id === "partner-top-opr" ? [{ key: "sum", label: "Combined", num: true }] : []), nCol, recCol],
        rows: shown.map((x) => row(x, { opr: num1(oprOf(x.team)), ...(id === "partner-top-opr" ? { sum: num1(sum(x.team)) } : {}), n: x.ms.length, record: recText(rec(x)) })), ...more }],
    };
  }
  if (list) {
    return {
      ...base,
      headline: { value: String(t.length), label: `${partners ? "alliance partners" : "opponents"} in ${plural(ms.length, "match")}${where}`, sub: `Most often: ${name(top.team)}, ${plural(top.ms.length, partners ? "match" : "meeting")}` },
      blocks: [{ kind: "table", title: "Most matches first", columns: [{ key: "team", label: "Team" }, nCol, recCol, { key: "events", label: scope.championship ? "Division" : "Events" }],
        rows: shown.map((x) => row(x, { n: x.ms.length, record: recText(rec(x)), events: eventsOf(x) })), ...more }],
    };
  }
  const lead = id === "beat-most" ? `beaten ${plural(rec(top).wins, "time")} in ${plural(top.ms.length, "meeting")}`
    : id === "lost-to-most" ? `beat ${team.number} ${plural(rec(top).losses, "time")} in ${plural(top.ms.length, "meeting")}`
    : `${recText(rec(top))} together in ${plural(top.ms.length, "match")}`;
  return {
    ...base,
    headline: { value: name(top.team), label: lead, sub: last(top), href: teamHref(top.team) },
    blocks: [{ kind: "table", title: `Top ${Math.min(TOP, ranked.length)}`, columns: [{ key: "team", label: "Team" }, nCol, recCol, { key: "rate", label: partners ? "Win rate together" : `${team.number} win rate`, num: true }],
      rows: ranked.slice(0, TOP).map((x) => row(x, { n: x.ms.length, record: recText(rec(x)), rate: pct(rec(x)) })) }],
  };
}
