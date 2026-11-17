// Highlights questions people asked that search couldn't answer (failed-search issues #1503–#1508, #1420–#1474 and the
// "best teleop videos in romania decode" report), each read by a rule, never by its words: a town's highlights, a town
// name two regions share, one period's best matches said with "videos" in a country, teams compared with "highlights",
// and an event with nothing played yet. Paraphrases nobody logged are asked too, so a rule is what answers.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { NO_EVENT_HIGHLIGHTS } from "./highlights";
import { buildNames } from "./names";
import type { StatAnswer, StatMatchRow } from "../../../src/shared/searchStat";

// Saturday 2026-03-14: the current season is 2025–26.
const NOW = Date.parse("2026-03-14T18:00:00Z");
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });
const stat = async (q: string) => (await ask(q)).stat as StatAnswer;
const rows = (s: StatAnswer): StatMatchRow[] => s.blocks.flatMap((b) => (b.kind === "matches" ? b.rows : []));
const codeOf = (r: StatMatchRow) => /^\/events\/\d{4}\/([^?/]+)/.exec(r.href)![1];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Grand Rapids is Michigan's (three teams, two events) and Minnesota's (one team): the name is Michigan's town.
  const teams: [number, string, string, string, string][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", "USA"], [6980, "Bad Wolf", "Paramus", "NJ", "USA"],
    [11111, "Rapid Robots", "Grand Rapids", "MI", "USA"], [11112, "Furniture City", "Grand Rapids", "MI", "USA"], [11113, "River Bend", "Grand Rapids", "MI", "USA"],
    [11114, "North Star", "Grand Rapids", "MN", "USA"], [11115, "Lansing Lugnuts", "Lansing", "MI", "USA"],
    [14270, "Quantum Robotics", "Bucharest", "", "Romania"], [19000, "Carpathia", "Cluj-Napoca", "", "Romania"],
  ];
  for (const [n, name, city, state, country] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state || null, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (code: string, name: string, type: string, start: string, city: string, state: string | null, country = "USA") =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, ?, ?, ?, ?, ?, 't')", [code, name, type, city, state, country, start, start]);
  await ev("USMIGRM1", "West Michigan Meet 1", "LeagueMeet", "2026-01-10", "Grand Rapids", "MI");
  await ev("USMIGRM2", "West Michigan Meet 2", "LeagueMeet", "2026-02-07", "Grand Rapids", "MI");
  await ev("USMILAQ", "Lansing Qualifier", "Qualifier", "2026-02-14", "Lansing", "MI");
  // Scheduled, nothing played: its highlights say so.
  await ev("USMIGRM6", "West Michigan Meet 6", "LeagueMeet", "2026-03-21", "Grand Rapids", "MI");
  await ev("USNJORQ", "Oradell Qualifier", "Qualifier", "2026-01-17", "Oradell", "NJ");
  await ev("ROBUQ", "Bucharest Qualifier", "Qualifier", "2026-01-24", "Bucharest", null, "Romania");
  await ev("ROCJQ", "Cluj Qualifier", "Qualifier", "2026-02-21", "Cluj-Napoca", null, "Romania");
  let n = 0;
  // [total, points without penalties, auto, teleop, endgame]
  const match = async (code: string, label: string, day: string, red: number[], blue: number[], reds: number[], blues: number[], level: "qual" | "playoff" = "qual") => {
    n++;
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, breakdown, source)
      VALUES (2025, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 't')`, [code, level, n, label, `${day}T15:00:00Z`, ...red, ...blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, ?, 0, ?, ?, ?, 1)", [code, level, n, t, a]);
      await run("INSERT OR IGNORE INTO event_teams (season, code, team, rank) VALUES (2025, ?, ?, 1)", [code, t]);
    }
  };
  await match("USMIGRM1", "Q1", "2026-01-10", [120, 120, 30, 70, 20], [60, 60, 10, 40, 10], [11111], [11112]);
  await match("USMIGRM2", "Q1", "2026-02-07", [90, 90, 20, 50, 20], [88, 88, 25, 45, 18], [11113], [11111]);
  // Lansing's best score is higher than any in Grand Rapids: a town's highlights never take it.
  await match("USMILAQ", "Q1", "2026-02-14", [300, 300, 80, 180, 40], [100, 100, 20, 60, 20], [11115], [11112]);
  await match("USNJORQ", "Q1", "2026-01-17", [150, 150, 40, 90, 20], [140, 140, 30, 90, 20], [4215], [6980]);
  await match("USNJORQ", "Q2", "2026-01-17", [130, 130, 50, 60, 20], [80, 80, 20, 40, 20], [6980], [4215]);
  // Romania: Cluj's match has the best TeleOp, Bucharest's the best score.
  await match("ROBUQ", "Q1", "2026-01-24", [400, 400, 200, 150, 50], [200, 200, 50, 120, 30], [14270], [19000]);
  await match("ROCJQ", "Q1", "2026-02-21", [380, 380, 60, 270, 50], [210, 210, 60, 120, 30], [19000], [14270]);
  await rebuildSearch();
  clearAllCaches();
});

describe("a town's highlights", () => {
  it("highlights in a town: its events' matches only, named as the town", async () => {
    for (const q of ["highlights in Grand Rapids", "best moments in grand rapids", "grand rapids highlights"]) {
      const s = await stat(q);
      expect(s?.intent, q).toBe("scope-highlights");
      expect(s.title, q).toBe("Highlights in Grand Rapids, 2025–26");
      expect(new Set(rows(s).map(codeOf)), q).toEqual(new Set(["USMIGRM1", "USMIGRM2"]));
    }
  });

  it("a town only one place has: its own events", async () => {
    const s = await stat("highlights in Oradell");
    expect(s.title).toBe("Highlights in Oradell, 2025–26");
    expect(rows(s).every((r) => codeOf(r) === "USNJORQ")).toBe(true);
  });

  it("a town name two regions share is the one with far more teams and events, never a team named after it", () => {
    const names = buildNames([
      { number: 1, name: "Rapid Robots", city: "Grand Rapids", state: "MI", country: "USA" },
      { number: 2, name: "B", city: "Grand Rapids", state: "MI", country: "USA" },
      { number: 3, name: "C", city: "Grand Rapids", state: "MI", country: "USA" },
      { number: 4, name: "D", city: "Grand Rapids", state: "MI", country: "USA" },
      { number: 5, name: "E", city: "Grand Rapids", state: "MI", country: "USA" },
      { number: 6, name: "F", city: "Grand Rapids", state: "MN", country: "USA" },
      { number: 7, name: "G", city: "Springfield", state: "IL", country: "USA" },
      { number: 8, name: "H", city: "Springfield", state: "MA", country: "USA" },
    ] as never, []);
    expect(names.place("grand rapids")).toMatchObject({ kind: "city", state: "MI", city: "Grand Rapids" });
    // Close counts stay ambiguous: no town is guessed.
    expect(names.place("springfield")).toBeNull();
  });
});

describe("one period's best matches said with videos", () => {
  it("best teleop videos in a country: the season's best TeleOp matches there, never a board of teams", async () => {
    for (const q of ["best teleop videos in romania decode", "highest teleop score in romania", "best teleop match in romania", "top teleop clips romania 2025-26"]) {
      const s = await stat(q);
      expect(s?.intent, q).toBe("season-top-matches");
      expect(s.title, q).toMatch(/teleop/i);
      expect(s.title, q).toContain("Romania");
      expect(s.headline?.label, q).toContain("Cluj Qualifier");
    }
  });

  it("an OPR or a team said keeps the board of teams", async () => {
    for (const q of ["best teleop opr in romania", "best teleop teams in romania"]) {
      const s = await stat(q);
      expect(s?.family, q).toBe("leaderboard");
    }
  });
});

describe("teams compared with highlights", () => {
  it("the side by side, then each team's own standout matches", async () => {
    for (const q of ["4215 vs 6980 highlights", "4215 versus 6980 best moments"]) {
      const s = await stat(q);
      expect(s?.intent, q).toBe("compare");
      const titles = s.blocks.map((b) => ("title" in b ? b.title ?? "" : ""));
      expect(titles.some((t) => t.startsWith("4215 Hypnotic Robotics:")), q).toBe(true);
      expect(titles.some((t) => t.startsWith("6980 Bad Wolf:")), q).toBe(true);
    }
  });

  it("the same compare without highlights adds nothing", async () => {
    const s = await stat("4215 vs 6980");
    expect(s.blocks.some((b) => "title" in b && /standout/.test(b.title ?? ""))).toBe(false);
  });
});

describe("an event with nothing played yet", () => {
  it("says no highlights yet, never sorry", async () => {
    for (const q of ["West Michigan Meet 6 highlights 2025-26", "west michigan meet 6 best moments 2025-26"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("scope-highlights");
      expect(a.stat?.none, q).toBe(NO_EVENT_HIGHLIGHTS);
    }
  });
  it("an event with matches played, its playoffs not yet: never \"no matches played\" (Loopy, #1579)", async () => {
    for (const q of ["Oradell Qualifier playoff highlights 2025-26", "Oradell Qualifier finals highlights 2025-26"]) {
      const a = await ask(q);
      expect(a.stat?.none ?? "", q).not.toBe(NO_EVENT_HIGHLIGHTS);
    }
  });
});
