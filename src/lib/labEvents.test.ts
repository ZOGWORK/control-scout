import { describe, expect, it } from "vitest";
import type { EventListItem } from "../shared/api";
import { eventMatches, labEventChoices } from "./labEvents";

const ev = (code: string, name: string, city: string, state: string, type = "Qualifier", start = "2026-11-01", country = "USA"): EventListItem =>
  ({ season: 2026, code, name, type, typeLabel: type, city, state, country, start, end: start, teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "upcoming" }) as EventListItem;

const athens = ev("USALATQ", "Athens Qualifier", "Athens", "AL", "Qualifier", "2026-12-05");
const curie = ev("USTXSOEDQ", "Curie Qualifier", "Edinburg", "TX", "Qualifier", "2026-10-24");
const edinburgh = ev("GBEDQ", "Edinburgh Qualifier", "Edinburgh", "SCT", "Qualifier", "2027-02-10", "United Kingdom");
const njLt = ev("USNJNOLT", "Northern League Tournament", "Oradell", "NJ", "LeagueTournament", "2027-01-20");
const njMeet = ev("USNJNOM1", "Northern League Meet 1", "Oradell", "NJ", "LeagueMeet", "2026-11-10");
const all = [athens, curie, edinburgh, njLt, njMeet];

describe("eventMatches", () => {
  it("matches name, code and city", () => {
    expect(eventMatches(athens, "athens")).toBe(true);
    expect(eventMatches(curie, "Edinburg")).toBe(true);
    expect(eventMatches(curie, "ustxsoedq")).toBe(true);
    expect(eventMatches(athens, "Edinburg")).toBe(false);
  });

  it("matches a state by its code or full name", () => {
    expect(eventMatches(curie, "TX")).toBe(true);
    expect(eventMatches(curie, "Texas")).toBe(true);
    expect(eventMatches(njLt, "new jersey")).toBe(true);
    expect(eventMatches(edinburgh, "Scotland")).toBe(true);
    expect(eventMatches(athens, "texas")).toBe(false);
  });

  it("matches word by word, so a city with its state works however it's typed", () => {
    expect(eventMatches(athens, "Athens AL")).toBe(true);
    expect(eventMatches(athens, "Athens, Alabama")).toBe(true);
    expect(eventMatches(curie, "  edinburg,  texas ")).toBe(true);
    expect(eventMatches(curie, "texas qualifier")).toBe(true);
    expect(eventMatches(athens, "Athens, TX")).toBe(false);
  });

  it("an empty search matches everything", () => {
    expect(eventMatches(athens, "  ")).toBe(true);
  });
});

describe("labEventChoices", () => {
  it("with no team, lists every advancing event by date (no scrimmages or league meets)", () => {
    const r = labEventChoices(all, { teamCodes: null, q: "" });
    expect(r.list.map((e) => e.code)).toEqual(["USTXSOEDQ", "USALATQ", "USNJNOLT", "GBEDQ"]);
    expect(r.teamOnly).toBe(false);
    expect(r.teamCount).toBeNull();
  });

  it("with a team, lists only the events it's registered at, never unrelated ones", () => {
    const r = labEventChoices(all, { teamCodes: new Set(["USNJNOLT", "USNJNOM1"]), q: "" });
    expect(r.list.map((e) => e.code)).toEqual(["USNJNOLT"]);
    expect(r.teamOnly).toBe(true);
    expect(r.teamCount).toBe(1);
  });

  it("a team registered nowhere gets an empty list (the empty state), not suggestions", () => {
    const r = labEventChoices(all, { teamCodes: new Set(), q: "" });
    expect(r.list).toEqual([]);
    expect(r.teamCount).toBe(0);
    expect(r.teamOnly).toBe(true);
  });

  it("Search all events lifts the team filter; the search applies either way", () => {
    const r = labEventChoices(all, { teamCodes: new Set(), q: "texas", showAll: true });
    expect(r.list.map((e) => e.code)).toEqual(["USTXSOEDQ"]);
    expect(r.teamOnly).toBe(false);
    expect(labEventChoices(all, { teamCodes: new Set(["USNJNOLT"]), q: "athens" }).list).toEqual([]);
  });

  it("counts non-advancing matches to explain an empty search", () => {
    const r = labEventChoices(all, { teamCodes: null, q: "league meet" });
    expect(r.list).toEqual([]);
    expect(r.otherMatches).toBe(1);
  });
});
