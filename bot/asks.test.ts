// What the bot was asked (bot/asks.ts): every question kept with how it was answered, the ones it couldn't answer
// grouped for the console, and the numbers beside them — on a database.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../server/db";
import { KEEP_DAYS, askText, askUsage, noteAsk, prune, topUnanswered } from "./asks";

const NOW = Date.parse("2026-11-22T15:00:00Z");
const at = (msAgo = 0) => new Date(NOW - msAgo).toISOString();
const ask = (question: string, over: Partial<Parameters<typeof noteAsk>[0]> = {}, msAgo = 0) =>
  noteAsk({ question, step: "deterministic", chat: true, answered: true, ms: 1000, guild: "g1", ...over }, NOW - msAgo);

describe("what the bot was asked", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => { await run("DELETE FROM discord_asks"); });

  it("keeps the words, the step and the outcome, with personal data redacted and no user id", async () => {
    expect(askText("  Who   won DECODE? my address is alex@example.com ")).toBe("Who won DECODE? my address is [email]");
    await ask("who won decode");
    const rows = await all<Record<string, unknown>>("SELECT * FROM discord_asks");
    expect(rows[0]).toMatchObject({ guild_id: "g1", question: "who won decode", step: "deterministic", chat: 1, answered: 1, ms: 1000 });
    expect(Object.keys(rows[0])).not.toContain("user_id");
    // Answered: not one the bot failed on.
    expect(await topUnanswered(10, NOW)).toEqual([]);
  });

  it("lists the questions it couldn't answer, most asked first, one entry per spelling and the latest words shown", async () => {
    await ask("Who won decode", { answered: false, chat: false, step: "recovery" }, 3_000);
    await ask("who won decode", { answered: false, chat: false, step: "recovery" }, 2_000);
    await ask("WHO WON DECODE", { answered: false, chat: false, step: "no-match" }, 1_000);
    await ask("how did our alliance do", { answered: false, chat: false, step: "no-match" }, 0);
    await ask("4215 opr");
    const top = await topUnanswered(10, NOW);
    expect(top.map((q) => [q.question, q.count, q.step])).toEqual([
      ["WHO WON DECODE", 3, "no-match"],
      ["how did our alliance do", 1, "no-match"],
    ]);
    expect(top[0].servers).toBe(1);
    expect(top[0].lastAt).toBe(at(1_000));
    // A limit is honoured.
    expect(await topUnanswered(1, NOW)).toHaveLength(1);
  });

  it("counts chats today and this week, how often Bruno answered, and the middle answer time", async () => {
    await ask("a");
    await ask("b", { answered: false, chat: false, step: "recovery" });
    await ask("c", { chat: false, answered: true, ms: 3000 });
    // Last week's ask isn't counted in today's, and is outside the week's window.
    await ask("old", {}, 8 * 86_400_000);
    const u = await askUsage(NOW);
    expect(u).toMatchObject({ asksToday: 3, asksWeek: 3, answeredPct: 67, chatPct: 33, medianMs: 1000 });
  });

  it("the middle answer time is the week's middle, not the middle of its fastest 5,000", async () => {
    // 5,011 timed asks, 1 ms to 5,011 ms: the middle is 2,506. The middle of the fastest 5,000 would be 2,501 — a
    // sample's middle, understated exactly when the bot is busiest.
    await run(
      `INSERT INTO discord_asks (guild_id, question, step, chat, answered, ms, asked_at)
       WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5011)
       SELECT 'g1', 'q' || i, 'deterministic', 1, 1, i, ? FROM n`,
      [at(1_000)],
    );
    expect((await askUsage(NOW)).medianMs).toBe(2506);
  });

  it("prunes asks older than KEEP_DAYS", async () => {
    await ask("old", {}, (KEEP_DAYS + 1) * 86_400_000);
    await ask("new");
    expect(await prune(NOW)).toBe(1);
    expect(await all("SELECT question FROM discord_asks")).toEqual([{ question: "new" }]);
  });
});
