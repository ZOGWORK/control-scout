// Automatic posts: a server follows a team in one of its channels (/follow), and the bot posts there
// 15 minutes before each of that team's matches (lineups, win odds, predicted score) and again once the
// match has a result (the score and whether the call was right). Built on the site's own match views, read
// from the same database the live lane keeps fresh every minute. Each post is written to discord_posts
// before it's sent, so a restart, a second bot tick or two followed teams in one match never post twice.
import type { APIEmbed } from "discord.js";
import { all, get, run } from "../server/db.js";
import { CURRENT_SEASON } from "../server/data/seasons.js";
import { matchViews } from "../server/api/matches.js";
import { teamKnown } from "../server/api/teams.js";
import type { MatchView } from "../src/shared/api.js";
import { Friendly, VOLT, predictEmbed } from "./views.js";

/** How long before a match the reminder goes out. */
export const REMIND_MS = 15 * 60_000;
/** A result older than this (bot down, a late follow) is never posted. */
export const RESULT_WINDOW_MS = 6 * 3600_000;
/** Teams one server can follow (each can be in its own channel). */
export const MAX_FOLLOWS_PER_SERVER = 10;
/** Failed sends in a row (channel deleted, access removed) before a follow is dropped. */
export const MAX_FAILURES = 5;

export interface Follow { guild_id: string; channel_id: string; team: number; created_at: string; failures: number }

export async function addFollow(guild: string, channel: string, team: number, by: string, now = Date.now()): Promise<"added" | "already"> {
  if (!(await teamKnown(team))) throw new Friendly("Team not found", `There's no FTC team ${team} in Control Scout's data.`);
  const n = await get<{ n: number }>("SELECT COUNT(*) n FROM discord_follows WHERE guild_id = ?", [guild]);
  const exists = await get("SELECT 1 FROM discord_follows WHERE guild_id = ? AND channel_id = ? AND team = ?", [guild, channel, team]);
  if (exists) return "already";
  if (Number(n?.n ?? 0) >= MAX_FOLLOWS_PER_SERVER) throw new Friendly("Too many teams", `A server can follow up to ${MAX_FOLLOWS_PER_SERVER} teams. Remove one with /unfollow first.`);
  await run("INSERT INTO discord_follows (guild_id, channel_id, team, created_at, created_by) VALUES (?, ?, ?, ?, ?)", [guild, channel, team, new Date(now).toISOString(), by]);
  return "added";
}

/** Stop following a team (in one channel, or every channel of the server); how many follows went. */
export async function removeFollow(guild: string, team: number, channel?: string | null): Promise<number> {
  return channel
    ? run("DELETE FROM discord_follows WHERE guild_id = ? AND team = ? AND channel_id = ?", [guild, team, channel])
    : run("DELETE FROM discord_follows WHERE guild_id = ? AND team = ?", [guild, team]);
}

export async function listFollows(guild: string): Promise<{ team: number; channel_id: string; name: string | null }[]> {
  return (await all<any>(
    "SELECT f.team, f.channel_id, t.name FROM discord_follows f LEFT JOIN teams t ON t.number = f.team WHERE f.guild_id = ? ORDER BY f.team, f.channel_id", [guild],
  )).map((r) => ({ team: Number(r.team), channel_id: String(r.channel_id), name: r.name ?? null }));
}

/** /following: the server's teams and where each one posts. */
export function followingEmbed(rows: { team: number; channel_id: string; name: string | null }[]): APIEmbed {
  return {
    title: "Teams this server follows",
    description: rows.length
      ? rows.map((r) => `**${r.team}**${r.name ? ` ${r.name}` : ""} → <#${r.channel_id}>`).join("\n")
      : "None yet. Use /follow team: to get a post before each of a team's matches and its result.",
    color: VOLT,
    footer: { text: `Up to ${MAX_FOLLOWS_PER_SERVER} teams · Control Scout • controlscout.org` },
  };
}

// ---------------------------------------------------------------------------
// The tick: every minute, what's due.
// ---------------------------------------------------------------------------

export type Kind = "reminder" | "result";
export interface Due { channel: string; follows: Follow[]; match: MatchView; kind: Kind; teams: number[] }

const startOf = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
const inMatch = (m: MatchView) => new Set([...m.red.teams, ...m.blue.teams].map((t) => t.number));

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
    const kind: Kind | null = !m.played ? (at > now && at - now <= REMIND_MS ? "reminder" : null) : (now - at <= RESULT_WINDOW_MS ? "result" : null);
    if (!kind) continue;
    const teams = inMatch(m);
    for (const f of follows) {
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

/** The post: the site's match embed, led by which followed team it's about. */
export function postEmbed(d: Due, eventName: string, site: string): APIEmbed {
  const e = predictEmbed({ event: { name: eventName } } as never, d.match, site);
  const who = d.teams.map((t) => `**${t}**`).join(" & ");
  if (d.kind === "reminder") {
    const at = Math.floor(startOf(d.match) / 1000);
    return { ...e, description: `${who} ${d.teams.length > 1 ? "play" : "plays"} <t:${at}:R> (<t:${at}:t>).` };
  }
  const red = d.match.red.score?.total ?? 0, blue = d.match.blue.score?.total ?? 0;
  const side = (t: number) => (d.match.red.teams.some((x) => x.number === t) ? "red" : "blue");
  const line = d.teams.map((t) => {
    const s = side(t), won = red === blue ? null : (red > blue) === (s === "red");
    return `**${t}** ${won == null ? "tied" : won ? "won" : "lost"}`;
  }).join(", ");
  return { ...e, description: `${line} ${d.match.label}.` };
}

export type Send = (channel: string, embed: APIEmbed) => Promise<"ok" | "gone" | "error">;

/** One tick: read the follows, the matches of followed teams at events on today (±1 day), post what's due. */
export async function notifyTick(send: Send, site: string, log: (m: string) => void, now = Date.now()): Promise<number> {
  const follows = (await all<any>("SELECT guild_id, channel_id, team, created_at, failures FROM discord_follows"))
    .map((r) => ({ guild_id: String(r.guild_id), channel_id: String(r.channel_id), team: Number(r.team), created_at: String(r.created_at), failures: Number(r.failures) }));
  if (!follows.length) return 0;
  const teams = [...new Set(follows.map((f) => f.team))];
  const day = (n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  const events = await all<{ code: string; name: string }>(
    `SELECT DISTINCT e.code, e.name FROM match_teams mt JOIN events e ON e.season = mt.season AND e.code = mt.code
     WHERE mt.season = ? AND mt.team IN (${teams.map(() => "?").join(",")}) AND e.start <= ? AND COALESCE(e.end, e.start) >= ?`,
    [CURRENT_SEASON, ...teams, day(1), day(-1)]);
  let posted = 0;
  for (const ev of events) {
    const matches = await matchViews({ season: CURRENT_SEASON, code: ev.code }, { predictUnplayed: true });
    for (const d of dueNow(follows, matches, now)) {
      // Claim the post first: only the tick that inserts the row sends it.
      const claimed = await run(
        "INSERT OR IGNORE INTO discord_posts (channel_id, season, code, match_key, kind, posted_at) VALUES (?, ?, ?, ?, ?, ?)",
        [d.channel, CURRENT_SEASON, ev.code, d.match.key, d.kind, new Date(now).toISOString()]);
      if (!claimed) continue;
      const r = await send(d.channel, postEmbed(d, ev.name, site));
      if (r === "ok") {
        posted++;
        await run("UPDATE discord_follows SET failures = 0 WHERE channel_id = ? AND failures > 0", [d.channel]);
      } else {
        // A passing failure: let the next tick try again. A channel that's gone or closed to the bot counts toward dropping it.
        if (r === "error") await run("DELETE FROM discord_posts WHERE channel_id = ? AND season = ? AND code = ? AND match_key = ? AND kind = ?", [d.channel, CURRENT_SEASON, ev.code, d.match.key, d.kind]);
        if (r === "gone") {
          await run("UPDATE discord_follows SET failures = failures + 1 WHERE channel_id = ?", [d.channel]);
          const dropped = await run("DELETE FROM discord_follows WHERE channel_id = ? AND failures >= ?", [d.channel, MAX_FAILURES]);
          if (dropped) log(`follows: dropped ${dropped} in channel ${d.channel} after ${MAX_FAILURES} failed posts`);
        }
      }
    }
  }
  // The post log only needs to outlive a match's windows.
  await run("DELETE FROM discord_posts WHERE posted_at < ?", [new Date(now - 7 * 864e5).toISOString()]);
  return posted;
}
