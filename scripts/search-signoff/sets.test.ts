import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const load = (f: string) => JSON.parse(readFileSync(join(__dirname, "sets", f), "utf8"));
const listed = new Set<string>([
  ...["A.json", "B.json", "C.json"].flatMap((f) => load(f).map((x: { q: string }) => x.q.toLowerCase())),
  ...load("D.json").flatMap((f: { phrasings: string[] }) => f.phrasings.map((q) => q.toLowerCase())),
]);

describe("the sign-off sets", () => {
  it("keeps the held-out rewordings out of every other list, 5 or more per intent", () => {
    for (const g of load("paraphrase.json") as { intent: string; phrasings: string[] }[]) {
      expect(g.phrasings.filter((q) => listed.has(q.toLowerCase())), g.intent).toEqual([]);
      expect(g.phrasings.length, g.intent).toBeGreaterThanOrEqual(5);
    }
  });
  it("holds every list in full", () => {
    expect(load("A.json")).toHaveLength(200);
    expect(load("B.json")).toHaveLength(84);
    expect(load("C.json")).toHaveLength(50);
    expect(load("anyteam.json").length).toBeGreaterThanOrEqual(10);
    for (const f of load("D.json") as { intent: string; phrasings: string[] }[]) expect(f.phrasings.length, f.intent).toBeGreaterThanOrEqual(5);
  });
});
