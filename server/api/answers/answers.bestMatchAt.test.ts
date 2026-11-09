// "Best match in <event>" (logged 2026-11-09): the event's highest-scoring match, read by the pipeline as top matches
// at the event named, never the event-tab reader reading "best" as events with "West" in their names.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[13684, "Infinity Tech"], [24253, "Giggle Pickles"], [17768, "Little HOLLYWOOD"], [21427, "Techno Wizards"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Royal Oak', 'MI', 'USA')", [n, name]);
  }
  const ev = (code: string, name: string, venue: string, city: string, state: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, source) VALUES (2025, ?, ?, 'Qualifier', ?, ?, ?, 'USA', ?, ?, 't')", [code, name, venue, city, state, start, start]);
  // The qualifier asked about, played; later qualifiers with "West" (a letter from "best") in their venue or town, not
  // played yet.
  await ev("USMIROQ", "Royal Oak Qualifier", "Royal Oak High School", "Royal Oak", "MI", "2026-01-24");
  await ev("USAZWAQ", "Quartz - Waddell Qualifier", "West Foothills High School", "Waddell", "AZ", "2026-12-12");
  await ev("USCTWHQ", "University of Hartford Qualifier", "University of Hartford Sports Center", "West Hartford", "CT", "2026-12-19");
  await ev("USWISPQ", "Madison Fish Fry", "Sun Prairie West High School", "Sun Prairie", "WI", "2027-01-16");
  const match = async (level: "qual" | "playoff", series: number, number: number, label: string, red: number, blue: number) => {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USMIROQ', ?, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [level, series, number, label, red, red, blue, blue]);
    for (const [t, a] of [[13684, "red"], [24253, "red"], [17768, "blue"], [21427, "blue"]] as const) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USMIROQ', ?, ?, ?, ?, ?, 1)", [level, series, number, t, a]);
    }
  };
  await match("qual", 0, 39, "Q39", 152, 33);
  await match("playoff", 3, 1, "M3", 246, 69);
  await rebuildSearch();
});

describe("best match in <event>", () => {
  it("the event's highest-scoring match, its teams named", async () => {
    const a = await searchAnswer("best match in Royal Oak Qualifier", { limit: 25, full: true });
    expect(a.stat).toMatchObject({ title: "Highest-scoring match at Royal Oak Qualifier, DECODE 2025–26", headline: { value: "246 points", label: "M3 at Royal Oak Qualifier" } });
    expect(a.stat?.headline?.teams?.map((t) => t.label)).toEqual(["13684 Infinity Tech", "24253 Giggle Pickles"]);
    expect(a.understood?.label).not.toMatch(/Waddell|Hartford/);
  });
});
