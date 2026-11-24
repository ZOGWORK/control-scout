// The event page's v8 tab order (owner, 11-23): a finished event reads Matches, Playoffs, Rankings, Awards, Insights,
// Teams, Odds, and still opens on Rankings (the default is named, not "the first tab").
import { describe, expect, it } from "vitest";
import { V8_DEFAULT_TAB, V8_TAB_ORDER } from "./EventFocus";
import { EVENT_TABS } from "../lib/eventTab";

describe("v8 event tabs", () => {
  it("orders a finished event's tabs as the owner asked", () => {
    expect(V8_TAB_ORDER.finished).toEqual(["matches", "playoffs", "rankings", "awards", "insights", "teams", "odds"]);
  });
  it("keeps every tab in every state, once", () => {
    for (const order of Object.values(V8_TAB_ORDER)) expect([...order].sort()).toEqual([...EVENT_TABS].sort());
  });
  it("still opens a finished event on Rankings", () => {
    expect(V8_DEFAULT_TAB.finished).toBe("rankings");
  });
});
