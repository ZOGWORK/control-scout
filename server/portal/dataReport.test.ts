// The owner console's Data & sync and Packs & offline reports (/api/owner/data, /api/owner/packs) against the
// real app on an in-memory database: owner only, each data-quality check on fixture rows, no write to match
// data, and the pack listing read from a fixture manifest.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { invalidateFlags, setFlag } from "../flags";
import { canonicalUrl } from "../seo";
import { CURRENT_SEASON } from "../data/seasons";
import { endedNoMatches, recordMismatch, resetDataReport, seasonBelowEvents, sitemap404, sitemapMiss } from "./dataReport";

let server: Server;
let base = "";
const saved = { owners: process.env.OWNER_EMAILS, dataDir: process.env.DATA_DIR };
let ownerCookie = "", otherCookie = "";
let dir = "";

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}
async function call(path: string, cookie?: string) {
  const res = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const S = CURRENT_SEASON;

async function fixture() {
  for (const t of ["events", "matches", "match_teams", "event_teams", "team_season_stats", "team_event_stats", "teams"]) await run(`DELETE FROM ${t}`);
  await run("DELETE FROM kv WHERE key LIKE 'sync:%' OR key IN ('stats:last', 'records:last', 'packs:last')");
  const ev = (code: string, type: string, start: string, end: string, detail: string | null = day(-1)) =>
    run("INSERT INTO events (season, code, name, type, start, end, source, detail_synced_at) VALUES (?, ?, ?, ?, ?, ?, 'first', ?)", [S, code, `Event ${code}`, type, start, end, detail]);
  await ev("PLAYED", "Qualifier", day(-10), day(-10));
  await ev("EMPTY", "Qualifier", day(-9), day(-9));          // ended, no matches: flagged
  await ev("EMPTYOLD", "LeagueMeet", day(-30), day(-30), null); // ended, no matches, never fetched: flagged
  await ev("WORKSHOP", "Workshop", day(-8), day(-8));        // a kind that never has matches: not flagged
  await ev("YESTERDAY", "Qualifier", day(-1), day(-1));      // inside the grace days: not flagged yet
  await ev("FUTURE", "Qualifier", day(5), day(5));           // not started: not flagged
  await ev("UNPLAYED", "Qualifier", day(-7), day(-7));       // a scheduled match never played: flagged
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'PLAYED', 'qual', 0, 1, 'Q1', 1, 'first')", [S]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'UNPLAYED', 'qual', 0, 1, 'Q1', 0, 'first')", [S]);
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'EMPTY', 4215), (?, 'EMPTY', 4216)", [S, S]);
  // Season records: one adds up, one doesn't.
  await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties) VALUES (?, 4215, 10, 6, 3, 1), (?, 4216, 10, 6, 3, 0)", [S, S]);
  // Event rows: 4215's events count 8 of its 10 (fine); 4216's count 12 (more than its season total); 4217 has no season row.
  await run(`INSERT INTO team_event_stats (season, code, team, matches) VALUES (?, 'PLAYED', 4215, 5), (?, 'EMPTY', 4215, 3),
    (?, 'PLAYED', 4216, 12), (?, 'PLAYED', 4217, 4)`, [S, S, S, S]);
  await run("INSERT INTO teams (number, name) VALUES (4215, 'Overclocked'), (4216, 'Gears')");
  await run("INSERT INTO seasons (season, name, last_sync, last_complete) VALUES (?, 'x', ?, NULL) ON CONFLICT(season) DO UPDATE SET last_sync = excluded.last_sync, last_complete = NULL", [S, new Date().toISOString()]);
  await kvSet("sync:last", { at: new Date().toISOString(), reports: [{ season: S, listed: 7, detailed: 4, failed: [{ code: "BROKEN", error: "FIRST 500" }], fallback: 1, teams: 0 }] });
  await kvSet(`sync:teams:${S}`, new Date().toISOString());
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  dir = mkdtempSync(join(tmpdir(), "cs-owner-packs-"));
  process.env.DATA_DIR = dir;
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerCookie = await signIn("owner@example.com");
  otherCookie = await signIn("scout@example.com");
});
afterAll(() => {
  server?.close();
  for (const [k, v] of [["OWNER_EMAILS", saved.owners], ["DATA_DIR", saved.dataDir]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  process.env.OWNER_EMAILS = "owner@example.com";
  await run("DELETE FROM feature_flags");
  invalidateFlags();
  resetDataReport();
  await fixture();
});

describe("who gets in", () => {
  it("answers 403 to signed-out visitors and to accounts that aren't owners", async () => {
    for (const p of ["/api/owner/data", "/api/owner/data?fresh=1", "/api/owner/packs"]) {
      expect((await call(p)).status, p).toBe(403);
      expect((await call(p, otherCookie)).status, p).toBe(403);
      expect((await call(p, ownerCookie)).status, p).toBe(200);
    }
  });
});

describe("data quality flags", () => {
  it("finds ended events of a kind that plays matches with no played match, newest first, after the grace days", async () => {
    const f = await endedNoMatches();
    expect(f.error).toBeNull();
    expect(f.count).toBe(3);
    expect(f.examples.map((x) => x.label)).toEqual([`${S} UNPLAYED: Event UNPLAYED`, `${S} EMPTY: Event EMPTY`, `${S} EMPTYOLD: Event EMPTYOLD`]);
    expect(f.examples[1].detail).toMatch(/2 teams listed/);
    expect(f.examples[2].detail).toMatch(/no teams listed · detail never fetched/);
    expect(f.examples[1].href).toBe(`/events/${S}/EMPTY`);
  });

  it("finds season records whose wins, losses and ties don't add up to the match count", async () => {
    const f = await recordMismatch();
    expect(f.count).toBe(1);
    expect(f.examples).toEqual([{ label: `${S} team 4216`, detail: "6-3-0 over 10 matches", href: "/teams/4216" }]);
  });

  it("finds season totals smaller than their events' qualification matches, a missing season row included", async () => {
    const f = await seasonBelowEvents();
    expect(f.count).toBe(2);
    expect(f.examples.map((x) => [x.label, x.detail])).toEqual([
      [`${S} team 4217`, "no season row; 4 event matches"],
      [`${S} team 4216`, "season 10 matches; events 12"],
    ]);
  });

  it("tests sitemap URLs against the routes: a page that exists passes, one that would 404 is flagged with why", async () => {
    expect(sitemapMiss(canonicalUrl("/"))).toBeNull();
    expect(sitemapMiss(canonicalUrl("/teams/4215"))).toBeNull();
    expect(sitemapMiss(canonicalUrl("/events/2025/USCAQ1"))).toBeNull();
    expect(sitemapMiss(canonicalUrl("/power-rankings/2026-w44"))).toBeNull();
    expect(sitemapMiss(canonicalUrl("/faq"))).toBeNull();
    expect(sitemapMiss(canonicalUrl("/no-such-page"))).toBe("no page at this path");
    expect(sitemapMiss(canonicalUrl("/teams/1234567"))).toBe("not a team number with a page");
    expect(sitemapMiss(canonicalUrl("/teams/abc"))).toBe("not a team number with a page");
    expect(sitemapMiss(canonicalUrl(`/events/2025/${encodeURIComponent("A B")}`))).toBe("event code the event page can't read");
    expect(sitemapMiss(canonicalUrl("/events/1999/X"))).toBe("season out of range");
    const f = await sitemap404(async () => [{ loc: canonicalUrl("/") }, { loc: canonicalUrl("/teams/1234567") }, { loc: canonicalUrl("/nope") }]);
    expect(f.count).toBe(2);
    expect(f.examples.map((x) => x.detail)).toEqual(["not a team number with a page", "no page at this path"]);
  });

  it("finds nothing wrong in the real sitemap of the fixture", async () => {
    const f = await sitemap404();
    expect(f.error).toBeNull();
    expect(f.count).toBe(0);
  });

  it("reports a check that fails as failed, and still runs the others", async () => {
    const f = await sitemap404(async () => { throw new Error("database busy"); });
    expect(f).toMatchObject({ count: 0, error: "database busy" });
  });
});

describe("GET /api/owner/data", () => {
  it("reports each season's sync, the last-run numbers, the timestamps and every flag", async () => {
    const r = await call("/api/owner/data", ownerCookie);
    expect(r.status).toBe(200);
    const cur = r.json.seasons.find((s: any) => s.season === S);
    expect(cur).toMatchObject({ current: true, frozen: false, events: 7, eventsDetailed: 6, matchesPlayed: 1, lastComplete: null,
      lastRun: { listed: 7, detailed: 4, failed: 1, fallback: 1, teams: 0 } });
    expect(cur.lastSync).toBeTruthy();
    expect(cur.teamsAt).toBeTruthy();
    expect(r.json.seasons[0].season).toBe(S); // newest first
    expect(r.json.timestamps.syncAt).toBeTruthy();
    expect(Object.fromEntries(r.json.flags.map((f: any) => [f.id, f.count]))).toEqual({
      "sync-failures": 1, "ended-no-matches": 3, "record-mismatch": 1, "season-below-events": 2, "sitemap-404": 0,
    });
    expect(r.json.flags[0].examples[0]).toEqual({ label: `${S} BROKEN`, detail: "FIRST 500", href: `/events/${S}/BROKEN` });
  });

  it("keeps the report a few minutes, and computes it again on ?fresh=1", async () => {
    const a = await call("/api/owner/data", ownerCookie);
    await run("DELETE FROM team_season_stats");
    const kept = await call("/api/owner/data", ownerCookie);
    expect(kept.json.computedAt).toBe(a.json.computedAt);
    const fresh = await call("/api/owner/data?fresh=1", ownerCookie);
    expect(fresh.json.flags.find((f: any) => f.id === "record-mismatch").count).toBe(0);
  });

  it("never writes match data: every results table is the same after both reports", async () => {
    const TABLES = ["events", "matches", "match_teams", "event_teams", "team_season_stats", "team_event_stats", "teams", "seasons", "alliances", "awards", "advancement"];
    const snap = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, JSON.stringify(await all(`SELECT * FROM ${t} ORDER BY 1, 2, 3`))] as const)));
    const before = await snap();
    for (const p of ["/api/owner/data", "/api/owner/data?fresh=1", "/api/owner/packs"]) expect((await call(p, ownerCookie)).status).toBe(200);
    expect(await snap()).toEqual(before);
  });
});

describe("GET /api/owner/packs", () => {
  const packs = () => join(dir, "packs");
  beforeEach(() => { rmSync(packs(), { recursive: true, force: true }); });

  it("says there are none before the first build", async () => {
    const r = await call("/api/owner/packs", ownerCookie);
    expect(r.json).toMatchObject({ manifest: null, files: [], totalBytes: 0, versionsOnDisk: [], serving: true, unavailable: null });
  });

  it("lists the manifest and every file with its season, kind, size and SHA-256, and which are on disk", async () => {
    mkdirSync(packs(), { recursive: true });
    const hash = (c: string) => c.repeat(64);
    const manifest = {
      format: 1, version: "2026-10-29.2", builtAt: "2026-10-29T08:00:00.000Z", engineVersion: "2.11.0", dataAsOf: "2026-10-29T07:55:00.000Z",
      lite: { name: "scout-pack-2026-10-29-2-lite.json.gz", url: "/packs/scout-pack-2026-10-29-2-lite.json.gz", bytes: 1_200_000, sha256: hash("a"), seasons: [2025, 2024], kind: "lite", contents: "" },
      full: [
        { name: "scout-pack-2026-10-29-2-2025.db", url: "/packs/scout-pack-2026-10-29-2-2025.db", bytes: 30_000_000, sha256: hash("b"), seasons: [2025], kind: "full", contents: "" },
        { name: "scout-pack-2026-10-29-2-2024.db", url: "/packs/scout-pack-2026-10-29-2-2024.db", bytes: 40_000_000, sha256: hash("c"), seasons: [2024], kind: "full", contents: "" },
      ],
    };
    writeFileSync(join(packs(), "latest.json"), JSON.stringify(manifest));
    for (const f of ["scout-pack-2026-10-29-2-lite.json.gz", "scout-pack-2026-10-29-2-2025.db", "scout-pack-2026-10-29-1-2025.db", "scout-pack-2026-10-28-10-2025.db"]) writeFileSync(join(packs(), f), "x");
    await kvSet("packs:last", "2026-10-29T08:00:05.000Z");
    const r = await call("/api/owner/packs", ownerCookie);
    expect(r.json.manifest).toEqual({ format: 1, version: "2026-10-29.2", builtAt: "2026-10-29T08:00:00.000Z", engineVersion: "2.11.0", dataAsOf: "2026-10-29T07:55:00.000Z" });
    expect(r.json.files.map((f: any) => [f.kind, f.season, f.seasons, f.bytes, f.sha256, f.onDisk])).toEqual([
      ["lite", null, [2025, 2024], 1_200_000, hash("a"), true],
      ["full", 2025, [2025], 30_000_000, hash("b"), true],
      ["full", 2024, [2024], 40_000_000, hash("c"), false],
    ]);
    expect(r.json.totalBytes).toBe(71_200_000);
    expect(r.json.versionsOnDisk).toEqual(["2026-10-29.2", "2026-10-29.1", "2026-10-28.10"]);
    expect(r.json.lastBuildAt).toBe("2026-10-29T08:00:05.000Z");
  });

  it("says when serving is switched off, without touching a file", async () => {
    await setFlag("offlinePacks", false, "owner@example.com");
    invalidateFlags();
    const r = await call("/api/owner/packs", ownerCookie);
    expect(r.json.serving).toBe(false);
  });

  it("has no route that deletes a pack", async () => {
    for (const m of ["DELETE", "POST"]) {
      const res = await fetch(`${base}/api/owner/packs`, { method: m, headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: "{}" });
      expect(res.status, m).toBe(404);
    }
  });
});
