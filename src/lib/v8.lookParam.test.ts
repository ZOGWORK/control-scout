// setV8 with storage blocked loads the page with ?v8=, which index.html obeys: it must be in the query, before any
// #fragment (after it, index.html never sees it, and a reset to the new look reloaded forever: Loopy on #2116).
import { describe, expect, it } from "vitest";
import { withLookParam } from "./v8";

describe("withLookParam", () => {
  it("puts ?v8= before the fragment", () => {
    expect(withLookParam("/events#top", true)).toBe("/events?v8=1#top");
    expect(withLookParam("/events?season=2025#top", true)).toBe("/events?season=2025&v8=1#top");
  });
  it("adds it to a plain path or query, and replaces one already there", () => {
    expect(withLookParam("/", true)).toBe("/?v8=1");
    expect(withLookParam("/events?q=x", false)).toBe("/events?q=x&v8=0");
    expect(withLookParam("/events?v8=0&q=x", true)).toBe("/events?v8=1&q=x");
  });
});
