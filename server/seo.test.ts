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
  });

  it("team and event pages get their own title, description (120–160), canonical, OG and Twitter tags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head><title>FTC Control Scout — free</title>\n<meta name="description" content="generic" />\n<meta property="og:title" content="generic" />\n</head><body></body></html>');

    const team = await renderIndex(file, "/teams/4215");
    expect(team).toContain("<title>Team 4215 — Hypnotic Robotics · FTC Control Scout</title>");
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
    expect(lower).toContain("<title>P1-4 PM Northern League Meet (2025–26) · FTC Control Scout</title>");
    expect(lower).toContain('<link rel="canonical" href="https://controlscout.org/events/2025/USNJNOM3" />');
    const ev = await renderIndex(file, "/events/2025/USNJNOM3");
    expect(ev).toContain("<title>P1-4 PM Northern League Meet (2025–26) · FTC Control Scout</title>");
    expect(/<meta name="description" content="([^"]*)"/.exec(ev)![1]).toContain("Nov 8, 2025");

    const home = await renderIndex(file, "/");
    expect(home).toContain("<title>FTC Control Scout — free FTC scouting &amp; predictions</title>");
    expect(/<meta name="description" content="([^"]*)"/.exec(home)![1]).not.toBe(desc);
    // Policy pages: their own title and a fitted description, indexable.
    const privacy = await renderIndex(file, "/privacy");
    expect(privacy).toContain("<title>Privacy policy · FTC Control Scout</title>");
    expect(privacy).toContain('<link rel="canonical" href="https://controlscout.org/privacy" />');
    expect(privacy).not.toContain("noindex");
    const pdesc = /<meta name="description" content="([^"]*)"/.exec(privacy)![1];
    expect(pdesc.length).toBeGreaterThanOrEqual(120);
    expect(pdesc.length).toBeLessThanOrEqual(160);
    const terms = await renderIndex(file, "/terms");
    expect(terms).toContain("<title>Terms of use · FTC Control Scout</title>");
    expect(terms).toContain('<link rel="canonical" href="https://controlscout.org/terms" />');
    expect(terms).not.toContain("noindex");
    const tdesc = /<meta name="description" content="([^"]*)"/.exec(terms)![1];
    expect(tdesc.length).toBeGreaterThanOrEqual(120);
    expect(tdesc.length).toBeLessThanOrEqual(160);
    expect(await renderIndex(file, "/contact")).toContain("<title>Contact · FTC Control Scout</title>");
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
    expect(html).toContain("<title>FTC world rankings 2025–26 · FTC Control Scout</title>");
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
    expect(tx).toContain("<title>FTC rankings: Texas 2025–26, week of Feb 16, 2026 · FTC Control Scout</title>");
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
    const [team] = ld(await renderIndex(file, "/teams/4215"));
    expect(team).toMatchObject({ "@type": "SportsTeam", name: "Hypnotic Robotics", url: "https://controlscout.org/teams/4215", location: { address: { addressLocality: "Oradell", addressRegion: "NJ" } } });
    const [ev] = ld(await renderIndex(file, "/events/2025/USNJNOM3"));
    expect(ev.image).toEqual(["https://controlscout.org/og-image.png"]);
    expect(ev).toMatchObject({ "@type": "SportsEvent", name: "P1-4 PM Northern League Meet", startDate: "2025-11-08", url: "https://controlscout.org/events/2025/USNJNOM3", location: { name: "Don Bosco Prep" } });
    // A name containing </script> can't break out of the tag.
    await run("UPDATE teams SET name = 'Evil</script><script>alert(1)</script>' WHERE number = 4215");
    const evil = await renderIndex(file, "/teams/4215");
    expect(evil).not.toContain("</script><script>alert(1)");
    expect(ld(evil)[0].name).toBe("Evil</script><script>alert(1)</script>");
    expect(ld(await renderIndex(file, "/predict"))).toHaveLength(0);
    // Replacement patterns in a name ($', $`, $&) are inserted literally, never expanded.
    await run("UPDATE teams SET name = 'Dollar $'' Bot $` $& end' WHERE number = 4215");
    const dollar = await renderIndex(file, "/teams/4215");
    expect(ld(dollar)[0].name).toBe("Dollar $' Bot $` $& end");
    expect(dollar.match(/<\/head>/g)).toHaveLength(1);
    // An unknown team gets fallback meta but no structured data; a zero-padded number has one canonical URL.
    expect(ld(await renderIndex(file, "/teams/999998"))).toHaveLength(0);
    const padded = await renderIndex(file, "/teams/004215");
    expect(padded).toContain('<link rel="canonical" href="https://controlscout.org/teams/4215" />');
    expect(ld(padded)[0].url).toBe("https://controlscout.org/teams/4215");
    // Attendance mode follows the event's remote/hybrid flags.
    expect(ld(await renderIndex(file, "/events/2025/REMOTE1"))[0].eventAttendanceMode).toBe("https://schema.org/OnlineEventAttendanceMode");
    expect(ld(await renderIndex(file, "/events/2025/USNJNOM3"))[0].eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
  });

  it("HTTP 404 (app HTML, noindex, no canonical) for unknown routes, teams and events; 200 for every app route", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-404-"));
    const file = join(dir, "index.html");
    writeFileSync(file, '<html><head></head><body><div id="root"></div></body></html>');
    for (const p of ["/this-page-does-not-exist", "/privacy-policy", "/teams/999999", "/teams/0", "/teams/0000000", "/teams/abc", "/teams/0x10", "/teams/1234567", `/teams/${"9".repeat(400)}`, "/teams/4215/extra",
      "/events/2025/NOPE", "/events/2019/USNJNOM3", "/events/abc/USNJNOM3", "/events/0x7E9/USNJNOM3", `/events/${"9".repeat(400)}/USNJNOM3`,"/events/2025/a%20b", "/events/2025", "/teams/%E0%A4%A", "/teams%2F4215"]) {
      const page = await renderPage(file, p);
      expect(page.status, p).toBe(404);
      expect(page.html, p).toContain('<div id="root">'); // the app renders its own not-found page
      // Marked, so the app drops it on moving to a real page.
      expect(page.html, p).toContain('<meta name="robots" content="noindex" data-not-found />');
      expect(page.html, p).not.toContain('rel="canonical"');
      expect(page.html, p).toContain("<title>Page not found · FTC Control Scout</title>");
    }
    // Every route in the app's router (src/main.tsx) is a 200, in any case; known teams and events too.
    const main = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");
    // Except /owner: the owner portal is a 404 for every visitor on the server (it can't tell the owner from a
    // page load), and the app draws the portal only for the owner. Tested below.
    const routes = [...main.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== "*" && !r.includes(":") && r !== "/owner");
    for (const p of ["/owner", "/Owner", "/owner/"]) {
      const page = await renderPage(file, p);
      expect(page.status, p).toBe(404);
      expect(page.html, p).toContain("<title>Page not found · FTC Control Scout</title>");
      expect(page.html, p).not.toMatch(/owner portal/i);
    }
    expect(routes.length).toBeGreaterThan(10);
    for (const p of [...routes, "/Teams", "/teams/4215", "/teams/004215", "/teams/0004215", `/teams/${"0".repeat(40)}4215`, "/teams/%34%32%31%35", "/%74eams", "/events/2025/%55SNJNOM3", "/events/02025/USNJNOM3","/events/2025/USNJNOM3", "/events/2025/usnjnom3"]) {
      const page = await renderPage(file, p);
      expect(page.status, p).toBe(200);
      expect(page.html, p).toContain('rel="canonical"');
    }
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
