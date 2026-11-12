// /teams/<n>/record-split: Search's "<n> record" answer, qualifications and playoffs apart, at its own address. One
// rule for the page, the team page's link, the first HTML and the sitemap: only a team whose latest season holds both a
// qualification match and a playoff match on its record has one.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { recordSplitLastmods, teamRecordPage } from "./teamRecordPage";
import { pageMeta, headTags } from "./seoMeta";
import { buildSitemap, resetSitemapCache, sitemapEntries } from "./sitemap";
import { teamProfile } from "./api/teams";

beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name) VALUES (4215, 'Hypnotic Robotics'), (7149, 'Partner'), (8000, 'Rival A'), (8001, 'Rival B'), (5555, 'Quals Only'), (6000, 'Old Playoffs')");
  await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source, type, upstream_updated) VALUES (2025, 'USNJNOM3', 'North Meet 3', '2025-11-08', '2025-11-08', 0, 0, 't', 'Qualifier', '2025-11-20T09:00:00Z'), (2024, 'OLD', 'Old meet', '2024-12-07', '2024-12-07', 0, 0, 't', 'Qualifier', '2025-03-01T00:00:00Z'), (2025, 'SCRIM', 'Scrimmage', '2025-10-01', '2025-10-01', 0, 0, 't', 'Scrimmage', NULL)");
  await run("INSERT INTO event_teams (season, code, team, qual_played) VALUES (2025, 'USNJNOM3', 4215, 2), (2025, 'USNJNOM3', 7149, 2), (2025, 'USNJNOM3', 8000, 2), (2025, 'USNJNOM3', 8001, 2), (2025, 'USNJNOM3', 5555, 1), (2024, 'OLD', 6000, 1), (2025, 'USNJNOM3', 6000, 1), (2025, 'SCRIM', 5555, 1)");
  const match = async (season: number, code: string, level: string, n: number, red: number[], blue: number[], redTeams: number[], blueTeams: number[], date: string) => {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, time, red_total, blue_total, red_np, blue_np, source) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 't')",
      [season, code, level, level === "playoff" ? 1 : 0, n, `${level === "playoff" ? "M" : "Q"}${n}`, date, red[0], blue[0], red[1], blue[1]]);
    for (const [ts, side] of [[redTeams, "red"], [blueTeams, "blue"]] as const) for (const t of ts)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", [season, code, level, level === "playoff" ? 1 : 0, n, t, side]);
  };
  // 4215: two quals (a win, a loss) and a playoff win at USNJNOM3. 5555: quals only (a scrimmage's playoff never
  // counts). 6000: a playoff the season before, quals only in its latest season.
  await match(2025, "USNJNOM3", "qual", 1, [120, 110], [80, 80], [4215, 7149], [8000, 8001], "2025-11-08T10:00:00Z");
  await match(2025, "USNJNOM3", "qual", 2, [60, 60], [90, 85], [4215, 5555], [8000, 6000], "2025-11-08T11:00:00Z");
  await match(2025, "USNJNOM3", "playoff", 3, [150, 140], [100, 100], [4215, 7149], [8000, 8001], "2025-11-08T15:00:00Z");
  await match(2025, "SCRIM", "playoff", 1, [50, 50], [40, 40], [5555], [8001], "2025-10-01T15:00:00Z");
  await match(2024, "OLD", "playoff", 1, [90, 90], [30, 30], [6000], [8000], "2024-12-07T15:00:00Z");
  resetSitemapCache();
});

describe("team record-split page", () => {
  it("is Search's record answer, whole, in the first HTML, with its own title, description and canonical", async () => {
    const page = await teamRecordPage(4215);
    expect(page?.stat.intent).toBe("record");
    expect(page?.stat.scope).toEqual(["2025–26"]);
    const m = await pageMeta("/teams/4215/record-split");
    expect(m.notFound).toBeUndefined();
    expect(m.noindex).toBeUndefined();
    expect(m.title).toBe("4215 Hypnotic Robotics record, quals vs playoffs, 2025–26");
    expect(m.description).toContain("4215 Hypnotic Robotics went 2-1-0 in 2025–26: 1-1-0 in qualification matches and 1-0-0 in the playoffs.");
    const head = headTags("/teams/4215/record-split", m);
    expect(head).toContain('<link rel="canonical" href="https://controlscout.org/teams/4215/record-split" />');
    expect(head).not.toContain("noindex");
    const body = m.bodyHtml!;
    expect(body).toContain("<b>2-1-0</b>");
    expect(body).toContain('<tr><th scope="row">Qualifications</th><td>1</td><td>1</td><td>0</td><td>50%</td></tr>');
    expect(body).toContain('<tr><th scope="row">Playoffs</th><td>1</td><td>0</td><td>0</td><td>100%</td></tr>');
    expect(body).toContain('<a href="/teams/4215">4215 Hypnotic Robotics: team page</a>');
  });

  it("is not found without both kinds of match in the latest season, or with no team at all", async () => {
    expect(await teamRecordPage(5555)).toBeNull(); // a scrimmage's playoff isn't on the record
    expect(await teamRecordPage(6000)).toBeNull(); // its playoff was the season before
    expect((await pageMeta("/teams/5555/record-split")).notFound).toBe(true);
    expect((await pageMeta("/teams/999999/record-split")).notFound).toBe(true);
  });

  it("the team page links to it only when it exists", async () => {
    expect((await teamProfile(4215))?.recordSplit).toBe(true);
    expect((await teamProfile(5555))?.recordSplit).toBe(false);
  });

  it("the sitemap lists each exactly once, with the day its season last changed", async () => {
    const rs = await recordSplitLastmods();
    expect(rs.map((r) => Number(r.number))).toEqual([4215, 7149, 8000, 8001]);
    expect(rs.find((r) => Number(r.number) === 4215)?.lastmod).toBe("2025-11-20");
    const locs = (await sitemapEntries()).map((x) => x.loc);
    expect(locs.filter((l) => l === "https://controlscout.org/teams/4215/record-split")).toHaveLength(1);
    expect(locs).not.toContain("https://controlscout.org/teams/5555/record-split");
    expect(locs).not.toContain("https://controlscout.org/teams/6000/record-split");
    expect(new Set(locs).size).toBe(locs.length);
    expect(buildSitemap(await sitemapEntries()).main).toContain("<url><loc>https://controlscout.org/teams/4215/record-split</loc><lastmod>2025-11-20</lastmod></url>");
  });
});
