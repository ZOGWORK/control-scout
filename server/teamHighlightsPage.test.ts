// /teams/<n>/highlights: Search's "<n> highlights" answer at its own address. One rule for the page, the team page's
// link, the first HTML and the sitemap: only a team with a page to index and a match to pick from has one.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { highlightsEntries, teamHighlightsPage } from "./teamHighlightsPage";
import { pageMeta, headTags } from "./seoMeta";
import { buildSitemap, resetSitemapCache, sitemapEntries } from "./sitemap";
import { teamProfile } from "./api/teams";

beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name) VALUES (4215, 'Hypnotic Robotics'), (7149, 'Partner'), (8000, 'Rival A'), (8001, 'Rival B'), (5555, 'Rookies')");
  await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source, type, upstream_updated) VALUES (2025, 'USNJNOM3', 'North Meet 3', '2025-11-08', '2025-11-08', 0, 0, 't', 'LeagueMeet', '2025-11-20T09:00:00Z'), (2024, 'OLD', 'Old meet', '2024-12-07', '2024-12-07', 0, 0, 't', 'Qualifier', '2025-03-01T00:00:00Z'), (2026, 'FUTURE', 'Later', '2099-01-01', '2099-01-02', 0, 0, 't', 'Qualifier', NULL)");
  await run("INSERT INTO event_teams (season, code, team, qual_played) VALUES (2025, 'USNJNOM3', 4215, 2), (2025, 'USNJNOM3', 7149, 2), (2025, 'USNJNOM3', 8000, 2), (2025, 'USNJNOM3', 8001, 2), (2024, 'OLD', 4215, 1), (2026, 'FUTURE', 5555, 0)");
  // Two played qualification matches at USNJNOM3 (a win and a loss) and one the season before, which the page leaves
  // to its own season (highlights are of the latest season with matches).
  const match = async (season: number, code: string, n: number, red: [number, number], blue: [number, number], date: string) => {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, time, red_total, blue_total, red_np, blue_np, red_auto, blue_auto, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, ?, ?, ?, ?, ?, 20, 10, 't')",
      [season, code, n, `Q${n}`, date, red[0], blue[0], red[1], blue[1]]);
    const teams = season === 2025 ? [[4215, "red"], [7149, "red"], [8000, "blue"], [8001, "blue"]] : [[4215, "red"], [8000, "blue"]];
    for (const [t, side] of teams) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, n, t, side]);
  };
  await match(2025, "USNJNOM3", 1, [120, 110], [80, 80], "2025-11-08T10:00:00Z");
  await match(2025, "USNJNOM3", 2, [60, 60], [90, 85], "2025-11-08T11:00:00Z");
  await match(2024, "OLD", 1, [300, 300], [10, 10], "2024-12-07T10:00:00Z");
  resetSitemapCache();
});

describe("team highlights page", () => {
  it("is Search's highlights answer, whole, in the first HTML, with its own title, description and canonical", async () => {
    const page = await teamHighlightsPage(4215);
    expect(page?.stat.intent).toBe("team-highlights");
    expect(page?.stat.scope).toEqual(["2025–26"]); // the latest season with matches, never the old 300
    const m = await pageMeta("/teams/4215/highlights");
    expect(m.notFound).toBeUndefined();
    expect(m.noindex).toBeUndefined();
    expect(m.title).toBe("4215 Hypnotic Robotics highlights, 2025–26");
    expect(m.description).toBe("4215 Hypnotic Robotics's standout FTC matches of 2025–26: best score without penalties, 110 points, in Q1 at North Meet 3. Scores, partners and match videos.");
    const head = headTags("/teams/4215/highlights", m);
    expect(head).toContain('<link rel="canonical" href="https://controlscout.org/teams/4215/highlights" />');
    expect(head).not.toContain("noindex");
    const body = m.bodyHtml!;
    expect(body).toContain("<b>Best score</b>: <a href=\"/events/2025/USNJNOM3?match=qual:0:1\">Q1</a> at <a href=\"/events/2025/USNJNOM3?team=4215\">North Meet 3</a>");
    expect(body).toContain("Won 120–80 (110 without penalties)");
    expect(body).toContain('<a href="/teams/7149');
    expect(body).not.toContain("300"); // the season before stays out
    expect(body).toContain('<a href="/teams/4215">4215 Hypnotic Robotics: team page</a>'); // links back
  });

  it("is not found for a team with no match to pick from, or no team at all", async () => {
    expect(await teamHighlightsPage(5555)).toBeNull();
    expect((await pageMeta("/teams/5555/highlights")).notFound).toBe(true);
    expect((await pageMeta("/teams/999999/highlights")).notFound).toBe(true);
  });

  it("the team page links to it only when it exists", async () => {
    expect((await teamProfile(4215))?.highlights).toBe(true);
    expect((await teamProfile(5555))?.highlights).toBe(false);
  });

  it("the sitemap lists each exactly once, with the day its season last changed", async () => {
    const hs = await highlightsEntries();
    expect(hs.map((h) => h.number)).toEqual([4215, 7149, 8000, 8001]);
    // The source's change marker on USNJNOM3 (Nov 20) is later than its matches (Nov 8); OLD's (2025-03-01) is the
    // season before, so it never counts.
    expect(hs.find((h) => h.number === 4215)?.lastmod).toBe("2025-11-20");
    const e = await sitemapEntries();
    const locs = e.map((x) => x.loc);
    expect(locs.filter((l) => l === "https://controlscout.org/teams/4215/highlights")).toHaveLength(1);
    expect(locs).not.toContain("https://controlscout.org/teams/5555/highlights");
    expect(new Set(locs).size).toBe(locs.length);
    expect(buildSitemap(e).main).toContain("<url><loc>https://controlscout.org/teams/4215/highlights</loc><lastmod>2025-11-20</lastmod></url>");
  });
});
