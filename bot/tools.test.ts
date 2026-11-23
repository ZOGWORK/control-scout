import { describe, expect, it, vi } from "vitest";
import type { SearchAnswer } from "../src/shared/api";
import { LOOKUP_LINES, lookupFacts, plainAsk, splitAsk } from "./tools";

describe("the parts of a message", () => {
  it("the screenshot's question is three parts, its filler dropped", () => {
    expect(splitAsk("what is like the best team rn, where are they from and what is their auto opr")).toEqual([
      "what is the best team", "where are they from", "what is their auto opr",
    ]);
    expect(plainAsk("what is like the best team rn")).toBe("what is the best team");
  });

  it("the record-and-who question is two parts", () => {
    expect(splitAsk("what is the bio buzz world record rn and who is by")).toEqual(["what is the bio buzz world record", "who is by"]);
  });

  it("a compound search already answers stays whole: the words after \"and\" aren't a question", () => {
    expect(splitAsk("4215 and 6980 opr")).toEqual(["4215 and 6980 opr"]);
    expect(splitAsk("compare 4215 and 6980")).toEqual(["compare 4215 and 6980"]);
    expect(splitAsk("4215 opr and rank")).toEqual(["4215 opr and rank"]);
  });

  it("at most three parts, a one-part message whole, and nothing for no words", () => {
    expect(splitAsk("what is 4215's record, and who won worlds, and what is the highest score")).toHaveLength(3);
    expect(splitAsk("what is 4215's record")).toEqual(["what is 4215's record"]);
    expect(splitAsk("  ")).toEqual([]);
  });
});

describe("the facts of the parts", () => {
  const answer = (q: string) => ({ q }) as unknown as SearchAnswer;

  it("each part is searched on its own, and its facts are kept once, in the order asked", async () => {
    const asked: string[] = [];
    const facts = await lookupFacts(["what is the best team", "what is their auto opr"], {
      search: async (q) => { asked.push(q); return answer(q); },
      facts: async (a) => (a.q === "what is the best team" ? ["#1 23268 Ultraviolet (Oradell, NJ): OPR 101.6", "board line"] : ["board line", "auto line"]),
    });
    expect(asked).toEqual(["what is the best team", "what is their auto opr"]);
    expect(facts).toEqual(["#1 23268 Ultraviolet (Oradell, NJ): OPR 101.6", "board line", "auto line"]);
  });

  it("a part search can't answer adds nothing, and one part alone asks for nothing extra", async () => {
    const none = vi.fn(async () => null);
    expect(await lookupFacts(["what is the best team", "who is by"], { search: none, facts: async () => [] })).toEqual([]);
    expect(none).toHaveBeenCalledTimes(2);
    // The message's own facts are already its own: a one-part message looks nothing up.
    expect(await lookupFacts(["what is the best team"], { search: none, facts: async () => ["x"] })).toEqual([]);
    expect(none).toHaveBeenCalledTimes(2);
  });

  it("is capped, so a broad part's answer never crowds the chat's packet", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `line ${i} ${"x".repeat(100)}`);
    const facts = await lookupFacts(["a question", "another question"], { search: async () => answer("x"), facts: async () => many });
    expect(facts.length).toBeLessThanOrEqual(LOOKUP_LINES);
    expect(facts[0]).toBe(many[0]);
  });
});
