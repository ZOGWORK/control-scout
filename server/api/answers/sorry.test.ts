// A sorry's suggestions (./sorry.ts firstAnswering): the first four that answer, of the first six: the first four
// checked at once, the next two only when needed.
import { describe, expect, it } from "vitest";
import { firstAnswering } from "./sorry";

describe("a sorry's suggestions", () => {
  it("checks the first four, and the next two only when fewer than four of those answer", async () => {
    const asked: string[] = [];
    expect(await firstAnswering(["a", "b", "c", "d", "e", "f", "g"], async (q) => { asked.push(q); return true; })).toEqual(["a", "b", "c", "d"]);
    expect(asked).toEqual(["a", "b", "c", "d"]);
    asked.length = 0;
    expect(await firstAnswering(["a", "b", "c", "d", "e", "f", "g"], async (q) => { asked.push(q); return q !== "b"; })).toEqual(["a", "c", "d", "e"]);
    expect(asked).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("tries no more than the first six", async () => {
    const asked: string[] = [];
    expect(await firstAnswering(["a", "b", "c", "d", "e", "f", "g"], async (q) => { asked.push(q); return q === "g"; })).toEqual([]);
    expect(asked).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
