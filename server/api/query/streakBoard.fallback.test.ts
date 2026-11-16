// Where the database can't hold a snapshot (one shared connection: in memory, an embedded replica; db.ts inSnapshot),
// the streak board is one read, its matches alone: no list of the place's teams read before it, which a write landing
// between the two would leave out of step with the matches.
import { beforeAll, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => [] as string[]);
vi.mock("../../db.js", async (real) => {
  const m = await real<typeof import("../../db.js")>();
  return { ...m, all: (sql: string, args?: unknown[]) => { reads.push(sql); return m.all(sql, args as never); } };
});

const { migrate, openDb, run, setDb } = await import("../../db");
const { streakBoardAnswer } = await import("./streakBoard");

const S = 2025;
const NJ = { key: "USA:NJ", country: "USA", state: "NJ", name: "New Jersey" };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (let i = 0; i < 300; i++) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [1000 + i, `Team ${i}`]);
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'Q1', 'Qualifier 1', 'Qualifier', 'Town', 'NJ', 'USA', '2026-01-01', '2026-01-01', 't')", [S]);
  for (let i = 0; i < 300; i++) {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'Q1', 'qual', 0, ?, ?, 1, 30, 30, 20, 20, 't')", [S, i + 1, `Q${i + 1}`]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'Q1', 'qual', 0, ?, ?, 'red', 1)", [S, i + 1, 1000 + i]);
  }
});

describe("a streak board where no snapshot can be held", () => {
  it("is one read of the matches, every team in it", async () => {
    reads.length = 0;
    const a = await streakBoardAnswer({ region: NJ, season: 2026, now: false, losing: false, n: 3 });
    // The rows: one read, with no list of the place's teams before it (the leaders' names are read after, for show).
    const rows = reads.filter((r) => r.includes("match_teams"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toContain("BETWEEN");
    expect(reads.filter((r) => /SELECT number FROM teams WHERE country/.test(r))).toEqual([]);
    expect(a.source).toBe("From 300 match results of 300 teams from New Jersey");
  });
});
