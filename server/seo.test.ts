// One host, one URL per page: www/alias hosts 301 to the apex with path and
// query kept; trailing slashes and /team/… aliases 301; /api is never touched;
// the HTML carries the canonical link.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { canonicalRedirects, canonicalUrl, renderIndex, renderPage } from "./seo";
import { fitDescription } from "./seoMeta";
import { migrate, openDb, run, setDb } from "./db";
import { BOOT_CONSENT_ID } from "../src/shared/boot";
import { clearAllCaches } from "./caches";

let server: Server;
let port = 0;
const saved = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL };
beforeAll(async () => {
  Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://controlscout.org" });
  const app = express();
  app.set("trust proxy", 1);
  app.use(canonicalRedirects);
  app.get("/api/health", (_q, r) => { r.json({ ok: true }); });
  app.get(/.*/, (_q, r) => { r.send("app"); });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server?.close();
  // Restore exactly: a variable that was unset is deleted (assigning undefined would store "undefined").
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const get = (path: string, host: string) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", headers: { "X-Forwarded-Host": host, Host: host } });

describe("canonical redirects", () => {
  it("www and alias hosts → the apex, path and query kept", async () => {
    for (const host of ["www.controlscout.org", "scout.tryctrlpoint.org", "something.onrender.com"]) {
      const r = await get("/teams/4215?season=2024", host);
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("https://controlscout.org/teams/4215?season=2024");
    }
  });
  it("aliases and trailing slashes → the real path, in one hop (even from www)", async () => {
    expect((await get("/team/4215", "controlscout.org")).headers.get("location")).toBe("https://controlscout.org/teams/4215");
    expect((await get("/teams/4215/", "controlscout.org")).headers.get("location")).toBe("https://controlscout.org/teams/4215");
    expect((await get("/event/2025/USNJNOM3?tab=matches", "controlscout.org")).headers.get("location")).toBe("https://controlscout.org/events/2025/USNJNOM3?tab=matches");
    expect((await get("/index.html", "controlscout.org")).headers.get("location")).toBe("https://controlscout.org/");
    expect((await get("/team/4215/", "www.controlscout.org")).headers.get("location")).toBe("https://controlscout.org/teams/4215");
  });
  it("How it works has one URL: its old Predict addresses 301 to /methodology (the track record to its section)", async () => {
    for (const host of ["controlscout.org", "127.0.0.1", "www.controlscout.org"]) {
      for (const [from, to] of [
        ["/predict/how-it-works", "https://controlscout.org/methodology"],
        ["/predict/how-it-works/", "https://controlscout.org/methodology"],
        ["/Predict/How-It-Works", "https://controlscout.org/methodology"],
        ["/predict/accuracy", "https://controlscout.org/methodology#accuracy"],
        ["/predict/accuracy/?season=2025", "https://controlscout.org/methodology?season=2025#accuracy"],
      ]) {
        const r = await get(from, host);
        expect(r.status, `${host}${from}`).toBe(301);
        expect(r.headers.get("location")).toBe(to);
      }
    }
    expect((await get("/methodology", "controlscout.org")).status).toBe(200);
    expect((await get("/predict", "controlscout.org")).status).toBe(200);
  });
  it("never redirects off the site (//host paths collapse; every redirect is absolute on the apex)", async () => {
    for (const p of ["//attacker.example/foo/", "///attacker.example/foo", "//attacker.example"]) {
      const loc = (await get(p, "controlscout.org")).headers.get("location")!;
      expect(new URL(loc).origin).toBe("https://controlscout.org");
      expect(loc.startsWith("https://controlscout.org/attacker.example")).toBe(true);
    }
  });
  it("a backup host whose APP_URL is its own address: served, canonical to the apex, noindex", async () => {
    process.env.APP_URL = "https://control-scout.onrender.com";
    try {
      const r = await get("/teams/4215", "control-scout.onrender.com");
      expect(r.status).toBe(200);
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
      expect(canonicalUrl("/teams/4215")).toBe("https://controlscout.org/teams/4215");
      expect((await get("/teams/4215", "127.0.0.1")).headers.get("x-robots-tag")).toBeNull();
    } finally { process.env.APP_URL = "https://controlscout.org"; }
    expect((await get("/teams/4215", "controlscout.org")).headers.get("x-robots-tag")).toBeNull();
  });
  it("leaves the apex, the root, loopback and /api alone", async () => {
    expect((await get("/teams/4215", "controlscout.org")).status).toBe(200);
    expect((await get("/", "controlscout.org")).status).toBe(200);
    expect((await get("/teams/4215", "127.0.0.1")).status).toBe(200);
    expect((await get("/api/health", "www.controlscout.org")).status).toBe(200);
  });
});

describe("page head in the first HTML", () => {
  // Each test gets its own freshly seeded database, so any one can run alone.
  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA')");
    await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, matches, wins, losses, ties) VALUES (2025, 4215, 101.64, 616, 8375, 32, 26, 6, 0)");
    await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, remote, hybrid, source) VALUES (2025, 'USNJNOM3', 'P1-4 PM Northern League Meet', 'LeagueMeet', 'Don Bosco Prep', 'Ramsey', 'NJ', 'USA', '2025-11-08', '2025-11-08', 0, 0, 'test')");
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, remote, hybrid, source) VALUES (2025, 'REMOTE1', 'Remote League', 'LeagueMeet', 'Columbus', 'OH', 'USA', '2025-11-08', '2025-11-08', 1, 0, 'test')");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'USNJNOM3', 'qual', 0, 1, 'Q1', 0, 'test')");
  });

  it("team and event pages get their own title, description (120–160), canonical, OG and Twitter tags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head><title>FTC Control Scout — free</title>\n<meta name="description" content="generic" />\n<meta property="og:title" content="generic" />\n</head><body></body></html>');

    const team = await renderIndex(file, "/teams/4215");
    expect(team).toContain("<title>4215 Hypnotic Robotics — FTC team stats, OPR &amp; predictions · Control Scout</title>");
    expect(team).toContain('<link rel="canonical" href="https://controlscout.org/teams/4215" />');
    expect(team).toContain('<meta property="og:url" content="https://controlscout.org/teams/4215" />');
    expect(team).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(team).toContain('<meta property="og:image" content="https://controlscout.org/og-image.png" />');
    expect(team).not.toContain("generic"); // the template's own tags are replaced, not duplicated
    expect(team.match(/<title>/g)).toHaveLength(1);
    const desc = /<meta name="description" content="([^"]*)"/.exec(team)![1];
    expect(desc).toContain("OPR 101.6 (#616 of 8,375)");
    expect(desc.length).toBeGreaterThanOrEqual(120);
    expect(desc.length).toBeLessThanOrEqual(160);

    // Event codes are case-insensitive: a lowercase link gets the event's own preview, with the canonical code.
    const lower = await renderIndex(file, "/events/2025/usnjnom3");
    expect(lower).toContain("<title>P1-4 PM Northern League Meet (2025–26) · Control Scout</title>");
    expect(lower).toContain('<link rel="canonical" href="https://controlscout.org/events/2025/USNJNOM3" />');
    const ev = await renderIndex(file, "/events/2025/USNJNOM3");
    expect(ev).toContain("<title>P1-4 PM Northern League Meet (2025–26) · Control Scout</title>");
    expect(/<meta name="description" content="([^"]*)"/.exec(ev)![1]).toContain("Nov 8, 2025");

    const home = await renderIndex(file, "/");
    expect(home).toContain("<title>Control Scout — free FTC scouting &amp; predictions</title>");
    expect(/<meta name="description" content="([^"]*)"/.exec(home)![1]).not.toBe(desc);
    // Policy pages: their own title and a fitted description, indexable.
    const privacy = await renderIndex(file, "/privacy");
    expect(privacy).toContain("<title>Privacy policy · Control Scout</title>");
    expect(privacy).toContain('<link rel="canonical" href="https://controlscout.org/privacy" />');
    expect(privacy).not.toContain("noindex");
    const pdesc = /<meta name="description" content="([^"]*)"/.exec(privacy)![1];
    expect(pdesc.length).toBeGreaterThanOrEqual(120);
    expect(pdesc.length).toBeLessThanOrEqual(160);
    const terms = await renderIndex(file, "/terms");
    expect(terms).toContain("<title>Terms of use · Control Scout</title>");
    expect(terms).toContain('<link rel="canonical" href="https://controlscout.org/terms" />');
    expect(terms).not.toContain("noindex");
    const tdesc = /<meta name="description" content="([^"]*)"/.exec(terms)![1];
    expect(tdesc.length).toBeGreaterThanOrEqual(120);
    expect(tdesc.length).toBeLessThanOrEqual(160);
    expect(await renderIndex(file, "/contact")).toContain("<title>Contact · Control Scout</title>");
    // Personal pages: noindex.
    expect(await renderIndex(file, "/my-team")).toContain('<meta name="robots" content="noindex" />');
  });

  it("/rankings: its own title and description (the #1 team named), a canonical that keeps the view, an ItemList, and the title in the first paint", async () => {
    clearAllCaches(); // the ranking is cached per data version, and each test here has a fresh database
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-rk-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head><title>x</title></head><body><div id="root"></div></body></html>');
    await run("INSERT INTO teams (number, name, state, country) VALUES (18360, 'Zeta', 'TX', 'USA')");
    await run("UPDATE team_season_stats SET rating_np = 120.44, rating_matches = 9 WHERE season = 2025 AND team = 4215");
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_matches) VALUES (2025, 18360, 99.5, 6)");
    await run("INSERT INTO ranking_weeks (season, week, teams, taken_at) VALUES (2025, '2026-02-16', 2, 'x')");

    const page = await renderPage(file, "/rankings");
    expect(page.status).toBe(200);
    const html = page.html;
    // No rated team yet in the newest season: it opens on the latest season with ratings.
    expect(html).toContain("<title>FTC world rankings 2025–26 · Control Scout</title>");
    const desc = /<meta name="description" content="([^"]*)"/.exec(html)![1];
    expect(desc).toContain("#1: 4215 Hypnotic Robotics (120.4)");
    expect(desc.length).toBeGreaterThanOrEqual(120);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc).not.toMatch(/ftc ?scout/i);
    expect(html).toContain('<link rel="canonical" href="https://controlscout.org/rankings" />');
    expect(html).toContain('<h1>FTC world rankings 2025–26</h1>'); // the static first paint
    const [list] = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(list).toMatchObject({ "@type": "ItemList", numberOfItems: 2, url: "https://controlscout.org/rankings" });
    expect(list.itemListElement[1]).toEqual({ "@type": "ListItem", position: 2, name: "18360 Zeta", url: "https://controlscout.org/teams/18360" });

    // A region, a season, a week and a page are each their own list: kept in the canonical URL.
    const tx = await renderIndex(file, "/rankings", { region: "USA:TX", season: "2025", week: "2026-02-16" });
    expect(tx).toContain("<title>FTC rankings: Texas 2025–26, week of Feb 16, 2026 · Control Scout</title>");
    expect(tx).toContain('<link rel="canonical" href="https://controlscout.org/rankings?season=2025&amp;region=USA%3ATX&amp;week=2026-02-16" />');
    // Parameters the API would refuse are dropped, never a 404 (the app shows its own message).
    const odd = await renderPage(file, "/rankings", { region: "<x>", season: "1999", week: "2026-02-17", page: "-3" });
    expect(odd.status).toBe(200);
    expect(odd.html).toContain('<link rel="canonical" href="https://controlscout.org/rankings" />');
    expect(odd.html).not.toContain("<x>");
  });

  it("JSON-LD: WebSite + Organization on home, SportsTeam and SportsEvent on their pages, URLs = canonical, script-safe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-ld-"));
    const file = join(dir, "index.html");
    writeFileSync(file, "<html><head></head><body></body></html>");
    const ld = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const home = ld(await renderIndex(file, "/"));
    expect(home.map((x) => x["@type"]).sort()).toEqual(["Organization", "WebSite"]);
    expect(home.find((x) => x["@type"] === "Organization").logo).toBe("https://controlscout.org/logo-512.png");
    const [profile, crumbs] = ld(await renderIndex(file, "/teams/4215"));
    expect(profile).toMatchObject({ "@type": "ProfilePage", url: "https://controlscout.org/teams/4215", isPartOf: { "@id": "https://controlscout.org/#website" } });
    expect(profile.mainEntity).toMatchObject({ "@type": "SportsTeam", name: "Hypnotic Robotics", identifier: "4215", url: "https://controlscout.org/teams/4215", location: { address: { addressLocality: "Oradell", addressRegion: "NJ" } } });
    expect(crumbs).toMatchObject({ "@type": "BreadcrumbList" });
    expect(crumbs.itemListElement.map((x: { name: string; item: string }) => [x.name, x.item])).toEqual([
      ["Home", "https://controlscout.org/"], ["Teams", "https://controlscout.org/teams"], ["4215 Hypnotic Robotics", "https://controlscout.org/teams/4215"]]);
    const [ev] = ld(await renderIndex(file, "/events/2025/USNJNOM3"));
    expect(ev.image).toEqual(["https://controlscout.org/og-image.png"]);
    expect(ev).toMatchObject({ "@type": "SportsEvent", name: "P1-4 PM Northern League Meet", startDate: "2025-11-08", url: "https://controlscout.org/events/2025/USNJNOM3", location: { name: "Don Bosco Prep" } });
    // A name containing </script> can't break out of the tag.
    await run("UPDATE teams SET name = 'Evil</script><script>alert(1)</script>' WHERE number = 4215");
    const evil = await renderIndex(file, "/teams/4215");
    expect(evil).not.toContain("</script><script>alert(1)");
    expect(ld(evil)[0].mainEntity.name).toBe("Evil</script><script>alert(1)</script>");
    expect(evil).not.toContain("<script>alert(1)"); // nor out of the first paint's words
    expect(ld(await renderIndex(file, "/predict"))).toHaveLength(0);
    // Replacement patterns in a name ($', $`, $&) are inserted literally, never expanded.
    await run("UPDATE teams SET name = 'Dollar $'' Bot $` $& end' WHERE number = 4215");
    const dollar = await renderIndex(file, "/teams/4215");
    expect(ld(dollar)[0].mainEntity.name).toBe("Dollar $' Bot $` $& end");
    expect(dollar.match(/<\/head>/g)).toHaveLength(1);
    // An unknown team gets fallback meta but no structured data; a zero-padded number has one canonical URL.
    expect(ld(await renderIndex(file, "/teams/999998"))).toHaveLength(0);
    const padded = await renderIndex(file, "/teams/004215");
    expect(padded).toContain('<link rel="canonical" href="https://controlscout.org/teams/4215" />');
    expect(ld(padded)[0].mainEntity.url).toBe("https://controlscout.org/teams/4215");
    // Attendance mode follows the event's remote/hybrid flags.
    expect(ld(await renderIndex(file, "/events/2025/REMOTE1"))[0].eventAttendanceMode).toBe("https://schema.org/OnlineEventAttendanceMode");
    expect(ld(await renderIndex(file, "/events/2025/USNJNOM3"))[0].eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
  });

  it("a team page's first paint: its number and name as the h1, a summary from real data, its events as links; sameAs and rookie year in the data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-team-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head></head><body><div id="root"></div></body></html>');
    await run("UPDATE teams SET rookie_year = 2008, website = 'www.hypnoticrobotics.org', school = 'Bergen County & Co' WHERE number = 4215");
    // FIRST's row for a league meet is the league's running standing (rank 1, 10-0-0 here): the meet's own rank
    // (team_event_records) and its record from the matches (one scored win) show instead.
    await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties) VALUES (2025, 'USNJNOM3', 4215, 1, 10, 0, 0)");
    await run("INSERT INTO team_event_records (season, code, team, rank) VALUES (2025, 'USNJNOM3', 4215, 3)");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJNOM3', 'qual', 0, 2, 'Q2', 1, 100, 100, 50, 50, 'test')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, 'USNJNOM3', 'qual', 0, 2, 4215, 'red')");
    // On a league meet's roster with results in, but never on the field: not one of its events.
    await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source) VALUES (2025, 'NOSHOW', 'Skipped Meet', '2026-01-10', '2026-01-10', 0, 0, 'test')");
    await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'NOSHOW', 4215)");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'NOSHOW', 'qual', 0, 1, 'Q1', 1, 'test')");
    const html = await renderIndex(file, "/teams/4215");
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("<h1>4215 Hypnotic Robotics</h1>");
    expect(html).toContain("FTC team 4215 Hypnotic Robotics from Oradell, NJ (Bergen County &amp; Co), rookie year 2008. 2025–26: record 26-6-0, OPR 101.6 (#616 of 8,375).");
    expect(html).toContain('<a href="/events/2025/USNJNOM3">P1-4 PM Northern League Meet</a> <small>2025–26 · Nov 8, 2025 · ranked 3 · 1-0-0</small>');
    expect(html).not.toContain("Skipped Meet");
    const desc = /<meta name="description" content="([^"]*)"/.exec(html)![1];
    expect(desc).toContain("rookie year 2008");
    expect(desc.length).toBeLessThanOrEqual(160);
    const team = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]).mainEntity;
    expect(team.sameAs).toEqual(["https://www.hypnoticrobotics.org/", "https://ftc-events.firstinspires.org/2025/team/4215"]);
    expect(team).toMatchObject({ foundingDate: "2008", affiliation: { name: "Bergen County & Co" } });
    // A season parameter is the same page: one canonical, no ?season= duplicate.
    expect(await renderIndex(file, "/teams/4215", { season: "2024" })).toContain('<link rel="canonical" href="https://controlscout.org/teams/4215" />');
  });

  it("teamWebsite: an absolute http(s) URL or nothing", async () => {
    const { teamWebsite } = await import("./seoMeta");
    expect(teamWebsite("www.team.org")).toBe("https://www.team.org/");
    expect(teamWebsite("http://team.org/x")).toBe("http://team.org/x");
    for (const bad of [null, "", "  ", "none", "javascript:alert(1)", "ftp://team.org"]) expect(teamWebsite(bad)).toBeNull();
  });

  it("HTTP 404 (app HTML, noindex, no canonical) for unknown routes, teams and events; 200 for every app route", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-404-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head></head><body><div id="root"></div></body></html>');
    for (const p of ["/this-page-does-not-exist", "/privacy-policy", "/teams/999999", "/teams/0", "/teams/0000000", "/teams/abc", "/teams/0x10", "/teams/1234567", `/teams/${"9".repeat(400)}`, "/teams/4215/extra",
      "/events/2025/NOPE", "/events/2019/USNJNOM3", "/events/abc/USNJNOM3", "/events/0x7E9/USNJNOM3", `/events/${"9".repeat(400)}/USNJNOM3`,"/events/2025/a%20b", "/events/2025", "/teams/%E0%A4%A", "/teams%2F4215",
      "/events/2025/USNJNOM3/match/qual:0:99", "/events/2025/USNJNOM3/match/final", "/events/2025/NOPE/match/qual:0:1", "/events/2025/USNJNOM3/match/qual:0:1/x"]) {
      const page = await renderPage(file, p);
      expect(page.status, p).toBe(404);
      expect(page.html, p).toContain('<div id="root">'); // the app renders its own not-found page
      // Marked, so the app drops it on moving to a real page.
      expect(page.html, p).toContain('<meta name="robots" content="noindex" data-not-found />');
      expect(page.html, p).not.toContain('rel="canonical"');
      expect(page.html, p).toContain("<title>Page not found · Control Scout</title>");
    }
    // Every route in the app's router (src/main.tsx) is a 200, in any case; known teams and events too.
    const main = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");
    // Except /owner: the owner portal is a 404 for every visitor on the server (it can't tell the owner from a
    // page load), and the app draws the portal only for the owner. Tested below.
    const routes = [...main.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== "*" && !r.includes(":") && r !== "/owner");
    for (const p of ["/owner", "/Owner", "/owner/"]) {
      const page = await renderPage(file, p);
      expect(page.status, p).toBe(404);
      expect(page.html, p).toContain("<title>Page not found · Control Scout</title>");
      expect(page.html, p).not.toMatch(/owner portal/i);
    }
    expect(routes.length).toBeGreaterThan(10);
    for (const p of [...routes, "/Teams", "/teams/4215", "/teams/004215", "/teams/0004215", `/teams/${"0".repeat(40)}4215`, "/teams/%34%32%31%35", "/%74eams", "/events/2025/%55SNJNOM3", "/events/02025/USNJNOM3","/events/2025/USNJNOM3", "/events/2025/usnjnom3", "/events/2025/USNJNOM3/match/qual:0:1", "/events/2025/usnjnom3/match/QUAL%3A0%3A1", "/events/2025/USNJNOM3/match/qual:0:01"]) {
      const page = await renderPage(file, p);
      expect(page.status, p).toBe(200);
      expect(page.html, p).toContain('rel="canonical"');
    }
    // A match's scouting report: titled for a shared link, not indexed (v1.6 Task 2).
    const rep = (await renderPage(file, "/events/2025/USNJNOM3/match/qual:0:1")).html;
    expect(rep).toContain("<title>Q1 at P1-4 PM Northern League Meet: know your match · Control Scout</title>");
    expect(rep).toContain('<meta name="robots" content="noindex" />');
    // Any spelling of the key previews under the one address the app opens.
    expect((await renderPage(file, "/events/2025/usnjnom3/match/QUAL:0:01")).html).toContain('<link rel="canonical" href="https://controlscout.org/events/2025/USNJNOM3/match/qual:0:1" />');
    // The pit display: titled for the event, its canonical the event page, and no noindex (it would stick to
    // the event page after "Back to event": the app keeps no per-page robots tag in step). Unknown event: 404.
    const pit = await renderPage(file, "/events/2025/usnjnom3/display");
    expect(pit.status).toBe(200);
    expect(pit.html).toContain("<title>Pit display: ");
    expect(pit.html).toContain('<link rel="canonical" href="https://controlscout.org/events/2025/USNJNOM3" />');
    expect(pit.html).not.toContain('name="robots"');
    expect(pit.html).not.toContain(`id="${BOOT_CONSENT_ID}"`); // no privacy banner over a pit TV
    expect((await renderPage(file, "/events/2025/NOPE/display")).status).toBe(404);
    // The legal and contact pages are never a 404.
    for (const p of ["/privacy", "/terms", "/contact", "/Privacy"]) {
      const page = await renderPage(file, p);
      expect(page.status, p).toBe(200);
      expect(page.html, p).not.toContain("data-not-found");
    }
    // A team with results but no profile row is a real page (the team API serves it too).
    await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties) VALUES (2025, 77777, 5, 3, 2, 0)");
    expect((await renderPage(file, "/teams/77777")).status).toBe(200);
  });

  it("never a 404 when the database can't answer (the page may exist)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-db-"));
    const file = join(dir, "index.html");
    writeFileSync(file, "<html><head></head><body></body></html>");
    setDb(openDb(":memory:")); // no tables: every query throws
    expect((await renderPage(file, "/teams/999999")).status).toBe(200);
    expect((await renderPage(file, "/events/2025/NOPE")).status).toBe(200);
  });

  it("fits descriptions to 120–160 characters", () => {
    const short = fitDescription("Short.");
    expect(short.length).toBeGreaterThanOrEqual(120);
    expect(short.length).toBeLessThanOrEqual(160);
    const long = fitDescription("word ".repeat(80));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
    expect(canonicalUrl("/teams/4215/")).toBe("https://controlscout.org/teams/4215");
  });
});

describe("/faq", () => {
  it("has its own title, FAQPage structured data with every question, and the questions in the first paint", async () => {
    const { FAQ_ITEMS } = await import("../src/shared/faq");
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-faq-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head><title>x</title></head><body><div id="root"></div></body></html>');
    const page = await renderPage(file, "/faq");
    expect(page.status).toBe(200);
    expect(page.html).toContain("<title>FAQ: your questions answered · Control Scout</title>");
    const ld = [...page.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const faq = ld.find((x) => x["@type"] === "FAQPage");
    expect(faq.mainEntity).toHaveLength(FAQ_ITEMS.length);
    expect(faq.url).toBe("https://controlscout.org/faq");
    // The first paint carries the questions themselves (crawlers and previews read them without the app).
    expect(page.html).toContain("<h3>Do I need an account?</h3>");
    expect(page.html).not.toMatch(/\]\(\//);
  });
});

describe("the site's name for search engines", () => {
  const ld = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  let file = "";
  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA')");
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, remote, hybrid, source) VALUES (2025, 'USNJNOM3', 'Northern League Meet', 'LeagueMeet', 'Ramsey', 'NJ', 'USA', '2025-11-08', '2025-11-08', 0, 0, 'test')");
    file = join(mkdtempSync(join(tmpdir(), "cs-seo-name-")), "index.html");
    writeFileSync(file, readFileSync(join(process.cwd(), "index.html"), "utf8"));
  });

  it("home: WebSite (name, alternate name, a SearchAction the home page answers) and Organization (logo, sameAs)", async () => {
    const home = ld(await renderIndex(file, "/"));
    const site = home.find((x) => x["@type"] === "WebSite");
    expect(site).toMatchObject({ name: "Control Scout", alternateName: "FTC Control Scout", url: "https://controlscout.org/" });
    expect(site.potentialAction).toEqual({
      "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: "https://controlscout.org/?q={search_term_string}" }, "query-input": "required name=search_term_string",
    });
    const org = home.find((x) => x["@type"] === "Organization");
    expect(org).toMatchObject({ name: "Control Scout", url: "https://controlscout.org/", logo: "https://controlscout.org/logo-512.png" });
    expect(org.sameAs).toContain("https://tryctrlpoint.org");
    expect(site.publisher).toEqual({ "@id": org["@id"] });
  });

  it("home first paint says plainly what Control Scout is, in crawlable text", async () => {
    const html = await renderIndex(file, "/");
    const root = html.slice(html.indexOf('<div id="root">'));
    expect(root).toMatch(/<p[^>]*>Control Scout is free FTC scouting and match predictions[^<]*<\/p>/);
    expect(html).not.toMatch(/ftc ?scout(?!ing)/i);
  });

  it("every page's <title> and og:site_name name the site the same way", async () => {
    const paths = ["/", "/faq", "/methodology", "/rankings", "/power-rankings", "/teams", "/events", "/predict", "/privacy", "/teams/4215", "/events/2025/USNJNOM3", "/my-team", "/no-such-page"];
    for (const p of paths) {
      const html = (await renderPage(file, p)).html;
      const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
      expect(titles, p).toHaveLength(1);
      expect(titles[0], p).toMatch(p === "/" ? /^Control Scout — / : / · Control Scout$/);
      expect(titles[0], p).not.toContain("FTC Control Scout");
      expect([...html.matchAll(/<meta property="og:site_name" content="([^"]*)"/g)].map((m) => m[1]), p).toEqual(["Control Scout"]);
    }
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/manifest.webmanifest"), "utf8"));
    expect(manifest.name).toBe("Control Scout");
  });
});

describe("IndexNow", () => {
  type Call = { url: string; body: { host: string; key: string; keyLocation: string; urlList: string[] } };
  const fake = (status = 200) => {
    const calls: Call[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return { status, ok: status >= 200 && status < 300 }; };
    return { calls, fetchImpl };
  };
  const T0 = Date.parse("2026-10-19T12:00:00Z");
  const HOUR = 3600_000;
  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    process.env.INDEXNOW = "1";
    delete process.env.INDEXNOW_KEY;
    (await import("./powerRankings/generated")).invalidateGenerated(); // published weeks are cached across databases
  });
  afterAll(() => { delete process.env.INDEXNOW; delete process.env.INDEXNOW_KEY; });

  it("serves the key at /<key>.txt as plain text, and nothing at any other .txt name", async () => {
    const { indexNowKeyRoute, indexNowKey, DEFAULT_KEY } = await import("./indexNow");
    expect(indexNowKey()).toBe(DEFAULT_KEY);
    const app = express();
    app.get(/^\/[A-Za-z0-9-]{8,128}\.txt$/, indexNowKeyRoute);
    app.use((_q, r) => { r.status(404).send("Not found"); });
    const s = app.listen(0);
    await new Promise((r) => s.once("listening", r));
    const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      const r = await fetch(`${base}/${DEFAULT_KEY}.txt`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await r.text()).toBe(DEFAULT_KEY);
      expect((await fetch(`${base}/aaaaaaaaaaaa.txt`)).status).toBe(404);
      // INDEXNOW_KEY replaces it (a malformed one is ignored).
      process.env.INDEXNOW_KEY = "my-own-key-123";
      expect(await (await fetch(`${base}/my-own-key-123.txt`)).text()).toBe("my-own-key-123");
      expect((await fetch(`${base}/${DEFAULT_KEY}.txt`)).status).toBe(404);
      process.env.INDEXNOW_KEY = "bad key!";
      expect(indexNowKey()).toBe(DEFAULT_KEY);
    } finally { s.close(); }
  });

  it("off unless INDEXNOW is set; never pings a non-public origin", async () => {
    const { pingIndexNow } = await import("./indexNow");
    const f = fake();
    delete process.env.INDEXNOW;
    expect(await pingIndexNow({ now: T0, fetchImpl: f.fetchImpl })).toBe("off");
    process.env.INDEXNOW = "1";
    process.env.CANONICAL_URL = "http://localhost:5173";
    try {
      expect(await pingIndexNow({ now: T0, fetchImpl: f.fetchImpl })).toMatch(/^skipped: not a public origin/);
    } finally { delete process.env.CANONICAL_URL; }
    expect(f.calls).toHaveLength(0);
  });

  it("first ping: the main pages; then at most one an hour, with the events re-fetched since and their teams", async () => {
    const { pingIndexNow, ENDPOINT, DEFAULT_KEY } = await import("./indexNow");
    const f = fake();
    expect(await pingIndexNow({ now: T0, fetchImpl: f.fetchImpl })).toMatch(/^sent 7 URLs/);
    expect(f.calls[0].url).toBe(ENDPOINT);
    expect(f.calls[0].body).toMatchObject({ host: "controlscout.org", key: DEFAULT_KEY, keyLocation: `https://controlscout.org/${DEFAULT_KEY}.txt` });
    expect(f.calls[0].body.urlList).toEqual(expect.arrayContaining([
      "https://controlscout.org/", "https://controlscout.org/faq", "https://controlscout.org/power-rankings", "https://controlscout.org/rankings",
      "https://controlscout.org/teams", "https://controlscout.org/methodology",
    ]));
    // An event re-fetched after the ping (and one before it, which isn't sent again), with their teams.
    const at = (ms: number) => new Date(ms).toISOString();
    await run("INSERT INTO events (season, code, name, start, source, detail_synced_at) VALUES (2025, 'NEW1', 'New', '2025-11-08', 'test', ?), (2025, 'OLD1', 'Old', '2025-10-01', 'test', ?)", [at(T0 + 10 * 60_000), at(T0 - HOUR)]);
    await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'NEW1', 4215), (2025, 'NEW1', 18360), (2025, 'OLD1', 999)");
    expect(await pingIndexNow({ now: T0 + 30 * 60_000, fetchImpl: f.fetchImpl })).toMatch(/^skipped: pinged within the hour/);
    expect(f.calls).toHaveLength(1);
    expect(await pingIndexNow({ now: T0 + HOUR + 1, fetchImpl: f.fetchImpl })).toMatch(/^sent 3 URLs/);
    expect(f.calls[1].body.urlList.sort()).toEqual(["https://controlscout.org/events/2025/NEW1", "https://controlscout.org/teams/18360", "https://controlscout.org/teams/4215"]);
    // Nothing changed since: nothing sent, and the hour isn't used up.
    expect(await pingIndexNow({ now: T0 + 3 * HOUR, fetchImpl: f.fetchImpl })).toBe("nothing changed");
    expect(f.calls).toHaveLength(2);
  });

  it("sends each power rankings week once, by its id: one dated the day of an earlier ping still goes", async () => {
    const { pingIndexNow } = await import("./indexNow");
    const f = fake();
    expect(await pingIndexNow({ now: T0, fetchImpl: f.fetchImpl })).toMatch(/^sent 7 URLs/);
    // Published "2026-10-19", a date that sorts before the ping's own time on that same day.
    await run("INSERT INTO power_rankings_generated (season, week, published, status, packet, generated_at) VALUES (2026, '2026-w42', '2026-10-19', 'published', ?, ?)",
      [JSON.stringify({ season: 2026, week: "2026-w42", teams: [], comparedWith: null }), new Date(T0 + 60_000).toISOString()]);
    (await import("./powerRankings/generated")).invalidateGenerated(); // its 15 s cache (pings are an hour apart)
    expect(await pingIndexNow({ now: T0 + HOUR + 1, fetchImpl: f.fetchImpl })).toMatch(/^sent 1 URLs/);
    expect(f.calls[1].body.urlList).toEqual(["https://controlscout.org/power-rankings/2026-w42"]);
    expect(await pingIndexNow({ now: T0 + 3 * HOUR, fetchImpl: f.fetchImpl })).toBe("nothing changed");
  });

  it("a batch over the limit goes out across pings, from where the last one stopped: no page is skipped", async () => {
    const { changedEvents } = await import("./indexNow");
    const t = "2026-10-19T12:10:00.000Z"; // all re-fetched at the same moment: the cursor still tells them apart
    await run("INSERT INTO events (season, code, name, start, source, detail_synced_at) VALUES (2025, 'A', 'A', '2025-11-08', 'test', ?), (2025, 'B', 'B', '2025-11-08', 'test', ?), (2025, 'C', 'C', '2025-11-08', 'test', ?)", [t, t, t]);
    await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'A', 1), (2025, 'A', 2), (2025, 'B', 3), (2025, 'B', 4), (2025, 'C', 5)");
    const start = { t: "2026-10-19T12:00:00.000Z", season: 0, code: "" };
    // Room for 4 URLs: event A and its two teams (3) fit; B and its teams (3 more) wait whole.
    const first = await changedEvents(start, 4);
    expect(first.paths).toEqual(["/events/2025/A", "/teams/1", "/teams/2"]);
    expect(first.more).toBe(true);
    const second = await changedEvents(first.cursor, 4);
    expect(second.paths).toEqual(["/events/2025/B", "/teams/3", "/teams/4"]);
    const third = await changedEvents(second.cursor, 4);
    expect(third.paths).toEqual(["/events/2025/C", "/teams/5"]);
    expect(third.more).toBe(false);
    expect((await changedEvents(third.cursor, 4)).paths).toEqual([]);
  });

  it("fails quietly: a refused or broken request resolves, waits an hour, and loses no change", async () => {
    const { pingIndexNow } = await import("./indexNow");
    expect(await pingIndexNow({ now: T0, fetchImpl: fake(500).fetchImpl })).toBe("HTTP 500, 7 URLs not sent");
    expect(await pingIndexNow({ now: T0 + 60_000, fetchImpl: fake().fetchImpl })).toMatch(/^skipped/);
    const boom = async () => { throw new Error("network down"); };
    await expect(pingIndexNow({ now: T0 + HOUR + 1, fetchImpl: boom })).resolves.toBe("failed: network down");
    // The main pages were never accepted: the next ping still sends them.
    expect(await pingIndexNow({ now: T0 + 2 * HOUR + 2, fetchImpl: fake().fetchImpl })).toMatch(/^sent 7 URLs/);
  });
});

describe("/methodology (How it works)", () => {
  it("puts the prerendered page in the first paint with its single H1, own title and canonical URL", async () => {
    const { resetMethodologyHtml } = await import("./seoMeta");
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-hiw-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head><title>x</title></head><body><div id="root"></div></body></html>');
    writeFileSync(join(dir, "methodology.html"), '<header><h1>How Control Scout predictions work</h1></header><section id="ratings"><h2>Ratings</h2><p>expected contribution</p></section>');
    const prev = process.env.CS_PRERENDER_DIR;
    process.env.CS_PRERENDER_DIR = dir;
    resetMethodologyHtml();
    try {
      const page = await renderPage(file, "/methodology");
      expect(page.status).toBe(200);
      expect(page.html).toContain("<title>How the predictions work · Control Scout</title>");
      expect(page.html).toContain('<link rel="canonical" href="https://controlscout.org/methodology"');
      expect(page.html).toContain('<section id="ratings"><h2>Ratings</h2><p>expected contribution</p></section>');
      expect(page.html.match(/<h1[\s>]/g)).toHaveLength(1); // the page's own H1, not a second one from the shell
      expect(page.html).not.toMatch(/noindex/i);
    } finally {
      if (prev === undefined) delete process.env.CS_PRERENDER_DIR; else process.env.CS_PRERENDER_DIR = prev;
      resetMethodologyHtml();
    }
  });

  it("carries the track record's headline figure with its as-of date, in the description and the accuracy section", async () => {
    const { methodologyRecord, withRecordLine, fitDescription: fit } = await import("./seoMeta");
    const block = { n: 41743, decided: 41405, accuracy: 30554 / 41405 };
    const t = {
      headline: { kind: "backtest" as const, season: 2025, accuracy: block.accuracy, n: block.n },
      seasons: [{ season: 2025, label: "2025–26 DECODE", live: null, backtest: block }],
      generatedAt: "2026-10-28T21:05:00Z",
    } as unknown as Parameters<typeof methodologyRecord>[0];
    const rec = methodologyRecord(t)!;
    expect(rec.text).toBe("As of Oct 28, 2026: 73.8% of 41,405 decided 2025–26 matches called right in a season replay.");
    const live = methodologyRecord({ ...t!, headline: { ...t!.headline!, kind: "live" }, seasons: [{ ...t!.seasons[0], live: block as never }] })!;
    expect(live.text).toMatch(/called right before they were played\.$/);
    // Fits a search snippet whole.
    expect(fit(`How Control Scout rates robots and predicts FTC matches. ${rec.text}`).length).toBeLessThanOrEqual(160);
    expect(fit(`How Control Scout rates robots and predicts FTC matches. ${rec.text}`)).not.toMatch(/…$/);
    const html = withRecordLine('<section id="ratings"></section><section id="accuracy" class="x"><h2>How good</h2></section>', rec);
    expect(html).toBe('<section id="ratings"></section><section id="accuracy" class="x"><p data-cs-record>Track record: As of <time datetime="2026-10-28T21:05:00.000Z">Oct 28, 2026</time>: 73.8% of 41,405 decided 2025–26 matches called right in a season replay.</p><h2>How good</h2></section>');
    // No record built yet, no headline, or nothing decided: no line (the page's static description stands).
    expect(methodologyRecord(null)).toBeNull();
    expect(methodologyRecord({ ...t!, headline: null })).toBeNull();
    expect(methodologyRecord({ ...t!, seasons: [{ ...t!.seasons[0], backtest: { ...block, decided: 0 } as never }] })).toBeNull();
  });

  it("without a build (no prerendered file) still answers with its title, description and one H1", async () => {
    const { resetMethodologyHtml } = await import("./seoMeta");
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-hiw0-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head><title>x</title></head><body><div id="root"></div></body></html>');
    process.env.CS_PRERENDER_DIR = join(dir, "missing");
    resetMethodologyHtml();
    try {
      const page = await renderPage(file, "/methodology");
      expect(page.status).toBe(200);
      expect(page.html.match(/<h1[\s>]/g)).toHaveLength(1);
    } finally {
      delete process.env.CS_PRERENDER_DIR;
      resetMethodologyHtml();
    }
  });
});
