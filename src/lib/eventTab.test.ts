import { describe, expect, it } from "vitest";
import { eventTab } from "./eventTab";

describe("eventTab", () => {
  const opts = { predictable: true, fallback: "matches" as const };
  it("uses the fallback when no tab is asked", () => expect(eventTab(null, opts)).toEqual({ tab: "matches", valid: true }));
  it("keeps a real tab", () => expect(eventTab("insights", opts)).toEqual({ tab: "insights", valid: true }));
  it.each(["garbage", "", "Matches", "constructor", "toString"])("falls back for %j", (t) => expect(eventTab(t, opts)).toEqual({ tab: "matches", valid: false }));
  it("Odds only where predictions exist", () => {
    expect(eventTab("odds", opts)).toEqual({ tab: "odds", valid: true });
    expect(eventTab("odds", { predictable: false, fallback: "teams" })).toEqual({ tab: "teams", valid: false });
  });
});
