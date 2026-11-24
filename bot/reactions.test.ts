// The thumbs on an answer (bot/reactions.ts): a row for each message the bot posted, a 👍 counted up and down, nothing
// below zero, and nothing at all for a message that isn't one of its answers. The 👎 was removed: an answer that still
// carries one changes nothing.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../server/db";
import { GOOD, reactionUsage, serialVotes, trackAnswer, vote } from "./reactions";

/** What the answers' 👎s would have filed before it was removed (server/searchFailures.ts): still empty, now always. */
const filed = () => all<{ n: number }>("SELECT COUNT(*) AS n FROM search_failures");

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

  it("counts a 👍 on an answer, and never below zero", async () => {
    await trackAnswer("m1", "g1");
    expect(await vote("m1", GOOD)).toBe(1);
    await vote("m1", GOOD);
    expect(await reactionUsage()).toEqual({ up: 2, down: 0 });
    // Taking the reactions back: an old answer's votes can't go negative, and an emoji that isn't 👍 changes nothing.
    await vote("m1", GOOD, -1);
    await vote("m1", GOOD, -1);
    await vote("m1", GOOD, -1);
    await vote("m1", "🔥");
    expect(await reactionUsage()).toEqual({ up: 0, down: 0 });
  });

  it("counts nothing for a 👎 on an answer it posted: the vote is gone", async () => {
    await trackAnswer("m7", "g1", "who won decode");
    expect(await vote("m7", "👎")).toBe(0);
    expect(await reactionUsage()).toEqual({ up: 0, down: 0 });
    // And nothing files the question it answered: the queue is written by search alone now.
    expect(await filed()).toMatchObject([{ n: 0 }]);
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

  it("runs one answer's votes in the order Discord sent them, and different answers side by side", async () => {
    const order: string[] = [];
    const serial = serialVotes();
    // An add whose write is slow and the removal after it: the removal must still be second, or a 👍 taken back within a
    // moment would leave the answer up.
    await Promise.all([
      serial("a", async () => { await new Promise((r) => setTimeout(r, 20)); order.push("add"); }),
      serial("a", async () => { await new Promise((r) => setTimeout(r, 1)); order.push("remove"); }),
      serial("b", async () => { order.push("another answer"); }),
    ]);
    // The slow add first, its removal second; another answer's vote didn't wait behind either.
    expect(order).toEqual(["another answer", "add", "remove"]);
  });
});
