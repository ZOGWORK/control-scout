// Team logos (server/teamLogos.ts): FIRST's per-season stylesheet read into team_logos, only changed pictures
// downloaded, and served behind the owner's teamLogos switch.
import type { AddressInfo } from "node:net";
import express from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, setDb } from "./db";
import { invalidateFlags, setFlag } from "./flags";
import { DEFAULT_TEAM, LOGO_ORIGIN, LOGO_REFRESH_MS, LOGO_RETRIES, LOGO_RETRY_MS, parseLogoSheet, refreshTeamLogos, refreshTeamLogosIfDue, sheetUrl, teamLogosRouter } from "./teamLogos";

// A 1×1 PNG, and a second one that differs in its last bytes.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const PNG2 = Uint8Array.from([...PNG.slice(0, -1), 0x83]);
const b64 = Buffer.from(PNG).toString("base64");

const sheet = (season: number, teams: Record<number, string>) => `:root { --avatar-size: 40; }
.team-avatar {
  background-image: url("data:image/png;base64,${b64}");
  background-size: contain;
}
${Object.entries(teams).map(([n, id]) => `.team-${n} {\n  background-image: url("/ftc/${season}/avatars/composed/${n}_${id}");\n}`).join("\n")}
`;

/** A stand-in for FIRST: the sheets and pictures given, counting every request. */
function fakeFirst(sheets: Record<number, string>, pictures: Record<string, Uint8Array> = {}) {
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(url);
    const season = Object.keys(sheets).find((s) => url === sheetUrl(Number(s)));
    if (season) return new Response(sheets[Number(season)]);
    const path = url.slice(LOGO_ORIGIN.length);
    if (pictures[path]) return new Response(pictures[path], { headers: { "Content-Type": "image/png" } });
    if (/^\/ftc\/\d+\/avatars\/composed\//.test(path)) return new Response(PNG, { headers: { "Content-Type": "image/png" } });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, asked };
}

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  invalidateFlags();
});

describe("parseLogoSheet", () => {
  it("reads the generic mark and each team's own picture path", () => {
    const s = parseLogoSheet(sheet(2026, { 4215: "abc-1", 8902: "def-2" }));
    expect([...s.teams]).toEqual([[4215, "/ftc/2026/avatars/composed/4215_abc-1"], [8902, "/ftc/2026/avatars/composed/8902_def-2"]]);
    expect(Buffer.from(s.fallback!).equals(Buffer.from(PNG))).toBe(true);
  });
  it("never takes a path off FIRST's own pictures", () => {
    const s = parseLogoSheet(`.team-1 { background-image: url("https://evil.example/x.png"); }\n.team-2 { background-image: url("/ftc/2026/../../x"); }`);
    expect(s.teams.get(1)).toBeUndefined();
    expect(s.fallback).toBeNull();
  });
});

describe("refreshTeamLogos", () => {
  it("stores every team and the generic mark, the newest season's picture winning", async () => {
    const { f } = fakeFirst({ 2026: sheet(2026, { 4215: "new" }), 2025: sheet(2025, { 4215: "old", 23314: "x" }) });
    const r = await refreshTeamLogos({ seasons: [2026, 2025], fetch: f });
    expect(r).toMatchObject({ seasons: [2026, 2025], listed: 2, fetched: 2, failed: 0, removed: 0 });
    const rows = await all<{ team: number; season: number; src: string }>("SELECT team, season, src FROM team_logos ORDER BY team");
    expect(rows.map((x) => [Number(x.team), Number(x.season), x.src])).toEqual([
      [DEFAULT_TEAM, 2026, expect.stringMatching(/^default:/)],
      [4215, 2026, "/ftc/2026/avatars/composed/4215_new"],
      [23314, 2025, "/ftc/2025/avatars/composed/23314_x"],
    ]);
  });

  it("downloads only pictures whose path changed, and drops a team that took its picture down", async () => {
    await refreshTeamLogos({ seasons: [2026], fetch: fakeFirst({ 2026: sheet(2026, { 4215: "a", 8902: "b" }) }).f });
    const { f, asked } = fakeFirst({ 2026: sheet(2026, { 4215: "a2" }) }, { "/ftc/2026/avatars/composed/4215_a2": PNG2 });
    const r = await refreshTeamLogos({ seasons: [2026], prune: true, fetch: f });
    expect(r).toMatchObject({ fetched: 1, unchanged: 0, removed: 1 });
    expect(asked).toEqual([sheetUrl(2026), `${LOGO_ORIGIN}/ftc/2026/avatars/composed/4215_a2`]);
    expect((await all<{ team: number }>("SELECT team FROM team_logos ORDER BY team")).map((x) => Number(x.team))).toEqual([DEFAULT_TEAM, 4215]);
    // Nothing changed: only the sheet is read.
    const again = fakeFirst({ 2026: sheet(2026, { 4215: "a2" }) });
    expect(await refreshTeamLogos({ seasons: [2026], fetch: again.f })).toMatchObject({ fetched: 0, unchanged: 1 });
    expect(again.asked).toEqual([sheetUrl(2026)]);
  });

  it("a run for a few teams fetches only those and removes nothing", async () => {
    await refreshTeamLogos({ seasons: [2026], fetch: fakeFirst({ 2026: sheet(2026, { 1: "a", 2: "b" }) }).f });
    const { f, asked } = fakeFirst({ 2026: sheet(2026, { 2: "b2", 3: "c" }) });
    expect(await refreshTeamLogos({ seasons: [2026], teams: [3], fetch: f })).toMatchObject({ fetched: 1, removed: 0 });
    expect(asked).toEqual([sheetUrl(2026), `${LOGO_ORIGIN}/ftc/2026/avatars/composed/3_c`]);
    expect((await all<{ team: number }>("SELECT team FROM team_logos ORDER BY team")).map((x) => Number(x.team))).toEqual([DEFAULT_TEAM, 1, 2, 3]);
  });

  it("without prune (a one-season or few-team run) removes nothing", async () => {
    await refreshTeamLogos({ seasons: [2026], fetch: fakeFirst({ 2026: sheet(2026, { 1: "a", 2: "b" }) }).f });
    expect(await refreshTeamLogos({ seasons: [2026], fetch: fakeFirst({ 2026: sheet(2026, { 1: "a" }) }).f })).toMatchObject({ removed: 0 });
    expect(await all("SELECT team FROM team_logos")).toHaveLength(3);
  });

  it("never prunes when a sheet couldn't be read, nor a mass removal from an empty or reshaped sheet", async () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 1, "a"]));
    await refreshTeamLogos({ seasons: [2026, 2025], fetch: fakeFirst({ 2026: sheet(2026, many), 2025: sheet(2025, { 99: "z" }) }).f });
    // 2025's sheet is missing: team 99 (only on it) stays.
    expect(await refreshTeamLogos({ seasons: [2026, 2025], prune: true, fetch: fakeFirst({ 2026: sheet(2026, many) }).f })).toMatchObject({ removed: 0 });
    // Both read, but listing nothing: every picture stays.
    expect(await refreshTeamLogos({ seasons: [2026, 2025], prune: true, fetch: fakeFirst({ 2026: sheet(2026, {}), 2025: sheet(2025, {}) }).f })).toMatchObject({ removed: 0 });
    expect(await all("SELECT team FROM team_logos")).toHaveLength(42);
  });

  it("keeps a picture that isn't a PNG out", async () => {
    const { f } = fakeFirst({ 2026: sheet(2026, { 7: "a" }) }, { "/ftc/2026/avatars/composed/7_a": new TextEncoder().encode("<html>") });
    expect(await refreshTeamLogos({ seasons: [2026], fetch: f })).toMatchObject({ fetched: 0, failed: 1 });
  });
});

describe("refreshTeamLogosIfDue", () => {
  const noLog = () => {};
  /** Whether a refresh runs at `at` (it reads the sheet first). */
  async function runsAt(at: number, sheets: Record<number, string>, pictures: Record<string, Uint8Array> = {}) {
    const { f, asked } = fakeFirst(sheets, pictures);
    await refreshTeamLogosIfDue([2026], noLog, at, f);
    return asked.length > 0;
  }
  const T = Date.parse("2026-11-26T00:00:00Z");

  it("runs once a day when it finishes", async () => {
    const ok = { 2026: sheet(2026, { 1: "a" }) };
    expect(await runsAt(T, ok)).toBe(true);
    expect(await runsAt(T + LOGO_RETRY_MS + 1, ok)).toBe(false);
    expect(await runsAt(T + LOGO_REFRESH_MS + 1, ok)).toBe(true);
  });

  it("a refresh with failures tries again within the hour, a few times, then waits a day", async () => {
    // Team 1's picture is never a PNG: every run has a failure.
    const bad = { 2026: sheet(2026, { 1: "a" }) }, pics = { "/ftc/2026/avatars/composed/1_a": new TextEncoder().encode("<html>") };
    let t = T;
    expect(await runsAt(t, bad, pics)).toBe(true);
    for (let i = 0; i < LOGO_RETRIES; i++) {
      expect(await runsAt(t + LOGO_RETRY_MS - 1000, bad, pics)).toBe(false);
      t += LOGO_RETRY_MS + 1;
      expect(await runsAt(t, bad, pics)).toBe(true);
    }
    // Retries used up: the usual day.
    expect(await runsAt(t + LOGO_RETRY_MS + 1, bad, pics)).toBe(false);
    expect(await runsAt(t + LOGO_REFRESH_MS + 1, bad, pics)).toBe(true);
  });

  it("a sheet that can't be read tries again within the hour too", async () => {
    expect(await runsAt(T, {})).toBe(true);
    expect(await runsAt(T + LOGO_RETRY_MS + 1, {})).toBe(true);
  });
});

describe("GET /api/team-logos/:number", () => {
  async function serve() {
    const app = express();
    app.use("/api/team-logos", teamLogosRouter());
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/team-logos`;
    return { base, close: () => new Promise((r) => server.close(r)) };
  }

  it("is switched off by default: no logo is served", async () => {
    await refreshTeamLogos({ seasons: [2026], fetch: fakeFirst({ 2026: sheet(2026, { 4215: "a" }) }).f });
    const s = await serve();
    try {
      const r = await fetch(`${s.base}/4215`);
      expect(r.status).toBe(403);
      expect((await r.json()).error).toBe("feature_disabled");
    } finally { await s.close(); }
  });

  it("switched on: the team's picture, else the generic mark, cached with an ETag", async () => {
    await refreshTeamLogos({ seasons: [2026], fetch: fakeFirst({ 2026: sheet(2026, { 4215: "a" }) }, { "/ftc/2026/avatars/composed/4215_a": PNG2 }).f });
    await setFlag("teamLogos", true, "owner@example.com");
    const s = await serve();
    try {
      const own = await fetch(`${s.base}/4215`);
      expect(own.status).toBe(200);
      expect(own.headers.get("content-type")).toBe("image/png");
      expect(own.headers.get("cache-control")).toMatch(/max-age=86400/);
      expect(Buffer.from(await own.arrayBuffer()).equals(Buffer.from(PNG2))).toBe(true);
      const etag = own.headers.get("etag")!;
      expect((await fetch(`${s.base}/4215`, { headers: { "If-None-Match": etag } })).status).toBe(304);
      const none = await fetch(`${s.base}/6980`);
      expect(Buffer.from(await none.arrayBuffer()).equals(Buffer.from(PNG))).toBe(true);
      expect((await fetch(`${s.base}/abc`)).status).toBe(404);
    } finally { await s.close(); }
  });
});
