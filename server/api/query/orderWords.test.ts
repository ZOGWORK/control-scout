// A sort said as an order ("lowest scoring first"), "what happened" with no team, and events said to be over
// ("ended meets"): read as the season's best or worst matches, a scope's highlights and past events. Fixture names
// only, no database; every phrasing here is a rewording, never a logged query.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";
import { parseQuery, type ParseContext } from "./parse";
import { readEventQuery } from "../../../src/shared/searchEventQuery";

const ctx: ParseContext = {
  names: buildNames([{ number: 4215, name: "Hypnotic Robotics", city: "Oradell", state: "NJ", country: "USA", lastPlayed: 2026 }], []),
  today: "2026-11-04",
  isEvent: async () => false,
};
const parse = (q: string) => parseQuery(q, ctx);

describe("a sort said as an order", () => {
  it("highest or lowest first is the best or worst matches, never a first match", async () => {
    expect(await parse("show me the games from last week, top first")).toMatchObject({ intent: "top-matches", agg: "max", complete: true });
    expect(await parse("matches in new jersey this month highest scores first")).toMatchObject({ intent: "top-matches", complete: true });
    expect(await parse("matches this week lowest scoring first")).toMatchObject({ intent: "low-matches", complete: true });
    // A team's first match is still its first.
    expect(await parse("4215 first match")).toMatchObject({ intent: "first-match", complete: true });
  });
});

describe("what happened, with no team", () => {
  it("is the scope's highlights, for a window or a place", async () => {
    expect(await parse("what happened this weekend")).toMatchObject({ intent: "highlights", complete: true });
    expect(await parse("what happened in new jersey last week, best games")).toMatchObject({ intent: "highlights", place: { name: "New Jersey" }, complete: true });
  });
});

describe("events said to be over", () => {
  it("finished, completed and ended events are past events", () => {
    for (const w of ["finished", "completed", "ended"]) expect(readEventQuery(`${w} meets in New Jersey`), w).toMatchObject({ kinds: ["meet"], time: "past", region: { key: "USA:NJ" } });
    expect(readEventQuery("ended events")).toMatchObject({ time: "past" });
  });
});
