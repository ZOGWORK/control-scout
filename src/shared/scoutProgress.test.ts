// The one progress source: pit scouting at an event, counted against its team list or its team count.
import { describe, expect, it } from "vitest";
import { pitProgress } from "./scoutProgress";

const pit = (team: number, eventCode = "USNJQ1") => ({ team, eventCode, matchLabel: null, kind: "pit" });

describe("pitProgress", () => {
  const entries = [pit(1), pit(2), pit(3, "OTHER"), { ...pit(4), deleted: true }];
  it("counts the event's listed teams with a pit entry there", () => {
    expect(pitProgress(entries, "usnjq1", [1, 5, 6])).toEqual({ done: 1, total: 3 });
    expect(pitProgress(entries, "USNJQ1", 10)).toEqual({ done: 2, total: 10 });
  });
  it("with no team count yet, what's scouted still shows (out of an unknown total)", () => {
    expect(pitProgress(entries, "USNJQ1", 0)).toEqual({ done: 2, total: 0 });
    expect(pitProgress(entries, "USNJQ1", [])).toEqual({ done: 2, total: 0 });
  });
});
