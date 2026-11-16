// A streak board read in parts (streakBoard.ts boardRows) describes one moment: results stored between two parts (the
// live lane, a sync in its child process) are in none of the parts, never in the later ones only. A database file, as
// in production: its read snapshot holds a connection of its own.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({ afterFirstPart: null as null | (() => Promise<void>), parts: 0 }));
vi.mock("../../db.js", async (real) => {
  const m = await real<typeof import("../../db.js")>();
  return {
    ...m,
    // The real snapshot, its reads counted, and a write made just after the first part (on the server's own connection).
    inSnapshot: (fn: Parameters<typeof m.inSnapshot>[0]) => m.inSnapshot((read) => fn(async (sql, args) => {
      const rows = await read(sql, args);
      if (sql.includes("CROSS JOIN match_teams")) {
        hook.parts++;
        const f = hook.afterFirstPart;
        if (f) { hook.afterFirstPart = null; await f(); }
      }
      return rows as never;
    })),
  };
});

const { all, migrate, openDb, run, setDb } = await import("../../db");
const { streakBoardAnswer } = await import("./streakBoard");

const dir = mkdtempSync(join(tmpdir(), "streak-snapshot-"));
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* still open on Windows */ } });
const S = 2025;
const NJ = { key: "USA:NJ", country: "USA", state: "NJ", name: "New Jersey" };
let match = 0;
const play = async (team: number, day: number) => {
  const n = ++match;
  await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, 30, 30, 20, 20, 't')", [S, `Q${day}`, n, `Q${n}`]);
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, 'red', 1)", [S, `Q${day}`, n, team]);
};

beforeAll(async () => {
  const c = openDb(`file:${join(dir, "scout.db").replace(/\\/g, "/")}`);
  setDb(c);
  await migrate(c);
  // 600 teams: three parts. Each wins once on day 1.
  for (let i = 0; i < 600; i++) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [1000 + i, `Team ${i}`]);
  for (const d of [1, 2]) await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', 'NJ', 'USA', ?, ?, 't')", [S, `Q${d}`, `Qualifier ${d}`, `2026-01-0${d}`, `2026-01-0${d}`]);
  for (let i = 0; i < 600; i++) await play(1000 + i, 1);
});

describe("a streak board read while results are stored", () => {
  it("never mixes moments: wins stored between its parts are in none of them, the first part's or the last's", async () => {
    // Just after the first part (teams 1000-1249) is read: a win more for 1005 (read already) and 1590 (still to come).
    hook.afterFirstPart = async () => { await play(1005, 2); await play(1590, 2); };
    hook.parts = 0;
    const a = await streakBoardAnswer({ region: NJ, season: 2026, now: false, losing: false, n: 2 });
    expect(hook.parts).toBe(3); // read in parts, the write landed between them
    expect(a.source).toBe("From 600 match results of 600 teams from New Jersey");
    const longest = a.blocks?.find((b) => b.kind === "table");
    expect(longest?.kind === "table" && longest.rows.map((r) => r.cells.streak)).toEqual(["1 win", "1 win"]);
    // Stored all the same: the next board has both.
    expect((await all("SELECT COUNT(*) n FROM match_teams"))[0]).toEqual({ n: 602 });
    const next = await streakBoardAnswer({ region: NJ, season: 2026, now: false, losing: false, n: 2 });
    expect(next.source).toBe("From 602 match results of 600 teams from New Jersey");
  });
});
