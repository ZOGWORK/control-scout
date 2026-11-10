// A listed website on the fact card links whether or not FIRST's listing gives it a scheme; only http(s) ever links.
import { describe, expect, it } from "vitest";
import { factSeason, hrefOf } from "./FactCard";

describe("hrefOf", () => {
  it("links a bare domain over https and keeps an http(s) link as is", () => {
    expect(hrefOf("www.hypnoticrobotics.org")).toBe("https://www.hypnoticrobotics.org/");
    expect(hrefOf("HTTPS://Example.org/team")).toBe("https://example.org/team");
    expect(hrefOf("http://example.org")).toBe("http://example.org/");
  });
  it("never links another scheme or something that isn't an address", () => {
    expect(hrefOf("javascript:alert(1)")).toBeNull();
    expect(hrefOf("mailto:team@example.org")).toBeNull();
    expect(hrefOf("not a site")).toBeNull();
  });
});

describe("factSeason", () => {
  it("a next match or next event is about the current season, whatever season the team hit carries", () => {
    expect(factSeason({ kind: "next-match", title: "Next match" }, 2025, 2026)).toBe(2026);
    expect(factSeason({ kind: "next-event", title: "Next event" }, 2025, 2026)).toBe(2026);
  });
  it("other answers keep the card's season, then the query's, then the title's", () => {
    expect(factSeason({ kind: "awards", title: "Awards won", season: 2023 }, 2025, 2026)).toBe(2023);
    expect(factSeason({ kind: "awards", title: "Awards won" }, 2025, 2026)).toBe(2025);
    expect(factSeason({ kind: "awards", title: "Awards in 2024–25" }, null, 2026)).toBe(2024);
    expect(factSeason({ kind: "awards", title: "Awards won" }, null, 2026)).toBeNull();
  });
});
