// The top bar's clock and weather stay everywhere except /search (FTC One Search, temporarily).
import { describe, expect, it } from "vitest";
import { showsClockWeather } from "./TopBarExtras";

describe("showsClockWeather", () => {
  it("hides on /search only", () => {
    expect(showsClockWeather("/search")).toBe(false);
    expect(showsClockWeather("/search/")).toBe(false);
    expect(showsClockWeather("/Search/")).toBe(false);
    for (const p of ["/", "/teams/4215", "/events", "/searching", "/rules"]) expect(showsClockWeather(p)).toBe(true);
  });
});
