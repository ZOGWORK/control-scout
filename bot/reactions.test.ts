// The thumbs on an answer (bot/reactions.ts): a row for each message the bot posted, counts up and down, nothing below
// zero, and nothing at all for a message that isn't one of its answers. The row also keeps the question the answer was
// given for, and the answer's first 👎 files it in the site's failed-search list in the same write as the vote.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../server/db";
import { BAD, GOOD, downNotes, downVote, firstDown, reactionUsage, serialVotes, trackAnswer, vote } from "./reactions";

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

  it("adds weight to an entry already on the list instead of rewriting it", async () => {
    // Search already failed this question its own way, with the spellings it saw: a 👎 says the entry matters, and must
    // not turn a no-match (with its own re-check) into a downvote or throw its examples away.
    await run(
      `INSERT INTO search_failures (key, hash, result_type, intent, reading, examples, count, first_seen, last_seen)
       VALUES ('4215 opr', 'h', 'no-match', 'opr', '{}', '["4215 opr rn"]', 3, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`,
    );
    await trackAnswer("m9", "g1", "4215 opr");
    await downVote("m9");
    expect(await failed()).toEqual([
      { key: "4215 opr", result_type: "no-match", intent: "opr", count: 4, examples: JSON.stringify(["4215 opr rn"]) },
    ]);
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

  it("tells the channel once, on an answer's first 👎, that a 👎 files the question", async () => {
    await trackAnswer("n1", "g1", "where do i get a lazy susan bearing");
    expect(await firstDown("n1")).toBe(false);
    await downVote("n1");
    expect(await firstDown("n1")).toBe(true);
    const note = downNotes();
    expect(await note.worth("n1")).toBe(true);
    note.said("n1");
    // A second 👎 — or the first one taken off and added again — is the same answer: it has been told.
    await downVote("n1");
    expect(await firstDown("n1")).toBe(false);
    expect(await note.worth("n1")).toBe(false);
    // A message that isn't one of the bot's answers has no count, so nothing is said about it.
    expect(await firstDown("someone-elses")).toBe(false);
  });

  it("two 👎 arriving together say it once, and a note that couldn't be sent is owed, not spent", async () => {
    const note = downNotes(async () => true);
    expect(await Promise.all([note.worth("same"), note.worth("same")])).toEqual([true, false]);
    // The send failed, or the channel wasn't there: the claim is released, so a later 👎 can say it.
    note.unsent("same");
    expect(await note.worth("same")).toBe(true);
    note.said("same");
    expect(await note.worth("same")).toBe(false);
    // An owed note is retried by the next 👎 even though that vote took the count past 1: the count alone can't say
    // whether the answer has been told.
    let count = 1;
    const owed = downNotes(async () => count === 1);
    expect(await owed.worth("x")).toBe(true);
    owed.unsent("x");
    count = 2;
    expect(await owed.worth("x")).toBe(true);
    owed.said("x");
    expect(await owed.worth("x")).toBe(false);
    // A read that fails says nothing and owes nothing: no message is claimed for a note it may not be due.
    const broken = downNotes(async () => { throw new Error("database is locked"); });
    expect(await broken.worth("y")).toBe(false);
    expect(await broken.worth("y")).toBe(false);
    // Past the cap the oldest answer is forgotten: at worst a repeat note, never a missing one.
    const capped = downNotes(async () => true, 1);
    expect(await capped.worth("a")).toBe(true);
    capped.said("a");
    expect(await capped.worth("b")).toBe(true);
    capped.said("b");
    expect(await capped.worth("a")).toBe(true);
  });
});
