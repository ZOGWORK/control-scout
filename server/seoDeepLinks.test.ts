// Search deep links and indexing (docs/search.md): what a crawler and a shared link get. Team and event pages carry
// their real numbers in the first HTML; a team page's title, description, canonical and SportsTeam data follow one
// pattern, with true fields only; /search is "noindex, follow" and shows each result's address; robots.txt lets
// crawlers read every content page; search's deep links are the team page plus a stable anchor, never a new scheme.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { rebuildSearch } from "./stats/job";
import { headTags, pageMeta } from "./seoMeta";
import { hitHref, sectionFor, shownPath } from "../src/shared/search";
import type { SearchHit } from "../src/shared/api";

const S = 2025;
beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country, school, rookie_year) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA', 'River Dell Regional High Sch', 2010), (6980, 'Bad Wolf', 'Oradell', 'NJ', 'USA', NULL, 2013)");
  await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, wins, losses, ties, matches) VALUES (?, 4215, 101.6, 616, 8375, 26, 6, 0, 32), (?, 6980, 46.9, 2679, 8375, 13, 11, 0, 24)", [S, S]);
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJCMPPKWY', 'New Jersey Championship - Parkway Division', 'Championship', 'Hillsborough', 'NJ', 'USA', '2026-03-15', '2026-03-15', 't')", [S]);
  await run("INSERT INTO event_teams (season, code, team, rank, rp, wins, losses, ties) VALUES (?, 'USNJCMPPKWY', 4215, 6, 3.4, 4, 1, 0), (?, 'USNJCMPPKWY', 6980, 12, 2.2, 2, 3, 0)", [S, S]);
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'USNJCMPPKWY', 4215, 101.6, 5), (?, 'USNJCMPPKWY', 6980, 46.9, 5)", [S, S]);
  await rebuildSearch();
});

describe("team pages", () => {
  it("title, description, canonical and OG follow one pattern, from the team's real numbers", async () => {
    const m = await pageMeta("/teams/4215");
    expect(m.title).toBe("4215 Hypnotic Robotics | FTC Team Stats, OPR & Rankings");
    expect(m.description).toContain("record 26-6-0, OPR 101.6 (#616 of 8,375)");
    const head = headTags("/teams/4215", m);
    expect(head).toContain("<title>4215 Hypnotic Robotics | FTC Team Stats, OPR &amp; Rankings | Control Scout</title>");
    expect(head).toContain('<link rel="canonical" href="https://controlscout.org/teams/4215" />');
    expect(head).toContain('<meta property="og:url" content="https://controlscout.org/teams/4215" />');
    expect(head).toContain('<meta property="og:title" content="4215 Hypnotic Robotics | FTC Team Stats, OPR &amp; Rankings | Control Scout" />');
    expect(head).not.toContain('name="robots"');
    // One URL: a padded number is the same page (its canonical says so), never a redirect or a new address.
    expect((await pageMeta("/teams/004215")).path).toBe("/teams/4215");
  });
  it("SportsTeam data holds true fields only: the ones listed, each from the stored team", async () => {
    const m = await pageMeta("/teams/4215");
    const team = (m.jsonLd as any[])[0].mainEntity;
    expect(Object.keys(team).sort()).toEqual(["@id", "@type", "affiliation", "alternateName", "description", "foundingDate", "identifier", "location", "memberOf", "name", "sameAs", "sport", "url"].sort());
    expect(team).toMatchObject({ "@type": "SportsTeam", name: "Hypnotic Robotics", identifier: "4215", foundingDate: "2010", affiliation: { name: "River Dell Regional High Sch" }, sport: "Robotics (FIRST Tech Challenge)" });
    // No school stored: no affiliation (never a made-up one).
    expect((await pageMeta("/teams/6980")).jsonLd as any[]).toSatisfy((ld: any[]) => !("affiliation" in ld[0].mainEntity));
  });
  it("the first HTML has the page itself: name, number, season, record, rank, OPR and its events as links", async () => {
    for (const [n, bits] of [[4215, ["4215 Hypnotic Robotics", "2025–26", "record 26-6-0", "OPR 101.6 (#616 of 8,375)", "ranked 6"]], [6980, ["6980 Bad Wolf", "record 13-11-0", "OPR 46.9 (#2,679 of 8,375)", "ranked 12"]]] as const) {
      const body = (await pageMeta(`/teams/${n}`)).bodyHtml!;
      for (const b of bits) expect(body, `${n}: ${b}`).toContain(b);
      expect(body).toContain('<a href="/events/2025/USNJCMPPKWY">New Jersey Championship - Parkway Division</a>');
    }
  });
});

describe("event pages", () => {
  it("the first HTML lists the standings: rank, team link, record, ranking score and OPR", async () => {
    const body = (await pageMeta("/events/2025/USNJCMPPKWY")).bodyHtml!;
    expect(body).toContain("<h2>Rankings</h2>");
    expect(body).toContain('<li><a href="/teams/4215">4215 Hypnotic Robotics</a> <small>#6 · 4-1-0 · RS 3.40 · OPR 101.6</small></li>');
    expect(body.indexOf("/teams/4215")).toBeLessThan(body.indexOf("/teams/6980")); // in rank order
  });
});

describe("/search", () => {
  it("is noindex, follow, and shows each result's full address", async () => {
    const m = await pageMeta("/search", { q: "4215" });
    expect(headTags("/search", m)).toContain('<meta name="robots" content="noindex, follow" data-search />');
    expect(m.bodyHtml).toContain("controlscout.org/teams/4215");
    // Its empty page too: never indexed.
    expect(headTags("/search", await pageMeta("/search"))).toContain('content="noindex, follow"');
  });
  it("robots.txt lets crawlers read every content page, keeps /api/ out, and names the sitemap", () => {
    const robots = readFileSync(join(process.cwd(), "public", "robots.txt"), "utf8");
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots.match(/^Disallow: .*$/gm)).toEqual(["Disallow: /api/"]);
    expect(robots).toContain("Sitemap: https://controlscout.org/sitemap.xml");
  });
});

describe("deep links", () => {
  const team: SearchHit = { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics", subtitle: "", season: 2025 };
  it("each stat topic opens the team page at its own anchor", () => {
    const anchors = Object.fromEntries((["rp", "rankings", "record", "opr", "stats", "history", "difficulty", "awards", "matches"] as const).map((t) => [t, sectionFor("team", t)]));
    expect(anchors).toEqual({ rp: "ranking", rankings: "ranking", record: "ranking", opr: "opr", stats: "opr", history: "history", difficulty: "schedule-difficulty", awards: "awards", matches: "matches" });
  });
  it("the shown address is the link itself on the site's host", () => {
    expect(shownPath({ ...team, section: "opr" })).toBe("controlscout.org/teams/4215#opr");
    expect(hitHref({ ...team, section: "opr" })).toBe("/teams/4215#opr");
    expect(shownPath({ ...team, href: "/compare?teams=4215,6980" })).toBe("controlscout.org/compare?teams=4215,6980");
  });
});
