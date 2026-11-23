// Per-server chat limits (bot/quota.ts), on a database: no server is capped by default — one without a row is allowed
// chats at once and nothing is counted — while a row of its own caps it (nulls: no cap for that window), and clearing the
// row leaves it uncapped again. A set limit counts the UTC hour and day, refuses past either with when it resets, and
// keeps one server's chats out of another's count.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../server/db";
import { DEFAULT_LIMIT, clearGuildLimit, guildLimit, setGuildLimit, takeChat } from "./quota";

/** 05:30 UTC: a fresh hour, halfway through the day. */
const NOW = Date.parse("2026-11-22T05:30:00Z");
const HOUR_MS = 3600_000;

const usage = async (guild: string) =>
  // A chat is counted in both windows: its hour's count is the number of chats that hour.
  Number((await get<{ c: number }>("SELECT COALESCE(SUM(used), 0) c FROM discord_chat_usage WHERE guild_id = ? AND window LIKE 'h:%'", [guild]))!.c);

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

  it("leaves a server with no row uncapped, and counts nothing", async () => {
    expect(DEFAULT_LIMIT).toEqual({ perHour: null, perDay: null });
    expect(await guildLimit("g1")).toEqual({ perHour: null, perDay: null, custom: false });
    for (let i = 0; i < 50; i++) expect((await takeChat("g1", NOW + i)).ok).toBe(true);
    // No cap: not one usage row written, and no limit row invented for it either.
    expect(await usage("g1")).toBe(0);
    expect(await get("SELECT 1 FROM discord_limits WHERE guild_id = 'g1'")).toBeUndefined();
  });

  it("lets a server's own row replace the default for both windows", async () => {
    await setGuildLimit("g1", { perHour: 2, perDay: null }, "owner", NOW);
    expect(await guildLimit("g1")).toEqual({ perHour: 2, perDay: null, custom: true });
    expect(await takeChat("g1", NOW)).toEqual({ ok: true });
    expect(await takeChat("g1", NOW + 1000)).toEqual({ ok: true });
    expect(await takeChat("g1", NOW + 2000)).toEqual({ ok: false, limited: "hour", retryAfter: 1798 });
    // More per hour than the default, and no daily cap at all: the row, not the default, is the limit.
    await setGuildLimit("g1", { perHour: 50, perDay: null }, "owner", NOW);
    expect(await takeChat("g1", NOW + HOUR_MS)).toEqual({ ok: true });
  });

  it("reads a row of nulls as no cap, and clearing the row leaves the server uncapped", async () => {
    await setGuildLimit("g1", { perHour: null, perDay: null }, "owner");
    expect(await guildLimit("g1")).toEqual({ perHour: null, perDay: null, custom: true });
    for (let i = 0; i < 50; i++) expect(await takeChat("g1", NOW + i)).toEqual({ ok: true });
    // Not one usage row written for a server with no cap.
    expect(await usage("g1")).toBe(0);
    // A zero is no cap too (how a console would clear one).
    await setGuildLimit("g1", { perHour: 0, perDay: 0 }, "owner");
    expect(await guildLimit("g1")).toEqual({ perHour: null, perDay: null, custom: true });
    // Cleared, it is back on the default — which is no cap — and its own row is gone.
    await clearGuildLimit("g1");
    expect(await guildLimit("g1")).toEqual({ ...DEFAULT_LIMIT, custom: false });
    expect(await get("SELECT 1 FROM discord_limits WHERE guild_id = 'g1'")).toBeUndefined();
    expect((await takeChat("g1", NOW + HOUR_MS)).ok).toBe(true);
  });

  it("starts a server's counters afresh when its cap is set or cleared", async () => {
    // A small cap this hour: full.
    await setGuildLimit("g1", { perHour: 5, perDay: 5 }, "owner", NOW);
    for (let i = 0; i < 5; i++) expect((await takeChat("g1", NOW + i)).ok).toBe(true);
    expect(await takeChat("g1", NOW + 100)).toMatchObject({ ok: false, limited: "hour" });
    // Given 20 an hour, it isn't refused at once: what it asked under the old cap isn't counted against its new one.
    await setGuildLimit("g1", { perHour: 20, perDay: 20 }, "owner", NOW);
    expect(await usage("g1")).toBe(0);
    for (let i = 0; i < 20; i++) expect((await takeChat("g1", NOW + i)).ok).toBe(true);
    expect(await takeChat("g1", NOW + 30)).toMatchObject({ ok: false, limited: "hour" });
    // Cleared, today's count goes with the cap: the server is uncapped and starts with nothing against it.
    await clearGuildLimit("g1");
    expect(await usage("g1")).toBe(0);
    expect((await takeChat("g1", NOW + 31)).ok).toBe(true);
  });

  it("a day's limit holds across hours and resets at midnight UTC", async () => {
    await setGuildLimit("g1", { perHour: 5, perDay: 2 }, "owner", NOW);
    expect((await takeChat("g1", NOW)).ok).toBe(true);
    expect((await takeChat("g1", NOW + HOUR_MS)).ok).toBe(true);
    expect(await takeChat("g1", NOW + 2 * HOUR_MS)).toMatchObject({ ok: false, limited: "day" });
    // Past midnight UTC the day's count starts again, and so does the hour's.
    expect(await takeChat("g1", Date.parse("2026-11-23T00:00:05Z"))).toEqual({ ok: true });
  });

  it("counts each server on its own", async () => {
    await setGuildLimit("g1", { perHour: 1, perDay: null }, "owner");
    expect((await takeChat("g1", NOW)).ok).toBe(true);
    expect((await takeChat("g1", NOW)).ok).toBe(false);
    // g2 has no cap (and so no count), so g1 being full doesn't touch it.
    expect((await takeChat("g2", NOW)).ok).toBe(true);
    expect(await usage("g2")).toBe(0);
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
