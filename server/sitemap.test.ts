// sitemap.xml from the database: the content pages, every team and event page with data (server/indexable.test.ts
// has the rule's cases), apex URLs, no personal pages; split into an index past the limit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDb, run, setDb } from "./db";
import { buildSitemap, resetSitemapCache, sitemapEntries } from "./sitemap";
import { setFlag } from "./flags";
import { pageMeta } from "./seoMeta";

const savedDataDir = process.env.DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "cs-sitemap-"));
afterAll(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = savedDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, updated_at) VALUES (4215, 'Hypnotic Robotics', '2026-10-01T10:00:00Z'), (18360, 'X', NULL), (5555, 'Rookies', NULL)");
  await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source, upstream_updated) VALUES (2025, 'USNJNOM3', 'Meet', '2025-11-08', '2025-11-08', 0, 0, 't', '2025-12-02T09:00:00Z'), (2026, 'FUTURE', 'Later', '2099-01-01', '2099-01-02', 0, 0, 't', NULL), (2019, '2019ALCMP', 'Alabama (history-only season)', '2020-02-21', '2020-02-22', 0, 0, 't', NULL), (2024, 'OLD', 'Old', '2024-12-07', '2024-12-07', 0, 0, 't', NULL)");
  // 4215 played USNJNOM3 (results marked changed later) and OLD, and both are registered for one that hasn't started.
  await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'USNJNOM3', 4215), (2024, 'OLD', 4215), (2026, 'FUTURE', 4215), (2026, 'FUTURE', 18360), (2026, 'FUTURE', 5555), (2019, '2019ALCMP', 18360)");
  // A league meet with results: on 4215's roster, but only 18360 took the field (4215 was a no-show), and only in a
  // playoff match (no qualification stats for it), which counts all the same.
  await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source) VALUES (2025, 'LEAGUE', 'League meet', '2026-01-10', '2026-01-10', 0, 0, 't')");
  await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'LEAGUE', 4215), (2025, 'LEAGUE', 18360)");
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'LEAGUE', 'playoff', 1, 1, 'M1', 1, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'LEAGUE', 'playoff', 1, 1, 18360, 'red', 1), (2025, 'LEAGUE', 'playoff', 1, 1, 4215, 'blue', 0)");
  // Leagues: NE (2025, USNJ) has FIRST's standings; SO (a meet names it) has none yet, and stays out.
  await run("INSERT INTO leagues (season, region, code, name, ranked_at) VALUES (2025, 'USNJ', 'NE', 'Northeast', '2026-01-11T09:00:00Z'), (2025, 'USNJ', 'SO', 'Southern', NULL)");
  await run("INSERT INTO league_rankings (season, region, league, team, rank, wins, losses, ties, played) VALUES (2025, 'USNJ', 'NE', 18360, 1, 3, 0, 0, 3), (2025, 'USNJ', 'NE', 4215, 2, 1, 2, 0, 3)");
  // Only a meet names this one (no leagues row): the page still finds it (storedLeague), so it's listed too.
  await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source, region, league, type) VALUES (2025, 'USNJNOM9', 'North meet', '2025-11-15', '2025-11-15', 0, 0, 't', 'USNJ', 'NO', 'LeagueMeet')");
  await run("INSERT INTO league_rankings (season, region, league, team, rank, played) VALUES (2025, 'USNJ', 'NO', 4215, 1, 2)");
  process.env.DATA_DIR = dataDir;
  resetSitemapCache();
});

/** A built set of offline packs on disk (server/packs/routes.ts presentManifest). */
function writePacks() {
  const dir = join(dataDir, "packs");
  mkdirSync(dir, { recursive: true });
  const f = (name: string, seasons: number[], kind: "lite" | "full", contents: string) => { writeFileSync(join(dir, name), "x"); return { name, url: `/packs/${name}`, bytes: 6_578_176, sha256: "0", seasons, kind, contents }; };
  writeFileSync(join(dir, "latest.json"), JSON.stringify({
    format: 1, version: "2026-11-11.1", builtAt: "2026-11-11T00:00:00Z", engineVersion: "x", dataAsOf: "2026-11-10T23:00:00Z",
    lite: f("scout-pack-1-lite.json.gz", [2025], "lite", "Every team's prediction rating."),
    full: [f("scout-pack-1-2025.db", [2025], "full", "Every 2025–26 DECODE event, team and match — a plain SQLite file.")],
  }));
}

describe("sitemap", () => {
  it("lists public pages, teams and events at apex URLs with lastmod; never personal pages or /api", async () => {
    const e = await sitemapEntries();
    const locs = e.map((x) => x.loc);
    expect(locs).toContain("https://controlscout.org/");
    expect(locs).toContain("https://controlscout.org/teams/4215");
    // Pages whose first HTML carries their content are listed; /predict (an input form) stays out, crawlable from its links.
    for (const p of ["/privacy", "/terms", "/contact", "/teams", "/matches"]) expect(locs).toContain(`https://controlscout.org${p}`);
    expect(locs).not.toContain("https://controlscout.org/predict");
    expect(locs).toContain("https://controlscout.org/faq");
    expect(locs).toContain("https://controlscout.org/rankings");
    expect(locs).toContain("https://controlscout.org/events/2025/USNJNOM3");
    expect(locs).toContain("https://controlscout.org/events/2019/2019ALCMP"); // legacy seasons are browsable pages too
    expect(locs.some((l) => /\/(my-team|shortlist|scout|settings|api)(\/|$)/.test(l))).toBe(false);
    expect(locs.every((l) => l.startsWith("https://controlscout.org/") && !l.includes("www."))).toBe(true);
    // A team's lastmod: its latest started event (the source's later change marker counts), never the sync stamp on teams.updated_at.
    expect(e.find((x) => x.loc.endsWith("/teams/4215"))!.lastmod).toBe("2025-12-02");
    expect(e.find((x) => x.loc.endsWith("/teams/18360"))!.lastmod).toBe("2026-01-10"); // played the league meet (a playoff match only)
    // 4215's no-show at the league meet (later than its last real event) doesn't count.
    // The source's change marker (late results move it past the event's last day); none when unknown.
    expect(e.find((x) => x.loc.endsWith("/events/2025/USNJNOM3"))!.lastmod).toBe("2025-12-02");
    expect(e.find((x) => x.loc.endsWith("/events/2026/FUTURE"))!.lastmod).toBeUndefined();
    // A team only entered in an event that hasn't started: that event is on its page, so it's listed, with no lastmod
    // until the event starts.
    expect(e.find((x) => x.loc.endsWith("/teams/5555"))!.lastmod).toBeUndefined();
    // An event with no teams and no matches (OLD's roster aside, every other here has one) is left out.
    await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source) VALUES (2025, 'BARE', 'Kickoff', '2025-09-06', '2025-09-06', 0, 0, 't')");
    expect((await sitemapEntries()).map((x) => x.loc)).not.toContain("https://controlscout.org/events/2025/BARE");
    // No Compare (empty until teams are picked; a pair is two team pages) and no /search (noindex).
    expect(locs.some((l) => /^https:\/\/[^/]+\/(compare|search)(\?|\/|$)/.test(l))).toBe(false);
    // The FTC One Search explainer is a public page.
    expect(locs).toContain("https://controlscout.org/how-it-works/search");
    const { main, chunks } = buildSitemap(e);
    expect(chunks).toHaveLength(0);
    expect(main).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    expect(main).toContain("<url><loc>https://controlscout.org/teams/4215</loc><lastmod>2025-12-02</lastmod></url>");
  });

  it("lists Download only while it offers season files, with them in its first HTML", async () => {
    const has = async () => (await sitemapEntries()).some((x) => x.loc === "https://controlscout.org/download");
    // No packs built: the page is a heading and a line, so it stays out.
    expect(await has()).toBe(false);
    expect((await pageMeta("/download")).bodyHtml).toBeUndefined();
    writePacks();
    expect(await has()).toBe(true);
    // lastmod: the day of the data the files hold (dataAsOf), never the build date of the sitemap.
    expect((await sitemapEntries()).find((x) => x.loc === "https://controlscout.org/download")?.lastmod).toBe("2026-11-10");
    const body = (await pageMeta("/download")).bodyHtml!;
    expect(body).toContain("<h2>Season files</h2>");
    expect(body).toContain("2025–26");
    expect(body).toContain("6.3 MB");
    expect(body).toContain("a plain SQLite file.");
    expect(body).not.toContain("href="); // no link to a 40 MB file for a crawler to fetch
    // An older manifest with no season files listed: the offline pack alone, never a failed page.
    const { downloadHtml } = await import("./seoMeta");
    expect(downloadHtml("Lead.", { format: 1, version: "v", builtAt: "2026-11-01T00:00:00Z", engineVersion: "x", dataAsOf: null, lite: null, full: undefined as never })).toBe("<p>Lead.</p><p><small>Built 2026-11-01.</small></p>");
    // Offline packs switched off by the owner: the page offers nothing, so out again.
    await setFlag("offlinePacks", false, "test");
    expect(await has()).toBe(false);
    expect((await pageMeta("/download")).bodyHtml).toBeUndefined();
    await setFlag("offlinePacks", true, "test");
  });

  it("lists every league with standings at its page's address, never one with none", async () => {
    const e = await sitemapEntries();
    const ne = e.find((x) => x.loc === "https://controlscout.org/leagues/2025/USNJ/NE");
    expect(ne?.lastmod).toBe("2026-01-11"); // the day its standings were read
    expect(e.find((x) => x.loc === "https://controlscout.org/leagues/2025/USNJ/NO")?.lastmod).toBeUndefined();
    expect(e.some((x) => x.loc.endsWith("/leagues/2025/USNJ/SO"))).toBe(false);
    // The page agrees: standings on it, no noindex; the empty one is the page's no-data case.
    const m = await pageMeta("/leagues/2025/USNJ/NE");
    expect(m.noData).toBeUndefined();
    expect(m.bodyHtml).toContain("<h2>Standings</h2>");
    expect((await pageMeta("/leagues/2025/USNJ/SO")).noData).toBe(true);
  });

  it("past the limit: an index of chunks, every URL exactly once", async () => {
    const e = await sitemapEntries();
    const { main, chunks } = buildSitemap(e, 3);
    expect(main).toContain("<sitemapindex");
    expect(chunks).toHaveLength(Math.ceil(e.length / 3));
    expect(main).toContain("<loc>https://controlscout.org/sitemap-1.xml</loc>");
    const got = chunks.join("").match(/<loc>[^<]*<\/loc>/g)!.map((l) => l.slice(5, -6));
    expect(got).toEqual(e.map((x) => x.loc)); // same URLs, same order: none dropped, none repeated
    expect(new Set(got).size).toBe(got.length);
  });
});

describe("missing files", () => {
  it("any extension counts as a file (so it 404s instead of serving the app)", async () => {
    const { MISSING_FILE } = await import("./seo");
    for (const p of ["/missing.webmanifest", "/x.png", "/a/b.xml", "/robots.txt", "/events/2019/x/y.png"]) expect(MISSING_FILE.test(p)).toBe(true);
    for (const p of ["/teams/4215", "/events/2025/USNJNOM3", "/", "/events/2019/63693260770.2649", "/events/2019/63693260770.2649/display", "/lite/events/2019/63693260770.2649", "/events/2019/63693260770.2649/match/qual:0:1"]) expect(MISSING_FILE.test(p)).toBe(false);
  });
});
