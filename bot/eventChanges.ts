// The schedule as it changes, and the match that is two away: what an event-aware follow posts beyond a fixed 15-minute
// reminder. At a real event matches slip and playoff pairings appear after quals, so a wall-clock reminder can arrive at
// the wrong moment and a moved match gets no notice at all.
//
// The tick keeps each event's last-seen schedule in `discord_match_state` (migration 110) and compares it: a match's
// start moved, its lineup changed, or a match appeared that wasn't on the schedule before (a playoff match) is posted
// once, to the channels following the teams in it. The first tick that ever sees an event only records it — otherwise a
// deploy would announce every match as new. "On deck" is separate: the match a followed team has two to go.
import { all, run } from "../server/db.js";
import type { EventDetail, MatchView } from "../src/shared/api.js";
import type { Follow } from "./follows.js";
import { FOOTER, VOLT, dates, preMatchEmbed } from "./views.js";

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

/** An on-deck post: the match, the followed teams in it, and where the event is up to — how many unplayed matches come
 *  before it, and the one on the field now (the latest unplayed match whose time has passed). */
export interface OnDeck { channel: string; match: MatchView; teams: number[]; ahead: number; nowPlaying: MatchView | null }

/** The match a followed team has two to go, while it is close enough to be a heads-up. One per channel and match. */
export function onDeckDue(follows: Follow[], matches: MatchView[], now: number): OnDeck[] {
  const out = new Map<string, OnDeck>();
  // The event's schedule as it stands: unplayed, in schedule order. What's ahead of a match is its place in this list.
  const unplayed = matches.filter((m) => !m.played).sort(order);
  // "On the field now": the latest unplayed match whose posted time has passed (a delayed event shows the one it is on).
  const playing = unplayed.filter((m) => { const at = m.startsAt ? Date.parse(m.startsAt) : NaN; return Number.isFinite(at) && at <= now; }).pop() ?? null;
  for (const f of follows) {
    if ((f.kind ?? "team") !== "team" || f.team == null || f.dropped_at) continue;
    const upcoming = unplayed.filter((m) => teamsIn(m).includes(f.team!));
    const target = upcoming[ON_DECK_AHEAD];
    if (!target) continue;
    const at = target.startsAt ? Date.parse(target.startsAt) : NaN;
    if (!Number.isFinite(at) || at - now > ON_DECK_MS || at - now < 60_000) continue;
    const key = `${f.channel_id}|${target.key}`;
    const mine = out.get(key);
    if (mine) { if (!mine.teams.includes(f.team)) mine.teams.push(f.team); }
    else out.set(key, { channel: f.channel_id, match: target, teams: [f.team], ahead: unplayed.indexOf(target), nowPlaying: playing });
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

/**
 * The on-deck post's first line: how many unplayed matches are before it, and which match the event is on now when one
 * has started. "On deck — 2 unplayed matches before it (Q14 is on the field now), in 24 minutes (4:30 PM)." The queue
 * position is what a team at the venue actually needs; the wall clock alone doesn't say whether it is close.
 */
export function onDeckLead(m: MatchView, ahead = ON_DECK_AHEAD, nowPlaying: MatchView | null = null): string {
  const at = m.startsAt ? Math.floor(Date.parse(m.startsAt) / 1000) : null;
  const queue = ahead === 0 ? "next up" : `${ahead} unplayed match${ahead === 1 ? "" : "es"} before it`;
  const field = nowPlaying && nowPlaying.key !== m.key ? ` (${nowPlaying.label} is on the field now)` : "";
  return `On deck — ${queue}${field}${at === null ? "" : `, <t:${at}:R> (<t:${at}:t>)`}.`;
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

/** Record this tick's schedule, and drop rows no event needs compared any more. `skip`: matches whose alert failed, so
 *  their old state is kept and the change is detected (and retried) on the next tick. */
export async function saveMatchState(season: number, code: string, matches: MatchView[], now = Date.now(), skip: ReadonlySet<string> = new Set()): Promise<void> {
  const at = new Date(now).toISOString();
  // One statement per chunk of 40 (SQLite's parameter cap), rather than a write per match every minute.
  const keep = matches.filter((m) => !skip.has(m.key));
  for (let i = 0; i < keep.length; i += 40) {
    const chunk = keep.slice(i, i + 40);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params = chunk.flatMap((m) => [season, code, m.key, m.startsAt ?? null,
      m.red.teams.map((t) => t.number).sort((a, b) => a - b).join(","),
      m.blue.teams.map((t) => t.number).sort((a, b) => a - b).join(","),
      m.level, at]);
    await run(
      `INSERT INTO discord_match_state (season, code, match_key, starts_at, red, blue, level, seen_at)
       VALUES ${values}
       ON CONFLICT(season, code, match_key) DO UPDATE SET starts_at = excluded.starts_at, red = excluded.red,
         blue = excluded.blue, level = excluded.level, seen_at = excluded.seen_at`,
      params);
  }
  await run("DELETE FROM discord_match_state WHERE seen_at < ?", [new Date(now - STATE_KEEP_MS).toISOString()]);
}

// ---------------------------------------------------------------------------
// The event itself: a meet moved to another weekend.
// ---------------------------------------------------------------------------

/** An event's dates as the last tick saw them. */
export interface EventState { start: string | null; end: string | null }
/** One event-dates post, for each channel following the event (by code, or through a team in it). */
export interface DateAlert { channel: string; key: string; was: EventState; now: EventState }

/** Every team entered or scheduled at the event. */
const fieldOf = (d: EventDetail) => new Set<number>([...d.field.map((f) => f.team), ...d.matches.flatMap(teamsIn)]);

/**
 * The channels following this event whose dates changed since the last tick: an event follow for its code, or a team
 * follow for a team in it. One entry per channel; a meet whose dates never move posts nothing, and a first sight (no
 * stored state) changes nothing (the caller records it).
 */
export function eventChanged(follows: Follow[], d: EventDetail, prev: EventState): DateAlert[] {
  const start = d.event.start ?? null, end = d.event.end ?? null;
  if (start === prev.start && end === prev.end) return [];
  const field = fieldOf(d);
  const out = new Map<string, DateAlert>();
  for (const f of follows) {
    if (f.dropped_at) continue;
    const byCode = f.kind === "event" && f.event === d.event.code && (f.season == null || f.season === d.event.season);
    const byTeam = (f.kind ?? "team") === "team" && f.team != null && field.has(f.team);
    if (!byCode && !byTeam) continue;
    if (!out.has(f.channel_id)) out.set(f.channel_id, { channel: f.channel_id, key: `dates:${start ?? ""}:${end ?? ""}`, was: prev, now: { start, end } });
  }
  return [...out.values()];
}

/** The post: what it was, what it is now. */
export function eventChangeEmbed(d: EventDetail, a: DateAlert, site: string): import("discord.js").APIEmbed {
  const says = (s: EventState) => (s.start ? dates(s.start, s.end) : "no dates posted");
  return {
    title: `Dates changed: ${d.event.name}`,
    url: `${site}/events/${d.event.season}/${encodeURIComponent(d.event.code)}`,
    description: `This event's dates moved.\n**Was:** ${says(a.was)}\n**Now:** ${says(a.now)}\n\nEverything else about it stays the same: the schedule posts here as soon as FIRST publishes it.`,
    color: VOLT,
    footer: FOOTER,
  };
}

/** This event's dates as the last tick stored them, or null for a first sight. */
export async function loadEventState(season: number, code: string): Promise<EventState | null> {
  const r = await all<{ start: string | null; end: string | null }>("SELECT start, end FROM discord_event_state WHERE season = ? AND code = ?", [season, code]);
  return r.length ? { start: r[0].start ?? null, end: r[0].end ?? null } : null;
}

/** Record this event's dates, and drop rows no event needs compared any more. */
export async function saveEventState(season: number, code: string, d: EventDetail, now = Date.now()): Promise<void> {
  const at = new Date(now).toISOString();
  await run(
    `INSERT INTO discord_event_state (season, code, start, end, seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(season, code) DO UPDATE SET start = excluded.start, end = excluded.end, seen_at = excluded.seen_at`,
    [season, code, d.event.start ?? null, d.event.end ?? null, at]);
  await run("DELETE FROM discord_event_state WHERE seen_at < ?", [new Date(now - STATE_KEEP_MS).toISOString()]);
}
