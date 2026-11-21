import { expect, it } from "vitest";
import { buildNames } from "./names";
import { parseQuery } from "./parse";

it("prefers a whole stored team name over an overlapping shortened alias", async () => {
  const names = buildNames([
    { number: 1, name: "Out of the Bot Robotics", city: null, state: null, country: null },
    { number: 2, name: "The Bot Patrol", city: null, state: null, country: null },
  ], []);
  const p = await parseQuery("tell me worst pts of the bot patrol please", { names, today: "2026-11-19", isEvent: async () => false });
  expect(p.teams.map(t => t.number)).toEqual([2]);
  expect(p.intent).toBe("lowest-score");
  expect(p.complete).toBe(true);
});
