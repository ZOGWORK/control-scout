// What a Discord server teaches the bot (bot/memory.ts), on a database: the teams its people ask about, the names
// they go by there, a reply thread kept past a restart, and what each channel was asking about lately. Plus the one rule
// that keeps the memory honest: a season year in a question is not a team.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../server/db";
import { CHANNEL_SUBJECT_MINUTES, TEAMS_MAX, THREAD_DAYS, channelSubject, keep, keepChannelSubject, learn, recall, teamsAsked, thread } from "./memory";

const NOW = Date.parse("2026-11-22T05:30:00Z");
const DAY = 86_400_000;

describe("the teams a message names", () => {
  it("takes a team number and leaves out seasons, ratios and numbers no team has", () => {
    expect(teamsAsked("what was 4215's auto OPR at their last event?")).toEqual([4215]);
    expect(teamsAsked("4215 vs 6980 who wins")).toEqual([4215, 6980]);
    expect(teamsAsked("who won decode 2025")).toEqual([]); // a season, not a team
    expect(teamsAsked("a 1:1 coaxial swerve")).toEqual([]);
    expect(teamsAsked("team 99999 or 0")).toEqual([]);
    // At most three, in the order they're first named, never twice.
    expect(teamsAsked("4215 6980 18360 4215 16379")).toEqual([4215, 6980, 18360]);
  });
});

describe("the server's memory, on a database", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => {
    await run("DELETE FROM discord_guild_teams");
    await run("DELETE FROM discord_people");
    await run("DELETE FROM discord_threads");
    await run("DELETE FROM discord_channel_subjects");
  });

  it("recalls the teams a server asks about most, counting each ask, at most TEAMS_MAX of them", async () => {
    await learn("g1", "u1", "Alex", [4215], NOW);
    await learn("g1", "u1", "Alex", [6980], NOW + 500);
    await learn("g1", "u1", "Alex", [4215], NOW + 1000);
    expect(await recall("g1", "u1")).toEqual({ teams: [4215, 6980], name: "Alex" });
    for (let i = 1; i <= 8; i++) await learn("g1", "u2", null, [1000 + i], NOW + 2000 + i);
    expect((await recall("g1", "u1")).teams).toHaveLength(TEAMS_MAX);
  });

  it("keeps servers apart, and the name a person now goes by", async () => {
    await learn("g1", "u1", "Alex", [4215], NOW);
    await learn("g2", "u1", "Alex", [6980], NOW);
    expect((await recall("g1", "u1")).teams).toEqual([4215]);
    expect((await recall("g2", "u1")).teams).toEqual([6980]);
    // Teams belong to the server, names to the person: someone new here still gets the server's teams, no name.
    expect(await recall("g2", "u9")).toEqual({ teams: [6980], name: null });
    await learn("g1", "u1", "Alexandra", [], NOW + 1000);
    expect((await recall("g1", "u1")).name).toBe("Alexandra");
  });

  it("keeps a reply thread across a restart — its last TURNS_MAX turns — and forgets a stale one", async () => {
    const turns = Array.from({ length: 8 }, (_, i) => ({ role: (i % 2 ? "bruno" : "user") as "user" | "bruno", text: `turn ${i}` }));
    await keep("root1", turns, "g1", NOW);
    expect((await thread("root1", NOW)).map((t) => t.text)).toEqual(["turn 2", "turn 3", "turn 4", "turn 5", "turn 6", "turn 7"]);
    // The thread knows its server, so being removed from that server can take it with the rest (bot/forget.ts).
    expect((await get<{ guild_id: string }>("SELECT guild_id FROM discord_threads WHERE root_id = 'root1'"))!.guild_id).toBe("g1");
    // Nobody carried it on for THREAD_DAYS: forgotten, and reading it never throws.
    expect(await thread("root1", NOW + (THREAD_DAYS + 1) * DAY)).toEqual([]);
    expect(await thread("nope", NOW)).toEqual([]);
  });

  it("drops threads nobody carried on when a new one is kept", async () => {
    await keep("old", [{ role: "user", text: "hi" }], "g1", NOW - (THREAD_DAYS + 1) * DAY);
    await keep("new", [{ role: "user", text: "hi" }], "g1", NOW);
    expect(await thread("old", NOW)).toEqual([]);
    expect(await thread("new", NOW)).toHaveLength(1);
  });

  it("keeps what a channel is talking about, per channel, until an hour has passed", async () => {
    expect(await channelSubject("c1", NOW)).toBeNull();
    await keepChannelSubject("c1", "what did theseus get in auto opr", "g1", NOW);
    expect(await channelSubject("c1", NOW + 59 * 60_000)).toBe("what did theseus get in auto opr");
    // Another channel is another conversation, and another server is not read for this one.
    expect(await channelSubject("c2", NOW)).toBeNull();
    // The channel moves on: the latest records question replaces the one before it, and the row knows its server.
    await keepChannelSubject("c1", "6980 opr", "g1", NOW + 60_000);
    expect(await channelSubject("c1", NOW + 60_000)).toBe("6980 opr");
    expect((await get<{ guild_id: string }>("SELECT guild_id FROM discord_channel_subjects WHERE channel_id = 'c1'"))!.guild_id).toBe("g1");
    // An hour after that question, "their record?" is a new conversation.
    expect(await channelSubject("c1", NOW + 60_000 + CHANNEL_SUBJECT_MINUTES * 60_000 + 1)).toBeNull();
  });

  it("drops a channel subject nobody replaced", async () => {
    await keepChannelSubject("hold", "4215 opr", "g1", NOW - (THREAD_DAYS + 1) * DAY);
    await keepChannelSubject("fresh", "6980 opr", "g1", NOW);
    expect(Number((await get<{ c: number }>("SELECT COUNT(*) c FROM discord_channel_subjects WHERE channel_id = 'hold'"))!.c)).toBe(0);
  });
});
