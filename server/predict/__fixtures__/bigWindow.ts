// A full-size ratings window in a database file of its own, for the rebuild tests: three seasons of `events` events,
// 60 qualification matches each among 2,000 teams (about 12,000 matches a season, a real season's order), the older
// two frozen. Generated in SQL, so it takes a second or two instead of minutes of inserts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { kvSet, migrate, openDb, setDb } from "../../db";
import { CURRENT_SEASON } from "../../data/seasons";

export const WINDOW = [CURRENT_SEASON - 2, CURRENT_SEASON - 1, CURRENT_SEASON];

async function seedSeason(c: Client, season: number, events: number): Promise<void> {
  const n = `WITH RECURSIVE e(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM e WHERE i < ${events - 1}), k(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM k WHERE j < 59)`;
  const start = `date('${season}-10-01', '+' || (i % 150) || ' days')`;
  await c.execute(`${n} INSERT INTO events (season, code, name, type, start, end, remote, hybrid, region, source)
    SELECT ${season}, 'E' || i, 'Event ' || i, 'Qualifier', ${start}, ${start}, 0, 0, 'R' || (i % 12), 'test' FROM e`);
  const s = (side: number, part: string, mod: number) => `((i * ${31 + side} + j * ${17 + side}) % ${mod}) + ${part}`;
  await c.execute(`${n} INSERT INTO matches (season, code, level, series, number, label, time, played,
      red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source)
    SELECT ${season}, 'E' || i, 'qual', 0, j + 1, 'Q' || (j + 1), strftime('%Y-%m-%dT%H:%M:%S', ${start}, '+9 hours', '+' || (j * 7) || ' minutes'), 1,
      ${s(0, "60", 97)}, ${s(0, "60", 97)}, ${s(0, "10", 31)}, ${s(0, "30", 41)}, ${s(0, "5", 23)}, 0,
      ${s(5, "60", 89)}, ${s(5, "60", 89)}, ${s(5, "10", 29)}, ${s(5, "30", 43)}, ${s(5, "5", 19)}, 0, 'test'
    FROM e, k`);
  await c.execute(`${n}, slot(x) AS (SELECT 0 UNION ALL SELECT x + 1 FROM slot WHERE x < 3)
    INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field)
    SELECT ${season}, 'E' || i, 'qual', 0, j + 1, 1000 + ((i * 7 + j * 4 + x * 13 + ${season}) % 2000), CASE WHEN x < 2 THEN 'red' ELSE 'blue' END, 1 FROM e, k, slot`);
  await c.execute(`${n} INSERT INTO awards (season, code, type, placement, team) SELECT ${season}, 'E' || i, 'Inspire', 1, 1000 + ((i * 11 + ${season}) % 2000) FROM e`);
}

/** The window seeded into a new database file, which becomes the app's database (setDb). `close` closes and deletes it. */
export async function bigWindowDb(events = 200): Promise<{ client: Client; file: string; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "cs-rebuild-"));
  const file = join(dir, "scout.db").replace(/\\/g, "/");
  const client = openDb(`file:${file}`);
  setDb(client);
  await migrate(client);
  for (const s of WINDOW) await seedSeason(client, s, events);
  for (const s of WINDOW.slice(0, 2)) await client.execute({ sql: "INSERT OR REPLACE INTO seasons (season, name, frozen, last_complete) VALUES (?, 'old', 1, '2026-08-01')", args: [s] });
  await client.execute({ sql: "INSERT OR REPLACE INTO seasons (season, name, frozen) VALUES (?, 'now', 0)", args: [CURRENT_SEASON] });
  await kvSet("data:version", "v1");
  return { client, file, close: () => { client.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* a worker may still hold it */ } } };
}
