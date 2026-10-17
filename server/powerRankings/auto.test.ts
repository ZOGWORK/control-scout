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
import { invalidateGenerated } from "./generated";
import { autoPowerRankingsTick, buildPacket, publishNow } from "./auto";
import type { FactPacket } from "./factCheck";
import type { PowerRankingsResponse } from "../../src/shared/powerRankings";

const S = 2025;
const TEAMS = Array.from({ length: 30 }, (_, i) => 7000 + i);
const KEY = "cs-test-internal-key-0123456789abcdef";
const FRI = Date.parse("2026-10-23T04:00:00Z"); // Friday 00:00 EDT, week 43
const SAT = Date.parse("2026-10-24T15:00:00Z");
const MON = Date.parse("2026-10-26T04:00:00Z"); // Monday 00:00 EDT
const NEXT_FRI = Date.parse("2026-10-30T04:00:00Z"); // week 44

// --- The stand-in for Control Point -------------------------------------------------------------
type Mode = "good" | "adversarial" | "error" | "malformed";
let mode: Mode = "good";
const calls: { key: string | undefined; packet: FactPacket }[] = [];
let cp: Server;

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
    req.on("end", () => {
      const packet = JSON.parse(body || "{}");
      calls.push({ key: req.headers["x-internal-key"] as string | undefined, packet });
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
  calls.length = 0;
  for (const t of ["power_rankings_generated", "owner_audit", "feature_flags"]) await run(`DELETE FROM ${t}`);
  for (const f of ["2026-w42.md", "2026-w43.md", "2026-w44.md"]) rmSync(join(dir, f), { force: true });
  useContentDir(dir);
  invalidateGenerated();
  invalidateFlags();
  resetSitemapCache();
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
});

describe("the owner panel", () => {
  it("is a 404 for anyone but the owner, read or write", async () => {
    for (const cookie of [undefined, otherCookie]) {
      expect((await call("GET", "/api/owner/power-rankings", { cookie })).status).toBe(404);
      expect((await call("POST", "/api/owner/power-rankings/publish-now", { cookie, body: { confirm: true } })).status).toBe(404);
      expect((await call("PATCH", `/api/owner/power-rankings/${S}/2026-w43`, { cookie, body: { confirm: true, intro: "x" } })).status).toBe(404);
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

    // Edit the intro and one blurb.
    const edit = await call("PATCH", path, { cookie: ownerCookie, body: { confirm: true, intro: "Mine.", blurbs: [{ team: 7001, text: "Edited by hand." }] } });
    expect(edit.status).toBe(200);
    expect(edit.json.panel.weeks[0]).toMatchObject({ intro: "Mine.", introSource: "owner" });
    expect(edit.json.panel.weeks[0].entries[1]).toMatchObject({ team: 7001, text: "Edited by hand.", source: "owner" });
    expect((await call("PATCH", path, { cookie: ownerCookie, body: { confirm: true, blurbs: [{ team: 4242, text: "Nope" }] } })).status).toBe(400);
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

    const audit = await all<{ actor: string; action: string; details: string; result: string | null }>("SELECT * FROM owner_audit ORDER BY id");
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
    const audit = await all<{ action: string; result: string }>("SELECT action, result FROM owner_audit ORDER BY id");
    expect(audit.map((a) => a.action)).toEqual(["powerRankings.publishNow", "powerRankings.publishNow"]);
    expect(audit[1].result).toMatch(/^refused/);
  });
});
