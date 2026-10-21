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
import { Friendly, dates, eventEmbed, predictEmbed, rankingsEmbed, teamEmbed } from "./views.js";

/** The site's public address, for every link in an embed (controlscout.org in production). */
export const site = () => env.canonicalUrl.replace(/\/+$/, "");
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export async function teamLookup(number: number): Promise<APIEmbed> {
  const profile = await teamProfile(number);
  if (!profile) throw new Friendly("Team not found", `There's no FTC team ${number} in Control Scout's data.`);
  return teamEmbed({ profile, seasonLabel: seasonInfo(profile.season).label, today: today() }, site());
}

/** An event of the current season by its code (any case), or by its exact name. */
async function eventCode(input: string): Promise<string> {
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
