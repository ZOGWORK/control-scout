// Who a team should pick at an event ("who should 12345 pick at <event>", "best second pick for 12345 at worlds",
// "teams that complement 12345's endgame"): Scout's pick helper (src/shared/pickRadar.ts) on the event's own teams,
// from the stored rating components (server/api/pickRatings.ts). The partner whose alliance with the team covers the
// most of the helper's four-axis radar comes first, so a partner strong where the team is weak beats one strong
// where it's already strong. Teams already on a posted alliance are left out. Nothing is worked out for the search
// but the helper's own sums, the same the Pick helper page shows.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { PICK_AXIS_LABEL, alliancePicked, allianceOf, pts, suggestPartners, type PickAxis, type PickGain } from "../../../../src/shared/pickRadar.js";
import { all, get } from "../../../db.js";
import { ROSTER } from "../../../data/registrations.js";
import { pickHelperQuery } from "../../../../src/shared/scoutSections.js";
import { dateRange, seasonLabel } from "../../../../src/shared/format.js";
import { isLegacy } from "../../../data/seasons.js";
import { eventToday } from "../../../../src/shared/eventDay.js";
import { pickRatings } from "../../pickRatings.js";
import { eventHref, shortEvent, teamHref } from "../matchSet.js";
import { whoOf, type AnswerTeam } from "./matches.js";

const PICK_RULE = "Scout's pick helper: each team's engine rating components (auto, TeleOp, endgame, and the penalty points it gives away a match) are added up for the alliance and drawn on four axes, each against the best this event's teams could field on it. The partner whose alliance covers the most of that area comes first, so a partner strong where the team is weak ranks above one strong where it already is. Teams already on a posted alliance are left out.";

const pct = (x: number) => `${Math.round(100 * x)}%`;
/** What a partner adds (its two biggest gains) and what it costs (an axis it lowers, as the helper page shows both). */
const adds = (gs: PickGain[], cs: PickGain[]) => [gs.slice(0, 2).map((g) => `${PICK_AXIS_LABEL[g.axis]} +${g.points}`).join(", "), cs.map((c) => `${PICK_AXIS_LABEL[c.axis]} ${c.points}`).join(", ")].filter(Boolean).join("; ") || "–";

export interface PickEvent { season: number; code: string; name: string; type: string | null; start: string | null; end: string | null }

/** The event a pick is for when none is named: the team's next one (still to finish), else its latest; in `season`, or
 *  held in `year`, when one is said. Null: it's listed at none. */
export async function teamPickEvent(team: number, now: number, season: number | null, year: number | null = null): Promise<{ ev: PickEvent; listed: true; next: boolean } | null> {
  const rows = await all<PickEvent & { timezone: string | null }>(
    `SELECT DISTINCT e.season, e.code, e.name, e.type, e.start, e.end, e.timezone FROM ${ROSTER} r JOIN events e ON e.season = r.season AND e.code = r.code
     WHERE r.team = ? AND (? IS NULL OR e.season = ?) AND (? IS NULL OR e.start LIKE ?) AND COALESCE(e.remote, 0) = 0 ORDER BY e.start DESC, e.code`,
    [team, season, season, year, year == null ? null : `${year}%`]);
  // Each event's own today, where it's held: an event on its last day in Hawaii is still to finish after midnight UTC.
  const today = (e: { timezone: string | null }) => eventToday(now, e.timezone).from;
  const next = rows.filter((e) => (e.end ?? e.start ?? "") >= today(e)).at(-1);
  const found = next ?? rows.find((e) => (e.start ?? "") <= today(e));
  if (!found) return null;
  const { timezone: _tz, ...ev } = found;
  return { ev, listed: true, next: !!next };
}

/** The pick helper's suggestions for `team` at `ev`. `why`: how the event was chosen, when the query named none.
 *  `focus`: a stat the question names ("complementing their auto"), each suggestion's change on it shown beside. */
/** Whether `ev`'s alliance selection is over by a sign of its own: playoff matches on record, or its last day gone
 *  where it's held (its venue's date, eventToday; with no time zone known, only once no time zone is still on it). */
async function selectionOver(ev: PickEvent, now: number): Promise<boolean> {
  const row = await get<{ timezone: string | null }>("SELECT timezone FROM events WHERE season = ? AND code = ?", [ev.season, ev.code]);
  if ((ev.end ?? ev.start ?? "9999") < eventToday(now, row?.timezone).from) return true;
  return !!(await get("SELECT 1 FROM matches WHERE season = ? AND code = ? AND level = 'playoff' LIMIT 1", [ev.season, ev.code]));
}

export async function pickAnswer(team: AnswerTeam, ev: PickEvent, why?: string, focus: PickAxis | null = null, now = Date.now()): Promise<StatAnswer> {
  const S = seasonLabel(Number(ev.season)), name = shortEvent(ev.name, ev.type), when = dateRange(ev.start, ev.end);
  // The helper opened on the same view: this team, and posted alliances ignored when the answer ignores them.
  const helperAt = (fresh: boolean) => { const sp = pickHelperQuery(Number(ev.season), ev.code); sp.set("pteam", String(team.number)); if (fresh) sp.set("pposted", "0"); return `/scout?${sp}`; };
  const linksOf = (fresh: boolean): StatBlock => ({ kind: "links", title: "Open", items: [{ label: "Open the pick helper", href: helperAt(fresh) }, { label: name, sub: when, href: eventHref(Number(ev.season), ev.code, team.number) }] });
  const links = linksOf(false);
  const base = { family: "two-team" as const, intent: "pick-partners", title: `Who ${team.number} should pick at ${name}`, team, scope: [S, name, "Weighs auto, TeleOp, endgame and fouls"],
    definition: `${PICK_RULE}${why ? ` ${why}` : ""}`, source: `The pick helper's ratings for ${ev.name}, ${S}` };
  if (isLegacy(Number(ev.season))) return { ...base, blocks: [links], none: `The pick helper's ratings start with 2023–24: ${S} has none.` };
  const r = await pickRatings(Number(ev.season), ev.code);
  if (!r) return { ...base, blocks: [links], none: `No team list for ${ev.name} yet, so the pick helper has no one to suggest.` };
  if (!r.teams.some((t) => t.team === team.number)) {
    const listed = r.unrated.includes(team.number);
    return { ...base, blocks: [links], none: `${whoOf(team)} ${listed ? "has no engine rating yet" : `isn't on ${ev.name}'s team list`}, so the pick helper has nothing to pair.` };
  }
  // Selection under way, the team on an alliance with a place free: its picks so far are the alliance, and only a team
  // still free can join it. Selection over (the team's alliance full; for a team on none, playoffs on record or the
  // event's last day gone, never the posted alliances alone, which can't tell a second pick still to come): every team
  // free, on the ratings as they stand now (the helper keeps no ratings from before selection), beside who it picked.
  const own = allianceOf(r.alliances, team.number);
  const done = own ? own.length >= r.size : r.alliances.length > 0 && await selectionOver(ev, now);
  const members = done ? [team.number] : own ?? [team.number];
  const s = suggestPartners({ teams: r.teams, members, unavailable: done ? [] : alliancePicked(r.alliances), size: r.size });
  if (!s.suggestions.length) return { ...base, blocks: [links], none: `No team at ${name} is left to pick.` };
  const named = (n: number) => whoOf({ number: n, name: r.teams.find((t) => t.team === n)?.name ?? null });
  const picked: StatBlock[] = done ? [{ kind: "links", title: own ? "Picked at the event" : "Not picked at the event", items: (own ?? []).filter((n) => n !== team.number).map((n) => ({ label: named(n), href: teamHref(n, Number(ev.season)) })) }] : [];
  // A partner on the alliance with no rating counts for nothing in the sums: said, as the helper page says it.
  const unrated = members.filter((n) => r.unrated.includes(n));
  const [top, ...rest] = s.suggestions;
  const who = (n: number) => { const t = r.teams.find((x) => x.team === n); return t ? whoOf({ number: t.team, name: t.name }) : `Team ${n}`; };
  // The stat asked about: how far each partner moves the alliance on it, on the radar's 0–100 axis.
  const on = (x: (typeof s.suggestions)[number]) => { const d = pts(x.result.axes[focus!]) - pts(s.current.axes[focus!]); return `${d >= 0 ? "+" : ""}${d}`; };
  return {
    ...base,
    headline: {
      value: who(top.team.team), label: `covers ${pct(top.result.share)} of the radar with ${members.map(String).join(" & ")} (now ${pct(s.current.share)})`,
      sub: `${done ? "Every team free, on today's ratings · " : ""}${unrated.length ? `${unrated.join(", ")} has no rating and counts for nothing · ` : ""}${focus ? `${PICK_AXIS_LABEL[focus]} ${on(top)} · ` : ""}Adds ${adds(top.gains, top.costs)} · #${top.ratingPlace} of ${s.pool} by rating alone`, href: teamHref(top.team.team, Number(ev.season)),
    },
    blocks: [
      ...(rest.length ? [{ kind: "table" as const, title: `The next ${rest.length}`,
        columns: [{ key: "rank", label: "#", num: true }, { key: "team", label: "Team" }, { key: "cover", label: "Covers", num: true }, ...(focus ? [{ key: "focus", label: PICK_AXIS_LABEL[focus], num: true }] : []), { key: "adds", label: "Adds" }],
        rows: rest.map((x, i) => ({ cells: { rank: i + 2, team: who(x.team.team), cover: pct(x.result.share), ...(focus ? { focus: on(x) } : {}), adds: adds(x.gains, x.costs) }, href: teamHref(x.team.team, Number(ev.season)) })) }] : []),
      ...picked.filter((b) => b.kind !== "links" || b.items.length),
      linksOf(done),
    ],
  };
}
