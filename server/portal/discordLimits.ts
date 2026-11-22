// /api/owner/discord/limits: the owner console's Discord chat caps (bot/quota.ts, src/components/owner/DiscordPanel.tsx).
//
//   GET    /api/owner/discord/limits         → OwnerDiscordLimits: every server the bot kept something for, the cap it
//                                              has (the default, or its own row) and what it has used this UTC hour and day
//   PUT    /api/owner/discord/limits/:guild  {perHour, perDay} → OwnerDiscordLimits
//   DELETE /api/owner/discord/limits/:guild  → OwnerDiscordLimits (back to the default)
//
// A server's row replaces both of the default's windows, so a null there is no cap for that window — how a big event
// server is exempted — and clearing the row is the way back to the default. Either write starts that server's counters
// afresh (bot/quota.ts), so a server given 20 an hour after 30 chats under the default isn't refused at once. Every
// change is in the audit log with the cap it replaced.
import type { Request, Response, Router } from "express";
import { all } from "../db.js";
import { DEFAULT_LIMIT, chatWindows, clearGuildLimit, guildLimit, setGuildLimit } from "../../bot/quota.js";
import type { OwnerDiscordLimits, OwnerDiscordServer } from "../../src/shared/discordLimits.js";
import { recordAudit } from "./audit.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** The most any window can be set to: far past any server's use, and still a number a mistyped box can't slip past. */
const MAX_CAP = 100_000;
/** A Discord server id (a snowflake). */
const GUILD = /^\d{15,22}$/;
/** The servers the bot has kept something for: a follow, a cap, a count, a team, a person, a thread. */
const GUILDS = `
  SELECT guild_id FROM discord_follows
  UNION SELECT guild_id FROM discord_limits
  UNION SELECT guild_id FROM discord_chat_usage
  UNION SELECT guild_id FROM discord_guild_teams
  UNION SELECT guild_id FROM discord_people
  UNION SELECT guild_id FROM discord_threads WHERE guild_id IS NOT NULL`;

/** Every server the bot knows, and the cap each one has. */
export async function ownerDiscordLimits(now = Date.now()): Promise<OwnerDiscordLimits> {
  const w = chatWindows(now);
  const [ids, follows, usage, last, rows] = await Promise.all([
    all<{ guild_id: string }>(GUILDS),
    all<{ guild_id: string; n: number }>("SELECT guild_id, COUNT(*) n FROM discord_follows GROUP BY guild_id"),
    all<{ guild_id: string; window: string; used: number }>("SELECT guild_id, window, used FROM discord_chat_usage WHERE window IN (?, ?)", [w.hour, w.day]),
    // The last time anyone asked it something there: a team it was asked about, a name, a thread (bot/memory.ts).
    all<{ guild_id: string; at: string }>(
      `SELECT guild_id, MAX(at) at FROM (
         SELECT guild_id, last_at at FROM discord_guild_teams
         UNION ALL SELECT guild_id, last_at FROM discord_people
         UNION ALL SELECT guild_id, updated_at FROM discord_threads WHERE guild_id IS NOT NULL
       ) GROUP BY guild_id`),
    all<{ guild_id: string; per_hour: number | null; per_day: number | null; updated_by: string | null; updated_at: string | null }>(
      "SELECT guild_id, per_hour, per_day, updated_by, updated_at FROM discord_limits"),
  ]);
  const followed = new Map(follows.map((r) => [String(r.guild_id), Number(r.n)]));
  const counted = new Map(usage.map((r) => [`${r.guild_id} ${r.window}`, Number(r.used)]));
  const asked = new Map(last.map((r) => [String(r.guild_id), String(r.at)]));
  const own = new Map(rows.map((r) => [String(r.guild_id), r]));
  const servers: OwnerDiscordServer[] = [];
  for (const guild of [...new Set(ids.map((r) => String(r.guild_id)))].sort()) {
    // The cap as enforced, read the way a chat reads it, so the console can't disagree with the bot.
    const l = await guildLimit(guild);
    const row = own.get(guild);
    servers.push({
      guild, ...l,
      usedHour: counted.get(`${guild} ${w.hour}`) ?? 0,
      usedDay: counted.get(`${guild} ${w.day}`) ?? 0,
      follows: followed.get(guild) ?? 0,
      lastAsk: asked.get(guild) ?? null,
      updatedBy: row?.updated_by ?? null,
      updatedAt: row?.updated_at ?? null,
    });
  }
  return { servers, defaultLimit: DEFAULT_LIMIT };
}

/** A cap from the console: null (blank or 0) is no cap for that window, a whole count is that cap, anything else is
 *  refused rather than quietly read as one. */
const cap = (v: unknown): { cap: number | null } | { problem: string } => {
  if (v === null || v === undefined || v === "") return { cap: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_CAP) return { problem: `A cap is a whole number up to ${MAX_CAP.toLocaleString()} (0: no cap)` };
  return { cap: n === 0 ? null : n };
};

/** The server's id from the path, or null when it isn't one. */
const guildOf = (req: Request): string | null => {
  const guild = String(req.params.guild);
  return GUILD.test(guild) ? guild : null;
};

export function discordLimitOwnerRoutes(r: Router, h: (fn: Handler) => (req: Request, res: Response, next: (e?: unknown) => void) => void, actor: (req: Request) => string) {
  r.get("/discord/limits", h(async () => ownerDiscordLimits()));

  // Set or replace a server's own cap: both windows in one write, a null in one of them for no cap there.
  r.put("/discord/limits/:guild", h(async (req, res) => {
    const guild = guildOf(req);
    if (!guild) { res.status(404).json({ error: "Not a Discord server id" }); return; }
    const perHour = cap(req.body?.perHour), perDay = cap(req.body?.perDay);
    if ("problem" in perHour || "problem" in perDay) { res.status(400).json({ error: "problem" in perHour ? perHour.problem : (perDay as { problem: string }).problem }); return; }
    const was = await guildLimit(guild);
    await setGuildLimit(guild, { perHour: perHour.cap, perDay: perDay.cap }, actor(req));
    const to = { perHour: perHour.cap, perDay: perDay.cap, custom: true };
    await recordAudit(actor(req), "discord.limit", { guild, perHour: to.perHour, perDay: to.perDay }, null,
      { from: { perHour: was.perHour, perDay: was.perDay, custom: was.custom }, to });
    return ownerDiscordLimits();
  }));

  // Back to the default cap every server has: delete the server's own row.
  r.delete("/discord/limits/:guild", h(async (req, res) => {
    const guild = guildOf(req);
    if (!guild) { res.status(404).json({ error: "Not a Discord server id" }); return; }
    const was = await guildLimit(guild);
    if (!was.custom) { res.status(409).json({ error: "That server already has the default cap" }); return; }
    await clearGuildLimit(guild);
    await recordAudit(actor(req), "discord.limit", { guild, clear: true }, null,
      { from: { perHour: was.perHour, perDay: was.perDay, custom: true }, to: { ...DEFAULT_LIMIT, custom: false } });
    return ownerDiscordLimits();
  }));
}
