// Family 6, two teams (the brief's "two-team set"): the matches a team played with or against another, read from the
// first team's match set (../matchSet.ts) under the scope clauses (../clauses.ts), and two teams' season numbers side
// by side from the stored season rows (team_season_stats: OPR and the prediction rating are never worked out here).
// The rules every answer below states:
//   Head to head: the matches the two teams played on opposite alliances, both robots on the field, at official
//     events; the record is the first team's, by the site's one record rule (src/shared/eventRecord.ts).
//   Toughest opponent: of the opponents met 3 times or more, the one with the best record against the team.
//   Best partner: of the partners played with 3 times or more, the one with the best record together.
//   Teams never played: teams from the team's state that played official matches that season, never met as an
//     opponent in any recorded match.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { RECORD_RULE } from "../../../../src/shared/eventRecord.js";
import { predictHref } from "../../../../src/shared/predictUrl.js";
import { isLegacy } from "../../../data/seasons.js";
import { all, get } from "../../../db.js";
import { OFFICIAL_TYPES, inScope, scopeChips, scopePhrase, type Scope } from "../clauses.js";
import { matchRow, teamHref, teamLinks, type TeamMatch } from "../matchSet.js";
import type { TwoTeamId, IntentId } from "../read.js";
import { sourceOf, whoOf, type AnswerTeam } from "./matches.js";

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

/** "A vs B head to head": the matches they met in, the record, and how often they were partners. */
export async function headToHead(a: AnswerTeam, b: AnswerTeam, msA: TeamMatch[], scope: Scope): Promise<StatAnswer> {
  const ms = counted(msA, scope);
  const met = ms.filter((m) => m.opponents.includes(b.number));
  const together = ms.filter((m) => m.partners.includes(b.number));
  const r = recOf(met), rt = recOf(together);
  const where = scopePhrase(scope);
  const title = `${a.number} vs ${b.number} head to head${where}`;
  const base = { family: "two-team" as const, intent: "head-to-head", title, team: a, scope: scopeChips(scope), definition: H2H_RULE, source: sourceOf(met.length ? met : ms) };
  const links = await teamLinks([...met, ...together].flatMap((m) => [...m.partners, ...m.opponents]).slice(0, 2000));
  const row = (m: TeamMatch) => ({ ...matchRow(m, links, a.number), ownNp: undefined });
  const togetherBlock: StatBlock[] = together.length ? [{ kind: "matches", title: `As partners: ${recText(rt)} in ${together.length} match${together.length === 1 ? "" : "es"}, newest first`, rows: together.slice(0, 5).map(row), ...(together.length > 5 ? { more: `Showing 5 of ${together.length}` } : {}) }] : [];
  if (!met.length) {
    return { ...base, none: `${whoOf(a)} and ${whoOf(b)} have never played each other${where}.`, blocks: togetherBlock };
  }
  const lead = r.wins === r.losses ? `Even, ${r.wins}–${r.losses}` : r.wins > r.losses ? `${a.number} leads ${r.wins}–${r.losses}` : `${b.number} leads ${r.losses}–${r.wins}`;
  return {
    ...base,
    headline: { value: lead, label: `${met.length} meeting${met.length === 1 ? "" : "s"}${r.ties ? `, ${r.ties} tied` : ""}`, sub: `Last met ${met[0].label} at ${met[0].event}, ${seasonLabel(met[0].season)}`, href: row(met[0]).href },
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

interface SeasonRow { team: number; season: number; opr_np: number | null; opr_auto: number | null; opr_teleop: number | null; opr_endgame: number | null; rank_np: number | null; ranked_teams: number | null; rating_np: number | null; rating_auto: number | null; rating_teleop: number | null; rating_endgame: number | null; rating_sd: number | null; rating_rank: number | null; matches: number; wins: number; losses: number; ties: number }

/** Both teams' rows for the season named, else the latest season both played (said so). */
async function bothSeasons(a: number, b: number, season: number | null): Promise<{ season: number | null; why?: string; ra?: SeasonRow; rb?: SeasonRow }> {
  const rows = await all<SeasonRow>("SELECT * FROM team_season_stats WHERE team IN (?, ?) AND matches > 0" + (season != null ? " AND season = ?" : "") + " ORDER BY season DESC", season != null ? [a, b, season] : [a, b]);
  const of = (t: number, s: number) => rows.find((r) => Number(r.team) === t && Number(r.season) === s);
  if (season != null) return { season, ra: of(a, season), rb: of(b, season) };
  const s = rows.map((r) => Number(r.season)).find((x) => of(a, x) && of(b, x));
  if (s == null) return { season: null };
  return { season: s, why: `The season is ${seasonLabel(s)}, the latest season both teams played.`, ra: of(a, s), rb: of(b, s) };
}

/** OPR, the prediction rating, the better record, or the win-chance question: two teams' season numbers side by side. */
export async function seasonSideBySide(id: TwoTeamId, a: AnswerTeam, b: AnswerTeam, scope: Scope): Promise<StatAnswer> {
  const s = await bothSeasons(a.number, b.number, scope.season);
  const sc: Scope = { ...scope, season: s.season };
  const phrase = s.season != null ? ` in ${seasonLabel(s.season)}` : "";
  const what = id === "opr-vs" ? "OPR" : id === "better-record" ? "Better record" : id === "win-chance" ? "Win chance" : "Prediction rating";
  const title = id === "better-record" ? `Better record: ${a.number} or ${b.number}${phrase}` : `${what}: ${a.number} vs ${b.number}${phrase}`;
  const base = { family: "two-team" as const, intent: id, title, team: a, scope: scopeChips(sc), definition: `${id === "better-record" ? RECORD_VERDICT : SEASON_RULE}${s.why ? ` ${s.why}` : ""}`, source: s.season != null ? `From both teams' ${seasonLabel(s.season)} season numbers` : "No season both teams played" };
  const { ra, rb } = s;
  if (!ra || !rb) {
    const missing = [!ra ? whoOf(a) : "", !rb ? whoOf(b) : ""].filter(Boolean).join(" and ");
    return { ...base, blocks: [], none: s.season == null ? `${whoOf(a)} and ${whoOf(b)} have no season they both played.` : `No ${seasonLabel(s.season)} matches on record for ${missing}.` };
  }
  // Predict covers 2023–24 on; an older season is Compare only.
  const predict: StatBlock = { kind: "links", title: "Try it", items: [...(isLegacy(s.season!) ? [] : [{ label: `Predict ${a.number} vs ${b.number}`, href: predictHref({ mode: "match", season: s.season!, red: [a.number], blue: [b.number] }) }]), { label: "Compare side by side", href: `/compare?teams=${[a.number, b.number].sort((x, y) => x - y).join(",")}&season=${s.season}` }] };

  if (id === "better-record") {
    const rA: Rec = { wins: ra.wins, losses: ra.losses, ties: ra.ties }, rB: Rec = { wins: rb.wins, losses: rb.losses, ties: rb.ties };
    const d = rateOf(rA) - rateOf(rB);
    const verdict = Math.abs(d) < 0.0005 ? "Even" : d > 0 ? whoOf(a) : whoOf(b);
    return {
      ...base,
      headline: { value: verdict, label: Math.abs(d) < 0.0005 ? `Both win ${pct(rA)} of their matches` : `${pct(d > 0 ? rA : rB)} win rate against ${pct(d > 0 ? rB : rA)}`, href: Math.abs(d) < 0.0005 ? undefined : teamHref(d > 0 ? a.number : b.number, s.season) },
      blocks: [
        { kind: "table", title: `Records, ${seasonLabel(s.season!)}`, columns: [{ key: "team", label: "Team" }, { key: "record", label: "W-L-T" }, { key: "rate", label: "Win rate", num: true }, { key: "n", label: "Matches", num: true }],
          rows: [[a, rA], [b, rB]].map(([t, r]) => ({ cells: { team: whoOf(t as AnswerTeam), record: recText(r as Rec), rate: pct(r as Rec), n: played(r as Rec) }, href: teamHref((t as AnswerTeam).number, s.season), strong: verdict === whoOf(t as AnswerTeam) })) },
        predict,
      ],
    };
  }

  const opr = id === "opr-vs";
  const vals = (r: SeasonRow) => (opr ? [r.opr_np, r.opr_auto, r.opr_teleop, r.opr_endgame] : [r.rating_np, r.rating_auto, r.rating_teleop, r.rating_endgame]);
  const [va, vb] = [vals(ra), vals(rb)];
  if (va[0] == null || vb[0] == null) {
    const missing = [va[0] == null ? whoOf(a) : "", vb[0] == null ? whoOf(b) : ""].filter(Boolean).join(" and ");
    return { ...base, blocks: [], none: `No ${opr ? "OPR" : "prediction rating"} for ${missing} in ${seasonLabel(s.season!)} yet.` };
  }
  const bars: StatBlock = { kind: "bars", title: opr ? "OPR by phase" : "Rating by phase", unit: "pts", groups: ["Total", "Auto", "TeleOp", "Endgame"].map((label, i) => ({ label, items: [{ label: String(a.number), value: va[i], tone: "a" as const }, { label: String(b.number), value: vb[i], tone: "b" as const }] })) };
  const d = (va[0] ?? 0) - (vb[0] ?? 0);
  const ahead = d >= 0 ? a : b;
  const rankText = (r: SeasonRow) => (opr ? (r.rank_np ? `#${r.rank_np} of ${r.ranked_teams ?? "?"}` : undefined) : r.rating_rank ? `#${r.rating_rank} worldwide` : undefined);
  const show = (r: SeasonRow, v: number | null) => (opr ? num1(v) : `${num1(v)} ±${Math.round(r.rating_sd ?? 0)}`);
  const kpis: StatBlock = { kind: "kpis", items: [
    { label: whoOf(a), value: show(ra, va[0]), sub: rankText(ra), href: teamHref(a.number, s.season), tone: d > 0 ? "accent" : undefined },
    { label: whoOf(b), value: show(rb, vb[0]), sub: rankText(rb), href: teamHref(b.number, s.season), tone: d < 0 ? "accent" : undefined },
  ] };
  if (id === "win-chance") {
    // FTC matches are two alliances, never one team against another: the ratings say who is stronger, and Predict works
    // out a real match's chances once its alliances are set.
    return {
      ...base,
      headline: { value: Math.abs(d) < 0.05 ? "Even" : `${ahead.number} is stronger`, label: Math.abs(d) < 0.05 ? "Same prediction rating" : `by ${num1(Math.abs(d))} points per match (prediction rating)`, sub: "A match is two alliances, so a win chance needs both alliances: Predict works it out for any lineup." },
      blocks: [kpis, bars, predict],
      definition: `${SEASON_RULE} No one-on-one win chance is given: every FTC match is two alliances against each other.${s.why ? ` ${s.why}` : ""}`,
    };
  }
  return {
    ...base,
    headline: { value: Math.abs(d) < 0.05 ? "Even" : `${whoOf(ahead)}`, label: Math.abs(d) < 0.05 ? `Both ${num1(va[0])}` : `${opr ? "OPR" : "rating"} ${num1(d >= 0 ? va[0] : vb[0])} against ${num1(d >= 0 ? vb[0] : va[0])}, +${num1(Math.abs(d))}` },
    blocks: [kpis, bars, predict],
  };
}

type Tally = { team: number; ms: TeamMatch[] };
const tally = (ms: TeamMatch[], side: "partners" | "opponents"): Tally[] => {
  const g = new Map<number, TeamMatch[]>();
  for (const m of ms) for (const t of m[side]) g.set(t, [...(g.get(t) ?? []), m]);
  return [...g.entries()].map(([team, xs]) => ({ team, ms: xs }));
};

/** Most played or toughest opponent, best or most frequent partner. */
export async function opponentsAnswer(id: IntentId, team: AnswerTeam, msAll: TeamMatch[], scope: Scope): Promise<StatAnswer> {
  const ms = counted(msAll, scope);
  const partners = id === "best-partner" || id === "frequent-partner";
  const where = scopePhrase(scope);
  const t = tally(ms, partners ? "partners" : "opponents");
  // From the team's side: an opponent's record against it is the team's losses-wins-ties.
  const theirs = (x: Tally): Rec => { const r = recOf(x.ms); return partners ? r : { wins: r.losses, losses: r.wins, ties: r.ties }; };
  const recent = (x: Tally) => String(x.ms[0]?.date ?? "");
  const ranked = id === "toughest-opponent" || id === "best-partner"
    ? t.filter((x) => x.ms.length >= MIN_MEETINGS).sort((x, y) => rateOf(theirs(y)) - rateOf(theirs(x)) || y.ms.length - x.ms.length || recent(y).localeCompare(recent(x)))
    : t.sort((x, y) => y.ms.length - x.ms.length || rateOf(theirs(y)) - rateOf(theirs(x)) || recent(y).localeCompare(recent(x)));
  const titles: Record<string, string> = { "most-played-opponent": "Most played opponent", "toughest-opponent": "Toughest opponent", "best-partner": "Best alliance partner", "frequent-partner": "Most frequent partner" };
  const rules: Record<string, string> = {
    "most-played-opponent": "Most played opponent: the team met most often on the other alliance (a tie goes to the better record against the team).",
    "toughest-opponent": `Toughest opponent: of the opponents met ${MIN_MEETINGS} times or more, the one with the best record against the team (wins over meetings; a tie goes to more meetings).`,
    "best-partner": `Best alliance partner: of the partners played with ${MIN_MEETINGS} times or more, the one with the best record together (wins over matches; a tie goes to more matches).`,
    "frequent-partner": "Most frequent partner: the team played with most often on the same alliance (a tie goes to the better record together).",
  };
  const title = `${titles[id]}${where}`;
  const base = { family: "two-team" as const, intent: id, title, team, scope: scopeChips(scope), definition: `${rules[id]} Matches at official events, both robots on the field. ${RECORD_RULE}`, source: sourceOf(ms) };
  const top = ranked[0];
  if (!top) {
    const need = id === "toughest-opponent" || id === "best-partner" ? ` ${MIN_MEETINGS} or more times` : "";
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
