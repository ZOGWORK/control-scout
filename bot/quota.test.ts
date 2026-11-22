// Per-server chat limits (bot/quota.ts), on a database: no row is no limit — nothing counted and nothing refused, which
// is how every server runs today — and a set limit counts the UTC hour and day, refuses past either with when it
// resets, and keeps one server's chats out of another's count.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../server/db";
import { guildLimit, setGuildLimit, takeChat } from "./quota";

/** 05:30 UTC: a fresh hour, halfway through the day. */
const NOW = Date.parse("2026-11-22T05:30:00Z");
const HOUR_MS = 3600_000;

describe("a server's chat limit, on a database", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => {
    await run("DELETE FROM discord_limits");
    await run("DELETE FROM discord_chat_usage");
  });

  it("no limit is no limit: every chat is allowed, and nothing is counted", async () => {
    for (let i = 0; i < 50; i++) expect(await takeChat("g1", NOW + i)).toEqual({ ok: true });
    expect(await guildLimit("g1")).toEqual({ perHour: null, perDay: null });
    // Not one row written: a server without a limit costs a single read per chat.
    expect(Number((await get<{ c: number }>("SELECT COUNT(*) c FROM discord_chat_usage"))!.c)).toBe(0);
    // A zero is no limit either (how a console would clear one).
    await setGuildLimit("g1", { perHour: 0, perDay: 0 }, "owner");
    expect(await guildLimit("g1")).toEqual({ perHour: null, perDay: null });
    expect(await takeChat("g1", NOW)).toEqual({ ok: true });
  });

  it("once a server has one: chats are counted, the hour's limit refuses the next, and says when it resets", async () => {
    await setGuildLimit("g1", { perHour: 2, perDay: null }, "owner", NOW);
    expect(await takeChat("g1", NOW)).toEqual({ ok: true });
    expect(await takeChat("g1", NOW + 1000)).toEqual({ ok: true });
    // 05:30 plus two seconds → the hour resets at 06:00.
    expect(await takeChat("g1", NOW + 2000)).toEqual({ ok: false, limited: "hour", retryAfter: 1798 });
    // The next hour starts afresh.
    expect(await takeChat("g1", NOW + HOUR_MS)).toEqual({ ok: true });
  });

  it("a day's limit holds across hours and resets at midnight UTC", async () => {
    await setGuildLimit("g1", { perHour: 5, perDay: 2 }, "owner", NOW);
    expect((await takeChat("g1", NOW)).ok).toBe(true);
    expect((await takeChat("g1", NOW + HOUR_MS)).ok).toBe(true);
    expect(await takeChat("g1", NOW + 2 * HOUR_MS)).toMatchObject({ ok: false, limited: "day" });
    // Past midnight UTC the day's count starts again, and so does the hour's.
    expect(await takeChat("g1", Date.parse("2026-11-23T00:00:05Z"))).toEqual({ ok: true });
  });

  it("counts each server on its own, and a null clears a limit for good", async () => {
    await setGuildLimit("g1", { perHour: 1, perDay: null }, "owner");
    await setGuildLimit("g2", { perHour: 1, perDay: null }, "owner");
    expect((await takeChat("g1", NOW)).ok).toBe(true);
    expect((await takeChat("g2", NOW)).ok).toBe(true);
    expect((await takeChat("g1", NOW)).ok).toBe(false);
    await setGuildLimit("g1", { perHour: null, perDay: null }, "owner");
    expect(await takeChat("g1", NOW)).toEqual({ ok: true });
  });

  it("two chats at the same moment can't share the last slot", async () => {
    await setGuildLimit("g1", { perHour: 1, perDay: null }, "owner", NOW);
    const both = await Promise.all([takeChat("g1", NOW), takeChat("g1", NOW)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("a chat the day's limit refuses gives its hour slot back", async () => {
    await setGuildLimit("g1", { perHour: 5, perDay: 1 }, "owner", NOW);
    expect((await takeChat("g1", NOW)).ok).toBe(true);
    expect(await takeChat("g1", NOW)).toMatchObject({ ok: false, limited: "day" });
    // Counted once, not twice: the refused chat isn't charged to the hour either.
    expect((await get<{ used: number }>("SELECT used FROM discord_chat_usage WHERE guild_id = 'g1' AND window = 'h:2026-11-22T05'"))!.used).toBe(1);
  });

  it("keeps the two windows a chat counts in, and drops the ones that are long over", async () => {
    await setGuildLimit("g1", { perHour: 10, perDay: 10 }, "owner", NOW);
    await takeChat("g1", NOW);
    await takeChat("g1", NOW + HOUR_MS); // a new hour: the first one's row goes
    const windows = (await get<{ w: string }>("SELECT group_concat(window) w FROM discord_chat_usage WHERE guild_id = 'g1'"))!.w.split(",").sort();
    expect(windows).toEqual(["d:2026-11-22", "h:2026-11-22T06"]);
  });
});
