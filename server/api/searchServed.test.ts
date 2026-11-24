import { afterEach, describe, expect, it } from "vitest";
import { SERVED_TTL_MS, noteServed, resetServed, servedHit } from "./searchServed";

afterEach(resetServed);
const intent = { kind: "team", pattern: "[team]", met: true, understood: ["Team 4215"] };
const other = { kind: "event", pattern: "[event]", met: true, understood: ["NJ"] };

describe("results search sent, for a click to be checked without searching again", () => {
  it("knows what a query gave, however it was typed, and the intent it read", () => {
    noteServed("Hypnotic  Robotics", intent, [{ kind: "team", ref: "4215" }, { kind: "team", ref: "4216", href: "/compare?teams=4215,4216" }], 1000);
    expect(servedHit("hypnotic robotics", "team", "4215", 2000)).toEqual({ intent, hit: { kind: "team", ref: "4215", href: false } });
    expect(servedHit("hypnotic robotics", "team", "4216", 2000)?.hit.href).toBe(true);
  });
  it("a result the query never gave isn't vouched for: the caller searches again", () => {
    noteServed("hypnotic", intent, [{ kind: "team", ref: "4215" }], 1000);
    expect(servedHit("hypnotic", "team", "9999", 2000)).toBeNull();
  });
  it("the short list and the page add up, each result with the intent of the answer that gave it", () => {
    noteServed("bad wolf", intent, [{ kind: "team", ref: "6980" }], 1000);
    noteServed("bad wolf", other, [{ kind: "event", ref: "2025:USNJNEM2" }], 1500);
    expect(servedHit("bad wolf", "team", "6980", 2000)?.intent).toEqual(intent);
    expect(servedHit("bad wolf", "event", "2025:USNJNEM2", 2000)?.intent).toEqual(other);
  });
  it("a result search stopped giving leaves on its own time, however often the query is asked", () => {
    noteServed("4215", intent, [{ kind: "team", ref: "4215" }, { kind: "event", ref: "gone" }], 0);
    for (let t = 60_000; t <= SERVED_TTL_MS + 60_000; t += 60_000) noteServed("4215", intent, [{ kind: "team", ref: "4215" }], t);
    expect(servedHit("4215", "event", "gone", SERVED_TTL_MS + 60_000)).toBeNull();
    expect(servedHit("4215", "team", "4215", SERVED_TTL_MS + 60_000)).toBeTruthy();
  });
  it("an unknown or old query isn't known: the caller searches as before", () => {
    expect(servedHit("never asked", "team", "1")).toBeNull();
    noteServed("old", intent, [{ kind: "team", ref: "1" }], 0);
    expect(servedHit("old", "team", "1", SERVED_TTL_MS)).toBeNull();
  });
});
