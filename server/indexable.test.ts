// Which pages are indexed (server/indexable.ts): one rule for a page's robots tag, the sitemap and IndexNow. A page with
// data is indexed, self-canonical and listed; an empty one (a team that never played, an event with no teams and no
// matches) answers 200 with noindex and stays out of the sitemap until its first data arrives; an address that names
// nothing is a 404; an event code the page can't look up is never listed.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { CURRENT_SEASON } from "./data/seasons";
import { headTags, pageMeta } from "./seoMeta";
import { renderPage } from "./seo";
import { STATIC_PAGES, sitemapEntries } from "./sitemap";
import { changedEvents } from "./indexNow";
import { isReachableEventCode } from "./indexable";
import { teamProfile } from "./api/teams";

const S = CURRENT_SEASON, P = CURRENT_SEASON - 1;
const ORIGIN = "https://controlscout.org";
let file = "";

beforeAll(async () => {
  process.env.APP_URL = ORIGIN;
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // 4215 played last season; 6980 won an award only; 5555 is entered in an upcoming event only; 7777 has never been
  // anywhere; 8888 is only on the roster of a finished league meet it never played (a league lists every team).
  await run(`INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA'),
    (6980, 'Bad Wolf', NULL, NULL, 'USA'), (5555, 'Rookies', NULL, NULL, 'USA'), (7777, 'Nothing Yet', NULL, NULL, 'USA'), (8888, 'Skipped', NULL, NULL, 'USA'),
    (3640, 'Veterans', NULL, NULL, 'USA')`);
  await run(`INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source, detail_synced_at) VALUES
    (?, 'PLAYED', 'Played qualifier', 'Qualifier', '2026-02-01', '2026-02-01', 0, 0, 't', '2026-02-01T20:00:00Z'),
    (?, 'AWARDS', 'Award event', 'Qualifier', '2026-02-08', '2026-02-08', 0, 0, 't', NULL),
    (?, 'SOON', 'Upcoming scrimmage', 'Scrimmage', '2099-01-01', '2099-01-01', 0, 0, 't', NULL),
    (?, 'EMPTY', 'Kickoff', 'Kickoff', '2026-09-10', '2026-09-10', 0, 0, 't', '2026-09-11T00:00:00Z'),
    (?, 'LGM1', 'League meet', 'LeagueMeet', '2026-10-01', '2026-10-01', 0, 0, 't', NULL),
    (2019, '2019INMeet10', 'Mixed-case code', 'LeagueMeet', '2019-12-01', '2019-12-01', 0, 0, 't', NULL)`, [P, P, S, S, S]);
  await run("INSERT INTO event_teams (season, code, team, rank, qual_played) VALUES (?, 'PLAYED', 4215, 1, 5), (?, 'SOON', 5555, NULL, NULL), (?, 'LGM1', 8888, NULL, NULL), (?, 'LGM1', 3640, NULL, NULL), (?, 'PLAYED', 3640, 2, 5), (?, 'LGM1', 4215, 1, 4), (2019, '2019INMeet10', 4215, 1, 5)", [P, S, S, S, P, S]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'PLAYED', 'qual', 0, 1, 'Q1', 1, 't'), (?, 'LGM1', 'qual', 0, 1, 'Q1', 1, 't')", [P, S]);
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'PLAYED', 'qual', 0, 1, 4215, 'red', 1), (?, 'LGM1', 'qual', 0, 1, 4215, 'red', 1)", [P, S]);
  await run("INSERT INTO team_season_stats (season, team, opr_np, wins, losses, ties, matches) VALUES (?, 4215, 101.6, 5, 0, 0, 5), (?, 3640, 40.2, 3, 2, 0, 5)", [P, P]);
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'AWARDS', 'Inspire', 1, 6980, 'Inspire Award')", [P]);
  const dir = mkdtempSync(join(tmpdir(), "cs-index-"));
  file = join(dir, "index.html");
  writeFileSync(file, '<html><head><title>x</title></head><body><div id="root"><!--cs-boot--></div></body></html>');
});

const robotsOf = async (path: string) => headTags(path, await pageMeta(path)).match(/<meta name="robots"[^>]*>/)?.[0] ?? null;
const canonicalOf = async (path: string) => headTags(path, await pageMeta(path)).match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;

describe("class A: a page with data", () => {
  it("is indexed and self-canonical: results, an award, or an upcoming event on the team's page", async () => {
    for (const n of [4215, 6980, 5555]) {
      expect(await robotsOf(`/teams/${n}`), `team ${n}`).toBeNull();
      expect(await canonicalOf(`/teams/${n}`)).toBe(`${ORIGIN}/teams/${n}`);
    }
    for (const p of [`/events/${P}/PLAYED`, `/events/${S}/SOON`, `/events/${S}/LGM1`]) {
      expect(await robotsOf(p), p).toBeNull();
      expect(await canonicalOf(p)).toBe(`${ORIGIN}${p}`);
    }
  });
});

describe("a team with past results on a current league roster it never played", () => {
  it("opens on its last season with results, not an empty current season, and is indexed", async () => {
    // The finished league meet lists every league team, so the page shows no event of this season for it.
    expect((await teamProfile(3640))!.season).toBe(P);
    expect((await teamProfile(3640))!.stats).not.toBeNull();
    expect((await teamProfile(4215))!.season).toBe(S); // it played the meet: the current season
    expect(await robotsOf("/teams/3640")).toBeNull();
  });
});

describe("class B: a page with nothing on it yet", () => {
  it("answers 200 with a marked noindex (never a 404), keeps its own canonical", async () => {
    for (const p of ["/teams/7777", "/teams/8888", `/events/${S}/EMPTY`]) {
      const r = await renderPage(file, p);
      expect(r.status, p).toBe(200);
      expect(r.html).toContain('<meta name="robots" content="noindex" data-no-data />');
      expect(r.html).not.toContain("data-not-found");
      expect(await canonicalOf(p)).toBe(`${ORIGIN}${p}`);
    }
  });
  it("leaves the sitemap and IndexNow", async () => {
    const locs = (await sitemapEntries()).map((e) => e.loc);
    for (const p of ["/teams/7777", "/teams/8888", `/events/${S}/EMPTY`]) expect(locs).not.toContain(`${ORIGIN}${p}`);
    const sent = (await changedEvents({ t: "", season: 0, code: "" }, 100)).paths;
    expect(sent).toContain(`/events/${P}/PLAYED`);
    expect(sent).not.toContain(`/events/${S}/EMPTY`);
  });
  it("flips to indexed and into the sitemap on its own once its first data arrives", async () => {
    await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'EMPTY', 7777)", [S]);
    try {
      expect(await robotsOf("/teams/7777")).toBeNull();
      expect(await robotsOf(`/events/${S}/EMPTY`)).toBeNull();
      const locs = (await sitemapEntries()).map((e) => e.loc);
      expect(locs).toContain(`${ORIGIN}/teams/7777`);
      expect(locs).toContain(`${ORIGIN}/events/${S}/EMPTY`);
    } finally {
      await run("DELETE FROM event_teams WHERE season = ? AND code = 'EMPTY'", [S]);
    }
    expect(await robotsOf("/teams/7777")).toContain("data-no-data");
  });
});

describe("class C: an address with no page", () => {
  it("is a real 404 with noindex and no canonical", async () => {
    for (const p of ["/teams/31999", "/events/2025/NOPE", "/teams/1234567", "/events/2019/2019INMeet10"]) {
      const r = await renderPage(file, p);
      expect(r.status, p).toBe(404);
      expect(r.html).toContain('<meta name="robots" content="noindex" data-not-found />');
      expect(r.html).not.toContain('rel="canonical"');
    }
  });
  it("never enters the sitemap: an event code the page can't look up is left out, whatever it holds", async () => {
    expect(isReachableEventCode("USNJCMP")).toBe(true);
    for (const c of ["2019INMeet10", "USVTM(KO", "NL'HKO", "63693260770.2649", "X", "ABCDEFGHIJKLMNOPQRSTUVWXY"]) expect(isReachableEventCode(c), c).toBe(false);
    const locs = (await sitemapEntries()).map((e) => e.loc);
    expect(locs.some((l) => l.includes("2019INMeet10"))).toBe(false);
  });
});

describe("the sitemap", () => {
  it("lists every URL once, final and canonical: what each page names as its own canonical", async () => {
    const e = await sitemapEntries();
    const locs = e.map((x) => x.loc);
    expect(new Set(locs).size).toBe(locs.length);
    for (const l of locs) {
      expect(l.startsWith(`${ORIGIN}/`) && !l.includes("?") && !l.includes("#"), l).toBe(true);
      const path = l.slice(ORIGIN.length);
      if (/^\/(teams|events)\//.test(path)) expect(await canonicalOf(path), path).toBe(l);
    }
  });
  it("holds only the content pages whose first HTML is their content; never search, compare, records or a tool page", async () => {
    const locs = (await sitemapEntries()).map((e) => e.loc.slice(ORIGIN.length));
    for (const p of STATIC_PAGES) expect(locs).toContain(p);
    for (const p of ["/search", "/compare", "/records", "/support", "/supporters", "/teams", "/matches", "/predict", "/privacy", "/terms", "/my-team", "/scout"]) expect(locs, p).not.toContain(p);
  });
  it("the event list and the world rankings carry their content in the first HTML", async () => {
    const ev = await pageMeta("/events");
    expect(ev.bodyHtml).toContain(`<a href="/events/${S}/LGM1">League meet</a>`);
    expect(ev.bodyHtml).not.toContain("/EMPTY"); // no teams, no matches
    expect(ev.bodyHtml).not.toContain("/SOON"); // not within two weeks
    const rk = await pageMeta("/rankings");
    expect(rk.bodyHtml).toContain("<p>");
  });
});

describe("robots.txt", () => {
  it("keeps /api/ out but for the public reads the content pages draw from, and names the sitemap", () => {
    const robots = readFileSync(join(process.cwd(), "public", "robots.txt"), "utf8");
    expect(robots.match(/^Disallow: .*$/gm)).toEqual(["Disallow: /api/"]);
    expect(robots.match(/^Allow: .*$/gm)).toEqual(["Allow: /", "Allow: /api/teams/", "Allow: /api/events/", "Allow: /api/rankings", "Allow: /api/teams-summary", "Allow: /api/power-rankings"]);
    expect(robots).toContain("Sitemap: https://controlscout.org/sitemap.xml");
  });
});
