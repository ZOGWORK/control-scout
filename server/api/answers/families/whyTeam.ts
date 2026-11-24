// "Why is <team> so good at autonomous", "what makes <team> a strong alliance partner": a question asking why a team
// is strong, answered from the team's own season numbers (docs/search-pipeline.md): the phase asked about against the
// field, its strongest phase, its OPR and record, and how dependable it is. What the numbers show, never a claim
// about why beyond them. Every word read here is a question's frame, a phase or a role: no team, event or place.
import type { SearchAnswer, SearchCardLine } from "../../../../src/shared/api.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { get } from "../../../db.js";
import { teamReliability } from "../../teams.js";
import { defaultSeason, teamSeason } from "../season.js";
import { teamHref } from "../matchSet.js";
import { readTime } from "../../query/time.js";

export type WhyTopic = "auto" | "teleop" | "endgame" | "partner" | null;
export interface WhyQuestion { core: string; topic: WhyTopic }

/** The question's lead: "why is", "what makes", "how come". */
const LEAD = /^(?:why\s+(?:is|are|was|were|does|do)|what\s+makes|how\s+come)\s+/;
/** Saying a team is strong: what the question asks why of. */
const STRONG = /\b(?:good|great|strong|dominant|consistent|reliable|successful|effective|fast|solid|elite|amazing|awesome)\b/;
/** The phase or role asked about. */
const TOPICS: [Exclude<WhyTopic, null>, RegExp][] = [
  ["auto", /\b(?:auto|autonomous|autos)\b/],
  ["teleop", /\b(?:tele-?op|driver(?:\s+|-)?controlled|driving|drivers?)\b/],
  ["endgame", /\bend\s?-?games?\b/],
  ["partner", /\b(?:alliance\s+)?(?:partners?|picks?)\b/],
];
/** Saying it isn't strong ("why is <team> not so good"): another question, never this card. */
const NEGATED = /\b(?:not|never|no|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|doesn['’]?t|don['’]?t)\b/;
/** The frame's own words, said around the team. */
const FRAME = /\b(?:so|really|very|such|that|this|the|a|an|at|in|on|of|for|with|team|teams|robot|robots|alliance|period|phase|part|be|they|them|their|it|its|good|great|strong|dominant|consistent|reliable|successful|effective|fast|solid|elite|amazing|awesome)\b/g;

/** A question asking why a team is strong, or null. */
export function readWhy(q: string): WhyQuestion | null {
  const t = q.toLowerCase().replace(/[?!.,;:"“”()]/g, " ").replace(/['’]s\b/g, "").replace(/\s+/g, " ").trim();
  const lead = LEAD.exec(t);
  if (!lead) return null;
  let rest = t.slice(lead[0].length);
  const topic = TOPICS.find(([, re]) => re.test(rest))?.[0] ?? null;
  // Asked why it is strong, or what makes it a partner ("what makes <team> worth picking as a partner").
  if ((!STRONG.test(rest) && topic !== "partner") || NEGATED.test(rest)) return null;
  for (const [, re] of TOPICS) rest = rest.replace(new RegExp(re.source, "g"), " ");
  const core = rest.replace(FRAME, " ").replace(/\s+/g, " ").trim();
  return core ? { core, topic } : null;
}

interface Row {
  opr_np: number | null; opr_auto: number | null; opr_teleop: number | null; opr_endgame: number | null;
  rank_np: number | null; rank_auto: number | null; rank_teleop: number | null; rank_endgame: number | null; ranked_teams: number | null;
  matches: number; wins: number; losses: number; ties: number;
}

const PHASES = [["auto", "Auto"], ["teleop", "TeleOp"], ["endgame", "Endgame"]] as const;
const one = (v: number) => v.toFixed(1);
/** Where a rank sits in the field: "top 3%" (never "top 0%"). */
const top = (rank: number, of: number) => `top ${Math.max(1, Math.ceil((rank * 100) / of))}%`;

/** The answer to a question asking why a team is strong: its numbers against the field, or null (no such question, no
 *  team, or a team with no ranked season). `resolve` reads the team from the question's other words. */
export async function whyTeamAnswer(q: string, resolve: (core: string) => Promise<SearchAnswer>): Promise<SearchAnswer | null> {
  const w = readWhy(q);
  if (!w) return null;
  // A season said with it ("last season", "in 2024-25", the season picker's): that season's numbers. Any other time
  // (a weekend, a date) is a question about those matches, never a season's card.
  const said = readTime(w.core, new Date().toISOString().slice(0, 10));
  if (said.time && said.time.kind !== "season") return null;
  const core = said.rest.trim();
  const base = await resolve(core);
  const hit = base.hits[0];
  if (base.step === "recovery" || hit?.kind !== "team" || !/^\d+$/.test(hit.ref)) return null;
  const team = Number(hit.ref);
  // Only the team is left beside the frame: anything else ("at worlds", "in the finals") scopes the question to
  // something this card doesn't read, so it is left to the readers that do.
  const named = new Set(`${hit.ref} ${hit.title}`.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  if (!core.split(/\s+/).every((x) => named.has(x))) return null;
  const relative = said.time?.relative === "last" ? defaultSeason() - 1 : said.time?.relative ? defaultSeason() : null;
  const season = said.time ? (said.time.season ?? relative) : ((await teamSeason(team)) ?? defaultSeason());
  if (season == null) return null;
  const r = await get<Row>(
    `SELECT opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams, matches, wins, losses, ties
     FROM team_season_stats WHERE season = ? AND team = ?`, [season, team]);
  if (!r || !r.matches || !r.ranked_teams || r.rank_np == null || r.opr_np == null) return null;
  const S = seasonLabel(season), of = r.ranked_teams;
  const name = (await get<{ name: string | null }>("SELECT name FROM teams WHERE number = ?", [team]))?.name;
  const who = `${team}${name ? ` ${name}` : ""}`;
  const phase = (id: (typeof PHASES)[number][0]) => {
    const v = r[`opr_${id}`], rank = r[`rank_${id}`];
    return v != null && rank != null ? { id, v, rank } : null;
  };
  const phases = PHASES.map(([id, label]) => ({ ...phase(id), label })).filter((p): p is { id: (typeof PHASES)[number][0]; v: number; rank: number; label: (typeof PHASES)[number][1] } => p.v != null);
  const best = [...phases].sort((a, b) => a.rank - b.rank)[0];
  const lines: SearchCardLine[] = [];
  const phaseLine = (p: (typeof phases)[number]): SearchCardLine => ({ text: `${p.label} OPR ${one(p.v)}: #${p.rank} of ${of.toLocaleString("en-US")} (${top(p.rank, of)})`, detail: `${S} · the points it adds in ${p.label}, against every ranked team`, href: teamHref(team, season) });
  const asked = w.topic && w.topic !== "partner" ? phases.find((p) => p.id === w.topic) : undefined;
  // The phase asked about has no numbers stored: no card that answers another question in its place.
  if (w.topic && w.topic !== "partner" && !asked) return null;
  const opr: SearchCardLine = { text: `OPR ${one(r.opr_np)}: #${r.rank_np} of ${of.toLocaleString("en-US")} (${top(r.rank_np, of)})`, detail: `${S} · the points it adds to an alliance per match, without penalties`, href: teamHref(team, season) };
  const won = r.wins + r.losses + r.ties ? Math.round((r.wins * 100) / (r.wins + r.losses + r.ties)) : null;
  const record: SearchCardLine = { text: `Record ${r.wins}-${r.losses}-${r.ties}${won != null ? ` (${won}% won)` : ""}`, detail: `${S} · ${r.matches} matches at official events`, href: teamHref(team, season) };
  // How dependable: its stored reliability (no-shows, near-zero matches, swing, penalties), against the field's.
  const rel = await teamReliability(season, team).catch(() => null);
  const steady: SearchCardLine | null = rel ? { text: `Reliability ${rel.index} out of 100${rel.fieldIndex != null ? ` (field average ${rel.fieldIndex})` : ""}`, detail: `${S} · ${rel.matches} qualification matches: ${rel.noShows} no-shows, ${rel.nearZero} near-zero`, href: teamHref(team, season) } : null;
  const strongest: SearchCardLine | null = best && phases.length > 1 ? { text: `Strongest phase against the field: ${best.label} (${top(best.rank, of)})`, detail: phases.filter((p) => p !== best).map((p) => `${p.label} ${top(p.rank, of)}`).join(" · "), href: teamHref(team, season) } : null;
  if (asked) lines.push(phaseLine(asked));
  if (w.topic === "partner") lines.push(opr, ...(steady ? [steady] : []), record, ...(strongest ? [strongest] : []));
  else lines.push(...(strongest ? [strongest] : []), ...(asked ? [] : phases.map(phaseLine)), opr, record, ...(steady ? [steady] : []));
  const title = w.topic === "partner" ? `${who} as an alliance partner` : asked ? `${who} in ${asked.label}, against the field` : `${who} against the field`;
  return {
    ...base, q, step: "deterministic", weak: false,
    card: { kind: "info", title, lines },
    understood: { kind: "question", label: `${title} · ${S}` },
  };
}
