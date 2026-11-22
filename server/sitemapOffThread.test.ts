// The sitemap's reads on a worker thread (sitemapOffThread.ts): the same rows this thread reads, from a database file of
// its own, and the same sitemap; a database that isn't one is still read here.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { migrate, openDb, run, setDb } from "./db";
import { resetSitemapCache, sitemapEntries, sitemapRoute, sitemapRows } from "./sitemap";
import { offThreadSitemaps, sitemapRowsOffThread } from "./sitemapOffThread";

const dirs: string[] = [];
const clients: Client[] = [];
afterAll(() => {
  for (const c of clients) c.close();
  // Windows can hold the file a moment after the close: a temp folder left behind is no failure.
  for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* left for the OS */ }
});

async function seed(c: Client): Promise<void> {
  setDb(c); await migrate(c);
  await run("INSERT INTO teams (number, name) VALUES (4215, 'Hypnotic Robotics'), (18360, 'X'), (5555, 'Rookies')");
  await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source, upstream_updated) VALUES (2025, 'USNJNOM3', 'Meet', '2025-11-08', '2025-11-08', 0, 0, 't', '2025-12-02T09:00:00Z'), (2025, 'LEAGUE', 'League meet', '2026-01-10', '2026-01-10', 0, 0, 't', NULL)");
  await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'USNJNOM3', 4215), (2025, 'LEAGUE', 4215), (2025, 'LEAGUE', 18360)");
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'LEAGUE', 'qual', 0, 1, 'Q1', 1, 't'), (2025, 'LEAGUE', 'playoff', 1, 1, 'M1', 1, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'LEAGUE', 'qual', 0, 1, 18360, 'red', 1), (2025, 'LEAGUE', 'qual', 0, 1, 4215, 'blue', 1), (2025, 'LEAGUE', 'playoff', 1, 1, 18360, 'red', 1), (2025, 'LEAGUE', 'playoff', 1, 1, 4215, 'blue', 1)");
  await run("INSERT INTO leagues (season, region, code, name, ranked_at) VALUES (2025, 'USNJ', 'NE', 'Northeast', '2026-01-11T09:00:00Z')");
  await run("INSERT INTO league_rankings (season, region, league, team, rank, wins, losses, ties, played) VALUES (2025, 'USNJ', 'NE', 18360, 1, 3, 0, 0, 3)");
}

const fileDb = () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-sitemap-"));
  dirs.push(dir);
  const c = openDb(`file:${join(dir, "scout.db").replace(/\\/g, "/")}`);
  clients.push(c);
  return c;
};

function fakeRes() {
  const r = { body: "", type() { return r; }, setHeader() { return r; }, send(s: string) { r.body = s; return r; } };
  return r;
}

describe("the sitemap's reads on a worker", () => {
  it("are the rows this thread reads, from the same database file, and make the same sitemap", async () => {
    await seed(fileDb());
    const today = "2026-11-22";
    const before = offThreadSitemaps();
    const here = await sitemapRows(today);
    const there = await sitemapRowsOffThread(today);
    expect(offThreadSitemaps()).toBe(before + 1);
    expect(there).toEqual(here);
    expect(here.teamRows.length).toBeGreaterThan(0);
    expect(here.events.length).toBeGreaterThan(0);
    expect(here.lastmods.length).toBeGreaterThan(0);
    expect(here.leagues.length).toBeGreaterThan(0);
    expect(await sitemapEntries(sitemapRowsOffThread)).toEqual(await sitemapEntries());
  }, 60_000);

  it("/sitemap.xml reads on the worker", async () => {
    await seed(fileDb());
    resetSitemapCache();
    const before = offThreadSitemaps();
    const res = fakeRes();
    await sitemapRoute({} as never, res as never);
    expect(offThreadSitemaps()).toBe(before + 1);
    expect(res.body).toContain("/teams/4215</loc>");
    resetSitemapCache();
  }, 60_000);

  it("reads an in-memory database here, as before", async () => {
    const c = openDb(":memory:");
    clients.push(c);
    await seed(c);
    const before = offThreadSitemaps();
    expect(await sitemapRowsOffThread("2026-11-22")).toEqual(await sitemapRows("2026-11-22"));
    expect(offThreadSitemaps()).toBe(before);
  });
});
