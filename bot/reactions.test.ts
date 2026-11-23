// The thumbs on an answer (bot/reactions.ts): a row for each message the bot posted, counts up and down, nothing below
// zero, and nothing at all for a message that isn't one of its answers. The row also keeps the question the answer was
// given for, and the answer's first 👎 files it in the site's failed-search list in the same write as the vote.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../server/db";
import { BAD, GOOD, downVote, reactionUsage, serialVotes, trackAnswer, vote } from "./reactions";

/** What the answers' 👎s have filed (server/searchFailures.ts downvoteFailure). */
const failed = () => all<{ key: string; result_type: string; intent: string | null; count: number; examples: string }>(
  "SELECT key, result_type, intent, count, examples FROM search_failures ORDER BY key",
);

describe("the thumbs on an answer", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => {
    await run("DELETE FROM discord_answers");
    await run("DELETE FROM search_failures");
  });

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
    await downVote("someone-elses");
    expect(await reactionUsage()).toEqual({ up: 0, down: 0 });
    expect(await failed()).toEqual([]);
  });

  it("tracking the same message twice keeps its counts", async () => {
    await trackAnswer("m2", "g1");
    await vote("m2", GOOD);
    await trackAnswer("m2", "g1");
    expect(await reactionUsage()).toEqual({ up: 1, down: 0 });
  });

  it("files the question a 👎 answered, on the answer's first vote only", async () => {
    await trackAnswer("m3", "g1", "  who won\n decode  ");
    await downVote("m3");
    // One line, as every ask is kept: the queue's key is the words, not the layout. The intent is the question's own.
    expect(await failed()).toEqual([
      { key: "who won decode", result_type: "downvoted", intent: "winners", count: 1, examples: JSON.stringify(["who won decode"]) },
    ]);
    // A second 👎 on the same answer is the same complaint about the same question: counted, and not filed again.
    await downVote("m3");
    expect(await failed()).toMatchObject([{ count: 1 }]);
    expect(await reactionUsage()).toEqual({ up: 0, down: 2 });
  });

  it("files one question once per 👎 across servers, and never for a 👍", async () => {
    await trackAnswer("a1", "g1", "who won decode at austin");
    await trackAnswer("a2", "g2", "who won decode at austin");
    await downVote("a1");
    await downVote("a2");
    // Two answers to one question, in two servers: one entry counted twice, not two entries.
    expect(await failed()).toMatchObject([{ key: "who won decode at austin", result_type: "downvoted", count: 2 }]);
    await trackAnswer("a3", "g1", "where is 4215 from");
    await vote("a3", GOOD);
    expect(await failed()).toHaveLength(1);
  });

  it("files nothing the queue may not hold, and still counts the vote", async () => {
    // All personal data: the vote counts, the question has nothing the list may keep.
    await trackAnswer("m4", "g1", "someone@example.com");
    await downVote("m4");
    // An answer posted before questions were kept: there is no question to name.
    await trackAnswer("m5", "g1");
    await downVote("m5");
    expect(await failed()).toEqual([]);
    expect(await reactionUsage()).toEqual({ up: 0, down: 2 });
  });

  it("two 👎 arriving together file once: the count is the claim", async () => {
    await trackAnswer("m6", "g1", "4215 opr");
    await Promise.all([downVote("m6"), downVote("m6")]);
    expect(await failed()).toMatchObject([{ key: "4215 opr", count: 1 }]);
    expect(await reactionUsage()).toEqual({ up: 0, down: 2 });
  });

  it("runs one answer's votes in the order Discord sent them, and different answers side by side", async () => {
    const order: string[] = [];
    const serial = serialVotes();
    // An add whose write is slow and the removal after it: the removal must still be second, or a 👎 taken back within a
    // moment would leave the answer down and file a vote nobody holds.
    await Promise.all([
      serial("a", async () => { await new Promise((r) => setTimeout(r, 20)); order.push("add"); }),
      serial("a", async () => { await new Promise((r) => setTimeout(r, 1)); order.push("remove"); }),
      serial("b", async () => { order.push("another answer"); }),
    ]);
    // The slow add first, its removal second; another answer's vote didn't wait behind either.
    expect(order).toEqual(["another answer", "add", "remove"]);
  });
});
