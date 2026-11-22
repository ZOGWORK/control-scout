// The owner Data report worked out on a worker thread (dataReportOffThread.ts): the same report the server's own thread
// worked out, from a database file of its own; a database that isn't one is still read here.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON } from "../data/seasons";
import { computeDataReport } from "./dataReport";
import { dataReportOffThread, offThreadReports } from "./dataReportOffThread";

const S = CURRENT_SEASON;
const dirs: string[] = [];
const clients: Client[] = [];
afterAll(() => {
  for (const c of clients) c.close();
  // Windows can hold the file a moment after the close: a temp folder left behind is no failure.
  for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* left for the OS */ }
});

async function seed(c: Client): Promise<void> {
  setDb(c); await migrate(c);
  // An ended event with no matches (a flag), one with a played match, and a team with a season row short of its events.
  await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'EMPTY', 'Empty Qualifier', '1', '2025-11-01', '2025-11-01', 'first'), (?, 'PLAYED', 'Played Qualifier', '1', '2025-11-02', '2025-11-02', 'first')", [S, S]);
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'EMPTY', 4215), (?, 'PLAYED', 4215)", [S, S]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'PLAYED', 'qual', 0, 1, 'Q1', 1, 'first')", [S]);
  await run("INSERT INTO team_event_stats (season, code, team, matches) VALUES (?, 'PLAYED', 4215, 3)", [S]);
  await run("INSERT INTO team_season_stats (season, team, matches) VALUES (?, 4215, 1)", [S]);
}

describe("the Data report on a worker", () => {
  it("is the report this thread works out, from the same database file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-datareport-"));
    dirs.push(dir);
    const c = openDb(`file:${join(dir, "scout.db").replace(/\\/g, "/")}`);
    clients.push(c);
    await seed(c);
    const now = Date.parse("2026-01-15T12:00:00Z");
    const before = offThreadReports();
    const here = await computeDataReport(now);
    const there = await dataReportOffThread(now);
    expect(offThreadReports()).toBe(before + 1);
    expect(there).toEqual(here);
    expect(there.flags.find((f) => f.id === "ended-no-matches")?.count).toBe(1);
  }, 60_000);

  it("reads an in-memory database here, as before", async () => {
    const c = openDb(":memory:");
    clients.push(c);
    await seed(c);
    const now = Date.parse("2026-01-15T12:00:00Z");
    const before = offThreadReports();
    expect(await dataReportOffThread(now)).toEqual(await computeDataReport(now));
    expect(offThreadReports()).toBe(before);
  });
});
