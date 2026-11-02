// The /search title names what was found: a team as "Name (number)" (each part once, whatever form the server's
// title takes), a Compare by both sides, a question by its team and what it asked, else the server's reading.
import { describe, expect, it } from "vitest";
import type { SearchAnswer, SearchHit } from "./api";
import { contextBadge, pageTitle, teamParts } from "./searchPage";

const a = (hits: SearchHit[], extra: Partial<SearchAnswer> & { understood?: { label: string } } = {}) => ({ q: "", hits, pages: [], step: "deterministic" as const, weak: false, ...extra });
const team = (title: string): SearchHit => ({ kind: "team", ref: "18061", title, subtitle: "", season: 2025 });

describe("teamParts", () => {
  it.each(["18061 Simply Complex", "18061 | Simply Complex", "18061 Simply Complex 18061"])("%s", (t) => expect(teamParts(t)).toEqual({ number: "18061", name: "Simply Complex" }));
});

describe("pageTitle", () => {
  it("a team", () => expect(pageTitle(a([team("18061 | Simply Complex")]), [team("18061 | Simply Complex")])).toBe("Simply Complex (18061)"));
  it("the server's reading", () => {
    const ev: SearchHit = { kind: "event", ref: "2026:X", title: "P1-1 Southern League Meet", subtitle: "", season: 2026 };
    expect(pageTitle(a([ev], { understood: { label: "Events in New Jersey" } }), [ev])).toBe("Events in New Jersey");
  });
  it("never a single event's name", () => {
    const ev: SearchHit = { kind: "event", ref: "2026:X", title: "SLU Meet", subtitle: "", season: 2026 };
    expect(pageTitle(a([ev]), [ev])).toBe("Search results");
  });
});

describe("contextBadge", () => {
  const ev: SearchHit = { kind: "event", ref: "2025:X", title: "FIRST Championship - Edison Division", subtitle: "", season: 2025 };
  it("never names one event", () => expect(contextBadge(a([ev]))).toBeNull());
  it("a team and what it opens on", () => expect(contextBadge(a([team("18061 Simply Complex")]))).toBe("Simply Complex (18061)"));
  it("the server's reading first", () => expect(contextBadge(a([ev], { understood: { label: "Events in New Jersey" } }))).toBe("Events in New Jersey"));
  it("everything understood, before a team's line (no detail dropped)", () => {
    expect(contextBadge(a([team("4215 Hypnotic Robotics")]), ["Understood: Team 4215 Hypnotic Robotics · Season 2024–25 · Their high scores without penalties"]))
      .toBe("Team 4215 Hypnotic Robotics · Season 2024–25 · Their high scores without penalties");
    expect(contextBadge(a([ev]), ["A comparison of 2 teams", "No team found for “zzz”"])).toBe("A comparison of 2 teams · No team found for “zzz”");
  });
});
