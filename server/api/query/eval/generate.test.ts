// The eval's generator (./generate.ts): the same seed gives the same sample, and every paraphrase it can make reads
// as the question it was made for. A phrase added to the lexicon that the parser reads another way fails here first.
import { describe, expect, it } from "vitest";
import { buildNames } from "../names";
import { parseQuery, type ParseContext } from "../parse";
import { SHAPES, paraphrases, rng } from "./generate";

const team = { number: 30002, name: "Copper Lanterns" };
const ctx: ParseContext = {
  names: buildNames([{ ...team, city: "Town", state: "OH", country: "USA", lastPlayed: 2026 }], []),
  today: "2026-11-04",
  isEvent: async () => false,
};

describe("the eval's generator", () => {
  it("draws the same sample for the same seed", () => {
    expect(paraphrases(rng(5), SHAPES[0], team, true, 8)).toEqual(paraphrases(rng(5), SHAPES[0], team, true, 8));
    expect(paraphrases(rng(5), SHAPES[0], team, true, 8)).not.toEqual(paraphrases(rng(6), SHAPES[0], team, true, 8));
  });
  it("every paraphrase reads as its question, for the team", async () => {
    for (const shape of SHAPES) {
      for (let seed = 0; seed < 20; seed++) {
        for (const q of paraphrases(rng(seed), shape, team, true, 6)) {
          expect(await parseQuery(q, ctx), q).toMatchObject({ intent: shape.id, teams: [{ number: team.number }], complete: true });
        }
      }
    }
  });
});
