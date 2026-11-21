import { describe, expect, it } from "vitest";
import { HANDOFF_MS, handOffAnswer, handedAnswer } from "./handoff";
import type { SearchAnswer } from "../../shared/api";

const answer = (q: string): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false });

describe("handedAnswer", () => {
  it("gives the answer back for the same words, however they were spaced or cased", () => {
    const a = answer("Hypnotic  Robotics");
    handOffAnswer(a);
    expect(handedAnswer("hypnotic robotics")).toBe(a);
    expect(handedAnswer("  Hypnotic Robotics  ")).toBe(a);
  });

  it("never hands an answer to another query", () => {
    handOffAnswer(answer("hypnotic robotics"));
    expect(handedAnswer("bad wolf")).toBeNull();
    expect(handedAnswer("hypnotic")).toBeNull();
  });

  it("forgets an answer once it is older than HANDOFF_MS", () => {
    const at = Date.now();
    handOffAnswer(answer("4215"));
    expect(handedAnswer("4215", at)).not.toBeNull();
    expect(handedAnswer("4215", at + HANDOFF_MS + 1)).toBeNull();
  });
});
