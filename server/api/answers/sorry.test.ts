// A sorry's suggestions (./sorry.ts firstAnswering): the first four that answer, of the first six, checked one at a
// time and no more once four do.
import { describe, expect, it } from "vitest";
import { firstAnswering } from "./sorry";

describe("a sorry's suggestions", () => {
  it("checks one at a time and stops once four answer", async () => {
    const asked: string[] = [];
    const answers = async (q: string) => { asked.push(q); return q !== "b"; };
    expect(await firstAnswering(["a", "b", "c", "d", "e", "f", "g"], answers)).toEqual(["a", "c", "d", "e"]);
    expect(asked).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("tries no more than the first six", async () => {
    const asked: string[] = [];
    expect(await firstAnswering(["a", "b", "c", "d", "e", "f", "g"], async (q) => { asked.push(q); return q === "g"; })).toEqual([]);
    expect(asked).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
