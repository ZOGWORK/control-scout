// Reading an event set from a query (src/shared/searchEventQuery.ts): place, city or venue, time, year, kind.
// The answers on data are in server/api/searchEvents.test.ts.
import { describe, expect, it } from "vitest";
import { eventSetLabel, eventTypesOf, readEventQuery, regionOf, timeWindow } from "./searchEventQuery";

describe("reading an event set", () => {
  it("reads a place by name or code, with any plural or preposition", () => {
    for (const q of ["meets in New Jersey", "Meets in New Jersey", "meet at new jersey", "Meets at New Jersey", "NJ meets", "meets in NJ", "meets in nj"]) {
      expect(readEventQuery(q), q).toMatchObject({ kinds: ["meet"], region: { key: "USA:NJ" }, where: null, words: [], time: null });
    }
  });
  it("reads a city or venue after 'at' or 'in', beside the place", () => {
    expect(readEventQuery("meets in New Jersey at River dell high school")).toMatchObject({ region: { key: "USA:NJ" }, where: "River dell high school" });
    expect(readEventQuery("meets at Nonexistent High School in New Jersey")).toMatchObject({ region: { key: "USA:NJ" }, where: "Nonexistent High School" });
    expect(readEventQuery("meets in Oradell")).toMatchObject({ region: null, where: "Oradell" });
  });
  it("reads time words as a time, never a name", () => {
    expect(readEventQuery("upcoming meets in New Jersey")).toMatchObject({ time: "upcoming", words: [] });
    expect(readEventQuery("past meets in New Jersey")).toMatchObject({ time: "past" });
    expect(readEventQuery("meets this weekend")).toMatchObject({ time: "this-weekend", region: null });
    expect(readEventQuery("when is the next meet in New Jersey")).toMatchObject({ time: "upcoming", words: [] });
  });
  it("reads a year as when events were held, and a season as a season", () => {
    expect(readEventQuery("2024 Houston Championship Edison Division")).toMatchObject({ year: 2024, season: null, kinds: ["championship"], words: ["Houston", "Edison", "Division"] });
    expect(readEventQuery("2023-24 championships in Texas")).toMatchObject({ season: 2023, year: null, region: { key: "USA:TX" } });
  });
  it("reads 'NJ state championship' as New Jersey's championship", () => {
    expect(readEventQuery("NJ State Championship")).toMatchObject({ kinds: ["championship"], region: { key: "USA:NJ" }, words: [] });
  });
  it("leaves names, teams, versus and matches alone", () => {
    for (const q of ["hypnotic robotics", "4215", "4215 vs 6980", "USNJQ1 Q12", "battle at the bay", "New Jersey Championship rankings 4215", "top teams in New Jersey", "meet", "league meet"]) {
      expect(readEventQuery(q), q).toBeNull();
    }
  });
  it("never reads an everyday word as a state code unless typed in capitals", () => {
    expect(regionOf(["in"])).toBeNull();
    expect(regionOf(["me"])).toBeNull();
    expect(regionOf(["IN"])).toMatchObject({ key: "USA:IN" });
    expect(regionOf(["nj"])).toMatchObject({ key: "USA:NJ" });
  });
});

describe("labels", () => {
  it("names the query as understood, never an event", () => {
    expect(eventSetLabel(readEventQuery("Meets in New Jersey")!)).toBe("League meets in New Jersey");
    expect(eventSetLabel(readEventQuery("upcoming meets in New Jersey")!)).toBe("Upcoming league meets in New Jersey");
    expect(eventSetLabel(readEventQuery("meets in New Jersey at River dell high school")!)).toBe("League meets in New Jersey at River Dell High School");
    expect(eventSetLabel(readEventQuery("meets in Oradell")!, { where: { text: "Oradell", city: true } })).toBe("League meets in Oradell");
    expect(eventSetLabel(readEventQuery("meets this weekend")!)).toBe("This weekend's league meets");
    expect(eventSetLabel(readEventQuery("2024 Houston Championship Edison Division")!)).toBe('Championships matching "Houston Edison Division" held in 2024');
  });
});

describe("time windows", () => {
  // 2026-11-02 is a Monday.
  it("reads the weekend as the coming Saturday and Sunday", () => {
    expect(timeWindow("this-weekend", "2026-11-02")).toEqual({ from: "2026-11-07", to: "2026-11-08" });
    expect(timeWindow("this-weekend", "2026-11-07")).toEqual({ from: "2026-11-07", to: "2026-11-08" }); // Saturday
    expect(timeWindow("this-weekend", "2026-11-08")).toEqual({ from: "2026-11-07", to: "2026-11-08" }); // Sunday: the weekend under way
    expect(timeWindow("next-weekend", "2026-11-02")).toEqual({ from: "2026-11-14", to: "2026-11-15" });
  });
  it("reads upcoming from today on and past as before today", () => {
    expect(timeWindow("upcoming", "2026-11-02")).toEqual({ from: "2026-11-02", to: null });
    expect(timeWindow("past", "2026-11-02")).toEqual({ from: null, to: "2026-11-01" });
    expect(timeWindow("this-week", "2026-11-02")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(timeWindow("next-month", "2026-11-02")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("Greptile on #434", () => {
  it("weeks and months are whole calendar ones", () => {
    expect(timeWindow("this-week", "2026-11-04")).toEqual({ from: "2026-11-02", to: "2026-11-08" }); // a Wednesday
    expect(timeWindow("this-week", "2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08" }); // a Sunday
    expect(timeWindow("this-month", "2026-11-20")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
  it("reads a season with a four-digit ending", () => {
    expect(readEventQuery("2024–2025 championships in Texas")).toMatchObject({ season: 2024, year: null, region: { key: "USA:TX" } });
    expect(readEventQuery("2024-2026 championships in Texas")).toBeNull();
  });
  it("keeps a region's own little words", () => {
    expect(readEventQuery("meets in District of Columbia")).toMatchObject({ region: { key: "USA:DC" }, where: null });
  });
  it("leaves an event's page and a season in words to their own readers", () => {
    expect(readEventQuery("New Jersey Championship rankings")).toBeNull();
    expect(readEventQuery("meets in NJ last season")).toBeNull();
  });
  it("a more specific event word narrows a broader one", () => {
    expect(eventTypesOf(["league", "meet"])).toEqual(["LeagueMeet"]);
    expect(eventTypesOf(["event", "meet"])).toEqual(["LeagueMeet"]);
    expect(eventTypesOf(["event"])).toBeNull();
    expect(eventTypesOf(["meet", "tournament"])).toEqual(["LeagueMeet", "LeagueTournament"]);
  });
});
