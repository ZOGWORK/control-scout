// Many teams' hits in one read (./search.ts teamNumberHits): each the same hit a search for its number alone gives,
// so compound, boolean and yes-or-no answers that read one per team (a whole search each) answer the same.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { search, teamNumberHits } from "./search";
import { searchAnswer } from "./searchAnswer";
import { CURRENT_SEASON } from "../data/seasons";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name, city] of [[4215, "Hypnotic Robotics", "Town"], [6980, "Bad Wolf", null], [42, null, "Elsewhere"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, 'NJ', 'USA')", [n, name, city]);
  }
  await run("INSERT INTO team_seasons (season, team) VALUES (?, 4215)", [CURRENT_SEASON]);
});

describe("teamNumberHits", () => {
  it("is each team's hit as a search for its number gives it, in one read", async () => {
    const by = await teamNumberHits([4215, 6980, 42, 4215]);
    for (const n of [4215, 6980, 42]) {
      const own = (await search(String(n), 12)).find((h) => h.kind === "team" && h.ref === String(n));
      expect(by.get(n)).toEqual(own);
      const whole = (await searchAnswer(String(n), { intents: false, learn: false })).hits.find((h) => h.kind === "team" && h.ref === String(n));
      expect({ ...by.get(n), facts: undefined, events: undefined }).toEqual({ ...whole, facts: undefined, events: undefined });
    }
    expect(by.get(4215)?.season).toBe(CURRENT_SEASON);
    expect(by.get(6980)?.season).toBeNull();
  });

  it("has none for a number no team has, and reads nothing for none", async () => {
    expect((await teamNumberHits([99999, 0, -1, 1.5])).size).toBe(0);
    expect((await teamNumberHits([])).size).toBe(0);
  });
});
