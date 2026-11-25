// The row behind each answer (bot/reactions.ts): the question it was written for, which is what a 👎 reports, nothing at
// all for a message the bot never posted, and the totals the owner console reads — counted while the thumbs existed, and
// never written again.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../server/db";
import { REPORT, answerRow, reactionUsage, trackAnswer } from "./reactions";

describe("the row behind an answer", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => {
    await run("DELETE FROM discord_answers");
  });

  it("keeps the question an answer was given for, so a 👎 can report it", async () => {
    await trackAnswer("m1", "g1", "who won decode");
    expect(await answerRow("m1")).toEqual({ question: "who won decode" });
    // Redacted like every ask (bot/asks.ts), and one line.
    await trackAnswer("m2", "g1", "who   won\n decode");
    expect(await answerRow("m2")).toEqual({ question: "who won decode" });
  });

  it("has no question for an answer from before questions were kept, and no row at all for a message it never posted", async () => {
    await trackAnswer("m1", "g1");
    expect(await answerRow("m1")).toEqual({ question: null });
    // Null is what keeps a 👎 elsewhere from filing anything.
    expect(await answerRow("someone-elses")).toBeNull();
    expect(await answerRow("")).toBeNull();
  });

  it("tracking the same message twice keeps the row it had", async () => {
    await trackAnswer("m3", "g1", "first");
    await trackAnswer("m3", "g1", "second");
    expect(await answerRow("m3")).toEqual({ question: "first" });
  });

  it("keeps the totals the thumbs collected, and nothing adds to them any more", async () => {
    await run("INSERT INTO discord_answers (message_id, guild_id, up, down, voted_at) VALUES ('m4', 'g1', 2, 1, ?)", [new Date().toISOString()]);
    expect(await reactionUsage()).toEqual({ up: 2, down: 1 });
    // A new answer: its own row, and not a vote on any of them.
    await trackAnswer("m5", "g1");
    expect(await reactionUsage()).toEqual({ up: 2, down: 1 });
  });

  it("names the one reaction a person adds deliberately", () => {
    expect(REPORT).toBe("👎");
  });
});
