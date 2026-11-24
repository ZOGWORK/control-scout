import { afterEach, describe, expect, it } from "vitest";
import { SERVED_TTL_MS, noteServed, resetServed, servedHit } from "./searchServed";

afterEach(resetServed);
const intent = { kind: "team", pattern: "[team]", met: true, understood: ["Team 4215"] };

describe("results search sent, for a click to be checked without searching again", () => {
  it("knows what a query gave, however it was typed, and the intent it read", () => {
    noteServed("Hypnotic  Robotics", intent, [{ kind: "team", ref: "4215" }, { kind: "team", ref: "4216", href: "/compare?teams=4215,4216" }], 1000);
    expect(servedHit("hypnotic robotics", "team", "4215", 2000)).toEqual({ intent, hit: { kind: "team", ref: "4215", href: false } });
    expect(servedHit("hypnotic robotics", "team", "4216", 2000)?.hit?.href).toBe(true);
  });
  it("a result the query never gave is known not to be one (nothing can be planted)", () => {
    noteServed("hypnotic", intent, [{ kind: "team", ref: "4215" }], 1000);
    expect(servedHit("hypnotic", "team", "9999", 2000)).toEqual({ intent, hit: null });
  });
  it("the short list and the page add up: both limits' results count", () => {
    noteServed("bad wolf", intent, [{ kind: "team", ref: "6980" }], 1000);
    noteServed("bad wolf", undefined, [{ kind: "event", ref: "2025:USNJNEM2" }], 1500);
    expect(servedHit("bad wolf", "team", "6980", 2000)?.hit).toBeTruthy();
    expect(servedHit("bad wolf", "event", "2025:USNJNEM2", 2000)?.hit).toBeTruthy();
    expect(servedHit("bad wolf", "event", "2025:USNJNEM2", 2000)?.intent).toEqual(intent);
  });
  it("an unknown or old query isn't known: the caller searches as before", () => {
    expect(servedHit("never asked", "team", "1")).toBeNull();
    noteServed("old", intent, [{ kind: "team", ref: "1" }], 0);
    expect(servedHit("old", "team", "1", SERVED_TTL_MS)).toBeNull();
  });
});
