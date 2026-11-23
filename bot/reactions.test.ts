// The thumbs on an answer (bot/reactions.ts): a row for each message the bot posted, counts up and down, nothing below
// zero, and nothing at all for a message that isn't one of its answers. The row also keeps the question the answer was
// given for, so the first 👎 on it can file that question (server/searchFailures.ts noteBotDownvote).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../server/db";
import { BAD, GOOD, downVote, reactionUsage, trackAnswer, vote } from "./reactions";

describe("the thumbs on an answer", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => { await run("DELETE FROM discord_answers"); });

  it("counts a vote on an answer, both ways, and never below zero", async () => {
    await trackAnswer("m1", "g1");
    expect(await vote("m1", GOOD)).toBe(1);
    await vote("m1", GOOD);
    await vote("m1", BAD);
    expect(await reactionUsage()).toEqual({ up: 2, down: 1 });
    // Taking the reactions back: an old answer's votes can't go negative, and an emoji that isn't one changes nothing.
    await vote("m1", GOOD, -1);
    await vote("m1", GOOD, -1);
    await vote("m1", GOOD, -1);
    await vote("m1", "🔥");
    expect(await reactionUsage()).toEqual({ up: 0, down: 1 });
  });

  it("ignores a message the bot never posted, so a reaction elsewhere can't inflate the numbers", async () => {
    expect(await vote("someone-elses", GOOD)).toBe(0);
    expect(await reactionUsage()).toEqual({ up: 0, down: 0 });
  });

  it("tracking the same message twice keeps its counts", async () => {
    await trackAnswer("m2", "g1");
    await vote("m2", GOOD);
    await trackAnswer("m2", "g1");
    expect(await reactionUsage()).toEqual({ up: 1, down: 0 });
  });

  it("keeps the question each answer was given for, and a 👎 names it on the answer's first vote only", async () => {
    await trackAnswer("m3", "g1", "  who won\n decode  ");
    // One line, as every ask is kept: the queue's key is the words, not the layout.
    expect(await downVote("m3")).toEqual({ question: "who won decode", guild: "g1", first: true });
    // A second 👎 on the same answer is the same complaint about the same question: counted, and not filed again.
    expect(await downVote("m3")).toEqual({ question: "who won decode", guild: "g1", first: false });
    expect(await reactionUsage()).toEqual({ up: 0, down: 2 });
  });

  it("redacts the question it keeps, and has nothing to file for a message it never posted", async () => {
    await trackAnswer("m4", null, "email someone@example.com about 4215");
    expect((await downVote("m4"))?.question).toBe("email [email] about 4215");
    expect(await downVote("never-posted")).toBeNull();
    // An answer posted before questions were kept: its 👍/👎 still count, and there is nothing to name.
    await trackAnswer("m5", "g1");
    expect(await downVote("m5")).toEqual({ question: null, guild: "g1", first: true });
  });
});
