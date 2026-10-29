// Automatic power rankings end to end, on an in-memory database with a stand-in for Control Point's
// POST /internal/bruno/power-rankings (no real model is ever called): the fact packet, the Friday
// schedule with catch-up and no double publish, the fact check and the all-template fallback, the
// markdown override, movement across sources, the switch, and the owner panel's actions and audit.
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { invalidateFlags } from "../flags";
import { renderPage } from "../seo";
import { resetSitemapCache, sitemapEntries } from "../sitemap";
import { useContentDir } from "./store";
import { editGenerated, getGenerated, invalidateGenerated, setGeneratedStatus, toDoc } from "./generated";
import { dailyRefreshTick } from "./refresh";
import { autoPowerRankingsTick, buildPacket, publishNow, weekSeason } from "./auto";
import type { FactPacket } from "./factCheck";
import type { PowerRankingsResponse } from "../../src/shared/powerRankings";

const S = 2026;
const TEAMS = Array.from({ length: 30 }, (_, i) => 7000 + i);
const KEY = "cs-test-internal-key-0123456789abcdef";
const FRI = Date.parse("2026-10-23T04:00:00Z"); // Friday 00:00 EDT, week 43
const SAT = Date.parse("2026-10-24T15:00:00Z");
const MON = Date.parse("2026-10-26T04:00:00Z"); // Monday 00:00 EDT
const NEXT_FRI = Date.parse("2026-10-30T04:00:00Z"); // week 44
const SAT0 = Date.parse("2026-10-24T04:00:00Z"); // Saturday 00:00 EDT: the first daily check
const SUN0 = Date.parse("2026-10-25T04:00:00Z");

// --- The stand-in for Control Point -------------------------------------------------------------
type Mode = "good" | "adversarial" | "error" | "malformed";
let mode: Mode = "good";
// owner_audit is append-only (migration 52): each test reads the rows written since it started.
let auditFrom = 0;
const calls: { key: string | undefined; packet: FactPacket }[] = [];
let cp: Server;
let whileWriting: (() => Promise<unknown>) | null = null;

function answer(p: FactPacket) {
  const blurbs = p.teams.map((t) => ({ team: t.team, text: `${t.name} sits at #${t.rank} with a rating of ${t.rating.toFixed(1)}.` }));
  if (mode === "adversarial") {
    blurbs[0].text = `${p.teams[0].name} dropped a 312-point score on the field.`; // invented number
    blurbs[1].text = "Their FTC Scout page says it all."; // another site
    blurbs[2].text = `Edging past ${p.teams[0].team} for the spot.`; // another team's number
    blurbs.splice(3, 1); // one missing
  }
  return { intro: mode === "adversarial" ? "See ftcscout.org for 999 more stats." : `Week ${Number(p.week.slice(6))} is here.`, blurbs };
}

// --- The app and its data -------------------------------------------------------------------------
let server: Server;
let base = "";
let dir = "";
let index = "";
let ownerCookie = "", otherCookie = "";
const saved = { ...process.env };

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

/** Ratings: team 7000 + i rated 500 - i*10 (so 7000 leads), or `order` to rank a different way. */
let version = 0;
async function rate(order: number[] = TEAMS) {
  await run("DELETE FROM team_season_stats WHERE season = ?", [S]);
  for (const [i, t] of order.entries()) {
    await run("INSERT INTO team_season_stats (season, team, rating_np, opr_np, wins, losses, ties, matches, rating_matches, events) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1)",
      [S, t, 500 - i * 10 + 0.04, 300 - i * 5 + 0.26, 9, 1, 10, 10]);
  }
  await kvSet("data:version", `v${++version}`); // the live ranking is cached by data version
}

function weekFile(week: string, published: string, teams: number[]) {
  return ["---", `title: Power rankings, week ${Number(week.slice(6))}`, `season: ${S}`, `week: ${week}`, `published: ${published}`, "intro: |", "  Hand-written.", "---", "",
    ...teams.slice(0, 25).flatMap((t, i) => [`## ${i + 1}. ${t}`, `Hand-written blurb for ${t}.`, ""])].join("\n");
}

const rows = () => all<{ season: number; week: string; status: string; entries: string; intro_source: string; packet: string; published: string }>("SELECT * FROM power_rankings_generated ORDER BY week");

beforeAll(async () => {
  // "Today" is after the weeks these tests publish (only Date is faked: timers and sockets run normally).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-11-01T12:00:00Z"));
  cp = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      const packet = JSON.parse(body || "{}");
      calls.push({ key: req.headers["x-internal-key"] as string | undefined, packet });
      // Something that happens while Bruno is writing (once): e.g. the daily refresh updating the week.
      const d = whileWriting;
      whileWriting = null;
      if (d) await d();
      if (req.url !== "/internal/bruno/power-rankings") { res.writeHead(404).end("{}"); return; }
      if (mode === "error") { res.writeHead(502, { "Content-Type": "application/json" }).end('{"error":"ai_failed"}'); return; }
      if (mode === "malformed") { res.writeHead(200, { "Content-Type": "application/json" }).end('{"intro": 5, "blurbs": "nope"}'); return; }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answer(packet)));
    });
  }).listen(0);
  await new Promise((r) => cp.once("listening", r));

  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const t of TEAMS) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Austin', 'TX', 'USA')", [t, `Bots ${t}`]);
  await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'TXCMP', 'Texas Championship', 'Championship', '2026-10-17', '2026-10-18', 'first')", [S]);
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, 'TXCMP', 7000, 2), (?, 'TXCMP', 7001, 1), (?, 'TXCMP', 7002, 3)", [S, S, S]);
  await run("INSERT INTO team_event_stats (season, code, team, matches) VALUES (?, 'TXCMP', 7000, 6)", [S]);
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'TXCMP', 'Winner', 1, 7000, 'Winning Alliance - Captain'), (?, 'TXCMP', 'Innovate', 1, 7000, 'Innovate Award sponsored by RTX')", [S, S]);
  dir = mkdtempSync(join(tmpdir(), "pr-auto-"));
  useContentDir(dir);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  index = join(mkdtempSync(join(tmpdir(), "pr-auto-html-")), "index.html");
  writeFileSync(index, '<html><head><title>FTC Control Scout</title>\n<meta name="description" content="generic" />\n</head><body><div id="root"></div></body></html>');
  ownerCookie = await signIn("owner@example.com");
  otherCookie = await signIn("scout@example.com");
});
afterAll(() => {
  vi.useRealTimers();
  server?.close();
  cp?.close();
  useContentDir(null);
  rmSync(dir, { recursive: true, force: true });
  process.env = saved;
});
beforeEach(async () => {
  process.env.CONTROL_POINT_INTERNAL_URL = `http://127.0.0.1:${(cp.address() as AddressInfo).port}`;
  process.env.CONTROL_POINT_INTERNAL_KEY = KEY;
  process.env.OWNER_EMAILS = "owner@example.com";
  process.env.APP_URL = "https://controlscout.org";
  mode = "good";
  whileWriting = null;
  calls.length = 0;
  for (const t of ["power_rankings_generated", "power_rankings_refreshes", "feature_flags"]) await run(`DELETE FROM ${t}`);
  auditFrom = Number((await get<{ n: number }>("SELECT COALESCE(MAX(id), 0) n FROM owner_audit"))!.n);
  for (const f of ["2026-w42.md", "2026-w43.md", "2026-w44.md"]) rmSync(join(dir, f), { force: true });
  useContentDir(dir);
  invalidateGenerated();
  invalidateFlags();
  resetSitemapCache();
  // Undo what the frozen-week tests change: last season's ratings and a renamed team.
  await run("DELETE FROM team_season_stats WHERE season <> ?", [S]);
  await run("UPDATE teams SET name = 'Bots ' || number");
  await rate();
});

const api = async (path: string) => (await call("GET", path)).json as PowerRankingsResponse;

describe("the fact packet", () => {
  it("the live top 25 with record, OPR, last event (rank and awards) and no movement without a previous week", async () => {
    const p = await buildPacket(S, "2026-w43", FRI);
    expect(p.teams).toHaveLength(25);
    expect(p.comparedWith).toBeNull();
    expect(p.teams[0]).toEqual({
      team: 7000, name: "Bots 7000", rank: 1, priorRank: null, movement: null, rating: 500, ratingDelta: null,
      record: { wins: 9, losses: 1, ties: 0 }, opr: 300.3,
      lastEvent: { name: "Texas Championship", result: "Ranked 2 of 3; Winning alliance; Innovate Award" },
    });
    expect(p.teams[1].lastEvent).toBeNull(); // no matches played at an event
    expect(p.teams.map((t) => t.team)).toEqual(TEAMS.slice(0, 25));
  });

  it("movement and rating change against the previous published week, generated or hand-written", async () => {
    await autoPowerRankingsTick(FRI);
    // Next week 7005 is the best team, everyone else keeps their order.
    await rate([7005, ...TEAMS.filter((t) => t !== 7005)]);
    const p = await buildPacket(S, "2026-w44", NEXT_FRI);
    expect(p.comparedWith).toBe("2026-w43");
    expect(p.teams[0]).toMatchObject({ team: 7005, rank: 1, priorRank: 6, movement: 5, rating: 500, ratingDelta: 50 });
    expect(p.teams[1]).toMatchObject({ team: 7000, rank: 2, priorRank: 1, movement: -1, ratingDelta: -10 });
    // A hand-written week 43 replaces the generated one, and is what week 44 is compared with (no ratings in it).
    writeFileSync(join(dir, "2026-w43.md"), weekFile("2026-w43", "2026-10-23", [7029, ...TEAMS.slice(0, 24)]));
    const q = await buildPacket(S, "2026-w44", NEXT_FRI);
    expect(q.teams[0]).toMatchObject({ team: 7005, priorRank: 7, movement: 6, ratingDelta: null });
    expect(q.teams.find((t) => t.team === 7024)).toMatchObject({ priorRank: null, movement: null });
  });
});

describe("the Friday schedule", () => {
  it("nothing before Friday 00:00 New York time; publishes at it; Control Point gets the key and the packet", async () => {
    expect(await autoPowerRankingsTick(FRI - 1000)).toBeNull();
    expect(await rows()).toHaveLength(0);
    const r = await autoPowerRankingsTick(FRI);
    expect(r).toMatchObject({ status: "published", season: S, week: "2026-w43", bruno: 25, template: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe(KEY);
    expect(calls[0].packet).toMatchObject({ season: S, week: "2026-w43" });
    expect(calls[0].packet).not.toHaveProperty("comparedWith");
    const [row] = await rows();
    expect(row).toMatchObject({ season: S, week: "2026-w43", status: "published", published: "2026-10-23", intro_source: "bruno" });
    // The frozen copy of the facts it was written from.
    expect(JSON.parse(row.packet).teams[0]).toMatchObject({ team: 7000, rank: 1, rating: 500 });
  });

  it("no double publish: later ticks, a second server's tick and Publish now all leave the week alone", async () => {
    await autoPowerRankingsTick(FRI);
    await Promise.all([autoPowerRankingsTick(FRI + 300_000), autoPowerRankingsTick(SAT)]);
    expect(calls).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
    const now = await publishNow(SAT);
    expect(now.status).toBe("exists");
    expect(calls).toHaveLength(1);
  });

  it("two ticks at once: one claims the week, the other doesn't call Bruno", async () => {
    const [a, b] = await Promise.all([autoPowerRankingsTick(FRI), autoPowerRankingsTick(FRI)]);
    expect([a?.status, b?.status].sort()).toEqual(["exists", "published"]);
    expect(calls).toHaveLength(1);
  });

  it("catches up after downtime (Saturday), but not into the next ISO week (Monday)", async () => {
    expect(await autoPowerRankingsTick(MON)).toBeNull();
    expect(await rows()).toHaveLength(0);
    expect(await autoPowerRankingsTick(SAT)).toMatchObject({ status: "published", week: "2026-w43" });
    expect((await rows())[0].published).toBe("2026-10-23"); // still the Friday's week and date
  });

  it("a run that died mid-way is taken over after 15 minutes; a fresh claim isn't", async () => {
    await run("INSERT INTO power_rankings_generated (season, week, published, status, generated_at) VALUES (?, '2026-w43', '2026-10-23', 'pending', ?)", [S, new Date(FRI).toISOString()]);
    expect(await autoPowerRankingsTick(FRI + 60_000)).toMatchObject({ status: "exists" });
    expect(calls).toHaveLength(0);
    expect(await autoPowerRankingsTick(FRI + 16 * 60_000)).toMatchObject({ status: "published" });
  });

  it("the switch off: nothing is generated, and Publish now is refused", async () => {
    await run("INSERT INTO feature_flags (name, enabled, updated_at, updated_by) VALUES ('autoPowerRankings', 0, ?, 'test')", [new Date().toISOString()]);
    invalidateFlags();
    expect(await autoPowerRankingsTick(FRI)).toMatchObject({ status: "off" });
    expect((await publishNow(SAT)).status).toBe("off");
    expect(await rows()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("a hand-written file for the week: nothing is generated for it", async () => {
    writeFileSync(join(dir, "2026-w43.md"), weekFile("2026-w43", "2026-10-23", TEAMS));
    expect(await autoPowerRankingsTick(FRI)).toMatchObject({ status: "overridden" });
    expect(await rows()).toHaveLength(0);
  });
});

describe("the fact check and the template", () => {
  it("adversarial output: the invented number, the site mention, another team's number and the missing blurb become the template", async () => {
    mode = "adversarial";
    expect(await autoPowerRankingsTick(FRI)).toMatchObject({ status: "published", bruno: 21, template: 4 });
    const entries = JSON.parse((await rows())[0].entries);
    expect(entries.slice(0, 4).map((e: any) => e.source)).toEqual(["template", "template", "template", "template"]);
    expect(entries[0].rejected).toEqual(['unknown number "312"']);
    expect(entries[1].rejected).toEqual(["mentions another site or a web address"]);
    expect(entries[2].rejected).toEqual(['unknown number "7000"']);
    expect(entries[3].rejected).toEqual(["no blurb"]);
    expect(entries[0].text).toBe("#1, 9-1 this season, last at Texas Championship (Ranked 2 of 3; Winning alliance; Innovate Award); rating 500.0, OPR 300.3.");
    expect((await rows())[0].intro_source).toBe("template");
    const w = (await api("/api/power-rankings")).week!;
    expect(JSON.stringify(w)).not.toMatch(/FTC Scout|ftcscout|312/);
  });

  for (const [label, setup] of [
    ["Control Point errors", () => { mode = "error"; }],
    ["Control Point answers malformed JSON", () => { mode = "malformed"; }],
    ["Control Point is unreachable", () => { process.env.CONTROL_POINT_INTERNAL_URL = "http://127.0.0.1:9"; }],
    ["Control Point isn't configured", () => { delete process.env.CONTROL_POINT_INTERNAL_URL; }],
  ] as const) {
    it(`${label}: the whole week is the template, and it still publishes`, async () => {
      setup();
      expect(await autoPowerRankingsTick(FRI)).toMatchObject({ status: "published", bruno: 0, template: 25 });
      const [row] = await rows();
      expect(JSON.parse(row.entries).every((e: any) => e.source === "template")).toBe(true);
      expect(row.intro_source).toBe("template");
      const w = (await api("/api/power-rankings")).week!;
      expect(w.generated).toEqual({ bruno: 0, template: 25, owner: 0, intro: "template" });
    });
  }
});

describe("serving", () => {
  it("a generated week is served like a file week: page, labels, plain-text blurbs, SEO, sitemap", async () => {
    mode = "adversarial";
    await autoPowerRankingsTick(FRI);
    const r = await api("/api/power-rankings/2026-w43");
    expect(r.week).toMatchObject({ week: "2026-w43", title: "Power rankings, week 43", published: "2026-10-23", generated: { bruno: 21, template: 4, owner: 0, intro: "template" } });
    expect(r.week!.entries[4]).toMatchObject({ author: "bruno", blurbHtml: "<p>Bots 7004 sits at #5 with a rating of 460.0.</p>" });
    expect(r.week!.entries[0].author).toBe("template");
    const page = await renderPage(index, "/power-rankings/2026-w43");
    expect(page.status).toBe(200);
    expect(page.html).toContain("Published Friday, Oct 23");
    expect(page.html).toContain("Blurbs written by Bruno, Control Point's AI, from this week's data.");
    expect(page.html).toContain("<small>Data summary</small>");
    const urls = (await sitemapEntries()).map((e) => e.loc);
    expect(urls).toContain("https://controlscout.org/power-rankings/2026-w43");
  });

  it("an all-template week isn't labelled as Bruno's", async () => {
    mode = "error";
    await autoPowerRankingsTick(FRI);
    const page = await renderPage(index, "/power-rankings");
    expect(page.html).toContain("Published automatically from this week's data.");
    expect(page.html).not.toContain("Bruno");
  });

  it("a published hand-written file for the same week takes precedence", async () => {
    await autoPowerRankingsTick(FRI);
    writeFileSync(join(dir, "2026-w43.md"), weekFile("2026-w43", "2026-10-23", TEAMS));
    const r = await api("/api/power-rankings/2026-w43");
    expect(r.week!.generated).toBeNull();
    expect(r.week!.introHtml).toBe("<p>Hand-written.</p>");
    expect(r.archive.map((a) => a.week)).toEqual(["2026-w43"]);
  });

  it("movement across sources: a generated week after a hand-written one, and back", async () => {
    writeFileSync(join(dir, "2026-w42.md"), weekFile("2026-w42", "2026-10-16", [7003, ...TEAMS.filter((t) => t !== 7003)]));
    await autoPowerRankingsTick(FRI);
    const w43 = (await api("/api/power-rankings/2026-w43")).week!;
    expect(w43.comparedWith).toBe("2026-w42");
    expect(w43.entries[0]).toMatchObject({ team: 7000, movement: { kind: "up", by: 1 } });
    expect(w43.entries[3]).toMatchObject({ team: 7003, movement: { kind: "down", by: 3 } });
    // The packet Bruno got said the same.
    expect(calls[0].packet.teams[3]).toMatchObject({ team: 7003, priorRank: 1, movement: -3 });
    // A hand-written week 44 compares with the generated week 43.
    writeFileSync(join(dir, "2026-w44.md"), weekFile("2026-w44", "2026-10-30", [7001, ...TEAMS.filter((t) => t !== 7001)]));
    const w44 = (await api("/api/power-rankings/2026-w44")).week!;
    expect(w44.comparedWith).toBe("2026-w43");
    expect(w44.entries[0]).toMatchObject({ team: 7001, movement: { kind: "up", by: 1 } });
  });

  it("a generated week keeps the comparison its blurbs were written from, even when the earlier week changes", async () => {
    writeFileSync(join(dir, "2026-w42.md"), weekFile("2026-w42", "2026-10-16", [7003, ...TEAMS.filter((t) => t !== 7003)]));
    await autoPowerRankingsTick(FRI);
    // The earlier week is rewritten in a different order: week 43's arrows and blurbs still say what they said.
    writeFileSync(join(dir, "2026-w42.md"), weekFile("2026-w42", "2026-10-16", [...TEAMS].reverse()));
    let w43 = (await api("/api/power-rankings/2026-w43")).week!;
    expect(w43.comparedWith).toBe("2026-w42");
    expect(w43.entries[3]).toMatchObject({ team: 7003, movement: { kind: "down", by: 3 } });
    expect(w43.entries[0]).toMatchObject({ team: 7000, movement: { kind: "up", by: 1 } });
    // Nobody dropped out then (the rewritten week would say 7029…7025 did).
    expect(w43.droppedOut).toEqual([]);
    // And when it's gone altogether.
    rmSync(join(dir, "2026-w42.md"));
    w43 = (await api("/api/power-rankings/2026-w43")).week!;
    expect(w43.comparedWith).toBe("2026-w42");
    expect(w43.entries[3].movement).toEqual({ kind: "down", by: 3 });
  });
});

describe("a week is frozen with its text", () => {
  const lines = (w: PowerRankingsResponse["week"]) => w!.entries.map((e) => ({ team: e.team, rank: e.rank, name: e.name, stats: e.stats }));

  it("an archived week never changes after the stats move, the teams are renamed and the next week goes out", async () => {
    await autoPowerRankingsTick(FRI);
    const before = (await api("/api/power-rankings/2026-w43")).week!;
    // Its lines are the packet its blurbs were written from: 7004 "sits at #5 with a rating of 460.0", and the line says 460.
    expect(before.entries[4]).toMatchObject({ team: 7004, name: "Bots 7004", stats: { rating: 460, ratingRank: 5, opr: 280.3, wins: 9, losses: 1, ties: 0 } });
    expect(before.entries[4].blurbHtml).toContain("460.0");
    expect(before.statsAsOf).toBe("2026-10-23");
    // A week later: every rating, OPR and record moves, a team is renamed, and week 44 goes out.
    await rate([...TEAMS].reverse());
    await run("UPDATE team_season_stats SET wins = 20, losses = 5, opr_np = opr_np + 40 WHERE season = ?", [S]);
    await run("UPDATE teams SET name = 'Renamed Bots' WHERE number = 7020");
    await kvSet("data:version", `v${++version}`);
    expect(await autoPowerRankingsTick(NEXT_FRI)).toMatchObject({ status: "published", week: "2026-w44" });
    invalidateGenerated();
    const after = (await api("/api/power-rankings/2026-w43")).week!;
    expect(lines(after)).toEqual(lines(before));
    expect(after.entries.map((e) => e.blurbHtml)).toEqual(before.entries.map((e) => e.blurbHtml));
    expect(after.statsAsOf).toBe("2026-10-23");
    // The new week has the new numbers and name.
    const w44 = (await api("/api/power-rankings/2026-w44")).week!;
    expect(w44.entries[0]).toMatchObject({ team: 7029, stats: { wins: 20, losses: 5 } });
    expect(w44.entries.find((e) => e.team === 7020)?.name).toBe("Renamed Bots");
    expect(after.entries.find((e) => e.team === 7020)?.name).toBe("Bots 7020");
    // The page says what the numbers are.
    const page = await renderPage(index, "/power-rankings/2026-w43");
    expect(page.html).toContain("Stats as of Oct 23, 2026.");
  });

  it("a team with no name when the week went out stays nameless in that week, on its page and in the archive", async () => {
    await run("UPDATE teams SET name = NULL WHERE number = 7000");
    await autoPowerRankingsTick(FRI);
    await run("UPDATE teams SET name = 'Named Later' WHERE number = 7000");
    invalidateGenerated();
    const w = (await api("/api/power-rankings/2026-w43")).week!;
    expect(w.entries.find((e) => e.team === 7000)?.name).toBeNull();
    const archive = await api("/api/power-rankings");
    expect(JSON.stringify(archive)).not.toContain("Named Later");
  });

  it("the list is in the order of the rating it shows, and each line's world rank is its place", async () => {
    await autoPowerRankingsTick(FRI);
    await rate([7003, 7001, 7000, ...TEAMS.filter((t) => t > 7003), 7002]); // the live order moves after it went out
    const w = (await api("/api/power-rankings/2026-w43")).week!;
    const ratings = w.entries.map((e) => e.stats!.rating!);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    expect(w.entries.map((e) => e.stats!.ratingRank)).toEqual(w.entries.map((e) => e.rank));
  });

  it("a week is tagged by the season its dates fall in, and one with no rated team of that season isn't published", async () => {
    expect(weekSeason("2026-10-16")).toBe(2026);
    expect(weekSeason("2026-08-28")).toBe(2025);
    expect(weekSeason("2027-03-05")).toBe(2026);
    // Week 42 (Friday Oct 16, 2026) when only last season's teams are rated: nothing goes out under it.
    await run("UPDATE team_season_stats SET season = 2025 WHERE season = ?", [S]);
    await kvSet("data:version", `v${++version}`);
    const FRI42 = Date.parse("2026-10-16T04:00:00Z");
    expect(await autoPowerRankingsTick(FRI42)).toMatchObject({ status: "empty", season: 2026, week: "2026-w42" });
    expect(await rows()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("a week ranked on another season's numbers says so, links that season's rankings, and isn't what the next week compares with", async () => {
    // As week 2026-w42 went out: tagged 2026 (migration 51), its packet from 2025–26.
    await run("UPDATE team_season_stats SET season = 2025 WHERE season = ?", [S]);
    await kvSet("data:version", `v${++version}`);
    const old = await buildPacket(2025, "2026-w42", Date.parse("2026-10-16T04:00:00Z"));
    const entries = old.teams.map((t) => ({ rank: t.rank, team: t.team, text: `#${t.rank}`, source: "template" }));
    await run("INSERT INTO power_rankings_generated (season, week, published, status, intro, intro_source, entries, packet, generated_at) VALUES (2026, '2026-w42', '2026-10-16', 'published', 'Week 42.', 'template', ?, ?, ?)",
      [JSON.stringify(entries), JSON.stringify(old), new Date(FRI).toISOString()]);
    invalidateGenerated();
    const w42 = (await api("/api/power-rankings/2026-w42")).week!;
    expect(w42).toMatchObject({ season: 2026, dataSeason: 2025, statsAsOf: "2026-10-16", worldRankings: "/rankings?season=2025" });
    expect(w42.entries[0].stats).toMatchObject({ rating: 500, ratingRank: 1 });
    expect((await renderPage(index, "/power-rankings/2026-w42")).html).toContain("Ratings and records are from the 2025–26 season.");
    // This season's week 43 counts no movement against it.
    await run("UPDATE team_season_stats SET season = ? WHERE season = 2025", [S]);
    await kvSet("data:version", `v${++version}`);
    const p = await buildPacket(S, "2026-w43", FRI);
    expect(p.comparedWith).toBeNull();
    expect(p.notes).toBe('This is week 43 of the 2026–27 FTC season. Call it "week 43", never "2026-w43", and the season "2026–27".');
  });
});

describe("the owner panel", () => {
  it("is a 403 for anyone but the owner, read or write", async () => {
    for (const cookie of [undefined, otherCookie]) {
      expect((await call("GET", "/api/owner/power-rankings", { cookie })).status).toBe(403);
      expect((await call("POST", "/api/owner/power-rankings/publish-now", { cookie, body: { confirm: true } })).status).toBe(403);
      expect((await call("PATCH", `/api/owner/power-rankings/${S}/2026-w43`, { cookie, body: { confirm: true, intro: "x" } })).status).toBe(403);
    }
    expect(calls).toHaveLength(0);
  });

  it("lists weeks with who wrote what; every action needs confirm and is audited", async () => {
    mode = "adversarial";
    await autoPowerRankingsTick(FRI);
    const list = await call("GET", "/api/owner/power-rankings", { cookie: ownerCookie });
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({ enabled: true, controlPoint: true });
    expect(list.json.weeks[0]).toMatchObject({ season: S, week: "2026-w43", status: "published", overridden: false, introSource: "template" });
    expect(list.json.weeks[0].entries[0]).toMatchObject({ team: 7000, name: "Bots 7000", source: "template", rejected: ['unknown number "312"'] });

    const path = `/api/owner/power-rankings/${S}/2026-w43`;
    // No confirmation: refused, nothing changes.
    expect((await call("PATCH", path, { cookie: ownerCookie, body: { intro: "Mine." } })).status).toBe(400);
    expect((await call("POST", `${path}/status`, { cookie: ownerCookie, body: { status: "hidden" } })).status).toBe(400);

    // Edit the intro and one blurb (with the version the editor opened; none: refused).
    const rev0 = list.json.weeks[0].rev;
    expect((await call("PATCH", path, { cookie: ownerCookie, body: { confirm: true, intro: "Mine." } })).status).toBe(400);
    const edit = await call("PATCH", path, { cookie: ownerCookie, body: { confirm: true, rev: rev0, intro: "Mine.", blurbs: [{ team: 7001, text: "Edited by hand." }] } });
    expect(edit.status).toBe(200);
    expect(edit.json.panel.weeks[0]).toMatchObject({ intro: "Mine.", introSource: "owner" });
    expect(edit.json.panel.weeks[0].entries[1]).toMatchObject({ team: 7001, text: "Edited by hand.", source: "owner" });
    const rev1 = edit.json.panel.weeks[0].rev;
    expect(rev1).not.toBe(rev0);
    // An overlapping save opened on the old version is refused, and the first save stands.
    const stale = await call("PATCH", path, { cookie: ownerCookie, body: { confirm: true, rev: rev0, blurbs: [{ team: 7002, text: "Second owner." }] } });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatch(/changed since you opened it/);
    const afterStale = (await call("GET", "/api/owner/power-rankings", { cookie: ownerCookie })).json.weeks[0];
    expect(afterStale.entries[1].text).toBe("Edited by hand.");
    expect(afterStale.entries[2].text).not.toBe("Second owner.");
    expect((await call("PATCH", path, { cookie: ownerCookie, body: { confirm: true, rev: rev1, blurbs: [{ team: 4242, text: "Nope" }] } })).status).toBe(400);
    const pub = (await api("/api/power-rankings/2026-w43")).week!;
    expect(pub.introHtml).toBe("<p>Mine.</p>");
    expect(pub.entries[1]).toMatchObject({ author: "owner", blurbHtml: "<p>Edited by hand.</p>" });
    expect((await get<{ edited_by: string }>("SELECT edited_by FROM power_rankings_generated"))!.edited_by).toBe("owner"); // never an email (the table is public)

    // Hide, then show again.
    expect((await call("POST", `${path}/status`, { cookie: ownerCookie, body: { confirm: true, status: "hidden" } })).status).toBe(200);
    expect((await call("GET", "/api/power-rankings/2026-w43")).status).toBe(404);
    expect((await api("/api/power-rankings")).week).toBeNull();
    expect((await call("POST", `${path}/status`, { cookie: ownerCookie, body: { confirm: true, status: "published" } })).status).toBe(200);
    expect((await call("GET", "/api/power-rankings/2026-w43")).status).toBe(200);

    // Regenerate: Bruno again, from the frozen packet, edits replaced.
    mode = "good";
    const regen = await call("POST", `${path}/regenerate`, { cookie: ownerCookie, body: { confirm: true } });
    expect(regen.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].packet).toEqual(calls[0].packet);
    expect(regen.json.panel.weeks[0].entries.every((e: any) => e.source === "bruno")).toBe(true);
    // Bruno unreachable: the week is left as it was.
    mode = "error";
    expect((await call("POST", `${path}/regenerate`, { cookie: ownerCookie, body: { confirm: true } })).status).toBe(502);
    expect(JSON.parse((await rows())[0].entries).every((e: any) => e.source === "bruno")).toBe(true);

    const audit = await all<{ actor: string; action: string; details: string; result: string | null }>("SELECT * FROM owner_audit WHERE id > ? ORDER BY id", [auditFrom]);
    expect(audit.map((a) => a.action)).toEqual(["powerRankings.edit", "powerRankings.hide", "powerRankings.unhide", "powerRankings.regenerate", "powerRankings.regenerate"]);
    expect(audit.every((a) => a.actor === "owner@example.com")).toBe(true);
    expect(JSON.parse(audit[0].details)).toEqual({ season: S, week: "2026-w43", intro: true, teams: [7001] });
    expect(audit[3].result).toBe("25 by Bruno, 0 from the template");
    expect(audit[4].result).toMatch(/^failed: Bruno couldn't be reached/);
  });

  it("Publish now: this week, right away, once; audited, refused when it exists", async () => {
    const first = await call("POST", "/api/owner/power-rankings/publish-now", { cookie: ownerCookie, body: { confirm: true } });
    expect(first.status).toBe(200);
    expect(first.json.result).toMatchObject({ status: "published", bruno: 25 });
    const again = await call("POST", "/api/owner/power-rankings/publish-now", { cookie: ownerCookie, body: { confirm: true } });
    expect(again.status).toBe(409);
    expect(again.json.error).toMatch(/already published/);
    expect(calls).toHaveLength(1);
    const audit = await all<{ action: string; result: string }>("SELECT action, result FROM owner_audit WHERE id > ? ORDER BY id", [auditFrom]);
    expect(audit.map((a) => a.action)).toEqual(["powerRankings.publishNow", "powerRankings.publishNow"]);
    expect(audit[1].result).toMatch(/^refused/);
  });
});

describe("the daily refresh", () => {
  const week = () => getGenerated(S, "2026-w43");
  const off = async (flag: string) => {
    await run("INSERT INTO feature_flags (name, enabled, updated_at, updated_by) VALUES (?, 0, ?, 'test')", [flag, new Date().toISOString()]);
    invalidateFlags();
  };
  /** 7003 and 7004 swap places (#4 and #5), everyone else keeps theirs. */
  const swap = () => rate([...TEAMS.slice(0, 3), 7004, 7003, ...TEAMS.slice(5)]);
  /** 7010 (#11) gets a new OPR: its numbers change, its place doesn't. */
  const newOpr = async () => { await run("UPDATE team_season_stats SET opr_np = 123.4 WHERE season = ? AND team = 7010", [S]); await kvSet("data:version", `v${++version}`); };

  it("nothing changed: the stored week is kept exactly, Bruno isn't asked, only the Updated date moves", async () => {
    await autoPowerRankingsTick(FRI);
    const before = (await week())!;
    expect(before.updated).toBeNull();
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "unchanged", week: "2026-w43", day: "2026-10-24" });
    const after = (await week())!;
    expect(after).toEqual({ ...before, updated: "2026-10-24" }); // same text, sources, packet and version
    expect(calls).toHaveLength(1); // Friday's call only
    // Once a day: later ticks the same day do nothing; the next day checks again.
    expect(await dailyRefreshTick(SAT0 + 3600_000)).toMatchObject({ status: "done" });
    expect(await dailyRefreshTick(SUN0 + 60_000)).toMatchObject({ status: "unchanged", day: "2026-10-25" });
    expect((await week())!.updated).toBe("2026-10-25");
    expect(await all("SELECT day, status, changed FROM power_rankings_refreshes ORDER BY day")).toEqual([
      { day: "2026-10-24", status: "unchanged", changed: 0 }, { day: "2026-10-25", status: "unchanged", changed: 0 },
    ]);
    // The page: "Published Friday, Oct 23 · Updated Sunday, Oct 25".
    const w = (await api("/api/power-rankings/2026-w43")).week!;
    expect(w).toMatchObject({ published: "2026-10-23", updated: "2026-10-25" });
    const page = await renderPage(index, "/power-rankings/2026-w43");
    expect(page.html).toContain("Published Friday, Oct 23 · Updated Sunday, Oct 25");
    expect(page.html).toContain('"dateModified":"2026-10-25"');
    expect((await sitemapEntries()).find((e) => e.loc.endsWith("/power-rankings/2026-w43"))?.lastmod).toBe("2026-10-25");
  });

  it("no Updated line on the day it went out, nor for a week never checked", async () => {
    await autoPowerRankingsTick(FRI);
    expect(await dailyRefreshTick(FRI + 3600_000)).toMatchObject({ status: "none" }); // Friday itself
    const w = (await api("/api/power-rankings/2026-w43")).week!;
    expect(w.updated).toBeNull();
    expect((await renderPage(index, "/power-rankings/2026-w43")).html).not.toContain("Updated");
  });

  it("something changed: only the teams whose place changed go to Bruno, in one call; the rest are kept", async () => {
    await autoPowerRankingsTick(FRI);
    const before = (await week())!;
    await swap();
    await newOpr();
    const r = await dailyRefreshTick(SAT0 + 60_000);
    expect(r).toEqual({ status: "updated", season: S, week: "2026-w43", day: "2026-10-24", changed: 3, bruno: 2, template: 0, kept: 0 });
    // One more call, with just the two teams that swapped (7010's blurb doesn't mention its OPR, so it stands).
    expect(calls).toHaveLength(2);
    expect(calls[1].packet.teams.map((t) => [t.team, t.rank])).toEqual([[7004, 4], [7003, 5]]);
    const after = (await week())!;
    expect(after.updated).toBe("2026-10-24");
    expect(after.rev).toBe(before.rev + 1);
    expect(after.entries.map((e) => e.team)).toEqual([...TEAMS.slice(0, 3), 7004, 7003, ...TEAMS.slice(5, 25)]);
    expect(after.entries[3]).toMatchObject({ team: 7004, rank: 4, source: "bruno", text: "Bots 7004 sits at #4 with a rating of 470.0." });
    expect(after.entries[4]).toMatchObject({ team: 7003, rank: 5, source: "bruno", text: "Bots 7003 sits at #5 with a rating of 460.0." });
    // Everyone else: Bruno's blurb from Friday, word for word.
    for (const i of [0, 1, 2, ...Array.from({ length: 20 }, (_, k) => k + 5)]) expect(after.entries[i]).toEqual(before.entries[i]);
    expect(after.intro).toBe(before.intro); // same leader, still checks out
    // The stored facts are the new ones (what a later check or Regenerate works from).
    expect(after.packet.teams.find((t) => t.team === 7010)?.opr).toBe(123.4);
    const panel = (await call("GET", "/api/owner/power-rankings", { cookie: ownerCookie })).json;
    expect(panel.daily).toEqual({ enabled: true, nextRun: "2026-11-02T05:00:00.000Z" }); // "today" in these tests is Nov 1
    expect(panel.weeks[0]).toMatchObject({ updated: "2026-10-24", refreshes: [{ day: "2026-10-24", status: "updated", changed: 3, bruno: 2, template: 0, kept: 0, note: null }] });
  });

  it("template blurbs are rebuilt from the new numbers without asking Bruno; the template intro too", async () => {
    mode = "error";
    await autoPowerRankingsTick(FRI);
    const before = (await week())!;
    mode = "good";
    await newOpr();
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "updated", changed: 1, bruno: 0, template: 1 });
    expect(calls).toHaveLength(1); // Friday's (failed) call only
    const after = (await week())!;
    expect(after.entries[10]).toMatchObject({ team: 7010, source: "template" });
    expect(after.entries[10].text).toContain("OPR 123.4");
    expect(after.entries.filter((e, i) => e.text !== before.entries[i].text).map((e) => e.team)).toEqual([7010]);
    expect(after.intro).toContain("as of Saturday, Oct 24");
  });

  it("a template team whose place changed is offered to Bruno; Bruno down means the template again", async () => {
    mode = "error";
    await autoPowerRankingsTick(FRI);
    mode = "good";
    await swap();
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "updated", changed: 2, bruno: 2, template: 0 });
    expect(calls[1].packet.teams.map((t) => t.team)).toEqual([7004, 7003]);
    await rate();
    mode = "error";
    expect(await dailyRefreshTick(SUN0 + 60_000)).toMatchObject({ status: "updated", changed: 2, bruno: 0, template: 2 });
    expect((await week())!.entries.slice(3, 5).map((e) => [e.team, e.source])).toEqual([[7003, "template"], [7004, "template"]]);
  });

  it("owner edits are never overwritten, even when the team moves", async () => {
    await autoPowerRankingsTick(FRI);
    const g = (await week())!;
    await editGenerated(S, "2026-w43", { blurbs: [{ team: 7003, text: "Written by the owner." }] }, String(g.rev));
    await swap();
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "updated", changed: 2, bruno: 1, kept: 1 });
    expect(calls[1].packet.teams.map((t) => t.team)).toEqual([7004]);
    expect((await week())!.entries[4]).toMatchObject({ team: 7003, rank: 5, source: "owner", text: "Written by the owner." });
  });

  it("an owner edit survives its team leaving the list and coming back", async () => {
    await autoPowerRankingsTick(FRI);
    await editGenerated(S, "2026-w43", { blurbs: [{ team: 7024, text: "Written by the owner." }] }, String((await week())!.rev));
    await run("UPDATE team_season_stats SET rating_matches = 0 WHERE season = ? AND team = 7024", [S]);
    await kvSet("data:version", `v${++version}`);
    await dailyRefreshTick(SAT0 + 60_000);
    const out = (await week())!;
    expect(out.entries.map((e) => e.team)).not.toContain(7024);
    expect(out.parked).toEqual([{ team: 7024, text: "Written by the owner." }]);
    await rate();
    calls.length = 0;
    expect(await dailyRefreshTick(SUN0 + 60_000)).toMatchObject({ status: "updated", kept: 1 });
    expect(calls.flatMap((c) => c.packet.teams.map((t) => t.team))).not.toContain(7024); // never sent to Bruno
    const back = (await week())!;
    expect(back.entries[24]).toEqual({ rank: 25, team: 7024, text: "Written by the owner.", source: "owner" });
    expect(back.parked).toEqual([]);
  });

  it("a new leader: Bruno's intro is written again (the whole packet goes, one call), blurbs only for teams that moved", async () => {
    await autoPowerRankingsTick(FRI);
    await rate([7001, 7000, ...TEAMS.slice(2)]);
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "updated", changed: 2, bruno: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[1].packet.teams).toHaveLength(25);
    expect((await week())!.introSource).toBe("bruno");
    expect((await get<{ note: string }>("SELECT note FROM power_rankings_refreshes"))!.note).toBe("intro rewritten (Bruno)");
  });

  it("keeps the comparison the week went out with, even when that earlier week is hidden", async () => {
    await rate([7003, ...TEAMS.filter((t) => t !== 7003)]);
    await autoPowerRankingsTick(Date.parse("2026-10-16T04:00:00Z")); // week 42
    await rate();
    await autoPowerRankingsTick(FRI);
    const before = (await week())!;
    expect(before.packet.comparedWith).toBe("2026-w42");
    await setGeneratedStatus(S, "2026-w42", "hidden");
    // The results didn't change, so neither does the week: same movement, rating changes and dropped teams.
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "unchanged" });
    expect((await week())!).toEqual({ ...before, updated: "2026-10-24" });
    // And when they do change, movement is still counted against week 42.
    await swap();
    expect(await dailyRefreshTick(SUN0 + 60_000)).toMatchObject({ status: "updated", changed: 2 });
    const after = (await week())!;
    expect(after.packet.comparedWith).toBe("2026-w42");
    expect(after.packet.teams[3]).toMatchObject({ team: 7004, priorRank: 5, movement: 1, ratingDelta: 10 });
    expect(after.packet.teams[4]).toMatchObject({ team: 7003, priorRank: 1, movement: -4 });
  });

  it("a team that drops out and comes back keeps its rating change against the compared week", async () => {
    await autoPowerRankingsTick(Date.parse("2026-10-16T04:00:00Z")); // week 42: 7000…7024
    await autoPowerRankingsTick(FRI); // week 43: the same, with rating changes of 0
    // Saturday 7024 loses its rating (out of the list, 7025 in); Sunday it's back.
    await run("UPDATE team_season_stats SET rating_matches = 0 WHERE season = ? AND team = 7024", [S]);
    await kvSet("data:version", `v${++version}`);
    await dailyRefreshTick(SAT0 + 60_000);
    expect((await week())!.packet.droppedOut).toEqual([{ team: 7024, lastRank: 25, rating: 260 }]);
    await rate();
    await dailyRefreshTick(SUN0 + 60_000);
    const back = (await week())!;
    expect(back.packet.teams[24]).toMatchObject({ team: 7024, priorRank: 25, movement: 0, ratingDelta: 0 });
    expect(back.packet.droppedOut).toEqual([]);
    // The page's dropped-out list carries no ratings.
    expect(toDoc((await getGenerated(S, "2026-w43"))!).generated!.droppedOut).toEqual([]);
  });

  it("Bruno's intro is checked again even when teams only leave the list", async () => {
    await autoPowerRankingsTick(FRI);
    await run("UPDATE power_rankings_generated SET intro = 'Bots 7024 rounds out the list at 25th... with 7024 in it.'");
    // Five teams lose their rating (too few matches): the list shrinks to 20, nobody else changes.
    await run("UPDATE team_season_stats SET rating_matches = 0 WHERE season = ? AND team >= 7020", [S]);
    await kvSet("data:version", `v${++version}`);
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "updated", changed: 0, bruno: 0 });
    expect(calls).toHaveLength(2);
    expect(calls[1].packet.teams).toHaveLength(20); // the whole (shorter) list, for the intro
    const after = (await week())!;
    expect(after.entries).toHaveLength(20);
    expect(after.intro).toBe("Week 43 is here.");
  });

  it("past weeks are frozen, hand-written weeks are never touched, and the switches turn it off", async () => {
    // A hand-written current week: nothing to do.
    writeFileSync(join(dir, "2026-w43.md"), weekFile("2026-w43", "2026-10-23", TEAMS));
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "none" });
    rmSync(join(dir, "2026-w43.md"));
    await autoPowerRankingsTick(FRI);
    const before = (await week())!;
    await swap();
    // From the next Friday, week 43 is a past week, even before week 44 is out.
    expect(await dailyRefreshTick(NEXT_FRI + 60_000)).toMatchObject({ status: "none" });
    // A week whose generated row a file replaced: never touched.
    writeFileSync(join(dir, "2026-w43.md"), weekFile("2026-w43", "2026-10-23", TEAMS));
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "none" });
    rmSync(join(dir, "2026-w43.md"));
    await off("dailyPowerRankings");
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "off" });
    await run("DELETE FROM feature_flags");
    await off("autoPowerRankings");
    expect(await dailyRefreshTick(SAT0 + 60_000)).toMatchObject({ status: "off" });
    expect(await week()).toEqual(before);
    expect(calls).toHaveLength(1);
    expect(await all("SELECT * FROM power_rankings_refreshes")).toEqual([]);
  });

  it("two servers at once: one check, one Bruno call", async () => {
    await autoPowerRankingsTick(FRI);
    await swap();
    const [a, b] = await Promise.all([dailyRefreshTick(SAT0 + 60_000), dailyRefreshTick(SAT0 + 60_000)]);
    expect([a.status, b.status].sort()).toEqual(["done", "updated"]);
    expect(calls).toHaveLength(2);
  });

  it("the owner panel's switch: off and on through the flags endpoint", async () => {
    expect((await call("PUT", "/api/owner/flags/dailyPowerRankings", { cookie: ownerCookie, body: { enabled: false } })).status).toBe(200);
    expect((await call("GET", "/api/owner/power-rankings", { cookie: ownerCookie })).json.daily.enabled).toBe(false);
    expect((await call("PUT", "/api/owner/flags/dailyPowerRankings", { cookie: ownerCookie, body: { enabled: true } })).status).toBe(200);
    expect((await call("GET", "/api/owner/power-rankings", { cookie: ownerCookie })).json.daily.enabled).toBe(true);
  });
});

describe("Regenerate: the words and the numbers come from one snapshot", () => {
  const path = `/api/owner/power-rankings/${S}/2026-w43`;
  const regen = () => call("POST", `${path}/regenerate`, { cookie: ownerCookie, body: { confirm: true } });
  /** Each blurb's rating ("… a rating of 470.0.") against the rating its own stat line shows on the page. */
  const agree = async () => {
    const w = (await api("/api/power-rankings/2026-w43")).week!;
    for (const e of w.entries) {
      const said = /rating of (-?\d+(?:\.\d+)?)/.exec(e.blurbHtml)?.[1];
      expect(Number(said), `team ${e.team}`).toBeCloseTo(e.stats!.rating!, 1);
    }
    return w;
  };

  it("after the live numbers move, Regenerate writes from the frozen snapshot and the page keeps that snapshot's numbers", async () => {
    await autoPowerRankingsTick(FRI);
    const before = (await getGenerated(S, "2026-w43"))!;
    await rate([...TEAMS].reverse()); // the live ranking turns upside down after the week went out
    expect((await regen()).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].packet).toEqual(calls[0].packet); // Bruno got the stored facts, not today's
    const after = (await getGenerated(S, "2026-w43"))!;
    expect(after.packet).toEqual(before.packet); // the snapshot itself is untouched
    expect(after.rev).toBe(before.rev + 1);
    const w = await agree();
    expect(w.entries.map((e) => e.team)).toEqual(TEAMS.slice(0, 25)); // the snapshot's order, not today's
    // The audit row says what the regeneration replaced and what it set.
    const row = (await all<{ old_value: string; new_value: string }>("SELECT old_value, new_value FROM owner_audit WHERE id > ? AND action = 'powerRankings.regenerate'", [auditFrom]))[0];
    expect(JSON.parse(row.old_value)).toMatchObject({ rev: String(before.rev), bruno: 25 });
    expect(JSON.parse(row.new_value)).toMatchObject({ rev: String(after.rev), bruno: 25 });
  });

  it("a daily refresh that lands while Bruno is writing wins: the regeneration is refused, never old words over new numbers", async () => {
    await autoPowerRankingsTick(FRI);
    await rate([...TEAMS.slice(0, 3), 7004, 7003, ...TEAMS.slice(5)]); // 7003 and 7004 swap places
    whileWriting = () => dailyRefreshTick(SAT0 + 60_000);
    const r = await regen();
    expect(r.status).toBe(409);
    const g = (await getGenerated(S, "2026-w43"))!;
    // The refresh's snapshot and its blurbs, together.
    expect(g.updated).toBe("2026-10-24");
    expect(g.packet.teams.slice(3, 5).map((t) => t.team)).toEqual([7004, 7003]);
    expect(g.entries.slice(3, 5).map((e) => e.team)).toEqual([7004, 7003]);
    await agree();
    const audit = await all<{ action: string; result: string }>("SELECT action, result FROM owner_audit WHERE id > ? ORDER BY id", [auditFrom]);
    expect(audit).toEqual([{ action: "powerRankings.regenerate", result: "refused: the week changed while Bruno was writing (an edit or the daily check); that version was kept" }]);
  });
});
