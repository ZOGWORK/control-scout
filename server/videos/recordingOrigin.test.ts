// Where an event's recording video came from (the line under the event page's player): FIRST's own link first, a
// broadcast read off the channel FIRST's link names, else whoever added the official recording.
import { describe, expect, it } from "vitest";
import { officialOrigin, videoOrigin } from "./recordings";

describe("recording origin", () => {
  it("names who added an official recording", () => {
    expect(officialOrigin("watcher")).toBe("watcher");
    expect(officialOrigin("list")).toBe("list");
    expect(officialOrigin("owner")).toBe("owner");
    expect(officialOrigin("owner-page")).toBe("owner");
    expect(officialOrigin("something else")).toBeUndefined();
    expect(officialOrigin(null)).toBeUndefined();
  });

  it("FIRST's link wins over an official row for the same video; a channel broadcast says so", () => {
    const d = {
      link: new Map([["A", "firstLink01"], ["C", "chanFirst01"]]),
      channel: new Set(["chanFirst01", "chanSecond1"]),
      extra: new Map([["firstLink01", { day: null, part: null, origin: "list" as const }], ["watched0001", { day: null, part: null, origin: "watcher" as const }], ["unknown0001", { day: null, part: null }]]),
    };
    expect(videoOrigin("firstLink01", "A", d)).toBe("first");
    expect(videoOrigin("watched0001", "A", d)).toBe("watcher");
    expect(videoOrigin("unknown0001", "A", d)).toBeUndefined();
    expect(videoOrigin("chanFirst01", "C", d)).toBe("channel");
    expect(videoOrigin("chanSecond1", "C", d)).toBe("channel");
  });
});
