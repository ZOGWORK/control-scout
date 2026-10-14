// One host, one URL per page: www/alias hosts 301 to the apex with path and
// query kept; trailing slashes and /team/… aliases 301; /api is never touched;
// the HTML carries the canonical link.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { canonicalRedirects, canonicalUrl, renderIndex } from "./seo";
import { fitDescription } from "./seoMeta";
import { migrate, openDb, run, setDb } from "./db";

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
afterAll(() => { server?.close(); Object.assign(process.env, saved); });

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
    expect((await get("/team/4215", "controlscout.org")).headers.get("location")).toBe("/teams/4215");
    expect((await get("/teams/4215/", "controlscout.org")).headers.get("location")).toBe("/teams/4215");
    expect((await get("/event/2025/USNJNOM3?tab=matches", "controlscout.org")).headers.get("location")).toBe("/events/2025/USNJNOM3?tab=matches");
    expect((await get("/team/4215/", "www.controlscout.org")).headers.get("location")).toBe("https://controlscout.org/teams/4215");
  });
  it("leaves the apex, the root, loopback and /api alone", async () => {
    expect((await get("/teams/4215", "controlscout.org")).status).toBe(200);
    expect((await get("/", "controlscout.org")).status).toBe(200);
    expect((await get("/teams/4215", "127.0.0.1")).status).toBe(200);
    expect((await get("/api/health", "www.controlscout.org")).status).toBe(200);
  });
});

describe("page head in the first HTML", () => {
  it("team and event pages get their own title, description (120–160), canonical, OG and Twitter tags", async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA')");
    await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, matches, wins, losses, ties) VALUES (2025, 4215, 101.64, 616, 8375, 32, 26, 6, 0)");
    await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, remote, hybrid, source) VALUES (2025, 'USNJNOM3', 'P1-4 PM Northern League Meet', 'LeagueMeet', 'Don Bosco Prep', 'Ramsey', 'NJ', 'USA', '2025-11-08', '2025-11-08', 0, 0, 'test')");
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

    const ev = await renderIndex(file, "/events/2025/USNJNOM3");
    expect(ev).toContain("<title>P1-4 PM Northern League Meet (2025–26) · FTC Control Scout</title>");
    expect(/<meta name="description" content="([^"]*)"/.exec(ev)![1]).toContain("Nov 8, 2025");

    const home = await renderIndex(file, "/");
    expect(home).toContain("<title>FTC Control Scout — free FTC scouting &amp; predictions</title>");
    expect(/<meta name="description" content="([^"]*)"/.exec(home)![1]).not.toBe(desc);
    // Personal pages: noindex.
    expect(await renderIndex(file, "/my-team")).toContain('<meta name="robots" content="noindex" />');
  });

  it("fits descriptions to 120–160 characters", () => {
    expect(fitDescription("Short.").length).toBeGreaterThanOrEqual(20);
    const long = fitDescription("word ".repeat(80));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
    expect(canonicalUrl("/teams/4215/")).toBe("https://controlscout.org/teams/4215");
  });
});
