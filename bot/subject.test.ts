// A thread's subject: the words a follow-up asks on behalf of, so "their last meet" in a thread about Theseus is
// searched for Theseus. The eval set (bot/evals/threads.json) is the phrasings the failed-search queue kept filing —
// add the ones people actually type, and the check below asks each of them the way a reply in that thread would.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BrunoChatTurn } from "../server/auth/controlPoint.js";
import { recordsTurn } from "./ask.js";
import { looksBack, namesOwn, subjectOf, threadSubject, withSubject } from "./subject.js";

const said = (...texts: string[]): BrunoChatTurn[] => texts.map((text) => ({ role: "user" as const, text }));

describe("a thread's subject", () => {
  it("is the last thing said about the records, in the thread's own words", () => {
    expect(threadSubject(said("hi", "what did theseus get in auto opr"), recordsTurn)).toBe("what did theseus get in auto opr");
    expect(threadSubject(said("4215 opr", "what about 6980 vs 4215"), recordsTurn)).toBe("what about 6980 vs 4215");
  });

  it("is nothing when the thread never asked about the records, or only looked back", () => {
    expect(threadSubject(said("hi", "thanks"), recordsTurn)).toBeNull();
    expect(threadSubject(said("their record?"), recordsTurn)).toBeNull();
    // A build question is not a subject, however long it is.
    expect(threadSubject(said("how does a 42:15 gear ratio work?"), recordsTurn)).toBeNull();
  });

  it("is read from a turn's words, without its question form", () => {
    expect(subjectOf("  so what did theseus get?  ")).toBe("what did theseus get");
    expect(subjectOf("4215 opr!")).toBe("4215 opr");
  });

  it("is only for a message that looks back and names nothing of its own", () => {
    expect(looksBack("their last meet?")).toBe(true);
    expect(looksBack("what about that event?")).toBe(true);
    expect(looksBack("how does it work?")).toBe(false);
    expect(namesOwn("what about 6980?")).toBe(true);
    expect(namesOwn("who won AUBRQ2")).toBe(true);
    expect(namesOwn("how does it work?")).toBe(false);
    expect(withSubject("their last meet?", "what did theseus get")).toBe("their last meet? (what did theseus get)");
    expect(withSubject("what about 6980?", "4215 opr")).toBeNull();
    expect(withSubject("their last meet?", null)).toBeNull();
    // The thread has already said it here.
    expect(withSubject("4215 opr, their record?", "4215 opr")).toBeNull();
  });
});

describe("the follow-up eval set", () => {
  const cases = JSON.parse(readFileSync(new URL("./evals/threads.json", import.meta.url), "utf8")) as
    { why: string; thread: string[]; q: string; expect: string | null }[];

  it.each(cases.map((c) => [c.q, c] as const))("%s", (_q, c) => {
    const asked = withSubject(c.q, threadSubject(said(...c.thread), recordsTurn)) ?? c.q;
    if (c.expect === null) expect(asked, c.why).toBe(c.q);
    else expect(asked, c.why).toContain(c.expect);
  });
});
