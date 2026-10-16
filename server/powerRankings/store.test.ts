// Power rankings end to end: the files in a directory → the API (latest, by week, archive, 404),
// the first HTML (head tags, the static content, a real 404 status) and the sitemap.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { renderPage } from "../seo";
import { resetSitemapCache, sitemapEntries } from "../sitemap";
import { CONTENT_DIR, SAMPLE_DIR, loadDir, useContentDir } from "./store";
import { env } from "../env";
import { latestRatedSeason, newWeekFile, topByRating } from "./scaffold";
import type { PowerRankingsResponse } from "../../src/shared/powerRankings";

const S = 2025;
const TEAMS = Array.from({ length: 30 }, (_, i) => 5000 + i);

function weekFile(o: { week: string; published: string; teams: number[]; title?: string; blurb?: (t: number) => string; extra?: string }) {
  return [
    "---", `title: ${o.title ?? `Power rankings, week ${Number(o.week.slice(6))}`}`, `season: ${S}`, `week: ${o.week}`, `published: ${o.published}`,
    "intro: |", "  The top stayed put; **5003** climbed.", ...(o.extra ? [o.extra] : []), "---", "",
    ...o.teams.slice(0, 25).flatMap((t, i) => [`## ${i + 1}. ${t}`, o.blurb ? o.blurb(t) : `Blurb for ${t}.`, ""]),
  ].join("\n");
}

let server: Server;
let base = "";
let index = "";
let dir = "";
const saved = { APP_URL: process.env.APP_URL };

beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const t of TEAMS) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Austin', 'TX', 'USA')", [t, t === 5000 ? "Alpha & <Co>" : `Team ${t}`]);
  await run("INSERT INTO team_season_stats (season, team, rating_np, rating_rank, opr_np, wins, losses, ties, matches, rating_matches, events) VALUES (?, 5000, 210.25, 99, 180.5, 9, 1, 0, 10, 10, 2)", [S]);
  // Two teams rated above 5000 (so it's #3 in the world, as /rankings counts: the stored rating_rank isn't used),
  // and one with too few rated matches to be ranked at all.
  await run("INSERT INTO team_season_stats (season, team, rating_np, opr_np, wins, losses, ties, matches, rating_matches, events) VALUES (?, 5028, 300, 250, 6, 0, 0, 6, 6, 1), (?, 5029, 250, 190, 4, 1, 0, 5, 5, 1), (?, 5027, 400, 300, 2, 0, 0, 2, 2, 1)", [S, S, S]);
  // The world rankings' weekly snapshot for week 41's Monday.
  await run("INSERT INTO ranking_weeks (season, week, teams, taken_at) VALUES (?, '2026-10-05', 2, '2026-10-05T00:00:00Z')", [S]);
  await run("INSERT INTO ranking_snapshots (season, week, team, rank, rating) VALUES (?, '2026-10-05', 5029, 1, 260), (?, '2026-10-05', 5000, 2, 200)", [S, S]);

  dir = mkdtempSync(join(tmpdir(), "pr-"));
  // Week 41, then week 42 with 5001/5000 swapped, 5002 out and 5025 in. Week 43 is published in the future.
  writeFileSync(join(dir, "2026-w41.md"), weekFile({ week: "2026-w41", published: "2026-10-05", teams: TEAMS }));
  const w42 = [5001, 5000, ...TEAMS.slice(3, 25), 5025];
  writeFileSync(join(dir, "2026-w42.md"), weekFile({
    week: "2026-w42", published: "2026-10-12", teams: w42,
    blurb: (t) => (t === 5001 ? 'Big week. <script>alert("x")</script> [bad](javascript:alert(1)) <img src=x onerror=alert(1)>' : `Blurb for ${t}.`),
  }));
  writeFileSync(join(dir, "2026-w43.md"), weekFile({ week: "2026-w43", published: "2099-01-01", teams: TEAMS }));
  // Broken (24 teams) and a sample in the real directory: both left out.
  writeFileSync(join(dir, "2026-w39.md"), weekFile({ week: "2026-w39", published: "2026-09-20", teams: TEAMS.slice(0, 24) }));
  writeFileSync(join(dir, "2026-w40.md"), weekFile({ week: "2026-w40", published: "2026-09-28", teams: TEAMS, extra: "sample: true" }));
  // A week under the wrong name (it would never show: an error, not skipped), and a non-markdown file (ignored).
  writeFileSync(join(dir, "2026-W44.md"), weekFile({ week: "2026-w44", published: "2026-10-12", teams: TEAMS }));
  writeFileSync(join(dir, ".gitkeep"), "");
  useContentDir(dir);

  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  index = join(mkdtempSync(join(tmpdir(), "pr-html-")), "index.html");
  writeFileSync(index, '<html><head><title>FTC Control Scout</title>\n<meta name="description" content="generic" />\n</head><body><div id="root"></div></body></html>');
});
afterAll(() => {
  server?.close();
  useContentDir(null);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const api = async (path: string) => { const r = await fetch(`${base}${path}`); return { status: r.status, body: (await r.json()) as PowerRankingsResponse & { error?: string } }; };

describe("loading", () => {
  it("keeps valid week files; leaves out broken ones, samples and misnamed .md files (with the reasons); ignores other files", () => {
    const l = loadDir(dir, false);
    expect(l.docs.map((d) => d.week)).toEqual(["2026-w41", "2026-w42", "2026-w43"]);
    expect(l.errors.map((e) => e.file).sort()).toEqual(["2026-W44.md", "2026-w39.md", "2026-w40.md"]);
    expect(l.errors.find((e) => e.file === "2026-W44.md")!.errors[0]).toMatch(/file name must be the week, like 2026-w43\.md/);
    expect(l.errors.find((e) => e.file === "2026-w39.md")!.errors).toContain("found 24 entries; a week has exactly 25");
    expect(l.errors.find((e) => e.file === "2026-w40.md")!.errors[0]).toMatch(/belong in content\/power-rankings-sample/);
    expect(loadDir(join(tmpdir(), "nope-does-not-exist"), false)).toEqual({ docs: [], errors: [] });
  });
});

describe("/api/power-rankings", () => {
  it("latest: the newest published week, live stats, movement vs the previous week, the archive", async () => {
    const { status, body } = await api("/api/power-rankings");
    expect(status).toBe(200);
    const w = body.week!;
    expect(w.week).toBe("2026-w42"); // w43 isn't published yet
    expect(w.comparedWith).toBe("2026-w41");
    expect([w.previous, w.next]).toEqual(["2026-w41", null]);
    expect(w.entries).toHaveLength(25);
    expect(w.entries[0]).toMatchObject({ rank: 1, team: 5001, movement: { kind: "up", by: 1 }, stats: null });
    expect(w.entries[1]).toMatchObject({
      rank: 2, team: 5000, name: "Alpha & <Co>", place: "Austin, TX", movement: { kind: "down", by: 1 },
      stats: { rating: 210.25, ratingRank: 3, opr: 180.5, wins: 9, losses: 1, ties: 0 },
    });
    expect(w.entries[2].movement).toEqual({ kind: "up", by: 1 }); // 5002 left, so 5003 moved up
    expect(w.entries[24]).toMatchObject({ team: 5025, movement: { kind: "new" } });
    expect(w.droppedOut).toEqual([{ team: 5002, lastRank: 3, name: "Team 5002" }]);
    expect(w.introHtml).toBe("<p>The top stayed put; <strong>5003</strong> climbed.</p>");
    expect(body.archive.map((a) => a.week)).toEqual(["2026-w42", "2026-w41"]);
    expect(body.archive[0].top).toEqual([{ team: 5001, name: "Team 5001" }, { team: 5000, name: "Alpha & <Co>" }, { team: 5003, name: "Team 5003" }]);
  });

  it("a blurb can't inject markup: script and handlers are escaped text, unsafe links dropped", async () => {
    const { body } = await api("/api/power-rankings/2026-w42");
    const html = body.week!.entries[0].blurbHtml;
    expect(html).not.toMatch(/<script|<img|href="javascript/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("by week (case-insensitive); the first week has no comparison", async () => {
    const { status, body } = await api("/api/power-rankings/2026-W41");
    expect(status).toBe(200);
    // Its world-rankings link is that week's snapshot (keyed by the week's Monday).
    expect(body.week).toMatchObject({ week: "2026-w41", comparedWith: null, previous: null, next: "2026-w42", worldRankings: "/rankings?season=2025&week=2026-10-05" });
    expect(body.week!.entries.every((e) => e.movement === null)).toBe(true);
  });

  it("unknown, future, broken, sample-in-the-wrong-place and malformed weeks: 404", async () => {
    for (const w of ["2026-w30", "2026-w43", "2026-w39", "2026-w40", "nonsense", "2026-w99"]) {
      const { status, body } = await api(`/api/power-rankings/${w}`);
      expect(status, w).toBe(404);
      expect(body.error).toMatch(/No power rankings published/);
    }
  });
});

describe("pages (first HTML)", () => {
  it("/power-rankings: its own head, the week's content in the HTML, structured data", async () => {
    const page = await renderPage(index, "/power-rankings");
    expect(page.status).toBe(200);
    expect(page.html).toContain("<title>FTC power rankings · FTC Control Scout</title>");
    expect(page.html).toContain('<link rel="canonical" href="https://controlscout.org/power-rankings" />');
    expect(page.html).toContain('<meta name="description" content="The weekly top 25 FTC teams');
    expect(page.html).toContain("#1 5001 Team 5001");
    // The content itself, for crawlers: every team linked, the blurbs, the numbers, the archive.
    expect(page.html).toContain('<a href="/teams/5000">5000 Alpha &amp; &lt;Co&gt;</a>');
    expect(page.html).toContain("Rating 210.3 (#3 worldwide) · OPR 180.5 · 9-1-0");
    expect(page.html).toContain('<a href="/power-rankings/2026-w41">');
    expect(page.html).toContain('<a href="/rankings?season=2025">'); // no snapshot for week 42: the live list
    expect(page.html).not.toMatch(/<script>alert|<img src=x/);
    expect(page.html).toContain('"@type":"ItemList"');
    expect(page.html).not.toContain('name="robots"');
  });

  it("/power-rankings/<week>: an article with its own title and canonical; upper case canonicalises to lower", async () => {
    const page = await renderPage(index, "/power-rankings/2026-W41");
    expect(page.status).toBe(200);
    expect(page.html).toContain("<title>Power rankings, week 41 (2025–26) · FTC Control Scout</title>");
    expect(page.html).toContain('<link rel="canonical" href="https://controlscout.org/power-rankings/2026-w41" />');
    expect(page.html).toContain('<meta property="og:type" content="article" />');
    expect(page.html).toContain('<meta property="og:url" content="https://controlscout.org/power-rankings/2026-w41" />');
    expect(page.html).toContain('"@type":"Article"');
    expect(page.html).toContain('"datePublished":"2026-10-05"');
  });

  it("an unknown or malformed week is a real 404", async () => {
    for (const p of ["/power-rankings/2026-w30", "/power-rankings/2026-w43", "/power-rankings/latest"]) {
      const page = await renderPage(index, p);
      expect(page.status, p).toBe(404);
      expect(page.html).toContain('<meta name="robots" content="noindex" data-not-found />');
    }
  });
});

describe("sitemap", () => {
  it("lists the hub and each published week with its date; never future, broken or sample weeks", async () => {
    resetSitemapCache();
    const e = await sitemapEntries();
    const pr = e.filter((x) => x.loc.includes("/power-rankings"));
    expect(pr).toEqual([
      { loc: "https://controlscout.org/power-rankings", lastmod: "2026-10-12" },
      { loc: "https://controlscout.org/power-rankings/2026-w42", lastmod: "2026-10-12" },
      { loc: "https://controlscout.org/power-rankings/2026-w41", lastmod: "2026-10-05" },
    ]);
  });
});

describe("no weeks yet", () => {
  it("the hub is a real page that says so (no robots tag to leak to other pages), and the sitemap leaves it out", async () => {
    useContentDir(mkdtempSync(join(tmpdir(), "pr-empty-")));
    try {
      expect((await api("/api/power-rankings")).body).toEqual({ week: null, archive: [] });
      const page = await renderPage(index, "/power-rankings");
      expect(page.status).toBe(200);
      expect(page.html).not.toContain('name="robots"');
      expect(page.html).toContain("No power rankings are published yet");
      resetSitemapCache();
      expect((await sitemapEntries()).some((x) => x.loc.includes("power-rankings"))).toBe(false);
    } finally {
      useContentDir(null);
    }
  });
});

describe("npm run power-rankings:new", () => {
  it("fills the world rankings' newest weekly snapshot (its ranks and ratings), with each team's OPR and record now", async () => {
    expect(await latestRatedSeason()).toBe(S);
    const top = await topByRating(S);
    expect(top.week).toBe("2026-10-05");
    expect(top.teams.map((t) => [t.team, t.name, t.rating])).toEqual([[5029, "Team 5029", 260], [5000, "Alpha & <Co>", 200]]);
    const { text, teams, from } = await newWeekFile({ week: "2026-w44", season: S, published: "2026-10-26" });
    expect([teams, from]).toEqual([2, "2026-10-05"]);
    expect(text).toContain("week: 2026-w44\npublished: 2026-10-26");
    expect(text).toContain("## 1. 5029 Team 5029\nTODO: blurb. (Rating 260.0, OPR 190.0, record 4-1-0.)");
    expect(text).toContain("## 2. 5000 Alpha & <Co>\nTODO: blurb. (Rating 200.0, OPR 180.5, record 9-1-0.)");
  });

  it("--live: the ranking right now (3+ rated matches, ties to the lower number)", async () => {
    await run("INSERT INTO team_season_stats (season, team, rating_np, opr_np, wins, losses, ties, matches, rating_matches, events) VALUES (?, 5001, 250, 200, 5, 0, 0, 5, 5, 1)", [S]);
    const top = await topByRating(S, { live: true });
    expect(top.week).toBeNull();
    expect(top.teams.map((t) => [t.team, t.rating])).toEqual([[5028, 300], [5001, 250], [5029, 250], [5000, 210.25]]); // 5027: too few rated matches
  });
});

describe("content", () => {
  it("every published week in the repo validates (CI refuses a bad file)", () => {
    const l = loadDir(CONTENT_DIR, false);
    expect(l.errors).toEqual([]);
  });

  it("the sample weeks validate, say sample: true, and are only served outside production", () => {
    const l = loadDir(SAMPLE_DIR, true);
    expect(l.errors).toEqual([]);
    expect(l.docs.length).toBeGreaterThanOrEqual(2);
    expect(l.docs.every((d) => d.sample && /SAMPLE/.test(d.title))).toBe(true);
    const was = { NODE_ENV: process.env.NODE_ENV, POWER_RANKINGS_SAMPLE: process.env.POWER_RANKINGS_SAMPLE };
    try {
      process.env.POWER_RANKINGS_SAMPLE = "1";
      process.env.NODE_ENV = "development";
      expect(env.powerRankingsSample).toBe(true);
      process.env.NODE_ENV = "production";
      expect(env.powerRankingsSample).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
