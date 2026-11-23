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
  created_at: string; failures: number;
}

/** The follows the console lists: a team (with its name) or an event, and where each posts. */
export interface FollowRow { kind: "team" | "event"; team: number | null; event: string | null; channel_id: string; name: string | null }

export async function addFollow(guild: string, channel: string, target: FollowTarget, by: string, now = Date.now()): Promise<"added" | "already"> {
  if (target.kind === "team") {
    if (!(await teamKnown(target.team))) throw new Friendly("Team not found", `There's no FTC team ${target.team} in Control Scout's data.`);
  } else if (!(await get("SELECT 1 FROM events WHERE season = ? AND code = ?", [CURRENT_SEASON, target.event]))) {
    throw new Friendly("Event not found", `There's no event ${target.event} this season. Pick one with /follow event: from the list.`);
  }
  // The limit check and the insert are one statement, so two managers following at once can't pass it together.
  const added = await run(
    `INSERT OR IGNORE INTO discord_follows (guild_id, channel_id, kind, team, event, target, created_at, created_by)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM discord_follows WHERE guild_id = ?) < ?`,
    [guild, channel, target.kind, target.kind === "team" ? target.team : null, target.kind === "event" ? target.event : null,
      followKey(target), new Date(now).toISOString(), by, guild, MAX_FOLLOWS_PER_SERVER]);
  if (added) return "added";
  if (await get("SELECT 1 FROM discord_follows WHERE guild_id = ? AND channel_id = ? AND target = ?", [guild, channel, followKey(target)])) return "already";
  throw new Friendly("Too many follows", `A server can follow up to ${MAX_FOLLOWS_PER_SERVER} teams and events. Remove one with /unfollow first.`);
}

/** Stop following a team or an event (in one channel, or every channel of the server); how many follows went. */
export async function removeFollow(guild: string, target: FollowTarget, channel?: string | null): Promise<number> {
  return channel
    ? run("DELETE FROM discord_follows WHERE guild_id = ? AND target = ? AND channel_id = ?", [guild, followKey(target), channel])
    : run("DELETE FROM discord_follows WHERE guild_id = ? AND target = ?", [guild, followKey(target)]);
}

export async function listFollows(guild: string): Promise<FollowRow[]> {
  return (await all<any>(
    `SELECT f.kind, f.team, f.event, f.channel_id, t.name FROM discord_follows f LEFT JOIN teams t ON t.number = f.team
      WHERE f.guild_id = ? ORDER BY f.kind, COALESCE(f.team, 0), f.event, f.channel_id`, [guild],
  )).map((r) => ({
    kind: r.kind === "event" ? "event" as const : "team" as const,
    team: r.team == null ? null : Number(r.team), event: r.event ?? null, channel_id: String(r.channel_id), name: r.name ?? null,
  }));
}

/** /following: the server's teams and events, and where each one posts. */
export function followingEmbed(rows: FollowRow[], site: string): APIEmbed {
  return {
    title: "What this server follows",
    description: rows.length
      ? rows.map((r) => (r.kind === "event"
        ? `**Event ${r.event}** → <#${r.channel_id}>`
        : `**${teamLink(r.team ?? 0, site)}**${r.name ? ` ${r.name}` : ""} → <#${r.channel_id}>`)).join("\n")
      : "None yet. Use /follow team: for a team's matches and results, or /follow event: for a whole event.",
    color: VOLT,
    footer: { text: `Up to ${MAX_FOLLOWS_PER_SERVER} teams and events · ${FOOTER.text}` },
  };
}

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

export type Send = (channel: string, embed: APIEmbed) => Promise<"ok" | "gone" | "error">;

/**
 * One tick: read the follows, the followed teams' events on around today (entered, or with matches, from
 * yesterday to tomorrow), and post what's due: per match (a reminder, a result) and per event (the evening
 * before, the schedule, the day's recap; bot/eventAlerts.ts).
 */
export async function notifyTick(send: Send, site: string, log: (m: string) => void, now = Date.now()): Promise<number> {
  // Switched off by the owner (the discordBot feature toggle): nothing is posted, every follow is kept.
  if (!(await isEnabled("discordBot"))) return 0;
  const follows: Follow[] = (await all<any>("SELECT guild_id, channel_id, kind, team, event, created_at, failures FROM discord_follows"))
    .map((r) => ({
      guild_id: String(r.guild_id), channel_id: String(r.channel_id), kind: r.kind === "event" ? "event" as const : "team" as const,
      team: r.team == null ? null : Number(r.team), event: r.event ?? null, created_at: String(r.created_at), failures: Number(r.failures),
    }));
  if (!follows.length) return 0;
  const teams = [...new Set(follows.filter((f) => f.kind !== "event" && f.team != null).map((f) => f.team!))];
  const codes = [...new Set(follows.filter((f) => f.kind === "event" && f.event).map((f) => f.event!))];
  const day = (n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  // The events to look at: the followed teams' events on around today (entered, or with matches, from yesterday to
  // tomorrow), and every event a server follows by code. A stale event's posts are keyed by day (bot/eventAlerts.ts),
  // so nothing old ever repeats.
  const found: { code: string }[] = [];
  if (teams.length) {
    const ph = teams.map(() => "?").join(",");
    found.push(...await all<{ code: string }>(
      `SELECT e.code FROM events e WHERE e.season = ? AND e.start <= ? AND COALESCE(e.end, e.start) >= ?
         AND (EXISTS (SELECT 1 FROM event_teams et WHERE et.season = e.season AND et.code = e.code AND et.team IN (${ph}))
           OR EXISTS (SELECT 1 FROM match_teams mt WHERE mt.season = e.season AND mt.code = e.code AND mt.team IN (${ph})))`,
      [CURRENT_SEASON, day(2), day(-1), ...teams, ...teams]));
  }
  if (codes.length) {
    found.push(...await all<{ code: string }>(`SELECT code FROM events WHERE season = ? AND code IN (${codes.map(() => "?").join(",")})`, [CURRENT_SEASON, ...codes]));
  }
  const events = [...new Map(found.map((e) => [e.code, e])).values()];
  let posted = 0;
  // Claim, send, mark sent; a failure gives the claim back (and counts toward dropping a channel that's gone).
  const deliver = async (channel: string, code: string, key: string, kind: string, embed: () => Promise<APIEmbed> | APIEmbed) => {
    const k = [channel, CURRENT_SEASON, code, key, kind];
    const t = new Date(now).toISOString();
    const claimed = (await run(
      "INSERT OR IGNORE INTO discord_posts (channel_id, season, code, match_key, kind, claimed_at) VALUES (?, ?, ?, ?, ?, ?)", [...k, t]))
      || (await run(
        "UPDATE discord_posts SET claimed_at = ? WHERE channel_id = ? AND season = ? AND code = ? AND match_key = ? AND kind = ? AND sent_at IS NULL AND claimed_at < ?",
        [t, ...k, new Date(now - CLAIM_STALE_MS).toISOString()]));
    if (!claimed) return;
    const r = await send(channel, pride(await embed()));
    if (r === "ok") {
      posted++;
      await run("UPDATE discord_posts SET sent_at = ? WHERE channel_id = ? AND season = ? AND code = ? AND match_key = ? AND kind = ?", [new Date().toISOString(), ...k]);
      await run("UPDATE discord_follows SET failures = 0 WHERE channel_id = ? AND failures > 0", [channel]);
      return;
    }
    await run("DELETE FROM discord_posts WHERE channel_id = ? AND season = ? AND code = ? AND match_key = ? AND kind = ? AND sent_at IS NULL", k);
    if (r === "gone") {
      await run("UPDATE discord_follows SET failures = failures + 1 WHERE channel_id = ?", [channel]);
      const dropped = await run("DELETE FROM discord_follows WHERE channel_id = ? AND failures >= ?", [channel, MAX_FAILURES]);
      if (dropped) log(`follows: dropped ${dropped} in channel ${channel} after ${MAX_FAILURES} failed posts`);
    }
  };
  for (const ev of events) {
    const d = await cachedEventDetail(CURRENT_SEASON, ev.code);
    if (!d) continue;
    for (const due of dueNow(follows, d.matches, now)) await deliver(due.channel, ev.code, due.match.key, due.kind, () => postEmbed(due, d, site));
    const today = venueClock(now, d.event.timezone ?? null).date;
    for (const due of eventDue(follows, d, now)) {
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
  return posted;
}
