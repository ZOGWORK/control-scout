// Reading an event set from a query (src/shared/searchEventQuery.ts): place, city or venue, time, year, kind.
// The answers on data are in server/api/searchEvents.test.ts.
import { describe, expect, it } from "vitest";
import { eventSetLabel, eventTypesOf, readEventQuery, regionOf, regionPartOf, timeWindow } from "./searchEventQuery";

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

describe("part of a region", () => {
  it("a direction and a region is the whole region; a place named so by itself stays itself", () => {
    expect(regionPartOf(["north", "jersey"])?.region.name).toBe("New Jersey");
    expect(regionPartOf(["northern", "california"])?.region.name).toBe("California");
    expect(regionPartOf(["western", "new", "york"])?.region.name).toBe("New York");
    for (const w of ["north carolina", "west virginia", "south dakota", "northern ireland", "north robotics", "jersey"]) expect(regionPartOf(w.split(" ")), w).toBeNull();
  });
});

describe("labels", () => {
  it("names the query as understood, never an event", () => {
    expect(eventSetLabel(readEventQuery("Meets in New Jersey")!)).toBe("Meets in New Jersey");
    expect(eventSetLabel(readEventQuery("upcoming meets in New Jersey")!)).toBe("Upcoming meets in New Jersey");
    expect(eventSetLabel(readEventQuery("meets in New Jersey at River dell high school")!)).toBe("Meets in New Jersey at River Dell High School");
    expect(eventSetLabel(readEventQuery("meets in Oradell")!, { where: { text: "Oradell", city: true } })).toBe("Meets in Oradell");
    expect(eventSetLabel(readEventQuery("meets this weekend")!)).toBe("This weekend's meets");
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
    expect(readEventQuery("meets in the Northern Territory")).toMatchObject({ region: { key: "Australia:NT" }, where: null });
    expect(readEventQuery("meets in ON")).toMatchObject({ region: { key: "Canada:ON" } });
    expect(readEventQuery("meets in NSW")).toMatchObject({ region: { key: "Australia:NSW" }, where: null });
    expect(readEventQuery("meets in qld")).toMatchObject({ region: { key: "Australia:QLD" } });
    expect(readEventQuery("meets in VIC")).toMatchObject({ region: { key: "Australia:VIC" } });
    expect(readEventQuery("meets in IN")).toMatchObject({ region: { key: "USA:IN" } });
    expect(readEventQuery("meets in the New Jersey")).toMatchObject({ region: { key: "USA:NJ" }, where: null });
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

describe("questions about events are not event sets", () => {
  it("leaves who-wins and award questions to their readers", () => {
    for (const q of ["who will win New Jersey Championship", "who won Inspire at New Jersey Championship", "New Jersey Championship winner", "who will advance from NJ meets"]) expect(readEventQuery(q), q).toBeNull();
    expect(readEventQuery("when is the next meet in NJ")).toMatchObject({ time: "upcoming", region: { key: "USA:NJ" } });
  });
});

describe("place typos and 'states' (owner report)", () => {
  it("reads a near miss of a place's name, said as read", () => {
    expect(readEventQuery("new jesey states")).toMatchObject({ kinds: ["states"], region: { key: "USA:NJ" }, regionTyped: "new jesey", allSeasons: true, words: [] });
    expect(readEventQuery("meets in new jersy")).toMatchObject({ kinds: ["meet"], region: { key: "USA:NJ" }, regionTyped: "new jersy" });
    expect(readEventQuery("pensylvania champs")).toMatchObject({ kinds: ["championship"], region: { key: "USA:PA" } });
  });
  it("'states', 'state champs' and 'champs' with a place are its championship", () => {
    for (const q of ["nj states", "NJ state champs", "new jersey champs"]) expect(readEventQuery(q), q).toMatchObject({ region: { key: "USA:NJ" }, words: [], allSeasons: true });
    expect(readEventQuery("nj states")?.kinds).toEqual(["states"]); // the state's own championship
    expect(readEventQuery("NJ state champs")?.kinds).toEqual(["championship"]);
    // Failed search "Who won inspire in nj cham this year": "cham" is "champ" cut short.
    expect(readEventQuery("ohio cham")).toMatchObject({ kinds: ["championship"], region: { key: "USA:OH" }, words: [] });
  });
  it("never guesses: no event word, a code, or two places as close", () => {
    expect(readEventQuery("new jesey")).toBeNull();
    expect(readEventQuery("nj state")).toBeNull();
    expect(readEventQuery("meets in nk")).toMatchObject({ region: null, where: "nk" }); // a city, as before
    expect(readEventQuery("meets in Jersey City")?.regionTyped).toBeUndefined();
  });
  it("championships with a year, season or time keep that scope", () => {
    expect(readEventQuery("2024-25 nj states")?.allSeasons).toBeUndefined();
    expect(readEventQuery("upcoming championships in NJ")?.allSeasons).toBeUndefined();
    expect(readEventQuery("meets in NJ")?.allSeasons).toBeUndefined();
  });
});

describe("Greptile on #450", () => {
  it("'states' before a misspelled place still reads the place", () => {
    for (const q of ["states in new jesey", "states in NJ", "NJ states"]) expect(readEventQuery(q), q).toMatchObject({ kinds: ["states"], region: { key: "USA:NJ" }, words: [], where: null, allSeasons: true });
  });
  it("a generic event word keeps every season", () => {
    for (const q of ["championship events in NJ", "NJ championship events", "championships in NJ"]) expect(readEventQuery(q)?.allSeasons, q).toBe(true);
  });
  it("time words work with states and champs, and keep their scope", () => {
    for (const q of ["past NJ states", "upcoming NJ champs", "recent NJ states"]) {
      const e = readEventQuery(q);
      expect(e, q).toMatchObject({ region: { key: "USA:NJ" }, words: [] });
      expect(e?.kinds, q).toEqual([/states/i.test(q) ? "states" : "championship"]);
      expect(e?.time, q).not.toBeNull();
      expect(e?.allSeasons, q).toBeUndefined();
    }
  });
  it("'states' without a place names nothing; 'united states' is never a championship", () => {
    expect(readEventQuery("states")).toBeNull();
    expect(readEventQuery("united states meets")?.kinds ?? []).not.toContain("states");
    expect(readEventQuery("meets in united states")).toMatchObject({ kinds: ["meet"], where: "united states" });
  });
});

describe("Greptile on #450, round 2", () => {
  it("'states' beside a generic event word is still the championship, every season", () => {
    for (const q of ["NJ states events", "NJ states competitions", "NJ states"]) expect(readEventQuery(q), q).toMatchObject({ region: { key: "USA:NJ" }, words: [], allSeasons: true });
    expect(readEventQuery("NJ states events")?.kinds).toContain("states");
  });
  it("labels the specific kind beside a generic one, and 'states' as state championships", () => {
    expect(eventSetLabel(readEventQuery("NJ states events")!)).toBe("State championships in New Jersey, every season");
    expect(eventSetLabel(readEventQuery("NJ championship events")!)).toBe("Championships in New Jersey, every season");
    expect(eventTypesOf(readEventQuery("tx states")!.kinds)).toEqual(["Championship"]); // never the FIRST Championship held there
  });
});

describe("labels echo the words typed (owner bug)", () => {
  it("never narrows to a type the words didn't say", () => {
    expect(eventSetLabel(readEventQuery("meets at river dell high school")!)).toBe("Meets at River Dell High School");
    expect(eventSetLabel(readEventQuery("meets in New Jersey")!)).toBe("Meets in New Jersey");
    expect(eventSetLabel(readEventQuery("league meets in NJ")!)).toBe("League meets in New Jersey");
    expect(eventSetLabel(readEventQuery("nj states")!)).toBe("State championships in New Jersey, every season");
    expect(eventSetLabel(readEventQuery("states in new jersey")!)).toBe("State championships in New Jersey, every season");
    expect(eventSetLabel(readEventQuery("NJ states events")!)).toBe("State championships in New Jersey, every season");
    expect(eventSetLabel(readEventQuery("tournaments in NJ")!)).toBe("Tournaments in New Jersey");
    expect(eventSetLabel(readEventQuery("league tournaments in NJ")!)).toBe("League tournaments in New Jersey");
    expect(eventSetLabel(readEventQuery("events in NJ")!)).toBe("Events in New Jersey");
    // Greptile on #461: kinds that share no type are each named, never the last one alone.
    expect(eventSetLabel(readEventQuery("meets tournaments in NJ")!)).toBe("Meets and tournaments in New Jersey");
  });
});
