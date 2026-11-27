// A person's own match reminder (bot/reminders.ts, migration 118): kept, sent once 15 minutes out with only that person
// pinged, never twice, and cancelled on request.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../server/db";
import { addReminder, cancelReminders, reminderDue, reminderPost, reminderTick } from "./reminders";
import type { NextMatch } from "./next";

const NOW = Date.parse("2026-12-05T15:00:00Z");
const next = (startsAt: string | null, label: string | boolean = "Q12", played = typeof label === "boolean" ? label : false): NextMatch => ({
  event: { event: { season: 2026, code: "USNJNEM", name: "Northeast League Meet" } },
  match: { label: typeof label === "string" ? label : "Q12", level: "qual", series: 0, number: Number(String(typeof label === "string" ? label : "Q12").slice(1)), played, startsAt, red: { teams: [{ number: 4215 }, { number: 6980 }] }, blue: { teams: [{ number: 1 }, { number: 2 }] } },
}) as never;

describe("reminders", () => {
  beforeAll(async () => { const c = openDb(":memory:"); setDb(c); await migrate(c); });
  beforeEach(async () => { await run("DELETE FROM discord_reminders"); });

  it("is due inside 15 minutes of the start, and not for a played or long-started match", () => {
    expect(reminderDue(next("2026-12-05T15:14:00Z"), NOW)).toBe(true);
    expect(reminderDue(next("2026-12-05T15:30:00Z"), NOW)).toBe(false);
    expect(reminderDue(next("2026-12-05T14:58:00Z"), NOW)).toBe(true);
    expect(reminderDue(next("2026-12-05T14:40:00Z"), NOW)).toBe(false);
    expect(reminderDue(next("2026-12-05T15:10:00Z", true), NOW)).toBe(false);
    expect(reminderDue(next(null), NOW)).toBe(false);
  });

  it("pings only the person who asked, with the match and its partner", () => {
    const p = reminderPost("u1", 4215, next("2026-12-05T15:10:00Z"), "https://controlscout.org");
    expect(p.content).toBe("<@u1> 4215 is up soon.");
    expect(p.embed.title).toBe("4215 plays Q12 soon");
    expect(p.embed.description).toContain("With 6980.");
  });

  it("sends once when due, never again after, and a cancelled one never", async () => {
    await addReminder("g1", "c1", "u1", 4215, NOW - 3600_000);
    await addReminder("g1", "c1", "u2", 4215, NOW - 3600_000);
    await addReminder("g1", "c1", "u3", 6980, NOW - 3600_000);
    expect(await cancelReminders("g1", "u3", 6980)).toBe(1);
    const sent: string[] = [];
    const send = async (channel: string, user: string) => { sent.push(`${channel}:${user}`); return "ok" as const; };
    const later = async () => next("2026-12-05T16:00:00Z");
    expect(await reminderTick(send, "s", NOW, later)).toBe(0);
    const soon = async () => next("2026-12-05T15:10:00Z");
    expect(await reminderTick(send, "s", NOW, soon)).toBe(2);
    expect(sent.sort()).toEqual(["c1:u1", "c1:u2"]);
    expect(await reminderTick(send, "s", NOW + 60_000, soon)).toBe(0);
    // Asking again starts it over, for the next match.
    await addReminder("g1", "c1", "u1", 4215, NOW + 120_000);
    const rows = await all<{ user_id: string; sent_at: string | null }>("SELECT user_id, sent_at FROM discord_reminders ORDER BY user_id");
    expect(rows.map((r) => [r.user_id, r.sent_at == null])).toEqual([["u1", true], ["u2", false]]);
    // ...and the match it was already sent for is never sent twice: only a later one is.
    expect(await reminderTick(send, "s", NOW + 180_000, soon)).toBe(0);
    const after = async () => next("2026-12-05T15:40:00Z", "Q14");
    expect(await reminderTick(send, "s", Date.parse("2026-12-05T15:30:00Z"), after)).toBe(1);
    expect(sent.filter((x) => x === "c1:u1")).toHaveLength(2);
  });
});
