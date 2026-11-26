// One person's pace in one server (bot/pacing.ts): six a minute, thirty an hour, counted per person and per server, with
// the hour's slot given back when the hour is what refused. On a database, so a restart doesn't reset it.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../server/db";
import { PERSON_PACE, paceEmbed, paceWindows, personUsage, takePersonChat } from "./pacing";

const NOW = Date.parse("2026-11-22T05:30:20Z");

describe("pace windows", () => {
  it("keys the UTC minute and hour, with a letter so they never collide", () => {
    expect(paceWindows(NOW)).toEqual({ minute: "m:2026-11-22T05:30", hour: "h:2026-11-22T05" });
  });
});

describe("a person's pace, on a database", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => { await run("DELETE FROM discord_person_usage"); });

  it("allows the minute's chats, then says when the next is", async () => {
    for (let i = 0; i < PERSON_PACE.perMinute; i++) expect(await takePersonChat("g1", "u1", NOW + i)).toEqual({ ok: true });
    const refused = await takePersonChat("g1", "u1", NOW + 1000);
    expect(refused.ok).toBe(false);
    expect(refused).toMatchObject({ window: "minute" });
    // Thirty-nine seconds to the next minute (the refusal lands one second after 05:30:20); a chat refused there
    // isn't counted against the hour.
    expect(!refused.ok && refused.retryAfter).toBe(39);
    // A minute later it is a new window.
    expect(await takePersonChat("g1", "u1", NOW + 60_000)).toEqual({ ok: true });
  });

  it("keeps one person's chats out of another's, and one server's out of another's", async () => {
    for (let i = 0; i < PERSON_PACE.perMinute; i++) await takePersonChat("g1", "u1", NOW + i);
    expect((await takePersonChat("g1", "u2", NOW)).ok).toBe(true);
    expect((await takePersonChat("g2", "u1", NOW)).ok).toBe(true);
  });

  it("refuses past the hour's thirty with when it resets, and gives the minute's slot back", async () => {
    // A person who has spent the hour: the hour refuses, and the minute that went with it is given back.
    await run("INSERT INTO discord_person_usage (guild_id, user_id, window, used) VALUES ('g1', 'u1', ?, ?)", [paceWindows(NOW).hour, PERSON_PACE.perHour]);
    const refused = await takePersonChat("g1", "u1", NOW);
    expect(refused).toMatchObject({ window: "hour" });
    expect(await personUsage("g1", "u1", NOW)).toEqual({ minute: 0, hour: PERSON_PACE.perHour });
  });

  it("says what happened in words, without a limit nobody can meet", () => {
    expect(paceEmbed({ window: "minute" }).title).toBe("One at a time");
    expect(paceEmbed({ window: "minute" }).description).toContain("controlscout.org");
    expect(paceEmbed({ window: "hour" }).description).toContain(`${PERSON_PACE.perHour} questions in an hour`);
  });
});
