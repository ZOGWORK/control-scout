// A team's event rows: each place badge in its colour (#2240): 1st gold, 2nd silver, 3rd copper, every other place a
// light blue-grey; a darker shade of each on a light theme (`dark:` is every theme but Light).
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
const { placeTone } = await import("./TeamPage");

describe("placeTone", () => {
  it("gold, silver, copper, then one blue-grey for every other place", () => {
    expect(placeTone(1)).toContain("dark:text-[#fcd34d]");
    expect(placeTone(2)).toContain("dark:text-zinc-200");
    expect(placeTone(3)).toContain("dark:text-[#d9895b]");
    for (const r of [4, 11, 26]) expect(placeTone(r)).toBe(placeTone(5));
    expect(placeTone(5)).toContain("dark:text-[#8ea4c4]");
    expect(new Set([1, 2, 3, 4].map(placeTone)).size).toBe(4);
  });

  it("each has a light-theme text colour of its own (the classes without dark:)", () => {
    const light = (r: number) => placeTone(r).split(" ").filter((c) => c.startsWith("text-"));
    expect([1, 2, 3, 4].map((r) => light(r).length)).toEqual([1, 1, 1, 1]);
    expect(new Set([1, 2, 3, 4].map((r) => light(r)[0])).size).toBe(4);
  });
});
