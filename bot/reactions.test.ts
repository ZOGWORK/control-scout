// The row behind each answer (bot/reactions.ts): the question it was written for, which is what a 👎 reports, nothing at
// all for a message the bot never posted, and the totals the owner console reads — counted while the thumbs existed, and
// never written again.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../server/db";
import { REPORT, answerRow, markReported, reactionUsage, reporterName, trackAnswer, wholeAnswer } from "./reactions";

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
    expect(await answerRow("m1")).toEqual({ question: "who won decode", report: null, source: null, step: null, ms: null });
    // Redacted like every ask (bot/asks.ts), and one line.
    await trackAnswer("m2", "g1", "who   won\n decode");
    expect(await answerRow("m2")).toEqual({ question: "who won decode", report: null, source: null, step: null, ms: null });
  });

  it("has no question for an answer from before questions were kept, and no row at all for a message it never posted", async () => {
    await trackAnswer("m1", "g1");
    expect(await answerRow("m1")).toEqual({ question: null, report: null, source: null, step: null, ms: null });
    // Null is what keeps a 👎 elsewhere from filing anything.
    expect(await answerRow("someone-elses")).toBeNull();
    expect(await answerRow("")).toBeNull();
  });

  it("keeps what produced the answer and how long it took, for a report's triage", async () => {
    await trackAnswer("m7", "g1", "who won decode", { source: "bruno", step: "deterministic", ms: 1100 });
    expect(await answerRow("m7")).toEqual({ question: "who won decode", report: null, source: "bruno", step: "deterministic", ms: 1100 });
  });

  it("tracking the same message twice keeps the row it had", async () => {
    await trackAnswer("m3", "g1", "first");
    await trackAnswer("m3", "g1", "second");
    expect(await answerRow("m3")).toEqual({ question: "first", report: null, source: null, step: null, ms: null });
  });

  it("keeps the issue a 👎 opened on the row, so a later 👎 finds it after a restart", async () => {
    await trackAnswer("m6", "g1", "who won decode");
    const issue = { number: 2150, url: "https://github.com/ZOGWORK/control-scout/issues/2150" };
    await markReported("m6", issue);
    expect(await answerRow("m6")).toEqual({ question: "who won decode", report: issue, source: null, step: null, ms: null });
    // A message it never posted: nothing to write, and nothing to read back.
    await markReported("someone-elses", issue);
    expect(await answerRow("someone-elses")).toBeNull();
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

describe("an answer Discord sent only part of", () => {
  /** A message as the gateway hands it over: `partial` when only its id arrived, with `fetch` for the rest. */
  interface Sent { id: string; partial: boolean; content: string | null; fetch: () => Promise<Sent> }
  const sent = (over: Partial<Sent> = {}): Sent => {
    const m: Sent = { id: "m9", partial: false, content: "Exodus qualified once.", fetch: async () => m, ...over };
    return m;
  };

  it("is fetched before it is reported, so the issue has its words", async () => {
    const full = sent();
    const partial = sent({ partial: true, content: null, fetch: async () => full });
    expect(await wholeAnswer(partial)).toBe(full);
  });

  it("is left as it came when it isn't partial, or the fetch fails", async () => {
    const whole = sent();
    const fetch = vi.fn(async () => whole);
    expect(await wholeAnswer({ ...whole, fetch })).toMatchObject({ id: "m9", partial: false });
    expect(fetch).not.toHaveBeenCalled();
    const partial = sent({ partial: true, content: null, fetch: async () => { throw new Error("10008"); } });
    expect(await wholeAnswer(partial)).toBe(partial);
  });
});

describe("the name a report shows the reporter by", () => {
  /** An answer as the reaction gateway carries it: its guild, and whoever is cached there. `MessageReaction` itself has no
   *  member, which is what made reading one off the reaction always null. */
  const answer = (nick?: string) => ({ guild: { members: { cache: new Map(nick === undefined ? [] : [["u1", { displayName: nick }]]) } } });

  it("is the nickname Discord shows them by in that server", () => {
    expect(reporterName(answer("Coach Kim"), "u1")).toBe("Coach Kim");
    expect(reporterName(answer("  Coach Kim "), "u1")).toBe("Coach Kim");
  });

  it("is null when the reactor isn't cached there, has no nickname, or the answer is a DM", () => {
    expect(reporterName(answer(), "u1")).toBeNull();
    expect(reporterName(answer("   "), "u1")).toBeNull();
    expect(reporterName(answer("Coach Kim"), "someone-else")).toBeNull();
    expect(reporterName({ guild: null }, "u1")).toBeNull();
    expect(reporterName(null, "u1")).toBeNull();
  });
});
