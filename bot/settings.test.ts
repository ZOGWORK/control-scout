// Per-server post settings (bot/settings.ts): quiet hours parse and wrap, the reminders switch, the ping role, the
// defaults a server without a row gets, and the words /settings shows.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../server/db";
import { DEFAULT_SETTINGS, allSettings, allows, guildSettings, inQuietHours, parseQuiet, pings, quietWords, setGuildSettings, settingsEmbed } from "./settings";

/** 23:30 UTC: inside a 22–7 window, outside a 9–17 one. */
const NIGHT = Date.parse("2026-11-22T23:30:00Z");
const NOON = Date.parse("2026-11-22T12:00:00Z");

describe("quiet hours", () => {
  it("reads 22-7, 22:00–07:00, off and nothing; refuses everything else", () => {
    expect(parseQuiet("22-7")).toEqual({ quiet: { start: 22, end: 7 } });
    expect(parseQuiet("22:00 - 07:00")).toEqual({ quiet: { start: 22, end: 7 } });
    expect(parseQuiet("off")).toEqual({ quiet: null });
    expect(parseQuiet("none")).toEqual({ quiet: null });
    expect(parseQuiet("")).toEqual({ quiet: null });
    expect(parseQuiet("22")).toHaveProperty("problem");
    expect(parseQuiet("25-7")).toHaveProperty("problem");
    expect(parseQuiet("7-7")).toHaveProperty("problem"); // all day is not a window anyone meant
  });

  it("wraps past midnight, and never covers an hour outside it", () => {
    const wrap = { start: 22, end: 7 };
    expect(inQuietHours(wrap, NIGHT)).toBe(true);
    expect(inQuietHours(wrap, Date.parse("2026-11-22T03:00:00Z"))).toBe(true);
    expect(inQuietHours(wrap, NOON)).toBe(false);
    expect(inQuietHours(wrap, Date.parse("2026-11-22T07:00:00Z"))).toBe(false); // the end is not included
    expect(inQuietHours({ start: 9, end: 17 }, NOON)).toBe(true);
    expect(inQuietHours(null, NOON)).toBe(false);
    expect(quietWords(wrap)).toBe("22:00–07:00 UTC");
    expect(quietWords(null)).toBe("none");
  });

  it("stops every post in quiet hours; muting reminders keeps results and event posts", () => {
    const quiet = { ...DEFAULT_SETTINGS, quiet: { start: 22, end: 7 } };
    expect(allows(quiet, "reminder", NIGHT)).toBe(false);
    expect(allows(quiet, "result", NIGHT)).toBe(false);
    expect(allows(quiet, "reminder", NOON)).toBe(true);

    const muted = { ...DEFAULT_SETTINGS, reminders: false };
    expect(allows(muted, "reminder", NOON)).toBe(false);
    expect(allows(muted, "ondeck", NOON)).toBe(false);
    expect(allows(muted, "moved", NOON)).toBe(false);
    expect(allows(muted, "result", NOON)).toBe(true);
    expect(allows(muted, "schedule", NOON)).toBe(true);
    expect(allows(muted, "recap", NOON)).toBe(true);
    expect(allows(muted, "rollover", NOON)).toBe(true);
  });

  it("pings a role only on the reminder and the on-deck post, and only when one is set", () => {
    const s = { ...DEFAULT_SETTINGS, pingRole: "123456789012345678" };
    expect(pings(s, "reminder")).toBe("123456789012345678");
    expect(pings(s, "ondeck")).toBe("123456789012345678");
    expect(pings(s, "result")).toBeNull();
    expect(pings(DEFAULT_SETTINGS, "reminder")).toBeNull();
  });
});

describe("a server's settings, on a database", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => { await run("DELETE FROM discord_guild_settings"); });

  it("gives a server with no row every post, no quiet hours and no ping", async () => {
    expect(await guildSettings("g1")).toEqual(DEFAULT_SETTINGS);
    expect(await allSettings()).toEqual(new Map());
  });

  it("round-trips what was set, and reads every row for the tick", async () => {
    await setGuildSettings("g1", { quiet: { start: 22, end: 7 }, reminders: false, pingRole: "123456789012345678" }, "u1", NOON);
    expect(await guildSettings("g1")).toMatchObject({
      quiet: { start: 22, end: 7 }, reminders: false, pingRole: "123456789012345678", updatedBy: "u1",
    });
    // Only the fields given change: a second write is the whole state, which is what the command sends.
    await setGuildSettings("g1", { quiet: null, reminders: true, pingRole: null }, "u2", NOON);
    expect(await guildSettings("g1")).toMatchObject({ quiet: null, reminders: true, pingRole: null, updatedBy: "u2" });
    await setGuildSettings("g2", { quiet: { start: 1, end: 5 }, reminders: true, pingRole: null }, "u1", NOON);
    const all = await allSettings();
    expect([...all.keys()].sort()).toEqual(["g1", "g2"]);
    expect(all.get("g2")?.quiet).toEqual({ start: 1, end: 5 });
    // A quiet window read back as all-or-nothing (a row with one end) is no quiet hours, not a guess.
    await run("UPDATE discord_guild_settings SET quiet_end = NULL WHERE guild_id = 'g2'");
    expect((await guildSettings("g2")).quiet).toBeNull();
  });

  it("/settings says what the server gets, and how to change it", () => {
    const e = settingsEmbed({ quiet: { start: 22, end: 7 }, reminders: false, pingRole: "123456789012345678", updatedAt: "2026-11-22T00:00:00.000Z", updatedBy: "111111111111111111" }, "g1");
    expect(e.description).toContain("Quiet hours:** 22:00–07:00 UTC");
    expect(e.description).toContain("Match reminders:** off");
    expect(e.description).toContain("<@&123456789012345678>");
    expect(e.description).toContain("`/settings quiet_hours:22-7`");
    expect(e.description).toContain("Last changed 2026-11-22 by <@111111111111111111>");
    // The default says so plainly instead of showing empty fields.
    expect(settingsEmbed(DEFAULT_SETTINGS, "g1").description).toContain("Quiet hours:** none");
    expect(settingsEmbed(DEFAULT_SETTINGS, "g1").description).toContain("Match reminders:** on");
  });
});
