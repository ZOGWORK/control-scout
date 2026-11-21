// Light pages (docs/lite.md): the real app over HTTP with an in-memory database. Each page is plain HTML with
// no scripts, images or charts, always links back to its full version, stays inside its payload budget, caches
// like the API when it's public, and the pick list asks for what the rich one asks for.
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { clearAllCaches } from "../caches";
import { setFlag } from "../flags";
import { renderPage } from "../seo";
import { CURRENT_SEASON } from "../data/seasons";
import { fullHref, liteHref, liteOffer } from "../../src/shared/lite";
import { num, oddsPct } from "../../src/shared/format";
import { factorLabel } from "../../src/shared/factorLabel";
import { sharePct } from "../../src/shared/factorSheet";
import type { RankingsResponse } from "../../src/shared/rankings";
import { liteEvent, nextMatches } from "./trim";
import { LITE_STYLE, LITE_TAP_CLASSES, LITE_V8_STYLE, esc, eventPage, matchList } from "./render";
import { searchPage, textBar } from "./pages";
import { LITE_CSP, LITE_NET_CSP, pageVary, safeNext } from "./routes";
import { NET_SCRIPT } from "./network";
import { LITE_LINE } from "../../src/shared/networkStatus";
import { seasonLabel } from "../../src/shared/format";
import type { CompareView, EventDetail, MatchExplanationView, MatchView, SearchAnswer } from "../../src/shared/api";

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
    // The v8 match row: red's teams, the scores (the winner bold in its colour, the loser muted), blue's teams.
    expect(html).toMatch(/<span class="ms"><span class="r w">115<\/span><i aria-hidden="true">–<\/i><span class="lo">90<\/span><\/span>/);
    // Each alliance is named, not told by colour alone.
    expect(html).toMatch(/<span class="mt r"><span class="vh">Red: <\/span><span>\d+<\/span><span>\d+<\/span><\/span><span class="ms">/);
    expect(html).toMatch(/<\/span><span class="mt b"><span class="vh">Blue: <\/span>/);
    // The call: the picked side and its chance, a thin bar, the tier, and once played Right or Upset.
    expect(html).toMatch(/<span class="mc"><span>Picked <span class="[rb]">(Red|Blue) \d+%<\/span><\/span><span class="wb" aria-hidden="true"><i style="width:\d+%"><\/i><\/span><span>[A-Z][a-z]+<\/span>/);
    // The #1 rank is the one place the accent marks.
    expect(html).toContain(`<td class="n top1">1</td>`);
    // On today: revalidated every time (results move), like the API on an event day.
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(html).toContain(`<link rel="canonical" href="https://controlscout.org/events/${S}/NJQ1">`);
    expect(r.headers.get("etag")).toBeTruthy();
  });

  it("a page with nothing but a name is noindex like its full page; one with data is not (soft 404s)", async () => {
    // Teams 10000+ played at NJQ1: indexable, so the Lite twin has only its canonical.
    const team = await (await get(`/lite/teams/10000`)).text();
    expect(team).toContain(`<link rel="canonical" href="https://controlscout.org/teams/10000">`);
    expect(team).not.toContain(`name="robots"`);
    expect(await (await get(`/lite/events/${S}/NJQ1`)).text()).not.toContain(`name="robots"`);
    // A team we know with no season, match, award or event yet, and an event with no teams and no matches.
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (39322, 'Orion', 'Tel Aviv', '', 'Israel')");
    await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, 'EMPTYQ', 'Empty Qualifier', 'Qualifier', '2099-01-01', '2099-01-01', 0, 0, 't')", [S]);
    clearAllCaches();
    const bare = await (await get(`/lite/teams/39322`)).text();
    expect(bare).toContain(`<link rel="canonical" href="https://controlscout.org/teams/39322">`);
    expect(bare).toContain(`<meta name="robots" content="noindex">`);
    const r = await get(`/lite/events/${S}/EMPTYQ`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(`<meta name="robots" content="noindex">`);
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
  // The classic look (a device that picked /legacy) draws the app's five themes; v8 is dark only (below).
  const page = async (cookie: string) => {
    const r = await get(`/lite/teams/10005`, { headers: { cookie: `cs-v8=0; ${cookie}` } });
    expect(r.headers.get("vary")).toMatch(/Cookie/);
    return r.text();
  };
  it("draws each theme as the app does: a class on <html>, System following the device", async () => {
    expect(await page("")).toMatch(/<html lang="en"><head>/);
    expect(await page("cs-theme=dark")).toMatch(/<html lang="en"><head>/);
    for (const t of ["light", "dim"]) expect(await page(`a=1; cs-theme=${t}`)).toContain(`<html lang="en" class="${t}">`);
    // The retired Midnight draws as Dark, the default.
    expect(await page("cs-theme=midnight")).toMatch(/<html lang="en"><head>/);
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

describe("the look: v8 unless this device picked the classic one", () => {
  const html = async (path: string, cookie = "") => (await get(path, cookie ? { headers: { cookie } } : {})).text();
  it("draws v8 by default: dark only, its own stylesheet, no gold anywhere", async () => {
    const v8 = await html("/lite/teams/10005");
    expect(v8).toMatch(/<html lang="en" data-v8><head>/);
    expect(v8).toContain(`<meta name="theme-color" content="#0a0a0b">`);
    expect(v8).toContain(`<style>${LITE_V8_STYLE}</style>`);
    expect(LITE_V8_STYLE).toContain("--acc:#a3b6e0");
    // The bright alliance pair (never faded) and wins and "Right" green, as in the app.
    expect(LITE_V8_STYLE).toContain("--red:#f43f5e");
    expect(LITE_V8_STYLE).toContain("--blue:#38bdf8");
    expect(LITE_V8_STYLE).toContain("--ok:#34d399");
    // Accent text and the brand mark are white.
    expect(LITE_V8_STYLE).toContain("--at:#f4f4f5");
    expect(LITE_V8_STYLE).toContain(".brand path{fill:var(--fg)}");
    // No yellow, mint or teal in what v8 paints (the mark's inline gold is painted over).
    for (const c of ["#ffc700", "#eab308", "#7fd1ae", "#14b8a6", "#2dd4bf"]) expect(LITE_V8_STYLE, c).not.toContain(c);
    // The theme cookie waits (v8 is dark only, as in the app); the text size still applies.
    expect(await html("/lite/teams/10005", "cs-theme=light; cs-text-size=l")).toContain(`<html lang="en" data-v8 data-text-size="l">`);
  });
  it("the classic look from the app's cookie, or ?v8= for this load", async () => {
    const classic = await html("/lite/teams/10005", "cs-v8=0");
    expect(classic).toMatch(/<html lang="en"><head>/);
    expect(classic).toContain(`<style>${LITE_STYLE}</style>`);
    expect(await html("/lite/teams/10005", "cs-v8=1")).toContain("data-v8");
    expect(await html("/lite/teams/10005?v8=0")).toMatch(/<html lang="en"><head>/);
    expect(await html("/lite/teams/10005?v8=1", "cs-v8=0")).toContain("<html lang=\"en\" data-v8>");
  });
  it("every v8 link class is a 44px tap target too", () => {
    for (const c of LITE_TAP_CLASSES) {
      const rules = [...LITE_V8_STYLE.matchAll(new RegExp(`(?:^|})\\.${c}\\{([^}]*)\\}`, "g"))];
      expect(rules.length, c).toBeGreaterThan(0);
      for (const r of rules) {
        const h = /min-height:(\d+)px/.exec(r[1]);
        if (h) expect(Number(h[1]), `.${c}`).toBeGreaterThanOrEqual(44);
      }
    }
    expect(LITE_V8_STYLE).toMatch(/\.mr\{[^}]*min-height:44px/);
  });
  it("a played call says Right or Upset; an unplayed one shows the predicted score, muted", () => {
    const call = { pRed: 0.7, tier: "confident" as const, kind: "live" as const, red: 120.4, blue: 88, redRange: null, blueRange: null };
    const row = (score: { red: number; blue: number } | null) => ({ key: "qual:0:1", label: "Q1", time: null, played: !!score, red: [1, 2], blue: [3, 4], off: [], score, call });
    const right = matchList([row({ red: 130, blue: 90 })], 2025, "X", "", false, 3);
    expect(right).toContain(`<span class="rt">✓ Right</span>`);
    expect(right).toContain(`<span class="mm lo">3 lost</span>`);
    expect(right).toContain(`<i style="width:70%"></i>`);
    expect(matchList([row({ red: 80, blue: 90 })], 2025, "X", "")).toContain(`<span class="up">✗ Upset</span>`);
    const ahead = matchList([row(null)], 2025, "X", "");
    expect(ahead).toContain(`<span class="pr" title="Predicted score">~120</span>`);
    expect(ahead).not.toMatch(/Right|Upset/);
  });
  it("a team's matches end with its own result, white when won", async () => {
    const t = await html(`/lite/teams/10005?season=${S}`);
    expect(t).toMatch(/<a class="row mr my" href="\/lite\/events\//);
    expect(t).toMatch(/<span class="mm( lo)?">10005 (won|lost|tied)<\/span>/);
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
    expect(pageVary("/predict")).toBe("Accept-Encoding, Cookie");
    expect(pageVary("/events")).toBe("Accept-Encoding");
    expect(pageVary("/")).toBe("Accept-Encoding, Cookie");
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
    expect((await raw(`/events`, { ...nav, cookie: "cs-lite=1" })).status).not.toBe(302);
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
    expect(liteHref("/scout", "?space=7&tab=planning&view=activity")).toBe("/lite/scout?space=7&tab=planning&view=activity");
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
    for (const p of ["/events", "/records", "/teams", "/events?season=2025"]) expect(liteHref(p.split("?")[0], p.includes("?") ? p.slice(p.indexOf("?")) : "")).toBeNull();
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

// ── Home, Search, Predict, Compare, Rankings, Scouting, Settings ─────────────────────────────────────────────

describe("the rest of Lite: the same answers as the API", () => {
  beforeAll(async () => {
    // Season ratings for the fixture's 40 teams and 30 more, so the ranking has two pages (50 a page).
    for (let i = 0; i < 70; i++) {
      const t = i < 40 ? 10000 + i : 20000 + i;
      if (i >= 40) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Austin', 'TX', 'USA')", [t, `Far Team ${t}`]);
      await run("INSERT OR REPLACE INTO team_season_stats (season, team, rating_np, rating_sd, rating_matches, matches, opr_np, opr_auto, opr_teleop, opr_endgame) VALUES (?, ?, ?, 6, 8, 8, ?, 10, 30, 12)", [S, t, 100 - i * 0.7, 60 - i * 0.5]);
    }
    clearAllCaches();
  });
  const json = async <T,>(path: string): Promise<T> => { const r = await get(path); expect(r.status, path).toBe(200); return r.json() as Promise<T>; };

  it("home: the search box and the events on now, as the full Home's calendar lists them", async () => {
    const { html } = await lightPage("/lite", "/");
    expect(html).toContain(`<form class="srch" action="/lite/search" method="get" role="search">`);
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const api = await json<{ events: { code: string; status: string }[] }>(`/api/events?season=${S}&from=${day(Date.now() - 2 * 864e5)}&to=${day(Date.now() + 7 * 864e5)}`);
    const on = api.events.filter((e) => e.status !== "finished");
    expect(on.map((e) => e.code)).toContain("NJQ1");
    for (const e of on) expect(html).toContain(`href="/lite/events/${S}/${e.code}"`);
    expect(html).not.toContain(`/lite/events/${S}/OLDQ`);
    for (const p of ["/lite/predict", "/lite/compare", "/lite/rankings", "/lite/scout", "/lite/settings"]) expect(html).toContain(`href="${p}"`);
  });

  it("search: the answer /api/search?answer=1 sends, its results linked to their Lite pages", async () => {
    const api = await json<SearchAnswer>("/api/search?q=10005&answer=1");
    const { html } = await lightPage("/lite/search?q=10005", "/search?q=10005");
    expect(api.hits.length).toBeGreaterThan(0);
    for (const h of api.hits.slice(0, 15)) expect(html).toContain(esc(h.title));
    expect(html).toContain(`href="/lite/teams/10005`);
    expect(html).toContain(`value="10005"`);
    // Nothing asked yet: the box and a few searches to try.
    const empty = await lightPage("/lite/search", "/search");
    expect(empty.html).toContain(`href="/lite/search?q=4215"`);
    // A search that names a page answers with the page alone: never "Nothing matched" above it.
    const pageOnly = searchPage("rankings", null, { q: "rankings", hits: [], pages: [{ title: "World rankings", href: "/rankings" }], step: "deterministic", weak: false, understood: { kind: "names", label: "Rankings" } });
    expect(pageOnly.body).not.toContain("Nothing matched");
    expect(pageOnly.body).toContain(`<a class="chip" href="/lite/rankings">World rankings</a>`);
    expect(searchPage("zzqxv", null, { q: "zzqxv", hits: [], pages: [], step: "deterministic", weak: false }).body).toContain("Nothing matched");
    // A search with no match says so, never an empty page.
    expect((await lightPage("/lite/search?q=zzqxv", "/search?q=zzqxv")).html).toMatch(/Nothing matched|Did you mean|can't answer/);
  });

  it("predict: the form, and the same odds, scores and reasons as /api/predict/match", async () => {
    const empty = await lightPage("/lite/predict", "/predict");
    expect(empty.html.match(/inputmode="numeric"/g)).toHaveLength(4);
    expect(empty.html).toContain(`<form class="card" action="/lite/predict" method="get">`);
    const x = await json<MatchExplanationView>(`/api/predict/match?season=${S}&red=10000,10001&blue=10002,10003`);
    // The form's boxes (?red=a&red=b) and a link's list (?red=a,b) are the same matchup.
    const { html } = await lightPage("/lite/predict?red=10000&red=10001&blue=10002,10003", "/predict?mode=match&amp;red=10000,10001&amp;blue=10002,10003");
    expect(html).toContain(`<b class="r">${oddsPct(x.winProbRed)}</b>`);
    expect(html).toContain(`<b class="b">${oddsPct(x.winProbBlue)}</b>`);
    expect(html).toContain(`${Math.round(x.predictedRed)}–${Math.round(x.predictedBlue)}`);
    for (const f of x.factors.slice(0, 3)) expect(html).toContain(esc(factorLabel(f.label)));
    expect(x.factorSheet).toBeTruthy();
    for (const f of [...x.factorSheet!.phases, ...x.factorSheet!.model]) expect(html).toContain(`<td class="n">${esc(sharePct(f.weight))}</td>`);
    expect(html).toContain("Full why breakdown");
    for (const t of [...x.teamsRed, ...x.teamsBlue]) expect(html).toContain(`href="/lite/teams/${t.team}?season=${S}"`);
    // A matchup that can't be one says why.
    expect((await lightPage("/lite/predict?red=10000&blue=10000", "/predict?mode=match&amp;red=10000&amp;blue=10000")).html).toContain("each team once");
  });

  it("compare: the same CompareView as /api/compare, a text bar for OPR and the head-to-head", async () => {
    const v = await json<CompareView>("/api/compare?teams=10000,10001,10002");
    const { html } = await lightPage("/lite/compare?teams=10000,10001,10002", "/compare?teams=10000,10001,10002");
    for (const t of v.teams) {
      expect(html).toContain(`href="/lite/teams/${t.team.number}?season=${v.season}"`);
      expect(html).toContain(`<b>${num(t.stats?.opr.np.value)}</b>`);
      expect(html).toContain(num(t.stats?.rating?.np));
    }
    expect(html).toMatch(/<span class="bar" aria-hidden="true">[█░]{10}<\/span>/);
    expect(textBar(50, 100)).toBe("█████░░░░░");
    const meetings = v.meetings.filter((m) => m.relation === "opponents").slice(0, 20);
    for (const m of meetings) expect(html).toContain(`href="/lite/events/${m.season}/${m.code}/match/${m.key}"`);
    // The form's boxes arrive repeated.
    expect((await lightPage("/lite/compare?teams=10000&teams=10001", "/compare?teams=10000,10001")).html).toContain("10001");
  });

  it("rankings: the page /api/rankings sends, 50 a page, with the next page a link", async () => {
    const r = await json<RankingsResponse>(`/api/rankings?season=${S}`);
    expect(r.total).toBe(70);
    const { html } = await lightPage("/lite/rankings", `/rankings?season=${S}`);
    const shown = [...html.matchAll(/<td class="n(?: top1)?">(\d+)<\/td><td><a class="cell" href="\/lite\/teams\/(\d+)\?season=\d+"><b>\d+<\/b>/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(shown).toEqual(r.rows.map((x) => [x.rank, x.team]));
    for (const x of r.rows) expect(html).toContain(`<td class="n">${x.rating.toFixed(1)}</td>`);
    expect(html).toContain(`href="/lite/rankings?season=${S}&amp;page=2">Next page →</a>`);
    const two = await lightPage(`/lite/rankings?season=${S}&page=2`, `/rankings?season=${S}&amp;page=2`);
    expect(two.html).toContain(`<td class="n">51</td>`);
    expect(two.html).toContain("← Previous");
    const tx = await lightPage(`/lite/rankings?season=${S}&region=USA:TX`, `/rankings?season=${S}&amp;region=USA:TX`);
    expect(tx.html).toContain("30 rated teams");
  });

  it("scouting: says it needs the full app, and opens its same view there", async () => {
    const { html } = await lightPage("/lite/scout?space=7&tab=match", "/scout?space=7&amp;tab=match");
    expect(html).toContain(`<a class="btn p" href="/scout?space=7&amp;tab=match">Open scouting (full app)</a>`);
    expect(html).not.toContain("<form");
    const on = await (await get("/lite/scout", { headers: { cookie: "cs-lite=1" } })).text();
    expect(on).toContain(`href="/scout?lite=0">Open scouting (full app)</a>`);
  });

  it("settings: theme and text size as links that set the app's cookies, Lite on or off, and the network settings", async () => {
    const { html: v8 } = await lightPage("/lite/settings", "/settings");
    expect(v8).toContain("The new look is dark only for now.");
    expect(v8).not.toContain(`href="/lite/theme?set=`);
    const { html, r } = await lightPage("/lite/settings?v8=0", "/settings");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    for (const t of ["light", "dim", "dark", "system"]) expect(html).toContain(`href="/lite/theme?set=${t}&amp;next=%2Flite%2Fsettings"`);
    expect(html).toContain(`<a class="chip cur" href="/lite/theme?set=dark&amp;next=%2Flite%2Fsettings" aria-current="true">Dark</a>`);
    expect(html).toContain(`<a class="chip cur" href="/lite/size?set=m&amp;next=%2Flite%2Fsettings" aria-current="true">Default</a>`);
    expect(html).toContain(`<a class="btn" href="/lite/network">Network &amp; offline</a>`);
    const lit = await (await get("/lite/settings", { headers: { cookie: "cs-v8=0; cs-theme=dim; cs-text-size=xl; cs-lite=1" } })).text();
    expect(lit).toContain(`<a class="chip cur" href="/lite/theme?set=dim&amp;next=%2Flite%2Fsettings" aria-current="true">Dim</a>`);
    expect(lit).not.toContain("Midnight");
    expect(lit).toContain(`aria-current="true">Largest</a>`);
    expect(lit).toContain(`href="/lite/network"`);
    const t = await get("/lite/theme?set=light&next=%2Flite%2Fsettings");
    expect(t.status).toBe(302);
    expect(t.headers.get("location")).toBe("/lite/settings");
    const cookies = t.headers.getSetCookie();
    expect(cookies.some((c) => /^cs-theme=light; Max-Age=31536000; Path=\//.test(c))).toBe(true);
    expect(cookies.some((c) => /^cs-lite-picked=theme;/.test(c))).toBe(true);
    const both = (await get("/lite/size?set=l", { headers: { cookie: "cs-lite-picked=theme" } })).headers.getSetCookie();
    expect(both.some((c) => /^cs-text-size=l;/.test(c))).toBe(true);
    expect(both.some((c) => /^cs-lite-picked=size\.theme;/.test(c))).toBe(true);
    expect((await get("/lite/size?set=m")).headers.getSetCookie().some((c) => /^cs-text-size=;/.test(c))).toBe(true);
    // Nothing else is ever set, and never another site.
    const bad = await get("/lite/theme?set=%3Cb%3E&next=%2F%2Fevil.example");
    expect(bad.headers.get("location")).toBe("/");
    expect(bad.headers.getSetCookie()).toEqual([]);
  });

  it("every new page has its Lite twin there and back, and ?lite=1 goes there", async () => {
    const pairs: [string, string, string][] = [
      ["/", "", "/lite"],
      ["/search", "?q=4215&in=2024&x=1", "/lite/search?q=4215&in=2024"],
      ["/predict", "?mode=match&season=2025&red=1,2&blue=3,4", "/lite/predict?season=2025&red=1,2&blue=3,4"],
      ["/predict", "?mode=advancement&code=X", "/lite/predict"],
      ["/compare", "?teams=4215,7149&season=2025", "/lite/compare?teams=4215,7149&season=2025"],
      ["/rankings", "?season=2025&region=USA:TX&page=2&week=2025-11-03", "/lite/rankings?season=2025&region=USA:TX&page=2"],
      ["/scout", "?space=7&tab=match", "/lite/scout?space=7&tab=match"],
      ["/settings", "", "/lite/settings"],
      ["/network", "", "/lite/network"],
    ];
    for (const [path, search, lite] of pairs) expect(liteHref(path, search), path + search).toBe(lite);
    expect(fullHref("/lite")).toBe("/");
    expect(fullHref("/lite/search", "?q=4215&in=2024")).toBe("/search?q=4215&in=2024");
    expect(fullHref("/lite/predict", "?red=1&red=2&blue=3,4&season=2025")).toBe("/predict?mode=match&season=2025&red=1,2&blue=3,4");
    expect(fullHref("/lite/predict")).toBe("/predict");
    expect(fullHref("/lite/compare", "?teams=1&teams=2")).toBe("/compare?teams=1,2");
    expect(fullHref("/lite/rankings", "?season=2025&page=3")).toBe("/rankings?season=2025&page=3");
    expect(fullHref("/lite/scout", "?space=7&tab=match&lite=0")).toBe("/scout?space=7&tab=match");
    expect(fullHref("/lite/settings")).toBe("/settings");
    expect(fullHref("/lite/network")).toBe("/network");
    // Scouting's forms keep working offline in the full app: the app never offers Lite there.
    expect(liteOffer("/scout", "?space=7&tab=match")).toBeNull();
    expect(liteOffer("/scout", "?space=7&view=picklist")).toBe("/lite/picklist?space=7");
    expect(liteOffer("/")).toBe("/lite");
    for (const [path, lite] of [["/?lite=1", "/lite"], ["/search?q=4215&lite=1", "/lite/search?q=4215"], ["/settings?lite=1", "/lite/settings"]]) {
      const r = await get(path);
      expect(r.status, path).toBe(302);
      expect(r.headers.get("location")).toBe(lite);
    }
  });
});

describe("network & offline (journey 10)", () => {
  /** The pack list /download offers, written where the server reads it (DATA_DIR/packs), its files on disk. */
  function withPacks(full: { season: number; bytes: number }[], lite: number | null) {
    const dir = mkdtempSync(join(tmpdir(), "cs-lite-packs-"));
    const packs = join(dir, "packs");
    mkdirSync(packs);
    const file = (name: string, bytes: number, seasons: number[], kind: string) => { writeFileSync(join(packs, name), ""); return { name, url: `/packs/${name}`, bytes, sha256: "x", seasons, kind, contents: "" }; };
    writeFileSync(join(packs, "latest.json"), JSON.stringify({ format: 1, version: "t", builtAt: "2026-11-14T00:00:00Z", engineVersion: "x", dataAsOf: null,
      lite: lite == null ? null : file("scout-pack-lite.json", lite, full.map((f) => f.season), "lite"),
      full: full.map((f) => file(`scout-pack-${f.season}.db`, f.bytes, [f.season], "full")) }));
    const was = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    return () => { if (was == null) delete process.env.DATA_DIR; else process.env.DATA_DIR = was; };
  }

  it("one screen: the status, the connection, the download sizes, what's downloaded, and the switches with their lines", async () => {
    const restore = withPacks([{ season: S, bytes: 23_400_000 }, { season: S - 1, bytes: 18_000_000 }], 640_000);
    try {
      const r = await get("/lite/network");
      expect(r.status).toBe(200);
      const html = await r.text();
      // The way back, and every link a tap target, as on every Lite page.
      expect(html).toContain(`<a class="btn p full" href="/network">Full version</a>`);
      for (const [a] of html.matchAll(/<a\b[^>]*>/g)) expect(LITE_TAP_CLASSES.some((c) => new RegExp(`class="(?:[^"]* )?${c}(?: [^"]*)?"`).test(a)), a).toBe(true);
      expect(gzipSync(html).length).toBeLessThan(BUDGET_GZIP);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      // The server answered, so the first paint already says so; the script checks again at once.
      expect(html).toContain(`<h2 id="n-title" aria-live="polite">You're online</h2>`);
      expect(html).toContain(`<td class="n" id="n-net">Working</td>`);
      // Sizes from the pack list, in the full screen's words.
      expect(html).toContain(`<li>The whole ${seasonLabel(S)} season uses 23.4 MB.</li>`);
      expect(html).toContain("<li>Every season (2) uses 41.4 MB.</li>");
      expect(html).toContain("<li>Offline predictions use 640 KB.</li>");
      // The switches, each with the line saying what it does.
      expect(html).toContain(`<b id="n-lite">Lite is off</b></p><p class="m s" id="n-lite-line">${LITE_LINE}</p>`);
      expect(html).toContain(`<a class="btn" href="/lite/on?next=%2Flite%2Fnetwork">Turn on Lite</a>`);
      expect(html).toContain(`<b id="n-dn">Wi-Fi only</b></p><p class="m s" id="n-dn-line">Nothing downloads on mobile data unless you tap Download yourself.</p>`);
      expect(html).toContain(`id="n-up-line">Updates download by themselves when you're on Wi-Fi.</p>`);
    } finally { restore(); }
  });

  it("runs one script, the fixed one its CSP allows by hash, and may only ask this site", async () => {
    const r = await get("/lite/network");
    const html = await r.text();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toEqual([NET_SCRIPT]);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toMatch(/<img|<iframe|<link rel="stylesheet"/);
    const csp = r.headers.get("content-security-policy") ?? r.headers.get("content-security-policy-report-only");
    expect(csp).toBe(LITE_NET_CSP);
    expect(csp).toBe(`default-src 'none'; script-src 'sha256-${createHash("sha256").update(NET_SCRIPT).digest("base64")}'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'`);
  });

  it("no packs published, or packs switched off: says which", async () => {
    const restore = withPacks([], null);
    try {
      // A manifest with no files is no pack list.
      expect(await (await get("/lite/network")).text()).toContain("<li>No downloads have been published yet.</li>");
      await setFlag("offlinePacks", false, "owner@example.com");
      expect(await (await get("/lite/network")).text()).toContain("<li>Download sizes aren't available. Offline packs are paused right now. Packs already on this device keep working.</li>");
    } finally { await setFlag("offlinePacks", true, "owner@example.com"); restore(); }
  });

  it("Lite on: its switch turns it off, back to the full screen; Settings links here", async () => {
    const html = await (await get("/lite/network", { headers: { cookie: "cs-v8=0; cs-lite=1; cs-theme=light" } })).text();
    expect(html).toContain(`<b id="n-lite">Lite is on</b>`);
    expect(html).toContain(`<a class="btn" href="/lite/off?next=%2Flite%2Fnetwork">Turn off Lite</a>`);
    // The full pages it links open this once (Lite would bring them straight back).
    expect(html).toContain(`href="/download?lite=0"`);
    expect(html).toContain(`<html lang="en" class="light">`);
    const off = await get("/lite/off?next=%2Flite%2Fnetwork");
    expect(off.headers.get("location")).toBe("/network");
  });
});
