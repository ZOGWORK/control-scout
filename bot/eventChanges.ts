// The schedule as it changes, and the match that is two away: what an event-aware follow posts beyond a fixed 15-minute
// reminder. At a real event matches slip and playoff pairings appear after quals, so a wall-clock reminder can arrive at
// the wrong moment and a moved match gets no notice at all.
//
// The tick keeps each event's last-seen schedule in `discord_match_state` (migration 110) and compares it: a match's
// start moved, its lineup changed, or a match appeared that wasn't on the schedule before (a playoff match) is posted
// once, to the channels following the teams in it. The first tick that ever sees an event only records it — otherwise a
// deploy would announce every match as new. "On deck" is separate: the match a followed team has two to go.
import { all, run } from "../server/db.js";
import type { MatchView } from "../src/shared/api.js";
import type { Follow } from "./follows.js";
import { preMatchEmbed } from "./views.js";

/** A match's start moving by less than this is posting noise, not a schedule change. */
export const MOVE_MS = 2 * 60_000;
/** Alerts only for matches around now: six hours either side, so a future schedule refresh posts nothing. */
export const ALERT_WINDOW_MS = 6 * 3600_000;
/** "On deck" is this many unplayed matches ahead of the team's next one. */
export const ON_DECK_AHEAD = 2;
/** And only while it is this close, so it is a heads-up rather than a second reminder hours early. */
export const ON_DECK_MS = 90 * 60_000;
/** How long a schedule row is kept for comparison. */
export const STATE_KEEP_MS = 30 * 86_400_000;

/** One match as the last tick saw it. */
export interface MatchState {
  startsAt: string | null;
  red: number[];
  blue: number[];
  level: string;
}

/** Moved, lineup changed, or newly on the schedule. */
export type AlertKind = "moved" | "changed" | "new";

/** One post the tick should make: which channel, which match, and what happened. */
export interface MatchAlert {
  channel: string;
  match: MatchView;
  kind: AlertKind;
  /** The state it had before, for a moved match's "was" line. */
  was: MatchState | null;
}

/** The claim key for one alert in the post log: a second move or a second lineup change is a new post, not the first
 *  one's claim. (Two alerts for the same match and kind differ only in what changed, so that is what the key adds.) */
export function alertKey(a: MatchAlert): string {
  const lineup = [...a.match.red.teams, ...a.match.blue.teams].map((t) => t.number).sort((x, y) => x - y).join("-");
  const change = a.kind === "moved" ? a.match.startsAt ?? "" : a.kind === "changed" ? lineup : "";
  return `${a.match.key}:${a.kind}${change ? `:${change}` : ""}`;
}

/** Every team on the field (a playoff alliance's sitting-out third included: it is still in the match). */
const teamsIn = (m: MatchView): number[] => [...m.red.teams, ...m.blue.teams].map((t) => t.number);

/** Schedule order, as the event page reads it: quals before playoffs, then series and match number. */
const order = (a: MatchView, b: MatchView) =>
  (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number;

/** The channels following a team follow that isn't stopped, for each team in the match. */
const watchers = (follows: Follow[], teams: number[]) =>
  follows.filter((f) => (f.kind ?? "team") === "team" && f.team != null && !f.dropped_at && teams.includes(f.team));

/**
 * What changed since the last tick, for the followed teams, one entry per channel and match. `prev` is that event's
 * schedule from the last tick; an empty one is the first sight and changes nothing (the caller saves it).
 */
export function changedMatches(follows: Follow[], matches: MatchView[], prev: Map<string, MatchState>, now: number): MatchAlert[] {
  if (!prev.size) return [];
  const out = new Map<string, MatchAlert>();
  for (const m of matches) {
    if (m.played) continue;
    const at = m.startsAt ? Date.parse(m.startsAt) : NaN;
    if (!Number.isFinite(at) || Math.abs(at - now) > ALERT_WINDOW_MS) continue;
    const was = prev.get(m.key) ?? null;
    const red = m.red.teams.map((t) => t.number).sort((a, b) => a - b);
    const blue = m.blue.teams.map((t) => t.number).sort((a, b) => a - b);
    let kind: AlertKind | null = null;
    if (!was) kind = "new";
    else {
      const old = was.startsAt ? Date.parse(was.startsAt) : NaN;
      if (Number.isFinite(old) && Math.abs(old - at) >= MOVE_MS) kind = "moved";
      else if (was.red.join() !== red.join() || was.blue.join() !== blue.join()) kind = "changed";
    }
    if (!kind) continue;
    for (const f of watchers(follows, teamsIn(m))) {
      const key = `${f.channel_id}|${m.key}`;
      if (!out.has(key)) out.set(key, { channel: f.channel_id, match: m, kind, was });
    }
  }
  return [...out.values()];
}

/** The match a followed team has two to go, while it is close enough to be a heads-up. One per channel and match. */
export function onDeckDue(follows: Follow[], matches: MatchView[], now: number): { channel: string; match: MatchView; teams: number[] }[] {
  const out = new Map<string, { channel: string; match: MatchView; teams: number[] }>();
  for (const f of follows) {
    if ((f.kind ?? "team") !== "team" || f.team == null || f.dropped_at) continue;
    const upcoming = matches.filter((m) => !m.played && teamsIn(m).includes(f.team!)).sort(order);
    const target = upcoming[ON_DECK_AHEAD];
    if (!target) continue;
    const at = target.startsAt ? Date.parse(target.startsAt) : NaN;
    if (!Number.isFinite(at) || at - now > ON_DECK_MS || at - now < 60_000) continue;
    const key = `${f.channel_id}|${target.key}`;
    const mine = out.get(key);
    if (mine) { if (!mine.teams.includes(f.team)) mine.teams.push(f.team); }
    else out.set(key, { channel: f.channel_id, match: target, teams: [f.team] });
  }
  return [...out.values()];
}

/** What an alert says first; the pre-match card carries the lineup and the call underneath. */
export function alertLead(a: MatchAlert, now = Date.now()): string {
  const at = a.match.startsAt ? Math.floor(Date.parse(a.match.startsAt) / 1000) : null;
  const was = a.was?.startsAt ? Math.floor(Date.parse(a.was.startsAt) / 1000) : null;
  const when = at === null ? "with no time posted yet" : `<t:${at}:R> (<t:${at}:t>)`;
  if (a.kind === "moved") {
    return was === null
      ? `Moved: it is now ${when}.`
      : `Moved: it was <t:${was}:t>, now ${when}.`;
  }
  if (a.kind === "changed") return `The lineup changed since I last looked. It is ${when}.`;
  return `A new match is on the schedule: ${when}.`;
}

/** The embed for an alert, in the same design the reminder uses. */
export function alertEmbed(a: MatchAlert, eventName: string, site: string, now = Date.now()) {
  return preMatchEmbed(eventName, a.match, site, alertLead(a, now));
}

/** The on-deck post's first line. */
export function onDeckLead(m: MatchView): string {
  const at = m.startsAt ? Math.floor(Date.parse(m.startsAt) / 1000) : null;
  return `On deck — two matches away${at === null ? "" : `, <t:${at}:R> (<t:${at}:t>)`}.`;
}

/** This event's schedule as the last tick stored it, by match key. */
export async function loadMatchState(season: number, code: string): Promise<Map<string, MatchState>> {
  const rows = await all<{ match_key: string; starts_at: string | null; red: string; blue: string; level: string }>(
    "SELECT match_key, starts_at, red, blue, level FROM discord_match_state WHERE season = ? AND code = ?", [season, code]);
  const nums = (s: string) => String(s ?? "").split(",").map(Number).filter(Number.isFinite);
  return new Map(rows.map((r) => [String(r.match_key), {
    startsAt: r.starts_at ?? null, red: nums(r.red), blue: nums(r.blue), level: String(r.level),
  }]));
}

/** Record this tick's schedule, and drop rows no event needs compared any more. */
export async function saveMatchState(season: number, code: string, matches: MatchView[], now = Date.now()): Promise<void> {
  const at = new Date(now).toISOString();
  // One statement per chunk of 40 (SQLite's parameter cap), rather than a write per match every minute.
  for (let i = 0; i < matches.length; i += 40) {
    const chunk = matches.slice(i, i + 40);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params = chunk.flatMap((m) => [season, code, m.key, m.startsAt ?? null,
      m.red.teams.map((t) => t.number).sort((a, b) => a - b).join(","),
      m.blue.teams.map((t) => t.number).sort((a, b) => a - b).join(","),
      m.level, at]);
    await run(
      `INSERT INTO discord_match_state (season, code, match_key, starts_at, red, blue, level, seen_at)
       VALUES ${values}
       ON CONFLICT(season, code, match_key) DO UPDATE SET starts_at = excluded.starts_at, red = excluded.red,
         blue = excluded.blue, level = excluded.level, seen_at = excluded.seen_at
       WHERE discord_match_state.starts_at IS NOT excluded.starts_at OR discord_match_state.red != excluded.red
          OR discord_match_state.blue != excluded.blue OR discord_match_state.level != excluded.level`,
      params);
  }
  await run("DELETE FROM discord_match_state WHERE seen_at < ?", [new Date(now - STATE_KEEP_MS).toISOString()]);
}
