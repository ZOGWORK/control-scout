import { describe, expect, it } from "vitest";
import { namesOf, offTopic, type Subject } from "./followUpTopic.js";

const subject = (s: Partial<Subject>): Subject => ({ teams: [], events: [], places: [], words: [], ...s });

describe("offTopic", () => {
  const team = subject({ teams: [{ number: 4215, name: "Bionic Bulldogs" }], words: ["4215", "record"] });
  it("a follow-up naming the team's number, possessive or not, is on the subject", () => {
    expect(offTopic("What is 4215's OPR in 2025–26?", team)).toBeNull();
    expect(offTopic("4215 awards", team)).toBeNull();
  });
  it("or its name", () => expect(offTopic("bionic bulldogs highest score", team)).toBeNull());
  it("a number inside another one is not the team", () => expect(offTopic("14215 record", team)).toMatch(/names none of 4215/));
  it("a follow-up about something else is off it", () => expect(offTopic("top teams in texas", team)).toMatch(/names none/));
  it("an event or place the search named counts", () => {
    const s = subject({ events: ["NJ championship"], places: ["New Jersey", "nj"] });
    expect(offTopic("Who won Inspire at NJ Championship?", s)).toBeNull();
    expect(offTopic("top teams in new jersey", s)).toBeNull();
    expect(offTopic("highest score in 2025-26", s)).not.toBeNull();
  });
  it("a search naming no team, event or place is matched on its own words, common ones aside", () => {
    const s = subject({ words: ["highest", "penalty", "match", "in", "2025-26"] });
    expect(offTopic("most penalty points in 2025-26", s)).toBeNull();
    expect(offTopic("top teams in 2025-26", s)).toMatch(/shares no word/);
    expect(offTopic("anything", subject({ words: ["top", "teams", "2025-26"] }))).toBeNull();
  });
});

describe("namesOf", () => {
  it("drops names too short or too common to tell a subject", () => {
    expect(namesOf(subject({ teams: [{ number: 1, name: "Team" }, { number: 2, name: "Hi" }], places: ["NJ"] }))).toEqual(["1", "2", "nj"]);
  });
});
