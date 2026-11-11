// The /search title names what was found: a team as "Name (number)" (each part once, whatever form the server's
// title takes), a Compare by both sides, a question by its team and what it asked, else the server's reading.
import { describe, expect, it } from "vitest";
import type { SearchAnswer, SearchHit } from "./api";
import { answerDescription, badgeUnder, capWords, cardTitle, contextBadge, headingOver, pageTitle, repeats, teamParts } from "./searchPage";

const a = (hits: SearchHit[], extra: Partial<Omit<SearchAnswer, "understood">> & { understood?: { label: string } } = {}) => ({ q: "", hits, pages: [], step: "deterministic" as const, weak: false, ...extra });
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

describe("capWords", () => {
  it("capitalises each word, never a letter after an apostrophe", () => {
    expect(capWords("where they're from")).toBe("Where They're From");
    expect(capWords("dean’s list finalists")).toBe("Dean’s List Finalists");
    expect(capWords("worlds appearances")).toBe("Worlds Appearances");
    expect(capWords("sponsors and school or organization")).toBe("Sponsors and School or Organization");
    expect(capWords("the record at states")).toBe("The Record at States");
  });
});

describe("cardTitle (audit v2.8.9: sentence case, the team once, no \"Team 4215 —\" prefix)", () => {
  const hyp = { number: 4215, name: "Hypnotic Robotics" };
  it("names the team inside a sentence-case label", () => {
    expect(cardTitle({ title: "Where they're from", team: hyp })).toBe("Where Hypnotic Robotics (4215) is from");
    expect(cardTitle({ title: "Sponsors and school", team: hyp })).toBe("Sponsors and school for Hypnotic Robotics (4215)");
    expect(cardTitle({ title: "Worlds appearances", team: { number: 7149, name: null } })).toBe("Worlds appearances for Team 7149");
    expect(cardTitle({ title: "Highest scores in 2025–26 (DECODE)" })).toBe("Highest scores in 2025–26 (DECODE)");
  });
  it("titles a card page that way, never Title Case", () => {
    const t = pageTitle(a([], { card: { kind: "info", title: "Where they're from", team: hyp, lines: [] } }), []);
    expect(t).toBe("Where Hypnotic Robotics (4215) is from");
    expect(t).not.toMatch(/^Team \d+ —/);
  });
});

describe("badgeUnder", () => {
  it("drops a badge that only repeats the title, keeps one that adds to it", () => {
    expect(badgeUnder("League meets in New Jersey", "League meets in New Jersey")).toBeNull();
    expect(badgeUnder("Hypnotic Robotics (4215) vs Ultraviolet (20245)", "Hypnotic Robotics (4215) vs Ultraviolet (20245) — Compare")).toBeNull();
    expect(badgeUnder("Closest names to \"hypnotc\"", 'Closest names to "hypnotc" (did you mean "Hypnotic Robotics"?)')).toBeNull();
    expect(badgeUnder("Worlds appearances for ENFORCERS (7149)", "Team 7149 ENFORCERS · Their worlds appearances")).toBe("Team 7149 ENFORCERS · Their worlds appearances");
    // The same team and the same fact as the title: said once.
    expect(badgeUnder("Where Bad Wolf (6980) is from", "Bad Wolf (6980) · Where they're from")).toBeNull();
    expect(badgeUnder("Worlds appearances for ENFORCERS (7149)", "ENFORCERS (7149) · Worlds appearances")).toBeNull();
    expect(badgeUnder("Where Bad Wolf (6980) is from", "Hypnotic Robotics (4215) · Where they're from")).toBe("Hypnotic Robotics (4215) · Where they're from");
    expect(badgeUnder("Simply Complex (18061)", null)).toBeNull();
    // A suggested name with its own brackets is still the whole tail.
    expect(badgeUnder('Closest names to "robotcs"', 'Closest names to "robotcs" (did you mean "Robotics (FTC)"?)')).toBeNull();
  });

  it("never titles or badges the page with the query typed: a names reading is titled by what was found", () => {
    const a = { q: "hypnotc", hits: [], pages: [], step: "deterministic", weak: true, understood: { label: 'Closest names to "hypnotc" (did you mean "Hypnotic Robotics"?)' } } as unknown as Parameters<typeof pageTitle>[0];
    expect(pageTitle(a, [])).toBe("Search results");
    expect(pageTitle(a, [team("4215 Hypnotic Robotics")])).toBe("Matching teams");
    const ev: SearchHit = { kind: "event", ref: "2025:NJW", title: "FTC NJ Multi-Track Workshops (North)", subtitle: "", season: 2025 };
    const won = { ...a, q: "who won nj states", understood: { label: 'Teams, events and matches matching "won nj states"' } } as typeof a;
    expect(pageTitle(won, [ev, ev])).toBe("Matching events");
    expect(pageTitle(won, [team("18061 | Simply Complex"), ev])).toBe("Matching teams and events");
    expect(contextBadge(won!)).toBeNull();
    expect(contextBadge({ ...a!, understood: { label: 'No match for "zzz"' } })).toBeNull();
    // "How good is X": X names the page even when the reading says more.
    const q = { ...a, q: "how good is simply complex", understood: { label: "Simply Complex (18061) — OPR" } } as typeof a;
    expect(pageTitle(q, [{ kind: "team", ref: "18061", title: "18061 | Simply Complex", subtitle: "", season: 2025 }], true)).toBe("Simply Complex (18061)");
  });
});

describe("answerDescription", () => {
  const card = (extra: object = {}) => ({ kind: "high-scores" as const, title: "Highest official scores in 2025–26 (DECODE)", lines: [{ text: "574 points: M14 at FIRST Championship" }], ...extra });
  it("says a card's title and its first record", () => {
    expect(answerDescription(a([], { card: card() } as never))).toBe("Highest official scores in 2025–26 (DECODE): 574 points: M14 at FIRST Championship");
  });
  it("says a card's plain 'none' instead, and a verdict first", () => {
    expect(answerDescription(a([], { card: card({ lines: [], none: "No official records yet." }) } as never))).toBe("Highest official scores in 2025–26 (DECODE): No official records yet.");
    expect(answerDescription(a([], { card: card(), verdict: { answer: "Yes", label: "Played at Worlds" } } as never))).toMatch(/^Yes: Played at Worlds\. Highest official/);
  });
  it("says a stat's title and headline", () => {
    const stat = { title: "Highlights at Worlds, 2025–26", headline: { value: "574 points", label: "Best score without penalties" }, blocks: [] };
    expect(answerDescription(a([], { stat } as never))).toBe("Highlights at Worlds, 2025–26: 574 points · Best score without penalties");
  });
  it("cuts a long one at a word", () => {
    const d = answerDescription(a([], { card: card({ lines: [{ text: "word ".repeat(60) }] }) } as never))!;
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d).toMatch(/ word…$/);
  });
  it("is null with nothing answered, or for a sorry", () => {
    expect(answerDescription(a([]))).toBeNull();
    expect(answerDescription(a([], { card: card(), sorry: { understood: [], suggest: [] } } as never))).toBeNull();
  });
});

describe("headingOver", () => {
  it("takes a card title that says the heading and more, so the words show once", () => {
    expect(headingOver("Teams in Oradell", "Teams in Oradell, NJ")).toBe("Teams in Oradell, NJ");
    expect(repeats(headingOver("Teams in Oradell", "Teams in Oradell, NJ"), "Teams in Oradell, NJ")).toBe(true);
  });
  it("keeps the heading otherwise", () => {
    expect(headingOver("Teams in Oradell", "Highest scores")).toBe("Teams in Oradell");
    expect(headingOver("Teams in Oradell", "teams in oradell")).toBe("Teams in Oradell");
    expect(headingOver("Teams in Oradell", undefined)).toBe("Teams in Oradell");
  });
});

describe("badgeUnder a heading that says it and more", () => {
  it("drops the badge", () => {
    expect(badgeUnder("Teams in Oradell, NJ", "Teams in Oradell")).toBeNull();
    expect(badgeUnder("Teams in Oradell, NJ", "Teams in Ora")).toBe("Teams in Ora");
  });
});
