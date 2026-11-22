// What a Discord server teaches the bot, kept in the database (migration 100) so it survives a restart: the teams its
// people ask about, the name each person goes by there, and the turns of a reply thread. Nothing is personal beyond a
// Discord id and the display name Discord already shows; the tables are private (server/data/snapshot.ts), and all of
// it is deleted when the bot is removed from the server (bot/forget.ts).
//
// Teams are learned from the message itself (teamsAsked, below): a 3 to 5 digit number that could be one. Years are
// skipped (1900–2099) so "who won decode 2025" doesn't teach the bot that 2025 is this server's team.
import { all, get, run } from "../server/db.js";
import type { BrunoChatTurn } from "../server/auth/controlPoint.js";

/** Teams a server has asked about, kept per server: at most this many are offered to a chat. */
export const TEAMS_MAX = 5;
/** Turns of a reply thread kept across a restart (Control Point takes at most 6 new ones anyway). */
export const TURNS_MAX = 6;
/** A thread nobody has carried on in this long is forgotten. */
export const THREAD_DAYS = 14;

/** The teams a message asked about, most likely first: a 3 to 5 digit number that could be a team, no years. */
export function teamsAsked(q: string, max = 3): number[] {
  const found: number[] = [];
  for (const m of q.matchAll(/(?<!\d)\d{3,5}(?!\d)/g)) {
    const n = Number(m[0]);
    if (n < 1 || n > 30000) continue; // no real FTC team number is outside 1…30000
    if (n >= 1900 && n <= 2099) continue; // a season or a year, not a team
    if (!found.includes(n)) found.push(n);
    if (found.length >= max) break;
  }
  return found;
}

/** Remember an ask: the asker's display name, and the teams the message named. No name and no teams: nothing written. */
export async function learn(guild: string, user: string, name: string | null, teams: number[], now = Date.now()): Promise<void> {
  const at = new Date(now).toISOString();
  if (name) {
    await run(
      `INSERT INTO discord_people (guild_id, user_id, name, asks, last_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET name = excluded.name, asks = asks + 1, last_at = excluded.last_at`,
      [guild, user, name, at]);
  }
  for (const team of teams.slice(0, 3)) {
    await run(
      `INSERT INTO discord_guild_teams (guild_id, team, asks, last_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(guild_id, team) DO UPDATE SET asks = asks + 1, last_at = excluded.last_at`,
      [guild, team, at]);
  }
}

/** What this server has taught the bot: the teams its people ask about (most asked first) and this person's name. */
export async function recall(guild: string, user: string): Promise<{ teams: number[]; name: string | null }> {
  const rows = await all<{ team: number }>(
    "SELECT team FROM discord_guild_teams WHERE guild_id = ? ORDER BY asks DESC, last_at DESC LIMIT ?", [guild, TEAMS_MAX]);
  const person = await get<{ name: string }>("SELECT name FROM discord_people WHERE guild_id = ? AND user_id = ?", [guild, user]);
  return { teams: rows.map((r) => Number(r.team)), name: person?.name ?? null };
}

/** A reply thread's turns, by the id of the answer that started it. Empty: unknown, or too old to keep. */
export async function thread(root: string, now = Date.now()): Promise<BrunoChatTurn[]> {
  const row = await get<{ turns: string; updated_at: string }>("SELECT turns, updated_at FROM discord_threads WHERE root_id = ?", [root]);
  if (!row) return [];
  if (Date.parse(row.updated_at) < now - THREAD_DAYS * 86_400_000) return [];
  try {
    const turns = JSON.parse(row.turns) as BrunoChatTurn[];
    return Array.isArray(turns) ? turns.filter((t) => t && (t.role === "user" || t.role === "bruno") && typeof t.text === "string") : [];
  } catch { return []; }
}

/** Keep a thread's last turns in its server (`guild`: which server, so it can be forgotten with the rest of that
 *  server's data), and forget the threads nobody has carried on in THREAD_DAYS. */
export async function keep(root: string, turns: BrunoChatTurn[], guild: string | null, now = Date.now()): Promise<void> {
  const at = new Date(now).toISOString();
  await run(
    `INSERT INTO discord_threads (root_id, turns, updated_at, guild_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(root_id) DO UPDATE SET turns = excluded.turns, updated_at = excluded.updated_at,
       guild_id = COALESCE(excluded.guild_id, discord_threads.guild_id)`,
    [root, JSON.stringify(turns.slice(-TURNS_MAX)), at, guild]);
  await run("DELETE FROM discord_threads WHERE updated_at < ?", [new Date(now - THREAD_DAYS * 86_400_000).toISOString()]);
}
