// The bot's data: the same modules the site's API is built from (server/api/*), reading the same
// database. No HTTP to the site and no public API: the numbers match the site because they are
// computed by the same code from the same rows.
import type { APIEmbed } from "discord.js";
import { all, get } from "../server/db.js";
import { env } from "../server/env.js";
import { CURRENT_SEASON, seasonInfo } from "../server/data/seasons.js";
import { teamProfile } from "../server/api/teams.js";
import { cachedEventDetail, NO_MATCH_TYPES } from "../server/api/events.js";
import { rankings } from "../server/api/rankings.js";
import { RANKED_MIN_MATCHES } from "../src/shared/rankings.js";
import type { EventDetail } from "../src/shared/api.js";
import { Friendly, dates, eventEmbed, predictEmbed, preMatchEmbed, rankingsEmbed, teamEmbed, teamLink } from "./views.js";
import { aheadEvents, inEvent, nextPlaying } from "./next.js";

/** The site's public address, for every link in an embed (controlscout.org in production). */
export const site = () => env.canonicalUrl.replace(/\/+$/, "");
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export async function teamLookup(number: number): Promise<APIEmbed> {
  const profile = await teamProfile(number);
  if (!profile) throw new Friendly("Team not found", `There's no FTC team ${number} in Control Scout's data.`);
  return teamEmbed({ profile, seasonLabel: seasonInfo(profile.season).label, today: today() }, site());
}

/** An event of the current season by its code (any case), or by its exact name. */
export async function eventCode(input: string): Promise<string> {
  const q = input.trim().slice(0, 100);
  const r = await get<{ code: string }>(
    "SELECT code FROM events WHERE season = ? AND (code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE) ORDER BY code = ? COLLATE NOCASE DESC LIMIT 1",
    [CURRENT_SEASON, q, q, q]);
  if (!r) throw new Friendly("Event not found", `No ${seasonInfo(CURRENT_SEASON).label} event matches "${q.slice(0, 40)}". Pick one from the list as you type.`);
  return String(r.code);
}

async function eventFor(input: string) {
  const code = await eventCode(input);
  const d = await cachedEventDetail(CURRENT_SEASON, code);
  if (!d) throw new Friendly("Event not found", `No ${seasonInfo(CURRENT_SEASON).label} event ${code}.`);
  return d;
}

export async function predictLookup(event: string, match: number): Promise<APIEmbed> {
  const d = await eventFor(event);
  const quals = d.matches.filter((m) => m.level === "qual");
  if (!quals.length) throw new Friendly("No schedule yet", `Schedule isn't posted for ${d.event.name} yet.`);
  const m = quals.find((x) => x.number === match);
  if (!m) {
    const top = Math.max(...quals.map((x) => x.number));
    throw new Friendly("No such match", `${d.event.name} has ${quals.length} qualification match${quals.length === 1 ? "" : "es"}${top !== quals.length ? ` (numbered up to ${top})` : ""}. Try a number from 1 to ${top}.`);
  }
  return predictEmbed(d, m, site());
}

/** /next: the team's next unplayed match, from the earliest of its events that isn't over (the schedule of each is
 *  read until one has it). No match scheduled yet is said plainly, naming the event it is entered in, rather than
 *  showing a match that has already been played. */
export async function nextLookup(number: number, now = Date.now()): Promise<APIEmbed> {
  const profile = await teamProfile(number);
  if (!profile) throw new Friendly("Team not found", `There's no FTC team ${number} in Control Scout's data.`);
  // The events it is entered in that aren't over yet, earliest first, read on each venue's own calendar (bot/next.ts).
  const ahead = aheadEvents(profile.events.filter((e) => e.season === CURRENT_SEASON), now);
  // One event at a time, earliest first: the first that has an unplayed match answers. A read that fails is not a
  // "nothing scheduled" — it fails the lookup, since the later events can't stand in for the one that couldn't be read.
  const read: EventDetail[] = [];
  for (const e of ahead) {
    const detail = await cachedEventDetail(e.season, e.code);
    // A null is an event that should be there and isn't readable (already over, or the row went): not an empty schedule,
    // so it fails the lookup rather than letting a later event answer as "the next one".
    if (!detail) throw new Friendly("Couldn't read the schedule", `Control Scout couldn't read ${e.name}'s schedule just now. Try again in a minute.`);
    read.push(detail);
    const found = nextPlaying([detail], number);
    if (!found) continue;
    const m = found.match, at = m.startsAt ? Date.parse(m.startsAt) : NaN;
    const when = Number.isFinite(at) ? `Starts <t:${Math.floor(at / 1000)}:R> (<t:${Math.floor(at / 1000)}:t>)` : m.time ? `Scheduled ${m.time.slice(11, 16)}` : "No time posted yet";
    return preMatchEmbed(found.event.event.name, m, site(), `${when} · next for ${teamLink(number, site())}.`);
  }
  // Nothing unplayed. Say which of the two it is: its matches at the current event are all played, or no schedule has
  // it yet — never that a published schedule is missing.
  const first = ahead[0];
  if (!first) throw new Friendly("No match scheduled", `Nothing is scheduled for ${teamLink(number, site())} yet this season. [See the team](${site()}/teams/${number}).`);
  const eventLink = (e: (typeof ahead)[number]) => `[${e.name}](${site()}/events/${e.season}/${encodeURIComponent(e.code)})`;
  // The latest event that does have the team on its schedule, in the order read: its matches there are all played.
  const finished = read.map((d, i) => (inEvent(d, number) ? i : -1)).filter((i) => i >= 0).pop();
  if (finished != null) {
    const later = ahead[finished + 1];
    throw new Friendly("No more matches", `${number} has no unplayed match left at ${eventLink(ahead[finished])}${later ? `; its next event is ${eventLink(later)}` : ""}.`);
  }
  const later = ahead.find((e) => e !== first);
  throw new Friendly("No match scheduled", `No schedule with ${number} at ${eventLink(first)} yet. The bot answers with the match as soon as FIRST publishes it${later ? `, and ${number} is entered in ${eventLink(later)}` : ""}.`);
}

export async function eventLookup(code: string): Promise<APIEmbed> {
  return eventEmbed(await eventFor(code), site());
}

export async function rankingsLookup(now = Date.now()): Promise<APIEmbed> {
  const r = await rankings({ season: CURRENT_SEASON, week: null, places: [], page: 1 }, now);
  if (!r.rows.length) {
    const first = await get<{ start: string }>(
      `SELECT start FROM events WHERE season = ? AND start >= ? AND type NOT IN (${NO_MATCH_TYPES.map(() => "?").join(",")}) ORDER BY start LIMIT 1`,
      [CURRENT_SEASON, today(now), ...NO_MATCH_TYPES]);
    const when = !first ? "" : first.start <= today(now) ? "; events are under way, so the first teams appear soon" : `; the next events start ${dates(first.start, null)}`;
    throw new Friendly("Rankings haven't started", `World rankings for ${seasonInfo(CURRENT_SEASON).label} start once teams have played ${RANKED_MIN_MATCHES} matches${when}.`);
  }
  return rankingsEmbed(r.rows, seasonInfo(CURRENT_SEASON).label, site());
}

// ---------------------------------------------------------------------------
// Autocomplete: events on now, coming up, or just finished (the last 3 days, so a played match can
// still be looked up the day after). One bounded read a minute, filtered in memory per keystroke.
// ---------------------------------------------------------------------------

export interface EventChoice { code: string; name: string; start: string | null; end: string | null }
let choices: { at: number; list: Promise<EventChoice[]> } | null = null;
const CHOICES_TTL_MS = 60_000;
/** Enough for every event of a busy fortnight; the list is a choice of 25, not a directory. */
const CHOICES_MAX = 2000;

export function eventChoices(now = Date.now()): Promise<EventChoice[]> {
  if (choices && now - choices.at < CHOICES_TTL_MS) return choices.list;
  const list = all<EventChoice>(
    `SELECT code, name, start, end FROM events WHERE season = ? AND start IS NOT NULL AND COALESCE(end, start) >= ?
       AND type NOT IN (${NO_MATCH_TYPES.map(() => "?").join(",")}) ORDER BY start, name LIMIT ?`,
    [CURRENT_SEASON, today(now - 3 * 864e5), ...NO_MATCH_TYPES, CHOICES_MAX]);
  choices = { at: now, list };
  list.catch(() => { if (choices?.list === list) choices = null; });
  return list;
}

/** Up to 25 choices for what's typed: a code match first, then events on now, then by start date. */
export function rankChoices(list: EventChoice[], typed: string, now = Date.now()): { name: string; value: string }[] {
  const q = typed.trim().toLowerCase();
  const d = today(now);
  const live = (e: EventChoice) => !!e.start && e.start <= d && (e.end ?? e.start) >= d;
  const score = (e: EventChoice) => {
    const code = e.code.toLowerCase(), name = e.name.toLowerCase();
    if (!q) return live(e) ? 0 : (e.end ?? e.start ?? "") >= d ? 1 : 2;
    if (code === q) return -2;
    if (code.startsWith(q)) return -1;
    if (name.includes(q) || code.includes(q)) return live(e) ? 0 : (e.end ?? e.start ?? "") >= d ? 1 : 2;
    return null;
  };
  return list
    .map((e) => ({ e, s: score(e) }))
    .filter((x): x is { e: EventChoice; s: number } => x.s != null)
    .sort((a, b) => a.s - b.s || (a.e.start ?? "").localeCompare(b.e.start ?? "") || a.e.name.localeCompare(b.e.name))
    .slice(0, 25)
    .map(({ e }) => {
      const tail = ` (${e.code}${live(e) ? ", live" : ""})`;
      const name = e.name.length + tail.length > 100 ? `${e.name.slice(0, 99 - tail.length)}…` : e.name;
      return { name: `${name}${tail}`, value: e.code };
    });
}
