// The open questions about a team as a whole (./families/overview.ts): how good it is, what's up with it, its stuff.
import { describe, expect, it } from "vitest";
import { readOverview } from "./families/overview";

describe("an open question about a team", () => {
  it("is read in any of the ways it is put, the team's words left", () => {
    const cases: [string, string, number | null][] = [
      ["how good is 7149 really, like in plain numbers, in 2025-26", "7149", 2025],
      ["is 23268 actually that good or just hype, in 2025-26", "23268", 2025],
      ["can u tell me if bad wolf is good, be honest", "bad wolf", null],
      ["show me alphatronic stuff, like everything", "alphatronic", null],
      ["whats up with ultraviolet, are they cracked", "ultraviolet", null],
      ["how good is simply complex", "simply complex", null],
      ["everything about 4215", "4215", null],
    ];
    for (const [q, core, season] of cases) expect(readOverview(q), q).toMatchObject({ id: "overview", core, season });
  });
  it("leaves one thing asked about the team to that thing's reader", () => {
    for (const q of ["how good is 4215 at auto", "is 4215 good at auto", "how good is 4215 at worlds", "is 4215 better than 6980", "4215 record", "whats up with nj states", "how good is 4215 vs 6980", "auto stuff"]) {
      expect(readOverview(q), q).toBeNull();
    }
  });
});
