import { describe, expect, it, vi } from "vitest";
import type { SearchAnswer } from "../src/shared/api";
import { LOOKUP_LINES, lookupFacts, needsSubject, plainAsk, resolveAsk, splitAsk, subjectPhrase } from "./tools";

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

describe("a part that leans on an earlier one", () => {
  const board = { card: undefined, hits: [{ kind: "team", ref: "23268" }] } as unknown as SearchAnswer;

  it("is one with a pronoun, or nothing but its own frame — never a part naming a number", () => {
    for (const p of ["where are they from", "what is their auto opr", "who is by", "where from"]) expect(needsSubject(p), p).toBe(true);
    for (const p of ["what is the best team", "who won decode", "what is 4215's record", "4215 opr", "where is 4215 from"]) expect(needsSubject(p), p).toBe(false);
  });

  it("a chain leans on the nearest team an earlier answer named, not the first part's", () => {
    const board = { stat: { blocks: [{ kind: "leaderboard", rows: [{ team: { label: "23268 Ultraviolet", href: "/teams/23268?season=2026" } }] }] } } as unknown as SearchAnswer;
    const beaten = { hits: [{ kind: "team", ref: "6980", title: "6980 | Bad Wolf", href: "/teams/6980" }] } as unknown as SearchAnswer;
    expect(resolveAsk(["what is the best team", "who beat them", "where are they from"], 2, [board, beaten])).toBe("where are 6980 from");
  });

  it("is asked with the team the earlier part's answer names, not as a dead fragment", () => {
    expect(resolveAsk(["what is the best team", "where are they from"], 1, [board])).toBe("where are 23268 from");
    expect(resolveAsk(["what is the best team", "what is their auto opr"], 1, [board])).toBe("what is 23268 auto opr");
    // A board's own top row, and a card's team, are teams too.
    const leaderboard = { stat: { headline: { value: "23268 Ultraviolet" }, blocks: [{ kind: "leaderboard", rows: [{ team: { label: "23268 Ultraviolet", href: "/teams/23268?season=2026" } }] }] } } as unknown as SearchAnswer;
    expect(resolveAsk(["what is the best team", "where are they from"], 1, [leaderboard])).toBe("where are 23268 from");
    expect(resolveAsk(["4215 highest score", "what is their auto opr"], 1, [{ card: { team: { number: 4215 } } } as unknown as SearchAnswer])).toBe("what is 4215 auto opr");
  });

  it("never takes a score for a team: a headline reading \"412 points\" names no team", () => {
    const score = { stat: { headline: { value: "412 points", teams: [] }, team: undefined, blocks: [] }, hits: [] } as unknown as SearchAnswer;
    expect(resolveAsk(["what is the bio buzz world record", "where are they from"], 1, [score])).toBe("where are bio buzz world record from");
  });

  it("with nothing but its own frame, is asked as the thing it asks about", () => {
    // "…and who is by" has no subject in it: the record the earlier part named is the question the site answers,
    // and its card names the alliance — never a dead "who is by" no search can read.
    expect(resolveAsk(["what is the bio buzz world record", "who is by"], 1)).toBe("bio buzz world record");
    expect(subjectPhrase("what is the bio buzz world record")).toBe("bio buzz world record");
    expect(resolveAsk(["what is 4215's record", "who is by"], 1, [board])).toBe("4215's record");
    // Nothing earlier at all: left as it is.
    expect(resolveAsk(["who is by"], 0, [])).toBe("who is by");
  });
});

describe("the facts of the parts", () => {
  const answer = (q: string, over: Partial<SearchAnswer> = {}) => ({ q, hits: [], pages: [], step: "deterministic", weak: false, ...over }) as SearchAnswer;

  it("each part is searched on its own, and its facts are kept once, in the order asked", async () => {
    const asked: string[] = [];
    const facts = await lookupFacts(["what is the best team", "what is the auto opr"], {
      search: async (q) => { asked.push(q); return answer(q); },
      facts: async (a) => (a.q === "what is the best team" ? ["#1 23268 Ultraviolet (Oradell, NJ): OPR 101.6", "board line"] : ["board line", "auto line"]),
    });
    expect(asked).toEqual(["what is the best team", "what is the auto opr"]);
    expect(facts.facts).toEqual(["#1 23268 Ultraviolet (Oradell, NJ): OPR 101.6", "board line", "auto line"]);
  });

  it("a follow-up is searched with its subject, after the part it leans on has answered", async () => {
    const asked: string[] = [];
    const facts = await lookupFacts(["what is the bio buzz world record", "who is by"], {
      search: async (q) => {
        asked.push(q);
        return q === "what is the bio buzz world record"
          ? answer(q, { card: { kind: "high-scores", title: "Highest scores in 2026–27 (BIOBUZZ)", lines: [{ text: "412 points: Q1 at BioBuzz Qualifier", results: ["Red alliance: 23268 Ultraviolet"] }] } })
          : answer(q);
      },
      facts: async (a) => (a.card ? ["412 points: Q1 at BioBuzz Qualifier: Red alliance: 23268 Ultraviolet", "board line"] : []),
    });
    expect(asked).toEqual(["what is the bio buzz world record", "bio buzz world record"]);
    expect(facts.facts[0]).toMatch(/412 points/);
  });

  it("a part search can't answer adds nothing, and one part alone asks for nothing extra", async () => {
    const none = vi.fn(async () => null);
    expect((await lookupFacts(["what is the best team", "who is by"], { search: none, facts: async () => [] })).facts).toEqual([]);
    expect(none).toHaveBeenCalledTimes(2);
    // The message's own facts are already its own: a one-part message looks nothing up.
    expect((await lookupFacts(["what is the best team"], { search: none, facts: async () => ["x"] })).facts).toEqual([]);
    expect(none).toHaveBeenCalledTimes(2);
  });

  it("keeps the part whose answer has something to show, not the first one with a hit", async () => {
    const weak = answer("weak", { step: "recovery", hits: [{ kind: "team", ref: "1" } as never], sorry: { understood: [], suggest: [] } });
    const board = answer("board", { card: { kind: "high-scores", title: "Board", lines: [] } });
    const facts = await lookupFacts(["weak", "board"], { search: async (q) => (q === "weak" ? weak : board), facts: async () => [] });
    expect(facts.answer?.q).toBe("board");
  });

  it("keeps the site's own answer to the first part search answered, for the card beside his words", async () => {
    const card = { kind: "leaderboard", title: "Top teams by OPR", lines: [] } as const;
    const facts = await lookupFacts(["what is the best team", "what is the auto opr"], {
      search: async (q) => answer(q, q === "what is the best team" ? { card: card as never } : {}),
      facts: async () => ["line"],
    });
    expect(facts.answer?.card).toEqual(card);
    expect((await lookupFacts(["what is the best team", "who is by"], { search: async (q) => answer(q), facts: async () => [] })).answer).toBeUndefined();
  });

  it("is capped, and every part keeps a share, so a broad board never fills the packet before the follow-up", async () => {
    const many = (p: string) => Array.from({ length: 40 }, (_, i) => `${p} ${i} ${"x".repeat(100)}`);
    const facts = await lookupFacts(["a question", "another question"], {
      search: async (q) => answer(q),
      facts: async (a) => many(a.q),
    });
    expect(facts.facts.length).toBeLessThanOrEqual(LOOKUP_LINES);
    expect(facts.facts[0]).toBe(many("a question")[0]);
    // The second part's own line is in the packet: the first part's 40 can't crowd it out.
    expect(facts.facts).toContain(many("another question")[0]);
  });
});
