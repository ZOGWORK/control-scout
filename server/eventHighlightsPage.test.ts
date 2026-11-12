// /events/<season>/<code>/highlights: Search's "<event> highlights" answer at its own address. One rule for the page,
// the event page's link, the first HTML and the sitemap: only an event with a page to index and a match to pick from
// has one.
import type { AddressInfo } from "node:net";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { migrate, openDb, run, setDb } from "./db";
import { eventHighlightsLastmods, eventHighlightsPage, hasEventHighlights } from "./eventHighlightsPage";
import { pageMeta, headTags } from "./seoMeta";
import { buildSitemap, resetSitemapCache, sitemapEntries } from "./sitemap";

beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name) VALUES (4215, 'Hypnotic Robotics'), (7149, 'Partner'), (8000, 'Rival A'), (8001, 'Rival B')");
  const ev = (season: number, code: string, name: string, type: string, date: string, extra: { remote?: number; division?: string; updated?: string } = {}) =>
    run("INSERT INTO events (season, code, name, start, end, city, state, remote, hybrid, source, type, division_code, upstream_updated) VALUES (?, ?, ?, ?, ?, 'Edison', 'NJ', ?, 0, 't', ?, ?, ?)",
      [season, code, name, date, date, extra.remote ?? 0, type, extra.division ?? null, extra.updated ?? null]);
  await ev(2025, "USNJNOM3", "North Meet 3", "LeagueMeet", "2025-11-08", { updated: "2025-11-20T09:00:00Z" });
  await ev(2025, "SCRIM", "Fall Scrimmage", "Scrimmage", "2025-10-04");
  await ev(2025, "CMP", "State Championship", "Championship", "2026-02-21");
  await ev(2025, "CMPD1", "State Championship Division 1", "Championship", "2026-02-21", { division: "CMP" });
  await ev(2025, "EMPTY", "Registered Only", "Qualifier", "2026-03-07");
  await ev(2025, "REMOTE", "Remote Meet", "Qualifier", "2025-12-06", { remote: 1 });
  await ev(2025, "NOTOTAL", "Half Reported", "Qualifier", "2025-12-13");
  await run("INSERT INTO event_teams (season, code, team, qual_played) VALUES (2025, 'USNJNOM3', 4215, 2), (2025, 'USNJNOM3', 7149, 2), (2025, 'USNJNOM3', 8000, 2), (2025, 'USNJNOM3', 8001, 2), (2025, 'EMPTY', 4215, 0), (2025, 'CMP', 4215, 0)");
  const match = async (code: string, n: number, red: [number, number], blue: [number, number], date: string) => {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, time, red_total, blue_total, red_np, blue_np, red_auto, blue_auto, source) VALUES (2025, ?, 'qual', 0, ?, ?, 1, ?, ?, ?, ?, ?, 20, 10, 't')",
      [code, n, `Q${n}`, date, red[0], blue[0], red[1], blue[1]]);
    for (const [t, side] of [[4215, "red"], [7149, "red"], [8000, "blue"], [8001, "blue"]]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1)", [code, n, t, side]);
    }
  };
  await match("USNJNOM3", 1, [120, 110], [80, 80], "2025-11-08T10:00:00Z");
  await match("USNJNOM3", 2, [60, 60], [90, 85], "2025-11-08T11:00:00Z");
  await match("SCRIM", 1, [70, 70], [50, 50], "2025-10-04T10:00:00Z");
  // The championship's matches are its division's: the main event's page reads them, as Search does.
  await match("CMPD1", 1, [200, 190], [150, 150], "2026-02-21T10:00:00Z");
  await match("REMOTE", 1, [99, 99], [10, 10], "2025-12-06T10:00:00Z");
  // Played, both scores without penalties in, but a final total still missing: Search's highlights never read it
  // (matchFind.ts where), so the event has no page, no button and no sitemap entry.
  await run("INSERT INTO event_teams (season, code, team, qual_played) VALUES (2025, 'NOTOTAL', 4215, 1)");
  await match("NOTOTAL", 1, [88, 88], [40, 40], "2025-12-13T10:00:00Z");
  await run("UPDATE matches SET blue_total = NULL WHERE season = 2025 AND code = 'NOTOTAL'");
  resetSitemapCache();
});

describe("event highlights page", () => {
  it("is Search's highlights answer, whole, in the first HTML, with its own title, description and canonical", async () => {
    const page = await eventHighlightsPage(2025, "USNJNOM3");
    expect(page?.stat.intent).toBe("scope-highlights");
    expect(page?.stat.title).toBe("Highlights at North Meet 3, 2025–26");
    const m = await pageMeta("/events/2025/usnjnom3/highlights");
    expect(m.notFound).toBeUndefined();
    expect(m.noindex).toBeUndefined();
    expect(m.title).toBe("North Meet 3 highlights, 2025–26");
    expect(m.description).toContain("The standout FTC matches of North Meet 3 (2025–26): best score without penalties, 110 points, in Q1");
    const head = headTags("/events/2025/USNJNOM3/highlights", m);
    expect(head).toContain('<link rel="canonical" href="https://controlscout.org/events/2025/USNJNOM3/highlights" />');
    expect(head).not.toContain("noindex");
    const body = m.bodyHtml!;
    expect(body).toContain('<a href="/events/2025/USNJNOM3?match=qual:0:1">Q1</a>');
    expect(body).toContain("Won 120–80 (110 without penalties)");
    expect(body).toContain('<a href="/teams/7149');
    expect(body).toContain('<a href="/events/2025/USNJNOM3">North Meet 3: event page</a>'); // links back
    // The page's data, keyed as the page asks: by the address's own spelling.
    expect(Object.keys(m.pageData ?? {})).toEqual(["/api/events/2025/usnjnom3/highlights"]);
    const padded = await pageMeta("/events/02025/USNJNOM3/highlights");
    expect(padded.path).toBe("/events/2025/USNJNOM3/highlights");
    expect(Object.keys(padded.pageData ?? {})).toEqual(["/api/events/02025/USNJNOM3/highlights"]);
  });

  it("an event read through its divisions, and an off-season event, have one too", async () => {
    expect((await eventHighlightsPage(2025, "CMP"))?.stat.headline?.value).toBe("190 points");
    expect((await eventHighlightsPage(2025, "CMPD1"))?.stat.headline?.value).toBe("190 points");
    expect((await eventHighlightsPage(2025, "SCRIM"))?.stat.headline?.value).toBe("70 points");
  });

  it("is not found for an event with no match to pick from, a remote one, or no event at all", async () => {
    for (const code of ["EMPTY", "REMOTE", "NOTOTAL", "NOPE"]) {
      expect(await eventHighlightsPage(2025, code)).toBeNull();
      expect((await pageMeta(`/events/2025/${code}/highlights`)).notFound).toBe(true);
    }
  });

  it("its API takes the code in any case, as every event address does (api.param resolves the stored code)", async () => {
    const server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const lower = await fetch(`${base}/api/events/2025/usnjnom3/highlights`);
      expect(lower.status).toBe(200);
      expect(((await lower.json()) as { event: { code: string } }).event.code).toBe("USNJNOM3");
      expect((await fetch(`${base}/api/events/2025/empty/highlights`)).status).toBe(404);
    } finally { await new Promise((r) => server.close(r)); }
  });

  it("the event page links to it only when it exists", async () => {
    expect(await hasEventHighlights(2025, "USNJNOM3")).toBe(true);
    expect(await hasEventHighlights(2025, "EMPTY")).toBe(false);
    expect(await hasEventHighlights(2025, "REMOTE")).toBe(false);
    expect(await hasEventHighlights(2025, "NOTOTAL")).toBe(false);
  });

  it("the sitemap lists each exactly once, with the day its matches last changed", async () => {
    const hs = await eventHighlightsLastmods();
    expect(hs.map((h) => h.code).sort()).toEqual(["CMP", "CMPD1", "SCRIM", "USNJNOM3"]);
    // The source's change marker (Nov 20) is later than the matches (Nov 8).
    expect(hs.find((h) => h.code === "USNJNOM3")?.lastmod).toBe("2025-11-20");
    expect(hs.find((h) => h.code === "CMP")?.lastmod).toBe("2026-02-21");
    const e = await sitemapEntries();
    const locs = e.map((x) => x.loc);
    expect(locs.filter((l) => l === "https://controlscout.org/events/2025/USNJNOM3/highlights")).toHaveLength(1);
    expect(locs).not.toContain("https://controlscout.org/events/2025/EMPTY/highlights");
    expect(locs).not.toContain("https://controlscout.org/events/2025/REMOTE/highlights");
    expect(locs).not.toContain("https://controlscout.org/events/2025/NOTOTAL/highlights");
    expect(new Set(locs).size).toBe(locs.length);
    expect(buildSitemap(e).main).toContain("<url><loc>https://controlscout.org/events/2025/USNJNOM3/highlights</loc><lastmod>2025-11-20</lastmod></url>");
  });
});
