// The pipeline run end to end on a small database (docs/search-pipeline.md): the slots applied as filters and stated on
// the card, the same card for every phrasing of one question and every team, a year honoured, a future year said.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import type { StatAnswer } from "../../../src/shared/searchStat";

// Wednesday 2026-03-18: "this week" is Mar 16–22, 2026, inside the 2025–26 season.
const NOW = Date.parse("2026-03-18T12:00:00Z");
const ask = (q: string, now = NOW) => searchAnswer(q, { limit: 25, full: true, now });
const stat = async (q: string, now = NOW) => (await ask(q, now)).stat as StatAnswer;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string, string][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", "USA"], [6980, "Bad Wolf", "Fair Lawn", "NJ", "USA"], [24033, "Alphatronic", "Cluj-Napoca", "CJ", "Romania"],
    [17713, "Delta Force", "Arad", "AR", "Romania"], [10809, "Crow Force", "Los Angeles", "CA", "USA"], [5555, "Never Listed", "Fresno", "CA", "USA"],
  ];
  for (const [n, name, city, state, country] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (code: string, name: string, type: string, start: string, state: string, country: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, 'Town', ?, ?, ?, ?, 't')", [code, name, type, state, country, start, start]);
  await ev("USNJQ1", "Garden Qualifier", "Qualifier", "2026-01-10", "NJ", "USA");
  await ev("USCAQ1", "Golden Qualifier", "Qualifier", "2026-03-17", "CA", "USA");
  await ev("USCAQ0", "Winter Qualifier", "Qualifier", "2026-01-24", "CA", "USA");
  await ev("ROCMP", "Romania Championship", "Championship", "2026-03-14", "B", "Romania");
  await ev("FTCCMP1", "FIRST Championship", "FIRSTChampionship", "2026-04-29", "TX", "USA");
  let n = 0;
  const match = async (code: string, day: string, red: number, blue: number, reds: number[], blues: number[]) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [code, n, `Q${n}`, `${day}T10:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1)", [code, n, t, a]);
    }
    for (const t of [...reds, ...blues]) await run("INSERT OR IGNORE INTO event_teams (season, code, team, rank) VALUES (2025, ?, ?, 1)", [code, t]);
  };
  await match("USNJQ1", "2026-01-10", 150, 90, [4215, 6980], [10809]);
  await match("USNJQ1", "2026-01-10", 80, 120, [4215], [6980]);
  // California: one match this week (Mar 17) and a higher one in January.
  await match("USCAQ1", "2026-03-17", 210, 100, [10809], [5555]);
  await match("USCAQ0", "2026-01-24", 260, 110, [10809], [5555]);
  await match("ROCMP", "2026-03-14", 300, 140, [24033], [17713]);
  await match("ROCMP", "2026-03-14", 120, 330, [24033], [17713]);
  for (const t of [4215, 6980, 24033, 17713, 10809, 5555]) {
    await run("INSERT OR IGNORE INTO team_event_stats (season, code, team, opr_np, matches) SELECT season, code, team, 50, 1 FROM event_teams WHERE team = ?", [t]);
  }
  await rebuildSearch();
  clearAllCaches();
});

describe("place and time are applied and stated", () => {
  it("highest-scoring match in California this week: that one match, never a team card", async () => {
    const a = await ask("highest-scoring match in California this week");
    expect(a.hits.some((h) => h.kind === "team")).toBe(false);
    const s = a.stat as StatAnswer;
    expect(s.title).toBe("Highest-scoring match in California this week, DECODE 2025–26");
    expect(s.scope).toEqual(expect.arrayContaining(["California", "This week"]));
    expect(s.headline).toMatchObject({ value: "210 points" });
    const rows = s.blocks.find((b) => b.kind === "matches");
    expect(rows?.kind === "matches" && rows.rows).toHaveLength(1);
    // The same match however it's asked.
    for (const q of ["this week california highest scoring match", "what was the top scoring game in CA this week?", "best match score this week in california please"]) {
      expect((await stat(q)).headline, q).toMatchObject({ value: "210 points" });
    }
  });
  it("a window with nothing in it says so for that window", async () => {
    const s = await stat("highest-scoring match in California this week", Date.parse("2026-02-11T12:00:00Z"));
    expect(s.none).toBe("No played matches at official events in California this week yet.");
  });
  it("no place named is every place, never one region by default", async () => {
    const s = await stat("highest scoring match on mar 14 2026");
    expect(s.title).toBe("Highest-scoring match on Mar 14, 2026, DECODE 2025–26");
    expect(s.headline).toMatchObject({ value: "330 points" });
  });
  it("a country is a place: a team's own region, or none of its matches", async () => {
    expect((await stat("alphatronic record in romania")).headline).toMatchObject({ value: "1-1-0" });
    const nj = await stat("4215 record in romania");
    expect(nj.title).toBe("Record at events in Romania in 2025–26");
    expect(nj.none).toContain("events in Romania");
  });
});

describe("one question, any phrasing, any team", () => {
  const FORMS = ["{t} highest score", "highest score {t}", "what is the best score for {t}", "{t} top score please", "score highest {t} rn"];
  for (const [t, value] of [["4215", "150 points"], ["delta force", "330 points"], ["24033", "300 points"], ["10809", "260 points"]] as const) {
    it(`highest score for ${t}`, async () => {
      for (const f of FORMS) expect((await stat(f.replace("{t}", t))).headline, f).toMatchObject({ value: expect.stringContaining(value) });
    });
  }
  it("two teams' shared matches, either order, any words around them", async () => {
    for (const q of ["4215 and 6980 matches together", "matches 6980 4215 shared", "shared matches hypnotic robotics bad wolf"]) {
      const s = await stat(q);
      expect(s.title, q).toMatch(/^Matches with (4215 and 6980|6980 and 4215)$/);
      expect(s.headline?.value, q).toBe("2");
    }
  });
});

describe("years", () => {
  it("a year is that season; none is the latest; a future year is said, never the latest", async () => {
    expect((await stat("4215 record 2025")).title).toBe("Record in 2025–26");
    const f = await ask("4215 record 2027");
    expect(f.stat).toMatchObject({ title: "No 2027–28 events yet", none: expect.stringContaining("no 2027–28 events on record yet") });
    expect(f.stat?.headline).toBeUndefined();
  });
});
