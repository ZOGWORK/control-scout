// Who a team should pick at an event ("who should 12345 pick at <event>", "best second pick for 12345 at worlds",
// "teams that complement 12345's endgame"): Scout's pick helper (src/shared/pickRadar.ts) on the event's own teams,
// from the stored rating components (server/api/pickRatings.ts). The partner whose alliance with the team covers the
// most of the helper's four-axis radar comes first, so a partner strong where the team is weak beats one strong
// where it's already strong. Teams already on a posted alliance are left out. Nothing is worked out for the search
// but the helper's own sums, the same the Pick helper page shows.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { PICK_AXIS_LABEL, alliancePicked, allianceOf, pts, suggestPartners, type PickAxis, type PickGain } from "../../../../src/shared/pickRadar.js";
import { all } from "../../../db.js";
import { ROSTER } from "../../../data/registrations.js";
import { pickHelperQuery } from "../../../../src/shared/scoutSections.js";
import { dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { isLegacy } from "../../../data/seasons.js";
import { pickRatings } from "../../pickRatings.js";
import { eventHref, shortEvent, teamHref } from "../matchSet.js";
import { whoOf, type AnswerTeam } from "./matches.js";

const PICK_RULE = "Scout's pick helper: each team's engine rating components (auto, TeleOp, endgame, and the penalty points it gives away a match) are added up for the alliance and drawn on four axes, each against the best this event's teams could field on it. The partner whose alliance covers the most of that area comes first, so a partner strong where the team is weak ranks above one strong where it already is. Teams already on a posted alliance are left out.";

const pct = (x: number) => `${Math.round(100 * x)}%`;
const adds = (gs: PickGain[]) => gs.slice(0, 2).map((g) => `${PICK_AXIS_LABEL[g.axis]} +${g.points}`).join(", ") || "–";

export interface PickEvent { season: number; code: string; name: string; type: string | null; start: string | null; end: string | null }

/** The event a pick is for when none is named: the team's next one (still to finish), else its latest; in `season` when
 *  one is said. Null: it's listed at none. */
export async function teamPickEvent(team: number, now: number, season: number | null): Promise<{ ev: PickEvent; listed: true; next: boolean } | null> {
  const today = new Date(now).toISOString().slice(0, 10);
  const rows = await all<PickEvent>(
    `SELECT DISTINCT e.season, e.code, e.name, e.type, e.start, e.end FROM ${ROSTER} r JOIN events e ON e.season = r.season AND e.code = r.code
     WHERE r.team = ? AND (? IS NULL OR e.season = ?) AND COALESCE(e.remote, 0) = 0 ORDER BY e.start DESC, e.code`, [team, season, season]);
  const next = rows.filter((e) => (e.end ?? e.start ?? "") >= today).at(-1);
  const ev = next ?? rows.find((e) => (e.start ?? "") <= today);
  return ev ? { ev, listed: true, next: !!next } : null;
}

/** The pick helper's suggestions for `team` at `ev`. `why`: how the event was chosen, when the query named none.
 *  `focus`: a stat the question names ("complementing their auto"), each suggestion's change on it shown beside. */
export async function pickAnswer(team: AnswerTeam, ev: PickEvent, why?: string, focus: PickAxis | null = null): Promise<StatAnswer> {
  const S = seasonLabel(Number(ev.season)), name = shortEvent(ev.name, ev.type), when = dateRange(ev.start, ev.end);
  const helper = `/scout?${pickHelperQuery(Number(ev.season), ev.code)}`;
  const links: StatBlock = { kind: "links", title: "Open", items: [{ label: "Open the pick helper", href: helper }, { label: name, sub: when, href: eventHref(Number(ev.season), ev.code, team.number) }] };
  const base = { family: "two-team" as const, intent: "pick-partners", title: `Who ${team.number} should pick at ${name}`, team, scope: [S, name, "Weighs auto, TeleOp, endgame and fouls"],
    definition: `${PICK_RULE}${why ? ` ${why}` : ""}`, source: `The pick helper's ratings for ${ev.name}, ${S}` };
  if (isLegacy(Number(ev.season))) return { ...base, blocks: [links], none: `The pick helper's ratings start with 2023–24: ${S} has none.` };
  const r = await pickRatings(Number(ev.season), ev.code);
  if (!r) return { ...base, blocks: [links], none: `No team list for ${ev.name} yet, so the pick helper has no one to suggest.` };
  if (!r.teams.some((t) => t.team === team.number)) {
    const listed = r.unrated.includes(team.number);
    return { ...base, blocks: [links], none: `${whoOf(team)} ${listed ? "has no engine rating yet" : `isn't on ${ev.name}'s team list`}, so the pick helper has nothing to pair.` };
  }
  // On a posted alliance that still has a place: its picks so far are the alliance, and only a team still free can
  // join it. A full one (selection is over): the helper's suggestions as selection opened, beside who it picked.
  const own = allianceOf(r.alliances, team.number);
  const done = !!own && own.length >= r.size;
  const members = done ? [team.number] : own ?? [team.number];
  const s = suggestPartners({ teams: r.teams, members, unavailable: done ? [] : alliancePicked(r.alliances), size: r.size });
  if (!s.suggestions.length) return { ...base, blocks: [links], none: `No team at ${name} is left to pick.` };
  const picked: StatBlock[] = done ? [{ kind: "links", title: "Picked at the event", items: own!.filter((n) => n !== team.number).map((n) => ({ label: whoOf({ number: n, name: r.teams.find((t) => t.team === n)?.name ?? null }), href: teamHref(n, Number(ev.season)) })) }] : [];
  const [top, ...rest] = s.suggestions;
  const who = (n: number) => { const t = r.teams.find((x) => x.team === n); return t ? whoOf({ number: t.team, name: t.name }) : `Team ${n}`; };
  // The stat asked about: how far each partner moves the alliance on it, on the radar's 0–100 axis.
  const on = (x: (typeof s.suggestions)[number]) => { const d = pts(x.result.axes[focus!]) - pts(s.current.axes[focus!]); return `${d >= 0 ? "+" : ""}${d}`; };
  return {
    ...base,
    headline: {
      value: who(top.team.team), label: `covers ${pct(top.result.share)} of the radar with ${members.map(String).join(" & ")} (now ${pct(s.current.share)})`,
      sub: `${done ? "As selection opened · " : ""}${focus ? `${PICK_AXIS_LABEL[focus]} ${on(top)} · ` : ""}Adds ${adds(top.gains)} · #${top.ratingPlace} of ${s.pool} by rating alone`, href: teamHref(top.team.team, Number(ev.season)),
    },
    blocks: [
      ...(rest.length ? [{ kind: "table" as const, title: `The next ${rest.length}`,
        columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "cover", label: "Covers", num: true }, ...(focus ? [{ key: "focus", label: PICK_AXIS_LABEL[focus], num: true }] : []), { key: "adds", label: "Adds" }],
        rows: rest.map((x, i) => ({ cells: { rank: i + 2, team: who(x.team.team), cover: pct(x.result.share), ...(focus ? { focus: on(x) } : {}), adds: adds(x.gains) }, href: teamHref(x.team.team, Number(ev.season)) })) }] : []),
      ...picked,
      links,
    ],
  };
}
