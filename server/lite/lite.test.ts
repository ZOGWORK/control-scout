// Light pages (docs/lite.md): the real app over HTTP with an in-memory database. Each page is plain HTML with
// no scripts, images or charts, always links back to its full version, stays inside its payload budget, caches
// like the API when it's public, and the pick list asks for what the rich one asks for.
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
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
import { LITE_STYLE, LITE_TAP_CLASSES, eventPage } from "./render";
import { LITE_CSP, pageVary, safeNext } from "./routes";
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
  expect(html).not.toMatch(/<script|<img|<image|<canvas|<iframe|<link rel="stylesheet"|xlink:href|<use\b/i);
  // One inline drawing, the C-mark: markup in the page, nothing fetched.
  expect(html.match(/<svg/g)).toHaveLength(1);
  expect(html).toContain(`<a class="btn p full" href="${full}">Full version</a>`);
  // One way back, top right: never a second button at the bottom.
  expect(html.match(/>Full version<\/a>/g)).toHaveLength(1);
  expect(gzipSync(html).length, `${path}: ${gzipSync(html).length} bytes gzipped`).toBeLessThan(BUDGET_GZIP);
  // Nothing else to fetch: the page allows no scripts, images or connections.
  const csp = r.headers.get("content-security-policy") ?? r.headers.get("content-security-policy-report-only");
  expect(csp).toBe(LITE_CSP);
  expect(LITE_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'");
  // Every link is a 44px tap target: it carries one of the classes the stylesheet sizes.
  for (const [a] of html.matchAll(/<a\b[^>]*>/g)) expect(LITE_TAP_CLASSES.some((c) => new RegExp(`class="(?:[^"]* )?${c}(?: [^"]*)?"`).test(a)), a).toBe(true);
  return { r, html };
}

describe("light pages", () => {
  it("event: rankings and the whole schedule as tables, results and calls, linked to light team and match pages", async () => {
    const { r, html } = await lightPage(`/lite/events/${S}/njq1`, `/events/${S}/NJQ1`);
    expect(html).toContain("<h1>Edison Qualifier</h1>");
    expect(html).toContain(`<a class="cell" href="/lite/teams/10000?season=${S}"><b>10000</b>`);
    // Names are escaped, never markup.
    expect(html).toContain("Robo &lt;Team&gt; 10000");
    expect(html).toContain(`href="/lite/events/${S}/NJQ1/match/qual:0:80"`);
    expect(html).toMatch(/<span class="r w">115<\/span>–<span class="b">90<\/span>/);
    // Each alliance is named, not told by colour alone.
    expect(html).toMatch(/<span class="r"><span class="vh">Red: <\/span>\d+ \d+<\/span><br><span class="b"><span class="vh">Blue: <\/span>/);
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
    expect(html).toContain(`<a class="cell" href="/lite/events/${S}/NJQ1"><b>Edison Qualifier</b>`);
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
      expect(await r.text()).toContain(`<a class="btn p full" href="${full}">Full version</a>`);
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
    expect(html).toContain(`<a class="btn p full" href="/scout?space=ws1&amp;tab=planning&amp;view=picklist&amp;season=2025">Full version</a>`);
  });
});

describe("the app's theme and text size (cookies)", () => {
  const page = async (cookie: string) => {
    const r = await get(`/lite/teams/10005`, { headers: { cookie } });
    expect(r.headers.get("vary")).toMatch(/Cookie/);
    return r.text();
  };
  it("draws each theme as the app does: a class on <html>, System following the device", async () => {
    expect(await page("")).toMatch(/<html lang="en"><head>/);
    expect(await page("cs-theme=dark")).toMatch(/<html lang="en"><head>/);
    for (const t of ["light", "dim", "midnight"]) expect(await page(`a=1; cs-theme=${t}`)).toContain(`<html lang="en" class="${t}">`);
    const sys = await page("cs-theme=system");
    expect(sys).toContain(`<html lang="en" class="sys">`);
    expect(sys).toContain(`<meta name="color-scheme" content="dark light">`);
    expect(LITE_STYLE).toContain("@media(prefers-color-scheme:light){html.sys{");
    expect(await page("cs-theme=light")).toContain(`<meta name="color-scheme" content="light">`);
    // Anything else is the default, never markup.
    expect(await page("cs-theme=%22%3E%3Cb%3E")).toMatch(/<html lang="en"><head>/);
  });
  it("scales the root font size with the app's text size", async () => {
    for (const t of ["s", "l", "xl"]) expect(await page(`cs-text-size=${t}`)).toContain(`<html lang="en" data-text-size="${t}">`);
    expect(await page("cs-text-size=m")).toMatch(/<html lang="en"><head>/);
    expect(await page("cs-theme=dim; cs-text-size=xl")).toContain(`<html lang="en" class="dim" data-text-size="xl">`);
    expect(LITE_STYLE).toContain("html[data-text-size=xl]{--s:1.25}");
    expect(LITE_STYLE).toContain("font-size:calc(100% * var(--b) * var(--s))");
  });
});

describe("tap targets", () => {
  it("every link class is at least 44px tall in the stylesheet", () => {
    for (const c of LITE_TAP_CLASSES) {
      const rule = new RegExp(`(?:^|})\\.${c}\\{([^}]*)\\}`).exec(LITE_STYLE);
      expect(rule, c).toBeTruthy();
      const h = /min-height:(\d+)px/.exec(rule![1]);
      expect(Number(h?.[1]), `.${c} min-height`).toBeGreaterThanOrEqual(44);
    }
    // Table cells and list rows keep their padding (nothing touching).
    expect(LITE_STYLE).toContain("th,td{padding:10px 12px;");
    expect(LITE_STYLE).toMatch(/\.in\{[^}]*padding:0 16px/);
  });
});

describe("Lite on (sticky)", () => {
  const nav = { "sec-fetch-mode": "navigate", accept: "text/html" };
  it("/lite/on sets the cookie and goes on; /lite/off clears it and goes to the full page", async () => {
    const on = await get(`/lite/on?next=${encodeURIComponent(`/lite/teams/10005?season=${S}`)}`);
    expect(on.status).toBe(302);
    expect(on.headers.get("location")).toBe(`/lite/teams/10005?season=${S}`);
    expect(on.headers.get("set-cookie")).toMatch(/^cs-lite=1; Max-Age=31536000; Path=\/; Expires=.*; SameSite=Lax$/);
    expect(on.headers.get("cache-control")).toBe("no-store");
    const off = await get(`/lite/off?next=${encodeURIComponent(`/lite/teams/10005?season=${S}`)}`, { headers: { cookie: "cs-lite=1" } });
    expect(off.status).toBe(302);
    expect(off.headers.get("location")).toBe(`/teams/10005?season=${S}`);
    expect(off.headers.get("set-cookie")).toMatch(/^cs-lite=; Path=\/; Expires=Thu, 01 Jan 1970/);
    expect((await get("/lite/off?next=/events")).headers.get("location")).toBe("/events");
  });
  it("never sends anyone to another site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "\\\\evil", "", undefined, "/a\nb", ["/x"], "/a/..//evil.example", "/a/../\\evil.example", "/./%2e%2e//evil.example"]) expect(safeNext(bad), String(bad)).toBe("/");
    expect(safeNext("/teams/1?season=2025")).toBe("/teams/1?season=2025");
    expect(safeNext("/a/../teams/1")).toBe("/teams/1");
  });
  it("a next that normalizes to another site goes home, from both endpoints", async () => {
    for (const ep of ["on", "off"]) expect((await get(`/lite/${ep}?next=${encodeURIComponent("/a/..//evil.example")}`)).headers.get("location"), ep).toBe("/");
  });
  it("app pages with a Lite twin are kept per cookie by caches (with Lite on they answer with a redirect)", () => {
    expect(pageVary("/teams/10005", "?season=2025")).toBe("Accept-Encoding, Cookie");
    expect(pageVary(`/events/${S}/NJQ1`)).toBe("Accept-Encoding, Cookie");
    expect(pageVary("/predict")).toBe("Accept-Encoding");
    expect(pageVary("/")).toBe("Accept-Encoding");
  });
  /** A request as a browser sends it (fetch puts its own "cors" in Sec-Fetch-Mode). */
  const raw = (path: string, headers: Record<string, string>) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>((ok, fail) => {
    request(`${base}${path}`, { headers }, (res) => { res.resume(); ok({ status: res.statusCode ?? 0, headers: res.headers }); }).on("error", fail).end();
  });
  it("a page load of a page with a Lite version goes there; ?lite=0, the app's own requests and other pages don't", async () => {
    const r = await raw(`/teams/10005?season=${S}`, { ...nav, cookie: "cs-lite=1" });
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`/lite/teams/10005?season=${S}`);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await raw(`/events/${S}/NJQ1`, { ...nav, cookie: "cs-lite=1" })).headers.location).toBe(`/lite/events/${S}/NJQ1`);
    // A browser without Sec-Fetch headers: a page load asks for HTML.
    expect((await raw(`/teams/10005`, { accept: "text/html", cookie: "cs-lite=1" })).status).toBe(302);
    expect((await raw(`/teams/10005?lite=0`, { ...nav, cookie: "cs-lite=1" })).status).not.toBe(302);
    expect((await raw(`/teams/10005`, nav)).status).not.toBe(302);
    expect((await raw(`/predict`, { ...nav, cookie: "cs-lite=1" })).status).not.toBe(302);
    expect((await raw(`/api/teams/10005`, { cookie: "cs-lite=1", "sec-fetch-mode": "cors", accept: "application/json" })).status).not.toBe(302);
    expect((await raw(`/teams/10005`, { cookie: "cs-lite=1", "sec-fetch-mode": "cors", accept: "text/html" })).status).not.toBe(302);
  });
  it("on a Lite page: Full version opens the full page this once, and Turn off Lite is offered", async () => {
    const html = await (await get(`/lite/teams/10005`, { headers: { cookie: "cs-lite=1" } })).text();
    expect(html).toContain(`<a class="btn p full" href="/teams/10005?lite=0">Full version</a>`);
    expect(html).toContain(`href="/lite/off?next=%2Fteams%2F10005">Turn off Lite</a>`);
    expect(html).not.toContain("Always open Lite");
    const off = await (await get(`/lite/teams/10005`)).text();
    expect(off).toContain(`href="/lite/on?next=%2Flite%2Fteams%2F10005">Always open Lite</a>`);
    expect(off).not.toContain("Turn off Lite");
  });
});

describe("switched off by the owner (venueLightMode)", () => {
  it("light addresses go to their full page, ?lite=1 is ignored, and the first paint offers nothing", async () => {
    const index = join(mkdtempSync(join(tmpdir(), "cs-lite-")), "index.html");
    writeFileSync(index, `<html><head><title>x</title></head><body><div id="root"></div></body></html>`);
    const offer = `<a href="/lite/teams/10005">Open Control Scout Lite</a>`;
    expect((await renderPage(index, "/teams/10005")).html).toContain(offer);
    await setFlag("venueLightMode", false, "owner@example.com");
    try {
      expect((await renderPage(index, "/teams/10005")).html).not.toContain("Open Control Scout Lite");
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
    // Any event code FIRST uses, as typed or encoded: there and back at its one address (capitals, encoded).
    expect(liteHref("/events/2019/63693260770.2649")).toBe("/lite/events/2019/63693260770.2649");
    expect(liteHref("/events/2019/NL'hko/match/qual:0:1")).toBe("/lite/events/2019/NL'HKO/match/qual:0:1");
    expect(liteHref("/events/2019/laredomeet%202")).toBe("/lite/events/2019/LAREDOMEET%202");
    expect(fullHref("/lite/events/2024/USVTM(KO")).toBe("/events/2024/USVTM(KO");
    expect(fullHref("/lite/events/2019/laredomeet%202/match/qual:0:1")).toBe("/events/2019/LAREDOMEET%202/match/qual:0:1");
    expect(fullHref("/lite/events/2019/%E0%A4%A")).toBe("/"); // not a code: malformed encoding
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
    expect(liteEvent(d).teams).toEqual([{ team: 1, name: "A", rank: null, rs: null, wins: null, losses: null, ties: null, opr: 10 }]);
    expect(Object.keys(liteEvent(d))).not.toContain("field");
  });

  it("a league meet ranks every team on the meet's own standing (RS), never FIRST's league totals", () => {
    const row = (team: number, rank: number | null, rp: number | null, meet: { rank: number; rs: number; w: number; l: number } | null) => ({
      team, name: `T${team}`, city: null, state: null, rank, rp, tbp: null, wins: 9, losses: 9, ties: 0, qualPlayed: 6,
      opr: { np: team / 10, auto: null, teleop: null, endgame: null, pen: null }, avgNp: null, rating: null,
      meet: meet && { rank: meet.rank, rs: meet.rs, tb: [], wins: meet.w, losses: meet.l, ties: 0, played: 6 } });
    const d = {
      event: { season: 2026, code: "M1", name: "Meet", type: "LeagueMeet", typeLabel: "League meet", city: null, state: null, country: null, start: null, end: null, status: "finished" },
      // FIRST's league rank 8 for the meet's winner, and a team FIRST's league list leaves out (rank null).
      field: [row(100, 8, 1.5, { rank: 1, rs: 2.5, w: 5, l: 1 }), row(200, 12, 1.4, { rank: 2, rs: 2.33, w: 4, l: 2 }), row(300, null, null, { rank: 3, rs: 2.17, w: 4, l: 2 })],
      matches: [], alliances: [], awards: [], live: null,
    } as unknown as EventDetail;
    const e = liteEvent(d);
    expect(e.meet).toBe(true);
    expect(e.teams.map((t) => [t.team, t.rank, t.rs, `${t.wins}-${t.losses}`])).toEqual([[100, 1, 2.5, "5-1"], [200, 2, 2.33, "4-2"], [300, 3, 2.17, "4-2"]]);
    const html = eventPage(e, "/events/2026/M1").body;
    expect(html).toContain(">RS</th>");
    expect(html).not.toContain(">RP</th>");
    expect(html).toContain("This meet's own standing");
  });
});
