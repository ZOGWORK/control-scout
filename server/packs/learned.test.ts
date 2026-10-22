// The lite pack records which results its ratings learned for each recent event (the forecaster's own
// storedPlayedKeys), and the device reads that record exactly: listed keys, none for an unlisted event in the
// window, unknown before it or with no record.
import { describe, expect, it } from "vitest";
import { learnedKeys } from "../../src/shared/liteLearned";
import { learnedEvents } from "./build";

const f = {
  seasonEvents: () => [{ code: "OLD", start: "2025-10-01", end: "2025-10-02" }, { code: "NOW", start: "2025-11-08", end: "2025-11-09" }] as never,
  storedPlayedKeys: (_s: number, code: string) => new Set(code === "NOW" ? ["qual:0:2", "qual:0:1"] : ["qual:0:9"]),
};

describe("lite pack learned record", () => {
  it("lists the learned keys of events that ended in the window, from the forecaster", () => {
    expect(learnedEvents(f, 2025, "2025-11-01")).toEqual({ NOW: ["qual:0:1", "qual:0:2"] });
  });
  it("reads back exactly what it can vouch for", () => {
    const rec = { since: "2025-11-01", events: { "2025": learnedEvents(f, 2025, "2025-11-01") } };
    expect(learnedKeys(rec, 2025, "NOW", "2025-11-09")).toEqual(new Set(["qual:0:1", "qual:0:2"]));
    expect(learnedKeys(rec, 2025, "NEXT", "2025-11-15")).toEqual(new Set()); // in the window, nothing learned
    expect(learnedKeys(rec, 2025, "OLD", "2025-10-02")).toBeNull(); // before the window: can't say
    expect(learnedKeys(undefined, 2025, "NOW", "2025-11-09")).toBeNull(); // older pack: no record
  });
});
