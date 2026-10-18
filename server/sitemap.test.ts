// sitemap.xml from the database: public pages, every team and event, apex URLs,
// no personal pages; split into an index past the limit.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { buildSitemap, resetSitemapCache, sitemapEntries } from "./sitemap";

beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, updated_at) VALUES (4215, 'Hypnotic Robotics', '2026-10-01T10:00:00Z'), (18360, 'X', NULL)");
  await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source, upstream_updated) VALUES (2025, 'USNJNOM3', 'Meet', '2025-11-08', '2025-11-08', 0, 0, 't', '2025-12-02T09:00:00Z'), (2026, 'FUTURE', 'Later', '2099-01-01', '2099-01-02', 0, 0, 't', NULL), (2019, '2019ALCMP', 'Alabama (history-only season)', '2020-02-21', '2020-02-22', 0, 0, 't', NULL)");
  resetSitemapCache();
});

describe("sitemap", () => {
  it("lists public pages, teams and events at apex URLs with lastmod; never personal pages or /api", async () => {
    const e = await sitemapEntries();
    const locs = e.map((x) => x.loc);
    expect(locs).toContain("https://controlscout.org/");
    expect(locs).toContain("https://controlscout.org/teams/4215");
    expect(locs).toContain("https://controlscout.org/privacy");
    expect(locs).toContain("https://controlscout.org/terms");
    expect(locs).toContain("https://controlscout.org/contact");
    expect(locs).toContain("https://controlscout.org/faq");
    expect(locs).toContain("https://controlscout.org/rankings");
    expect(locs).toContain("https://controlscout.org/events/2025/USNJNOM3");
    expect(locs).toContain("https://controlscout.org/events/2019/2019ALCMP"); // legacy seasons are browsable pages too
    expect(locs.some((l) => /\/(my-team|shortlist|scout|settings|api)(\/|$)/.test(l))).toBe(false);
    expect(locs.every((l) => l.startsWith("https://controlscout.org/") && !l.includes("www."))).toBe(true);
    expect(e.find((x) => x.loc.endsWith("/teams/4215"))!.lastmod).toBe("2026-10-01");
    // The source's change marker (late results move it past the event's last day); none when unknown.
    expect(e.find((x) => x.loc.endsWith("/events/2025/USNJNOM3"))!.lastmod).toBe("2025-12-02");
    expect(e.find((x) => x.loc.endsWith("/events/2026/FUTURE"))!.lastmod).toBeUndefined();
    const { main, chunks } = buildSitemap(e);
    expect(chunks).toHaveLength(0);
    expect(main).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    expect(main).toContain("<url><loc>https://controlscout.org/teams/4215</loc><lastmod>2026-10-01</lastmod></url>");
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
    for (const p of ["/missing.webmanifest", "/x.png", "/a/b.xml", "/robots.txt"]) expect(MISSING_FILE.test(p)).toBe(true);
    for (const p of ["/teams/4215", "/events/2025/USNJNOM3", "/"]) expect(MISSING_FILE.test(p)).toBe(false);
  });
});
