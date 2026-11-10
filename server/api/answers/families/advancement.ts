// Advancement odds in search: a team's chance to take an advancing slot at one event, under the season's rules, from
// the same engine numbers the Predict page's Advancement view shows (server/predict/eventForecast.ts, or the event's
// stored projection when the background job has one, as that view overlays it). An event still to come shows the odds
// as things stand; one already played shows the odds as they stood the day before it (Predict's "Before the event")
// beside what happened: the slot taken or not, and how. At a Worlds division the step on is the Worlds finals, which
// only the division's winning alliance reaches, so the chance there is the chance to win the division.
// A match's win chance is never shown as advancement odds.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { awardLabel, dateRange, oddsPct, seasonLabel } from "../../../../src/shared/format.js";
import { predictHref } from "../../../../src/shared/predictUrl.js";
import { advanceStatus } from "../../../../src/shared/projections.js";
import { CURRENT_SEASON, FIRST_PREDICT_SEASON, isLegacy } from "../../../data/seasons.js";
import { regionRuleset } from "../../../data/roadmapRules.js";
import { ROSTER } from "../../../data/registrations.js";
import { all, get } from "../../../db.js";
import { isEnabled } from "../../../flags.js";
import { eventForecast } from "../../../predict/eventForecast.js";
import { readProjections } from "../../../projections/store.js";
import { eventHref } from "../matchSet.js";
import { whoOf, type AnswerTeam } from "./matches.js";
import { wonEventByRules } from "./winners.js";

/** Where the advancing is asked toward: Worlds ("make worlds"), a state or regional championship ("make states"), or any next step. */
export type Toward = "worlds" | "states" | null;

interface Ev { season: number; code: string; name: string; type: string | null; start: string | null; end: string | null; region: string | null; division_code: string | null }

/** Odds printed as Predict prints them ("1%" for a long shot, never a false 0%). */
const pct = (p: number) => oddsPct(p, p <= 0 || p >= 1);
const EV_COLS = "e.season, e.code, e.name, e.type, e.start, e.end, e.region, e.division_code";
/** FIRST's event types a team can advance from, by where they lead. */
const TO_STATES = ["Qualifier", "LeagueTournament", "SuperQualifier"];
const TO_WORLDS = ["Championship", "Premier"];
const ADVANCING = [...TO_STATES, ...TO_WORLDS, "FIRSTChampionship"];
const typesFor = (t: Toward) => (t === "worlds" ? TO_WORLDS : t === "states" ? TO_STATES : ADVANCING);

export const ADVANCE_RULE = "The chance to take one of the event's advancing slots, from the engine's simulation of the whole event (2,000 runs of the qualification matches, alliance selection, the playoffs and the judged awards, under the season's advancement points), as Predict's Advancement view shows it. For an event already played it's the forecast made the day before (ratings from earlier matches only, none of the event's results), set beside what happened. At a Worlds division only the winning alliance goes on, to the Worlds finals. A match's win chance is a different number and never stands in for this.";

/** What advancing from `ev` leads to, in words ("to the New Jersey Championship", "to the Worlds finals"). */
async function destination(ev: Ev, advancesTo: string | null): Promise<string> {
  if (ev.type === "FIRSTChampionship") return ev.division_code ? "to the Worlds finals" : "as a Worlds finalist";
  if (advancesTo) {
    // FTC Events names the next event by its code ("USNJCMP") or in words ("FIRST Championship & Premier Events").
    const named = /^[A-Z0-9]+$/.test(advancesTo) ? await get<{ name: string }>("SELECT name FROM events WHERE season = ? AND code = ?", [ev.season, advancesTo]) : null;
    return `to ${named?.name ?? advancesTo.replace(/ Events$/, " events")}`;
  }
  const level = regionRuleset(Number(ev.season), ev.region)?.levels.find((l) => ev.type && l.types.includes(ev.type));
  if (level?.next) return `to ${level.next}`;
  return ev.type && TO_STATES.includes(ev.type) ? "to the region's championship" : "to the FIRST Championship or a Premier event";
}

/** The team's odds at `ev` the way Predict's Advancement view shows them: the stored projection when there is one (the
 *  current run, or for an event already played the baseline made before it), else the engine's forecast. Null: no
 *  forecast can be made (no team list, an unsupported event, ratings still building). */
async function oddsAt(ev: Ev, team: number, before: boolean) {
  const stored = await readProjections(Number(ev.season), ev.code).catch(() => null);
  const run = before ? stored?.baseline : stored?.current;
  const row = run?.teams.find((t) => t.team === team);
  if (run && row) {
    const status = advanceStatus(row);
    return { pAdvance: status === "odds" ? row.pAdvance : null, status, pWin: row.pWin, rank: row.rank ? { p10: row.rank.p10, p50: row.rank.p50, p90: row.rank.p90 } : null, runs: run.runs, slots: run.slots, estimated: run.slotsSource !== "official", notes: [] as string[] };
  }
  const fc = await eventForecast(Number(ev.season), ev.code, team, before ? "pre-event" : "current").catch(() => null);
  const t = fc?.teams.find((x) => x.team === team);
  if (!fc || !t) return null;
  const already = fc.prequalified.includes(team);
  return { pAdvance: already ? null : t.pAdvance, status: already ? "qualified" : "odds", pWin: t.pWin, rank: { p10: t.rank.p10, p50: t.rank.mean, p90: t.rank.p90 }, runs: fc.runs, slots: fc.slots, estimated: fc.slotsSource !== "official", notes: fc.assumptions.filter((a) => /slots|divisions/i.test(a)) };
}

/** An award as the card names it: "Winning Alliance", "Control Award", "Reach Award 2nd". */
const award = (a: { type: string; placement: number }) => (a.type === "Winner" || a.type === "Finalist" || a.type === "DeansList" ? awardLabel(a.type, a.placement)
  : awardLabel(a.type, a.placement).replace(/( \d+(?:st|nd|rd|th))?$/, " Award$1"));

/** What happened at a played event: the slot taken or not, and how (rank, playoff finish, awards, points). */
async function outcome(ev: Ev, team: number, worlds: boolean): Promise<{ value: string; sub: string; tone?: "good" | "bad" }> {
  const codes = [ev.code, ...(ev.division_code ? [ev.division_code] : [])];
  const ph = codes.map(() => "?").join(", ");
  const [rank, awards, pts, adv, won] = await Promise.all([
    get<{ rank: number | null }>(`SELECT rank FROM event_teams WHERE season = ? AND code = ? AND team = ?`, [ev.season, ev.code, team]),
    all<{ type: string; placement: number }>(`SELECT type, placement FROM awards WHERE season = ? AND code IN (${ph}) AND team = ? ORDER BY placement`, [ev.season, ...codes, team]),
    get<{ total: number }>(`SELECT total FROM advancement_points WHERE season = ? AND code IN (${ph}) AND team = ? LIMIT 1`, [ev.season, ...codes, team]),
    get<{ slots: number; rows: string }>(`SELECT slots, rows FROM advancement WHERE season = ? AND code IN (${ph}) ORDER BY code = ? DESC LIMIT 1`, [ev.season, ...codes, ev.code]),
    wonEventByRules(Number(ev.season), ev.code, team).catch(() => false),
  ]);
  const how = [rank?.rank != null ? `ranked #${rank.rank}` : null, won ? (ev.division_code ? "won the division" : "won the event") : null,
    ...new Set(awards.filter((a) => !(won && a.type === "Winner")).map(award)), pts ? `${pts.total} advancement points` : null].filter(Boolean).join(" · ");
  const sub = how ? how[0].toUpperCase() + how.slice(1) : "";
  if (worlds) return won ? { value: "Advanced", sub: sub || "Won the division", tone: "good" } : { value: "Did not advance", sub: sub || "Didn't win the division", tone: "bad" };
  const rows: { team: number; status: string; declined: boolean }[] = adv ? JSON.parse(adv.rows) : [];
  const r = rows.find((x) => x.team === team);
  if (r?.status === "FIRST") return r.declined ? { value: "Declined its slot", sub } : { value: "Advanced", sub: sub || "Took a slot", tone: "good" };
  if (r?.status === "ALREADY_ADVANCING" || r?.status === "ADVANCING_ABOVE") return { value: "Already qualified", sub: sub || "It had advanced at an earlier event" };
  if (r?.status === "INELIGIBLE") return { value: "Not eligible here", sub };
  if (adv && rows.length) return { value: "Did not advance", sub: [sub, `${adv.slots} slots went to other teams`].filter(Boolean).join(" · "), tone: "bad" };
  return { value: "List not published", sub: [sub, "FIRST hasn't posted who advanced yet"].filter(Boolean).join(" · ") };
}

/** An event's row as the card reads it, by its season and code. */
export async function advancementEvent(season: number, code: string): Promise<Ev | null> {
  return (await get<Ev>(`SELECT ${EV_COLS} FROM events e WHERE e.season = ? AND e.code = ?`, [season, code])) ?? null;
}

/** One team's advancement odds at one event: the card. `lead`: a line said first (why this event, when another was asked). */
export async function advancementAt(team: AnswerTeam, ev: Ev, now: number, lead?: { title: string; tile: { label: string; value: string; sub: string } }): Promise<StatAnswer> {
  const S = seasonLabel(Number(ev.season)), when = dateRange(ev.start, ev.end), today = new Date(now).toISOString().slice(0, 10);
  const worlds = ev.type === "FIRSTChampionship";
  const played = (ev.start ?? "9999") <= today;
  const done = (ev.end ?? ev.start ?? "9999") < today;
  const name = ev.name.replace(/^FIRST Championship - FIRST Tech Challenge - /, "Worlds · ");
  const href = predictHref({ mode: "advancement", season: Number(ev.season), code: ev.code, team: team.number });
  const links: StatBlock = { kind: "links", title: "Event", items: [{ label: ev.name, sub: when, href: eventHref(Number(ev.season), ev.code, team.number) }] };
  const base: Omit<StatAnswer, "blocks"> = {
    family: "stat", intent: "advancement-odds", title: lead?.title ?? `Advancement odds: ${team.number} at ${name}`, team,
    scope: [name, S, done ? "Before it started, then what happened" : played ? "As things stand" : "Not played yet"], definition: ADVANCE_RULE,
    source: `${ev.name}, ${S}${when ? ` · ${when}` : ""} · the engine's simulation, as Predict shows it`,
  };
  if (isLegacy(Number(ev.season))) return { ...base, blocks: [links], none: `Predictions start with ${seasonLabel(FIRST_PREDICT_SEASON)}: ${S} has no advancement odds.` };
  if (!(await isEnabled("advancementOdds").catch(() => false)) || !(await isEnabled("livePredictions").catch(() => false))) return { ...base, blocks: [links], none: "Advancement odds are switched off just now, so no chance is shown." };
  const adv = await get<{ slots: number; advances_to: string | null }>(`SELECT slots, advances_to FROM advancement WHERE season = ? AND code IN (?, ?) ORDER BY code = ? DESC LIMIT 1`, [ev.season, ev.code, ev.division_code ?? ev.code, ev.code]);
  const to = await destination(ev, adv?.advances_to ?? null);
  const odds = await oddsAt(ev, team.number, done);
  if (!odds) return { ...base, blocks: [links], none: `There's no forecast for ${whoOf(team)} at ${ev.name} (${S}) yet: the engine needs the event's team list${played ? "" : " and the season's ratings"}, and nothing is guessed in the meantime.` };
  const p = worlds ? odds.pWin : odds.pAdvance;
  const said = done ? "before it started" : played ? "as things stand" : "before it starts";
  const slots = worlds ? "1 alliance goes on from each division" : adv?.slots && !odds.estimated ? `${adv.slots} slots` : `${odds.slots} slots (estimated)`;
  const note = [when, `${odds.runs.toLocaleString("en-US")} simulated runs`, slots, ...odds.notes].filter(Boolean).join(" · ");
  const chance: StatBlock | null = p != null ? { kind: "chance", p, who: String(team.number), label: `to advance ${to}, ${said}`, note, action: { label: "Open in Predict", href } } : null;
  const result = done ? await outcome(ev, team.number, worlds) : null;
  const tiles = [
    ...(lead ? [lead.tile] : []),
    ...(p == null ? [{ label: "Advance", value: odds.status === "qualified" ? "Already qualified" : odds.status === "ineligible" ? "Not eligible here" : "–", sub: `Advancing here means going on ${to}` }] : []),
    ...(result ? [{ label: "What happened", value: result.value, sub: result.sub, ...(result.tone ? { tone: result.tone } : {}) }] : []),
    ...(worlds ? [] : [{ label: "Win the event", value: pct(odds.pWin), sub: said[0].toUpperCase() + said.slice(1) }]),
    ...(odds.rank ? [{ label: "Projected rank", value: `#${Math.round(odds.rank.p50)}`, sub: `#${Math.round(odds.rank.p10)}–#${Math.round(odds.rank.p90)} (P10–P90)` }] : []),
  ];
  return { ...base, blocks: [...(chance ? [chance] : []), { kind: "kpis", items: tiles }, links] };
}

/** A team's advancement odds for a season, no event named ("17670 chances this season", "can 4215 make it to states"):
 *  its next event toward where it's going (the soonest one the engine can forecast), else, said so, its latest one. */
export async function seasonAdvancement(team: AnswerTeam, o: { season: number | null; toward: Toward; now: number; missing?: string }): Promise<StatAnswer> {
  const today = new Date(o.now).toISOString().slice(0, 10), types = typesFor(o.toward), S = seasonLabel(o.season ?? CURRENT_SEASON);
  // The team's events of those types; a championship split into divisions is the team's division, where its odds are made.
  const evs = await all<Ev>(
    `SELECT DISTINCT ${EV_COLS} FROM ${ROSTER} r JOIN events e ON e.season = r.season AND e.code = r.code
     WHERE r.team = ? AND e.season >= ? AND e.type IN (${types.map(() => "?").join(", ")})
       AND NOT EXISTS (SELECT 1 FROM events d WHERE d.season = e.season AND d.division_code = e.code)
     ORDER BY e.start DESC, e.code`, [team.number, FIRST_PREDICT_SEASON, ...types]);
  const upcoming = evs.filter((e) => (e.end ?? e.start ?? "") >= today && Number(e.season) === (o.season ?? CURRENT_SEASON)).reverse();
  for (const e of upcoming) {
    const a = await advancementAt(team, e, o.now);
    if (!a.none) return { ...a, scope: [...a.scope, "Its next advancing event"] };
  }
  const toward = o.toward === "worlds" ? "event that sends teams to Worlds" : o.toward === "states" ? "event that sends teams to its championship" : "advancing event";
  const past = evs.filter((e) => (e.end ?? e.start ?? "9999") < today);
  // The season asked, when it's over: its latest event, the answer itself. Else the latest one, said why.
  const over = o.season != null && o.season < CURRENT_SEASON;
  const latest = (o.season != null ? past.find((e) => Number(e.season) === o.season) : undefined) ?? (over && !o.missing ? undefined : past[0]);
  const why = o.missing ?? `No next ${toward} with a team list is published for ${whoOf(team)} in ${S} yet`;
  if (!latest) {
    return { family: "stat", intent: "advancement-odds", title: `Advancement odds: ${team.number}`, team, scope: [S], definition: ADVANCE_RULE, source: `${team.number}'s events`, blocks: [],
      none: over ? `${whoOf(team)} played no ${toward} with a forecast in ${S}.` : `${why}, and it has no earlier ${toward} with a forecast to show instead. The odds appear once the event's team list is in.` };
  }
  const L = seasonLabel(Number(latest.season));
  if (over && !o.missing) return advancementAt(team, latest, o.now);
  const a = await advancementAt(team, latest, o.now, {
    title: `Advancement odds: ${team.number}'s latest ${o.toward === "worlds" ? "championship" : "advancing event"} (${L})`,
    tile: { label: o.missing ? "Not listed there" : `${S} so far`, value: o.missing ? "Not there" : "No event yet", sub: o.missing ? `${why}: these are its odds of getting there, at ${latest.name} (${L})` : `Nothing to come with a team list yet: these are the odds at its latest one (${L})` },
  });
  return { ...a, scope: [...a.scope, o.missing ? "Not at the event asked" : `No next event in ${S} yet`] };
}
