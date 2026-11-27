// Automatic posts: a server follows a team in one of its channels (/follow), and the bot posts there
// 15 minutes before each of that team's matches (lineups, win odds, predicted score) and again once the
// match has a result (the score and whether the call was right); plus, per event, the evening before, when
// its schedule is posted, and a recap at the end of each day (bot/eventAlerts.ts). A follow can name an event instead
// of a team (`/follow event:`): the same evening-before and recap posts, for the whole event, and the event's schedule
// once it's posted. Built on the site's own match views, read from the same database the live lane keeps fresh every
// minute. Each post is written to discord_posts before it's sent, so a restart, a second bot tick or two followed teams
// in one match never post twice.
import type { APIEmbed } from "discord.js";
import { all, get, run } from "../server/db.js";
import { isEnabled } from "../server/flags.js";
import { CURRENT_SEASON } from "../server/data/seasons.js";
import { cachedEventDetail } from "../server/api/events.js";
import { seasonStats, teamKnown } from "../server/api/teams.js";
import { eventDue, eventRecapEmbed, eventScheduleEmbed, eveEmbed, recapEmbed, scheduleEmbed, venueClock } from "./eventAlerts.js";
import { alertEmbed, alertKey, changedMatches, eventChanged, eventChangeEmbed, loadEventState, loadMatchState, onDeckDue, onDeckLead, saveEventState, saveMatchState } from "./eventChanges.js";
import { DEFAULT_SETTINGS, allSettings, allows, inQuietHours, pings, type GuildSettings } from "./settings.js";
import type { EventDetail, MatchView } from "../src/shared/api.js";
import { FOOTER, Friendly, VOLT, linkedAlliance, pride, preMatchEmbed, resultEmbed, teamLink, teamsOf } from "./views.js";

/** How long before a match the reminder goes out. */
export const REMIND_MS = 15 * 60_000;
/** A result older than this (bot down, a late follow) is never posted. */
export const RESULT_WINDOW_MS = 6 * 3600_000;
/** Teams and events one server can follow (each can be in its own channel). */
export const MAX_FOLLOWS_PER_SERVER = 10;
/** Failed sends in a row (channel deleted, access removed) before a follow is dropped. */
export const MAX_FAILURES = 5;
/** A claim this old that was never marked sent (the bot stopped mid-send) may be taken again. */
export const CLAIM_STALE_MS = 2 * 60_000;

/** What a follow names: a team's matches and events, or a whole event's (/follow event:). */
export type FollowTarget = { kind: "team"; team: number } | { kind: "event"; event: string };

/** A follow's key (`target` in the table): what it names, in one string, so a team and an event never collide. */
export const followKey = (t: FollowTarget) => (t.kind === "team" ? `team:${t.team}` : `event:${t.event}`);
/** A follow as a post and the console name it: the team number, or the event's code. */
export const followName = (t: FollowTarget) => (t.kind === "team" ? String(t.team) : t.event);

/** A follow, as the tick reads it. `kind` is absent only on hand-built ones (a team follow, as every follow was). */
export interface Follow {
  guild_id: string; channel_id: string;
  kind?: "team" | "event";
  /** A team follow's number; null on an event follow. */
  team: number | null;
  /** An event follow's code; null on a team follow. */
  event?: string | null;
  /** The season an event follow belongs to: codes repeat (an event code names a different event next season), so a
   *  follow only ever ticks for the season it was made in. Unset on a team follow, and on a hand-built one. */
  season?: number | null;
  created_at: string; failures: number;
  /** Who made the follow (a Discord user id), for the DM when it stops. */
  created_by?: string | null;
  /** Set when posts stopped for good: when, and why. A stopped follow is kept (so it can say so and be revived), never
   *  ticked. */
  dropped_at?: string | null;
  drop_reason?: string | null;
}

/** The follows the console lists: a team (with its name) or an event, where each posts, and what happens next. */
export interface FollowRow {
  kind: "team" | "event"; team: number | null; event: string | null; channel_id: string; name: string | null; stopped: boolean;
  /** The next post this follow will make: its moment when one is known (a reminder's), else just what it is. Null: the
   *  event is over, or nothing is scheduled yet. */
  next: { at: number | null; what: string } | null;
}

export async function addFollow(guild: string, channel: string, target: FollowTarget, by: string, now = Date.now()): Promise<"added" | "already"> {
  if (target.kind === "team") {
    if (!(await teamKnown(target.team))) throw new Friendly("Team not found", `There's no FTC team ${target.team} in Control Scout's data.`);
  } else if (!(await get("SELECT 1 FROM events WHERE season = ? AND code = ?", [CURRENT_SEASON, target.event]))) {
    throw new Friendly("Event not found", `There's no event ${target.event} this season. Pick one with /follow event: from the list.`);
  }
  // A follow belongs to the season it is made in: the same code next season is a different event, so following it
  // again moves the follow to this season rather than leaving last season's row to tick (or to say "already").
  if (target.kind === "event") {
    await run("UPDATE discord_follows SET season = ? WHERE guild_id = ? AND channel_id = ? AND target = ? AND season IS NOT ?",
      [CURRENT_SEASON, guild, channel, followKey(target), CURRENT_SEASON]);
  }
  // The limit check and the insert are one statement, so two managers following at once can't pass it together.
  const added = await run(
    `INSERT OR IGNORE INTO discord_follows (guild_id, channel_id, kind, team, event, season, target, created_at, created_by)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM discord_follows WHERE guild_id = ?) < ?`,
    [guild, channel, target.kind, target.kind === "team" ? target.team : null, target.kind === "event" ? target.event : null,
      target.kind === "event" ? CURRENT_SEASON : null, followKey(target), new Date(now).toISOString(), by, guild, MAX_FOLLOWS_PER_SERVER]);
  if (added) return "added";
  // A follow that stopped because its channel kept refusing posts is revived by following it again, instead of reading
  // "already" while nothing can ever post there.
  const revived = await run(
    "UPDATE discord_follows SET dropped_at = NULL, drop_reason = NULL, failures = 0 WHERE guild_id = ? AND channel_id = ? AND target = ? AND dropped_at IS NOT NULL",
    [guild, channel, followKey(target)]);
  if (revived) return "added";
  if (await get("SELECT 1 FROM discord_follows WHERE guild_id = ? AND channel_id = ? AND target = ?", [guild, channel, followKey(target)])) return "already";
  throw new Friendly("Too many follows", `A server can follow up to ${MAX_FOLLOWS_PER_SERVER} teams and events. Remove one with /unfollow first.`);
}

/** Stop following a team or an event (in one channel, or every channel of the server); how many follows went. */
export async function removeFollow(guild: string, target: FollowTarget, channel?: string | null): Promise<number> {
  return channel
    ? run("DELETE FROM discord_follows WHERE guild_id = ? AND target = ? AND channel_id = ?", [guild, followKey(target), channel])
    : run("DELETE FROM discord_follows WHERE guild_id = ? AND target = ?", [guild, followKey(target)]);
}

export async function listFollows(guild: string, now = Date.now()): Promise<FollowRow[]> {
  const rows = await all<any>(
    `SELECT f.kind, f.team, f.event, f.season, f.channel_id, f.dropped_at, t.name FROM discord_follows f LEFT JOIN teams t ON t.number = f.team
      WHERE f.guild_id = ? ORDER BY f.kind, COALESCE(f.team, 0), f.event, f.channel_id`, [guild]);
  const today = new Date(now).toISOString().slice(0, 10);
  return Promise.all(rows.map(async (r) => ({
    kind: r.kind === "event" ? "event" as const : "team" as const,
    team: r.team == null ? null : Number(r.team), event: r.event ?? null, channel_id: String(r.channel_id), name: r.name ?? null,
    stopped: !!r.dropped_at,
    next: r.dropped_at ? null : r.kind === "event"
      ? await nextEventPost(String(r.event), r.season == null ? null : Number(r.season), today)
      : await nextTeamPost(Number(r.team), now),
  })));
}

/** What a team follow posts next: the reminder for its next unplayed match at an event that isn't over (the match's
 *  start less REMIND_MS), read from the same schedule the tick reads. Null: nothing scheduled yet. */
async function nextTeamPost(team: number, now: number): Promise<FollowRow["next"]> {
  const today = new Date(now).toISOString().slice(0, 10);
  const r = await get<{ at: string | null }>(
    `SELECT MIN(m.time) AS at FROM match_teams mt
       JOIN matches m ON m.season = mt.season AND m.code = mt.code AND m.level = mt.level AND m.series = mt.series AND m.number = mt.number
       JOIN events e ON e.season = m.season AND e.code = m.code
      WHERE mt.season = ? AND mt.team = ? AND m.played = 0 AND m.time IS NOT NULL AND COALESCE(e.end, e.start) >= ?`,
    [CURRENT_SEASON, team, today]).catch(() => null);
  const at = r?.at ? Date.parse(r.at) : NaN;
  if (!Number.isFinite(at) || at - REMIND_MS < now - RESULT_WINDOW_MS) return null;
  return { at: at - REMIND_MS, what: "reminder" };
}

/** What an event follow posts next: its recap after today's last match, the evening before it starts, or nothing when
 *  it is over or this season's follow has gone stale. */
async function nextEventPost(code: string, season: number | null, today: string): Promise<FollowRow["next"]> {
  const r = await get<{ start: string | null; end: string | null; quals: number }>(
    `SELECT e.start, e.end, (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.level = 'qual') AS quals
       FROM events e WHERE e.season = ? AND e.code = ?`, [CURRENT_SEASON, code]).catch(() => null);
  if (!r) return season != null && season !== CURRENT_SEASON ? { at: null, what: "not this season's event (follow it again)" } : null;
  if (r.end && r.end < today) return null;
  if (Number(r.quals) > 0) return { at: null, what: "a recap after the day's last match" };
  if (r.start && r.start > today) return { at: null, what: `the evening before it starts (${r.start})` };
  return { at: null, what: "the schedule, once FIRST posts it" };
}

/** /following: the server's teams and events, and where each one posts. */
export function followingEmbed(rows: FollowRow[], site: string): APIEmbed {
  return {
    title: "What this server follows",
    description: rows.length
      ? rows.map((r) => (r.kind === "event"
        ? `**Event ${r.event}** → <#${r.channel_id}>${r.stopped ? " — stopped (the channel refused posts); follow it again to restart" : nextWords(r.next)}`
        : `**${teamLink(r.team ?? 0, site)}**${r.name ? ` ${r.name}` : ""} → <#${r.channel_id}>${r.stopped ? " — stopped (the channel refused posts); follow it again to restart" : nextWords(r.next)}`)).join("\n")
      : "None yet. Use /follow team: for a team's matches and results, or /follow event: for a whole event.",
    color: VOLT,
    footer: { text: `Up to ${MAX_FOLLOWS_PER_SERVER} teams and events · ${FOOTER.text}` },
  };
}

/** A follow's next post as /following shows it: "next: reminder in 3 hours", or just what it is when it has no moment. */
const nextWords = (n: FollowRow["next"]) => (!n ? " · next: nothing scheduled" : n.at ? ` · next: ${n.what} <t:${Math.floor(n.at / 1000)}:R>` : ` · next: ${n.what}`);

/** The posts sent today (UTC), for the console's numbers: one count, not a stream. */
export async function postUsage(now = Date.now()): Promise<number> {
  const at = `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`;
  const r = await get<{ n: number }>("SELECT COUNT(*) AS n FROM discord_posts WHERE sent_at >= ?", [at]);
  return Number(r?.n ?? 0);
}

// ---------------------------------------------------------------------------
// The tick: every minute, what's due.
// ---------------------------------------------------------------------------

export type Kind = "reminder" | "result";
export interface Due { channel: string; follows: Follow[]; match: MatchView; kind: Kind; teams: number[] }

const startOf = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
/** The match's teams: for a played one, only the robots that were on the field (a playoff alliance lists a third who may sit out). */
const inMatch = (m: MatchView) => {
  const side = (s: MatchView["red"]) => (m.played && s.teams.some((t) => t.onField) ? s.teams.filter((t) => t.onField) : s.teams);
  return new Set([...side(m.red), ...side(m.blue)].map((t) => t.number));
};

/**
 * What to post now, by channel (pure, tested): a reminder when a followed team's unplayed match starts within
 * REMIND_MS, a result once it's played (its start within RESULT_WINDOW_MS). Only matches that start after the
 * follow was made, so following a team mid-event doesn't post a backlog. One entry per channel and match,
 * naming every followed team in it.
 */
export function dueNow(follows: Follow[], matches: MatchView[], now: number): Due[] {
  const out = new Map<string, Due>();
  for (const m of matches) {
    const at = startOf(m);
    if (!Number.isFinite(at)) continue;
    // A played match counts as a result only once both scores are posted: marked played with a score missing, it
    // waits (posting it would read as a tie at 0, and its claim would keep the real result from ever posting).
    const scored = !!m.red.score && !!m.blue.score;
    const kind: Kind | null = !m.played ? (at > now && at - now <= REMIND_MS ? "reminder" : null) : (scored && now - at <= RESULT_WINDOW_MS ? "result" : null);
    if (!kind) continue;
    const teams = inMatch(m);
    for (const f of follows) {
      // Per-match posts are a team follow's (an event follow gets its own schedule and recap posts, bot/eventAlerts.ts).
      if ((f.kind ?? "team") !== "team" || f.team == null) continue;
      if (!teams.has(f.team) || at < Date.parse(f.created_at)) continue;
      const key = `${f.channel_id}|${m.code}|${m.key}|${kind}`;
      const d = out.get(key) ?? { channel: f.channel_id, follows: [], match: m, kind, teams: [] };
      d.follows.push(f);
      if (!d.teams.includes(f.team)) d.teams.push(f.team);
      out.set(key, d);
    }
  }
  return [...out.values()];
}

/**
 * The reminder's first line: each followed team's side and partner, then the time.
 * "[4215](…) on Blue with [23545](…), in 15 minutes (4:30 PM)." (Discord shows the times in each reader's zone.)
 */
export function reminderLead(d: Pick<Due, "match" | "teams">, site: string): string {
  const m = d.match, at = Math.floor(startOf(m) / 1000);
  const sides = (["red", "blue"] as const).map((s) => {
    const all = teamsOf(m[s], false), mine = d.teams.filter((t) => all.includes(t));
    if (!mine.length) return null;
    const partners = all.filter((t) => !mine.includes(t));
    return `${linkedAlliance(mine, site)} on ${s === "red" ? "Red" : "Blue"}${partners.length ? ` with ${linkedAlliance(partners, site)}` : ""}`;
  }).filter(Boolean);
  return `${sides.join("; ")}, <t:${at}:R> (<t:${at}:t>).`;
}

/** The followed teams' next unplayed match at the event after this one (the earliest, when there are several). */
export function nextMatch(matches: MatchView[], after: MatchView, teams: number[]): { match: MatchView; team: number | null } | null {
  // Schedule order (quals before playoffs, then series and number), so a match whose time isn't posted yet still
  // counts; its line just goes without a time.
  const order = (a: MatchView, b: MatchView) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number;
  const next = matches
    .filter((m) => !m.played && m.key !== after.key && order(m, after) > 0)
    .filter((m) => teams.some((t) => teamsOf(m.red, false).includes(t) || teamsOf(m.blue, false).includes(t)))
    .sort(order)[0];
  if (!next) return null;
  const team = teams.length > 1 ? teams.find((t) => teamsOf(next.red, false).includes(t) || teamsOf(next.blue, false).includes(t)) ?? null : null;
  return { match: next, team };
}

/** The post: the match design, about the followed teams (their side before, their outcome after). */
export function postEmbed(d: Due, ev: Pick<EventDetail, "event" | "matches">, site: string): APIEmbed {
  if (d.kind === "reminder") return preMatchEmbed(ev.event.name, d.match, site, reminderLead(d, site));
  return resultEmbed(ev.event.name, d.match, site, { next: nextMatch(ev.matches, d.match, d.teams) });
}

export type Send = (channel: string, embed: APIEmbed, opts?: { ping?: string | null }) => Promise<"ok" | "gone" | "error">;
/** A direct message to one person: how a stopped follow reaches whoever set it up. */
export type Dm = (user: string, text: string) => Promise<unknown>;

/**
 * One tick: read the follows, the followed teams' events on around today (entered, or with matches, from
 * yesterday to tomorrow), and post what's due: per match (a reminder, a result) and per event (the evening
 * before, the schedule, the day's recap; bot/eventAlerts.ts).
 */
export interface TickResult {
  /** Posts sent this tick. */
  posted: number;
  /** Sends Discord refused for a reason other than the channel being gone (the next tick retries them). */
  failed: number;
}

/**
 * The season notice: an event follow made in an earlier season, whose code is an event this season, is moved to this
 * season's event and told once. A code repeats (AUSYQ1 names a different meet next season), so the tick only ever posts
 * a current season's event — without this the follow would go silent for good rather than follow the new one.
 */
export interface Rollover { channel: string; guild: string; code: string; name: string; from: number }
export function rolloverDue(follows: Follow[], names: Map<string, string>, season = CURRENT_SEASON): Rollover[] {
  const out = new Map<string, Rollover>();
  for (const f of follows) {
    if ((f.kind ?? "team") !== "event" || !f.event || f.dropped_at) continue;
    if (f.season == null || f.season === season) continue;
    const name = names.get(f.event);
    if (!name) continue;
    const key = `${f.channel_id}|${f.event}`;
    if (!out.has(key)) out.set(key, { channel: f.channel_id, guild: f.guild_id, code: f.event, name, from: f.season });
  }
  return [...out.values()];
}

export async function notifyTick(send: Send, site: string, log: (m: string) => void, now = Date.now(), dm?: Dm): Promise<TickResult> {
  // Switched off by the owner (the discordBot feature toggle): nothing is posted, every follow is kept.
  if (!(await isEnabled("discordBot"))) return { posted: 0, failed: 0 };
  const follows: Follow[] = (await all<any>("SELECT guild_id, channel_id, kind, team, event, season, created_at, created_by, failures, dropped_at, drop_reason FROM discord_follows"))
    .map((r) => ({
      guild_id: String(r.guild_id), channel_id: String(r.channel_id), kind: r.kind === "event" ? "event" as const : "team" as const,
      team: r.team == null ? null : Number(r.team), event: r.event ?? null, season: r.season == null ? null : Number(r.season),
      created_at: String(r.created_at), failures: Number(r.failures), created_by: r.created_by ?? null,
      dropped_at: r.dropped_at ?? null, drop_reason: r.drop_reason ?? null,
    }));
  if (!follows.length) return { posted: 0, failed: 0 };
  // A stopped follow is kept for the record, never ticked: its channel refused posts until the follow was stopped.
  const active = follows.filter((f) => !f.dropped_at);
  // What each channel's server asked of its posts (bot/settings.ts, /settings): quiet hours, no match heads-ups, a ping
  // role. One read a minute; a failed read posts as before rather than going silent.
  const configured = await allSettings().catch(() => new Map<string, GuildSettings>());
  const settingsOf = new Map<string, GuildSettings>();
  for (const f of active) settingsOf.set(f.channel_id, configured.get(f.guild_id) ?? DEFAULT_SETTINGS);
  const settingsFor = (channel: string) => settingsOf.get(channel) ?? DEFAULT_SETTINGS;
  const teams = [...new Set(active.filter((f) => f.kind !== "event" && f.team != null).map((f) => f.team!))];
  // Only this season's event follows: a code repeats, and last season's follow must not post this season's event.
  const codes = [...new Set(active.filter((f) => f.kind === "event" && f.event && f.season === CURRENT_SEASON).map((f) => f.event!))];
  const day = (n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  // The events to look at: every event a followed team is entered in that isn't over, and every event a server follows
  // by code. Not a window around today: FIRST often posts a meet's schedule weeks before it, and a window would hold
  // that post back until the event was nearly here — and an event with no date published, or one that has ended with a
  // match still unplayed (moved), would never be looked at at all. What actually posts is still decided by each post's
  // own moment (bot/eventAlerts.ts: the evening before, the day of, fifteen minutes before a match), and a stale
  // event's posts are keyed by day, so nothing old ever repeats.
  const found: { code: string }[] = [];
  if (teams.length) {
    const ph = teams.map(() => "?").join(",");
    found.push(...await all<{ code: string }>(
      `SELECT e.code FROM events e WHERE e.season = ?
         AND (e.start IS NULL OR COALESCE(e.end, e.start) >= ?
           OR EXISTS (SELECT 1 FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 0
                        AND (m.time IS NULL OR substr(m.time, 1, 10) >= ?)))
         AND (EXISTS (SELECT 1 FROM event_teams et WHERE et.season = e.season AND et.code = e.code AND et.team IN (${ph}))
           OR EXISTS (SELECT 1 FROM match_teams mt WHERE mt.season = e.season AND mt.code = e.code AND mt.team IN (${ph})))`,
      [CURRENT_SEASON, day(-1), day(-1), ...teams, ...teams]));
  }
  if (codes.length) {
    found.push(...await all<{ code: string }>(`SELECT code FROM events WHERE season = ? AND code IN (${codes.map(() => "?").join(",")})`, [CURRENT_SEASON, ...codes]));
  }
  const events = [...new Map(found.map((e) => [e.code, e])).values()];
  let posted = 0, failed = 0;
  // Claim, send, mark sent; a failure gives the claim back (and counts toward dropping a channel that's gone). False:
  // nothing was sent, so a change-based alert's state must not advance past it. A post this server's settings silence is
  // not sent and not retried (true: nothing to come back to).
  const deliver = async (channel: string, code: string, key: string, kind: string, embed: () => Promise<APIEmbed> | APIEmbed): Promise<boolean> => {
    const setting = settingsFor(channel);
    if (!allows(setting, kind, now)) return true;
    const k = [channel, CURRENT_SEASON, code, key, kind];
    const t = new Date(now).toISOString();
    const claimed = (await run(
      "INSERT OR IGNORE INTO discord_posts (channel_id, season, code, match_key, kind, claimed_at) VALUES (?, ?, ?, ?, ?, ?)", [...k, t]))
      || (await run(
        "UPDATE discord_posts SET claimed_at = ? WHERE channel_id = ? AND season = ? AND code = ? AND match_key = ? AND kind = ? AND sent_at IS NULL AND claimed_at < ?",
        [t, ...k, new Date(now - CLAIM_STALE_MS).toISOString()]));
    if (!claimed) return true;
    const r = await send(channel, pride(await embed()), { ping: pings(setting, kind) });
    if (r !== "ok" && r !== "gone") failed++;
    if (r === "ok") {
      posted++;
      await run("UPDATE discord_posts SET sent_at = ? WHERE channel_id = ? AND season = ? AND code = ? AND match_key = ? AND kind = ?", [new Date().toISOString(), ...k]);
      await run("UPDATE discord_follows SET failures = 0 WHERE channel_id = ? AND failures > 0", [channel]);
      return true;
    }
    await run("DELETE FROM discord_posts WHERE channel_id = ? AND season = ? AND code = ? AND match_key = ? AND kind = ? AND sent_at IS NULL", k);
    if (r === "gone") {
      await run("UPDATE discord_follows SET failures = failures + 1 WHERE channel_id = ?", [channel]);
      // Kept, not deleted: the follow says it stopped and why, can be revived by following again, and the console can
      // show it. Its creator is told once, since the channel itself can't be posted in.
      // RETURNING the rows this statement actually stopped: `follows` is the tick's snapshot, and another failed post
      // for this channel may already have added a failure since, so the snapshot can name a follow that is still running.
      const stopped = await all<{ created_by: string | null; kind: string; team: number | null; event: string | null }>(
        "UPDATE discord_follows SET dropped_at = ?, drop_reason = 'the channel refused posts' WHERE channel_id = ? AND failures >= ? AND dropped_at IS NULL RETURNING created_by, kind, team, event",
        [new Date(now).toISOString(), channel, MAX_FAILURES]);
      if (stopped.length) {
        log(`follows: stopped ${stopped.length} in channel ${channel} after ${MAX_FAILURES} failed posts`);
        for (const f of stopped) {
          if (!f.created_by || !dm) continue;
          const what = f.kind === "event" ? `event ${f.event}` : `team ${f.team}`;
          void dm(f.created_by, `Control Scout stopped posting ${what} in <#${channel}> because Discord kept refusing messages there. Give it View Channel, Send Messages and Embed Links, then run /follow again to restart it.`).catch(() => {});
        }
      }
    }
    return false;
  };
  // Season rollover: an event follow from an earlier season whose code is this season's event again follows this one,
  // and the channel is told once. Stale codes with no event this season are left alone: there is nothing to follow.
  const stale = [...new Set(active.filter((f) => f.kind === "event" && f.event && f.season != null && f.season !== CURRENT_SEASON).map((f) => f.event!))];
  if (stale.length) {
    const named = new Map((await all<{ code: string; name: string }>(
      `SELECT code, name FROM events WHERE season = ? AND code IN (${stale.map(() => "?").join(",")})`, [CURRENT_SEASON, ...stale])).map((e) => [String(e.code), String(e.name)]));
    for (const r of rolloverDue(active, named)) {
      // Quiet hours wait: the channel has to be told it now follows this season's event, so the follow keeps its old
      // season (and this is tried again next tick) rather than moving without a word.
      if (inQuietHours(settingsFor(r.channel).quiet, now)) continue;
      const moved = await deliver(r.channel, r.code, `season:${r.from}`, "rollover", () => ({
        title: `Following ${r.name} again`,
        description: `This channel followed event **${r.code}** in ${r.from + 1}–${String(r.from + 2).slice(2)}. ${r.code} names this season's ${r.name}, so these posts follow it from now on. \`/unfollow event:${r.code}\` stops them.`,
        color: VOLT, footer: FOOTER,
      }));
      if (moved) await run("UPDATE discord_follows SET season = ? WHERE guild_id = ? AND channel_id = ? AND target = ?", [CURRENT_SEASON, r.guild, r.channel, `event:${r.code}`]);
    }
  }
  for (const ev of events) {
    const d = await cachedEventDetail(CURRENT_SEASON, ev.code);
    if (!d) continue;
    // The event's own dates as the last tick saw them: a meet moved to another weekend is posted once.
    const was = await loadEventState(CURRENT_SEASON, ev.code).catch(() => null);
    let datesTold = true;
    if (was) for (const a of eventChanged(active, d, was)) {
      if (!(await deliver(a.channel, ev.code, a.key, "dates", () => eventChangeEmbed(d, a, site)))) datesTold = false;
    }
    // A channel that refused the alert keeps the dates it was told about, so the next tick sees the move again; a channel
    // this server's settings silenced counts as told, like every other change alert.
    if (datesTold) await saveEventState(CURRENT_SEASON, ev.code, d, now).catch((e) => log(`follows: couldn't record ${ev.code}'s dates (${(e as Error)?.message ?? String(e)})`));
    // The schedule as the last tick saw it: a moved match, a changed lineup or a new one is posted once. The first
    // sight of an event only records it (changedMatches returns nothing for an empty map).
    const prev = await loadMatchState(CURRENT_SEASON, ev.code).catch(() => null);
    if (prev) {
      // A failed alert keeps that match's old state, so the next tick still sees the change and the claim releases it
      // for another try (an already-sent channel stays quiet: its claim is not deleted).
      const retry = new Set<string>();
      for (const a of changedMatches(active, d.matches, prev, now)) {
        // Each new time or lineup is its own post, not swallowed by the first change's claim.
        if (!(await deliver(a.channel, ev.code, alertKey(a), a.kind, () => alertEmbed(a, d.event.name, site, now)))) retry.add(a.match.key);
      }
      for (const c of onDeckDue(active, d.matches, now)) {
        await deliver(c.channel, ev.code, c.match.key, "ondeck", () => preMatchEmbed(d.event.name, c.match, site, onDeckLead(c.match, c.ahead, c.nowPlaying)));
      }
      await saveMatchState(CURRENT_SEASON, ev.code, d.matches, now, retry).catch((e) => log(`follows: couldn't record ${ev.code}'s schedule (${(e as Error)?.message ?? String(e)})`));
    }
    for (const due of dueNow(active, d.matches, now)) await deliver(due.channel, ev.code, due.match.key, due.kind, () => postEmbed(due, d, site));
    const today = venueClock(now, d.event.timezone ?? null).date;
    for (const due of eventDue(active, d, now)) {
      await deliver(due.channel, ev.code, due.key, due.kind, async () => {
        // No teams: an event follow's own post (a team follow always names at least one).
        if (!due.teams.length) {
          if (due.kind === "schedule") return eventScheduleEmbed(d, site);
          if (due.kind === "recap") return eventRecapEmbed(d, today, site);
          return eveEmbed(due, d, [], site);
        }
        if (due.kind === "schedule") return scheduleEmbed(due, d, site);
        if (due.kind === "recap") return recapEmbed(due, d, today, site);
        const seasons = await Promise.all(due.teams.map(async (t) => {
          const s = await seasonStats(CURRENT_SEASON, t).catch(() => null);
          return { team: t, name: d.field.find((f) => f.team === t)?.name ?? null, opr: s?.opr.np.value ?? null, worldRank: s?.rating?.rank ?? null };
        }));
        return eveEmbed(due, d, seasons, site);
      });
    }
  }
  // The post log only needs to outlive an event's windows.
  await run("DELETE FROM discord_posts WHERE claimed_at < ?", [new Date(now - 14 * 864e5).toISOString()]);
  return { posted, failed };
}
