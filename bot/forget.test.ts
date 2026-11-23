// A removed server's data (bot/forget.ts), on a database: every per-server row the bot writes goes — follows and the
// posts they sent, the chat limit and its usage, the teams, the names, the reply threads, the questions it was asked,
// the votes on its answers and its name — and another server's rows are untouched.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../server/db";
import { forgetGuild } from "./forget";

const NOW = Date.parse("2026-11-22T05:30:00Z");
const at = new Date(NOW).toISOString();

/** One of everything the bot writes for a server, in that server's channel. */
async function seed(guild: string, channel: string) {
  await run("INSERT INTO discord_follows (guild_id, channel_id, kind, team, target, created_at, created_by) VALUES (?, ?, 'team', 4215, 'team:4215', ?, 'u1')", [guild, channel, at]);
  await run("INSERT INTO discord_posts (channel_id, season, code, match_key, kind, claimed_at) VALUES (?, 2025, 'AUSYQ1', 'q1', 'reminder', ?)", [channel, at]);
  await run("INSERT INTO discord_limits (guild_id, per_hour, per_day, updated_by, updated_at) VALUES (?, 5, 10, 'owner', ?)", [guild, at]);
  await run("INSERT INTO discord_chat_usage (guild_id, window, used) VALUES (?, 'h:2026-11-22T05', 1)", [guild]);
  await run("INSERT INTO discord_guild_teams (guild_id, team, asks, last_at) VALUES (?, 6980, 1, ?)", [guild, at]);
  await run("INSERT INTO discord_people (guild_id, user_id, name, asks, last_at) VALUES (?, 'u1', 'Alex', 1, ?)", [guild, at]);
  await run("INSERT INTO discord_threads (root_id, turns, updated_at, guild_id) VALUES (?, '[{\"role\":\"user\",\"text\":\"hi\"}]', ?, ?)", [`root-${guild}`, at, guild]);
  await run("INSERT INTO discord_asks (guild_id, question, step, chat, answered, ms, asked_at) VALUES (?, 'who won decode', 'deterministic', 1, 1, 900, ?)", [guild, at]);
  await run("INSERT INTO discord_answers (message_id, guild_id, up, down, voted_at) VALUES (?, ?, 1, 0, ?)", [`m-${guild}`, guild, at]);
  await run("INSERT INTO discord_guilds (guild_id, name, joined_at, seen_at) VALUES (?, 'Austin Robotics', ?, ?)", [guild, at, at]);
}

const count = async (table: string, guild: string) =>
  Number((await all<{ c: number }>(`SELECT COUNT(*) c FROM ${table} WHERE guild_id = ?`, [guild]))[0].c);

describe("forgetting a removed server, on a database", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => {
    for (const t of ["discord_follows", "discord_posts", "discord_limits", "discord_chat_usage", "discord_guild_teams", "discord_people", "discord_threads", "discord_asks", "discord_answers", "discord_guilds"]) {
      await run(`DELETE FROM ${t}`);
    }
  });

  it("deletes every row the bot kept for that server, and only that server's", async () => {
    await seed("g1", "c1");
    await seed("g2", "c2");
    // The count is what went: ten rows here, including the follow's post (keyed by channel, not server).
    expect(await forgetGuild("g1")).toBe(10);
    for (const t of ["discord_follows", "discord_limits", "discord_chat_usage", "discord_guild_teams", "discord_people", "discord_threads", "discord_asks", "discord_answers", "discord_guilds"]) {
      expect(await count(t, "g1"), t).toBe(0);
    }
    expect(Number((await all<{ c: number }>("SELECT COUNT(*) c FROM discord_posts WHERE channel_id = 'c1'"))[0].c)).toBe(0);
    // The other server still has all of its own.
    for (const t of ["discord_follows", "discord_limits", "discord_chat_usage", "discord_guild_teams", "discord_people", "discord_threads", "discord_asks", "discord_answers", "discord_guilds"]) {
      expect(await count(t, "g2"), t).toBe(1);
    }
    expect(Number((await all<{ c: number }>("SELECT COUNT(*) c FROM discord_posts WHERE channel_id = 'c2'"))[0].c)).toBe(1);
    // Forgetting a server that left nothing behind is no error, and deletes nothing.
    expect(await forgetGuild("gone")).toBe(0);
  });
});
