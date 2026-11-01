// Light pages (docs/lite.md): the real app over HTTP with an in-memory database. Each page is plain HTML with
// no scripts, images or charts, always links back to its full version, stays inside its payload budget, caches
// like the API when it's public, and the pick list asks for what the rich one asks for.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { gzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { clearAllCaches } from "../caches";
import { setFlag } from "../flags";
import { renderPage } from "../seo";
import { CURRENT_SEASON } from "../data/seasons";
import { fullHref, liteHref } from "../../src/shared/lite";
import { liteEvent, nextMatches } from "./trim";
import type { EventDetail, MatchView } from "../../src/shared/api";

let server: Server;
let base = "";
const S = CURRENT_SEASON;
/** Low tens of KB: the budget for a light page as it travels (gzip), whatever the event's size. */
const BUDGET_GZIP = 30 * 1024;
/** The fixture event is on today: its unplayed matches are still to come. */
const TODAY = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // A full-size event: 40 teams, 80 qualification matches (half played).
  const teams = Array.from({ length: 40 }, (_, i) => 10000 + i);
  for (const t of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Edison', 'NJ', 'USA', 2019)", [t, `Robo <Team> ${t}`]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, t]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, remote, hybrid, source) VALUES (?, 'NJQ1', 'Edison Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', ?, ?, 0, 0, 't')", [S, TODAY, TODAY]);
  for (const [i, t] of teams.entries()) {
    await run("INSERT INTO event_teams (season, code, team, rank, rp, wins, losses, ties, qual_played) VALUES (?, 'NJQ1', ?, ?, ?, ?, ?, 0, 4)", [S, t, i + 1, 2 - i / 40, 4 - (i % 5), i % 5]);
  }
  for (let n = 1; n <= 80; n++) {
    const played = n <= 40 ? 1 : 0;
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, 'NJQ1', 'qual', 0, ?, ?, ?, ?, ?, ?, 20, 60, 30, 5, ?, ?, 15, 50, 25, 0, 't')`,
    [S, n, `Q${n}`, `${TODAY}T${String(9 + Math.floor(n / 10)).padStart(2, "0")}:${String((n * 6) % 60).padStart(2, "0")}:00`, played,
      played ? 115 : null, played ? 110 : null, played ? 90 : null, played ? 90 : null]);
    const lineup = [0, 1, 2, 3].map((k) => teams[(n * 4 + k) % 40]);
    for (const [k, t] of lineup.entries()) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, on_field) VALUES (?, 'NJQ1', 'qual', 0, ?, ?, ?, ?, 1)", [S, n, t, k < 2 ? "red" : "blue", (k % 2) + 1]);
    }
  }
  clearAllCaches();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const get = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });

/** A light page: HTML, no script, no image, no chart, a Full version link to `full`, inside the budget. */
async function lightPage(path: string, full: string) {
  const r = await get(path);
  expect(r.status, path).toBe(200);
  expect(r.headers.get("content-type")).toMatch(/^text\/html/);
  const html = await r.text();
  expect(html).not.toMatch(/<script|<img|<svg|<canvas|<iframe|<link rel="stylesheet"/i);
  expect(html).toContain(`<a class="full" href="${full}">Full version</a>`);
  // One way back, top right: never a second button at the bottom.
  expect(html.match(/>Full version<\/a>/g)).toHaveLength(1);
  expect(gzipSync(html).length, `${path}: ${gzipSync(html).length} bytes gzipped`).toBeLessThan(BUDGET_GZIP);
  // Nothing else to fetch: the page allows no scripts, images or connections.
  const csp = r.headers.get("content-security-policy") ?? r.headers.get("content-security-policy-report-only");
  expect(csp).toContain("default-src 'none'");
  return { r, html };
}

describe("light pages", () => {
  it("event: rankings and the whole schedule as tables, results and calls, linked to light team and match pages", async () => {
    const { r, html } = await lightPage(`/lite/events/${S}/njq1`, `/events/${S}/NJQ1`);
    expect(html).toContain("<h1>Edison Qualifier</h1>");
    expect(html).toContain(`<a href="/lite/teams/10000?season=${S}">10000</a>`);
    // Names are escaped, never markup.
    expect(html).toContain("Robo &lt;Team&gt; 10000");
    expect(html).toContain(`href="/lite/events/${S}/NJQ1/match/qual:0:80"`);
    expect(html).toMatch(/<span class="r w">115<\/span>–<span class="b">90<\/span>/);
    // On today: revalidated every time (results move), like the API on an event day.
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(html).toContain(`<link rel="canonical" href="https://controlscout.org/events/${S}/NJQ1">`);
    expect(r.headers.get("etag")).toBeTruthy();
  });

  it("a robot on the alliance but not on the field is marked, as on the full pages", async () => {
    await run("UPDATE match_teams SET on_field = 0 WHERE season = ? AND code = 'NJQ1' AND number = 3 AND station = 2 AND alliance = 'blue'", [S]);
    clearAllCaches();
    try {
      const html = await (await fetch(`${base}/lite/events/${S}/NJQ1`)).text();
      expect(html).toMatch(/<span class="m">\(\d+\)<\/span>/);
      expect(html).toContain("In brackets: on the alliance but not on the field.");
      const match = await (await fetch(`${base}/lite/events/${S}/NJQ1/match/qual:0:3`)).text();
      expect(match.match(/not on field/g)).toHaveLength(1);
    } finally {
      await run("UPDATE match_teams SET on_field = 1 WHERE season = ? AND code = 'NJQ1'", [S]);
      clearAllCaches();
    }
  });

  it("a past event is public and cacheable like the API", async () => {
    await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, 'OLDQ', 'Old Qualifier', 'Qualifier', '2020-01-01', '2020-01-01', 0, 0, 't')", [S]);
    clearAllCaches();
    const { r } = await lightPage(`/lite/events/${S}/OLDQ`, `/events/${S}/OLDQ`);
    expect(r.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
  });

  it("team: its record, next matches and events", async () => {
    const { html } = await lightPage("/lite/teams/10005", "/teams/10005");
    expect(html).toContain("<h1>10005 Robo &lt;Team&gt; 10005</h1>");
    expect(html).toContain("Next matches");
    expect(html).toContain(`<a href="/lite/events/${S}/NJQ1">Edison Qualifier</a>`);
    const { html: seasonal } = await lightPage(`/lite/teams/10005?season=${S}`, `/teams/10005?season=${S}`);
    expect(seasonal).toContain("10005");
  });

  it("match: both alliances, the score by phase and steps to the neighbouring matches", async () => {
    const { html } = await lightPage(`/lite/events/${S}/NJQ1/match/QUAL:0:02`, `/events/${S}/NJQ1/match/qual:0:2`);
    expect(html).toMatch(/<h2 class="r">Red · 115<\/h2>/);
    expect(html).toMatch(/<h2 class="b">Blue · 90<\/h2>/);
    expect(html).toContain("Score by phase");
    expect(html).toContain(`href="/lite/events/${S}/NJQ1/match/qual:0:1"`);
    expect(html).toContain(`href="/lite/events/${S}/NJQ1/match/qual:0:3"`);
  });

  it("not found: a 404 page that still leads to the full site", async () => {
    for (const [path, full] of [[`/lite/events/${S}/NOPE`, `/events/${S}/NOPE`], ["/lite/teams/77", "/teams/77"], [`/lite/events/${S}/NJQ1/match/qual:0:999`, `/events/${S}/NJQ1/match/qual:0:999`], ["/lite/elsewhere", "/"]]) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.text()).toContain(`<a class="full" href="${full}">Full version</a>`);
    }
  });

  it("?lite=1 on a rich page's address goes to its light twin; pages without one are left alone", async () => {
    const r = await get(`/events/${S}/NJQ1?lite=1`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`/lite/events/${S}/NJQ1`);
    expect((await get(`/teams/10005?season=${S}&lite=1`)).headers.get("location")).toBe(`/lite/teams/10005?season=${S}`);
    expect((await get("/scout?view=picklist&space=ws1&lite=1")).headers.get("location")).toBe("/lite/picklist?space=ws1");
    expect((await get("/api/health?lite=1")).status).toBe(200);
  });

  it("pick list: signed out is a 401 that's never cached, and points to signing in on the full version", async () => {
    const r = await get("/lite/picklist?space=ws1&season=2025");
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const html = await r.text();
    expect(html).toContain("Sign in first");
    expect(html).toContain(`<a class="full" href="/scout?space=ws1&amp;tab=planning&amp;view=picklist&amp;season=2025">Full version</a>`);
  });
});

describe("switched off by the owner (venueLightMode)", () => {
  it("light addresses go to their full page, ?lite=1 is ignored, and the first paint offers nothing", async () => {
    const index = join(mkdtempSync(join(tmpdir(), "cs-lite-")), "index.html");
    writeFileSync(index, `<html><head><title>x</title></head><body><div id="root"></div></body></html>`);
    const offer = `<a href="/lite/teams/10005">Open the light version</a>`;
    expect((await renderPage(index, "/teams/10005")).html).toContain(offer);
    await setFlag("venueLightMode", false, "owner@example.com");
    try {
      expect((await renderPage(index, "/teams/10005")).html).not.toContain("Open the light version");
      for (const [path, full] of [[`/lite/events/${S}/NJQ1`, `/events/${S}/NJQ1`], ["/lite/teams/10005?season=" + S, `/teams/10005?season=${S}`], ["/lite/picklist?space=ws1", "/scout?space=ws1&tab=planning&view=picklist"]]) {
        const r = await get(path);
        expect(r.status, path).toBe(302);
        expect(r.headers.get("location")).toBe(full);
        expect(r.headers.get("cache-control")).toBe("no-store");
      }
      const r = await get(`/events/${S}/NJQ1?lite=1`);
      expect(r.status).not.toBe(302);
    } finally { await setFlag("venueLightMode", true, "owner@example.com"); }
    expect((await get(`/lite/events/${S}/NJQ1`)).status).toBe(200);
  });
});

describe("addresses", () => {
  it("every rich page with a twin maps there and back", () => {
    const pairs: [string, string, string][] = [
      ["/events/2025/usnjq1", "", "/lite/events/2025/USNJQ1"],
      ["/events/2025/USNJQ1/match/qual:0:12", "", "/lite/events/2025/USNJQ1/match/qual:0:12"],
      ["/teams/18360", "?season=2024&tab=x", "/lite/teams/18360?season=2024"],
      ["/scout", "?space=7&view=picklist&season=2025&tab=data", "/lite/picklist?space=7&season=2025"],
      // Pick list & planning with no view opens on the pick list.
      ["/scout", "?space=7&tab=planning&season=2025", "/lite/picklist?space=7&season=2025"],
    ];
    expect(liteHref("/scout", "?space=7&tab=planning&view=activity")).toBeNull();
    for (const [path, search, lite] of pairs) expect(liteHref(path, search)).toBe(lite);
    expect(fullHref("/lite/events/2025/USNJQ1")).toBe("/events/2025/USNJQ1");
    expect(fullHref("/lite/teams/18360", "?season=2024")).toBe("/teams/18360?season=2024");
    expect(fullHref("/lite/picklist", "?space=7")).toBe("/scout?space=7&tab=planning&view=picklist");
    for (const p of ["/", "/events", "/predict", "/scout", "/scout?view=entries"]) expect(liteHref(p.split("?")[0], p.includes("?") ? p.slice(p.indexOf("?")) : "")).toBeNull();
  });
});

describe("trimming", () => {
  it("next matches: events that haven't ended, timed ones in order, untimed after them", () => {
    const m = (code: string, label: string, time: string | null, played = false) => ({ code, label, time, played } as unknown as MatchView);
    const ends = new Map([["NOW", "2026-10-31"], ["OLD", "2026-09-01"], ["SOON", "2026-11-07"]]);
    const got = nextMatches([m("NOW", "F1", null), m("OLD", "Q9", "2026-09-01T10:00:00"), m("NOW", "Q12", "2026-10-31T11:00:00"),
      m("NOW", "Q11", "2026-10-31T10:30:00"), m("NOW", "Q10", "2026-10-31T10:00:00", true), m("SOON", "Q1", "2026-11-07T09:00:00")], ends, "2026-10-31");
    expect(got.map((x) => `${x.code} ${x.label}`)).toEqual(["NOW Q11", "NOW Q12", "SOON Q1", "NOW F1"]);
  });

  it("keeps only what the light event page shows", () => {
    const d = {
      event: { season: 2025, code: "X", name: "X", type: "Qualifier", typeLabel: "Qualifier", divisionCode: null, region: "USNJ", city: null, state: null, country: null, venue: "Gym",
        start: null, end: null, remote: false, teams: 1, matchesPlayed: 0, matchesTotal: 0, status: "upcoming", website: "w", livestream: "l", timezone: "t", source: "first" },
      field: [{ team: 1, name: "A", city: "c", state: "s", rank: null, rp: null, tbp: 3, wins: null, losses: null, ties: null, qualPlayed: null,
        opr: { np: 10, auto: 1, teleop: 2, endgame: 3, pen: 4 }, avgNp: 9, rating: { np: 1, sd: 1, matches: 1 }, seasonOpr: 5 }],
      matches: [], alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null,
    } as unknown as EventDetail;
    expect(liteEvent(d).teams).toEqual([{ team: 1, name: "A", rank: null, rp: null, wins: null, losses: null, ties: null, opr: 10 }]);
    expect(Object.keys(liteEvent(d))).not.toContain("field");
  });
});
