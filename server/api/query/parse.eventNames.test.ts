// An event's whole stored name is the event (./parse.ts, step 0c), read before any of its words is a team, a number
// or a place: a league meet's own number, a town or a region in its name. Names stored with no other reading of them
// stay as they were.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";
import { parseQuery, type ParseContext } from "./parse";

const TEAMS = [
  { number: 1, name: "Team Unlimited", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 4, name: "Four Bots", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 4215, name: "Hypnotic Robotics", city: "Oradell", state: "NJ", country: "USA", lastPlayed: 2026 },
  // A team named as an event is: the team, as before.
  { number: 9000, name: "Robot Rumble Showcase", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
];
const EVENTS = [
  { city: "Edmonds", state: "WA", country: "USA", name: "Ritchie League Meet 1", code: "USWARIM1" },
  { city: "Dallas", state: "TX", country: "USA", name: "NTX I-League Meet #1", code: "USTXNTXM1" },
  { city: "Ames", state: "IA", country: "USA", name: "Iris Ames", code: "USIAIRAM" },
  { city: "Sergeant Bluff", state: "IA", country: "USA", name: "Coneflower Sgt Bluff", code: "USIACONEM1" },
  { city: "Grand Rapids", state: "MI", country: "USA", name: "West Michigan Meet 4", code: "USMIWMM4" },
  { city: "Belding", state: "MI", country: "USA", name: "Belding Qualifier", code: "USMIBEQ" },
  { city: "Austin", state: "TX", country: "USA", name: "Texas Championship", code: "USTXCMP" },
  { city: "Town", state: "OH", country: "USA", name: "League Meet 1", code: "USOHLM1" },
  { city: "Town", state: "OH", country: "USA", name: "Robot Rumble Showcase", code: "USOHRRS" },
];
const ctx: ParseContext = {
  names: buildNames(TEAMS, EVENTS),
  today: "2026-11-14",
  isEvent: async (w) => EVENTS.some((e) => (e.name ?? "").toLowerCase().includes(w) && w.split(" ").length >= 2),
};
const parse = (q: string) => parseQuery(q, ctx);

describe("an event's whole stored name", () => {
  it("is the event, its own number never a team", async () => {
    for (const [q, words] of [
      ["Ritchie League Meet 1 highlights 2026-27", "ritchie league meet 1"],
      ["NTX I-League Meet #1 highlights 2026-27", "ntx i league meet 1"],
      ["West Michigan Meet 4 highlights", "west michigan meet 4"],
      ["4215 at ritchie league meet 1", "ritchie league meet 1"],
    ] as const) {
      const p = await parse(q);
      expect(p.event?.words, q).toBe(words);
      expect(p.teams.map((t) => t.number), q).toEqual(q.startsWith("4215") ? [4215] : []);
    }
  });

  it("is the event, a town or region in it never the place", async () => {
    for (const [q, words] of [["Iris Ames highlights 2026-27", "iris ames"], ["Coneflower Sgt Bluff highlights", "coneflower sgt bluff"]] as const) {
      const p = await parse(q);
      expect(p.event?.words, q).toBe(words);
      expect(p.place, q).toBeNull();
    }
  });

  it("never a kind of event and a number alone, a team's whole name, or a place with only event words beside it: those read as they did", async () => {
    // The same names with no event's whole name to read (as before step 0c): the same parse.
    const before: ParseContext = { ...ctx, names: { ...buildNames(TEAMS, EVENTS), eventNamed: () => false } };
    for (const q of ["league meet 1", "robot rumble showcase", "texas championship", "belding qualifier", "4215 league meet"]) {
      const [now, then] = await Promise.all([parse(q), parseQuery(q, before)]);
      expect({ teams: now.teams, event: now.event, place: now.place }, q).toEqual({ teams: then.teams, event: then.event, place: then.place });
    }
    expect((await parse("robot rumble showcase")).teams.map((t) => t.number)).toEqual([9000]);
  });
});
