// @vitest-environment jsdom
// FTC One Search with no signal on the device (lib/offline/search.ts): a saved event pack answers the searches it
// holds with the server's own answer, builds a versus of its teams, says what the rest needs (with what the pack holds)
// and gives the team cards their numbers; lib/api.ts reaches it at once with no network, never through search's own
// 10-second wait.
import "fake-indexeddb/auto";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBundle, removeBundle } from "./bundles";

// A hook into reading a saved pack (the decode respond() races the server with), for what happens meanwhile.
const decode = vi.hoisted(() => ({ during: null as null | (() => Promise<void>), unreadable: false }));
vi.mock("./bundles", async (importOriginal) => {
  const m = await importOriginal<typeof import("./bundles")>();
  return { ...m, loadBundle: async (...a: Parameters<typeof m.loadBundle>) => { const f = decode.during; decode.during = null; await f?.(); return decode.unreadable ? null : m.loadBundle(...a); } };
});
import { packSearchSaved, writeBundles } from "./bundleMeta";
import { offlineAnswer } from "./answer";
import { offlineSource } from "./saved";
import { packPath, searchPackPath, type BundleManifest, type EventBundle, type PackApi } from "../../shared/eventBundle";
import type { SearchAnswer, SearchHit, TeamSummary } from "../../shared/api";
import type { PackSearch, SeasonRow } from "../../shared/searchVersus";

const S = 2025;
const hit = (n: number, name: string): SearchHit => ({ kind: "team", ref: String(n), title: `${n} | ${name}`, subtitle: "Midland, MI, USA", season: S, team: { season: S, opr: 40, record: { w: 3, l: 1, t: 0 }, rank: { n: n - 10, of: 40 } } } as SearchHit);
const row = (team: number, opr: number): SeasonRow => ({ team, season: S, opr_np: opr, opr_auto: opr / 4, opr_teleop: opr / 2, opr_endgame: opr / 4, rank_np: team - 10, rank_auto: null, rank_teleop: null, rank_endgame: null, ranked_teams: 40, rating_np: opr, rating_auto: null, rating_teleop: null, rating_endgame: null, rating_sd: 4, rating_rank: 1, matches: 4, wins: 3, losses: 1, ties: 0 });
const NAMES: Record<number, string> = { 11: "Gear Grinders", 12: "Bolt Brigade", 13: "Circuit Owls", 4215: "Terabridges", 1111: "Thousand Gears" };
/** A team card's numbers, in /api/teams-summary's own shape (TeamSummary). `opr` tells the pack's from the server's. */
const summary = (team: number, opr = 40): TeamSummary => ({ team, name: NAMES[team], place: "Midland, MI, USA", opr, oprRank: 3, of: 40, rating: opr, ratingSd: 4, record: "3-1-0", lastEvent: null, nextEvent: null });

function pack(): EventBundle {
  const api: PackApi = { answers: {}, same: {}, errors: {} };
  const lone: SearchAnswer = { q: "11", hits: [hit(11, NAMES[11])], pages: [], step: "deterministic", weak: false, understood: { kind: "team", label: "Gear Grinders (11)" } };
  api.answers[packPath(searchPackPath("11"))!] = lone;
  api.answers[packPath(searchPackPath("Gear Grinders"))!] = { ...lone, q: "Gear Grinders" };
  // A four-digit team, for a number typed with a thousands comma ("1,111").
  api.answers[packPath(searchPackPath("1111"))!] = { ...lone, q: "1111", hits: [hit(1111, NAMES[1111])], understood: { kind: "team", label: "Thousand Gears (1111)" } };
  api.answers[packPath(`/api/teams-summary?season=${S}&teams=12`)!] = { season: S, teams: [summary(12)] };
  api.answers[packPath(`/api/teams-summary?season=${S}&teams=11`)!] = { season: S, teams: [summary(11)] };
  const search: PackSearch = {
    teams: Object.fromEntries([11, 12, 13].map((n, i) => [String(n), { facts: { number: n, name: NAMES[n], city: "Midland", state: "MI", country: "USA" }, hit: hit(n, NAMES[n]), rows: [row(n, 60 - i * 10)], together: {} }])),
    scales: { [S]: { opr_np: 100, opr_auto: 30, opr_teleop: 60, opr_endgame: 30, rating_np: 100 } }, current: S, legacy: [2019, 2020, 2021, 2022],
  };
  return {
    format: 1,
    manifest: { format: 1, season: S, code: "USMIQ9", name: "Midland Robot Qualifier", end: "2099-11-08", version: "p1", builtAt: "2025-11-08T20:09:00Z", dataAsOf: "2025-11-08T20:09:00Z", engineVersion: "3.0.0", team: null, workspace: null, sections: [], field: [[11, null], [12, null], [13, null]], reportKeys: [],
      apiPaths: Object.keys(api.answers) },
    event: { event: { season: S, code: "USMIQ9", name: "Midland Robot Qualifier", city: "Midland", state: "MI", country: "USA" }, field: [{ team: 11 }, { team: 12 }, { team: 13 }], matches: [{ key: "qual:0:2", label: "Q2" }] } as never,
    ratings: null, reports: [], picklist: null, rules: null, venue: { name: "Midland Robot Qualifier" } as never,
    api, compare: { 11: {}, 12: {}, 13: {} } as never, search,
  };
}

beforeEach(async () => {
  const gz = new Uint8Array(gzipSync(JSON.stringify(pack())));
  const m = { ...pack().manifest, url: "/api/bundles/2025/USMIQ9/file", bytes: gz.length, sha256: createHash("sha256").update(gz).digest("hex") } as BundleManifest;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/manifest") ? new Response(JSON.stringify(m)) : new Response(gz))));
  await downloadBundle({ season: S, code: "USMIQ9", team: null, workspace: null });
});
afterEach(async () => { decode.unreadable = false; await removeBundle(S, "USMIQ9"); writeBundles([]); vi.unstubAllGlobals(); });

describe("search with no signal, from a saved event pack", () => {
  it("a search the pack holds is the server's own answer, whoever asks and however it's typed, marked with the pack", async () => {
    const a = await offlineAnswer("/api/search?q=%2011%20&limit=25&answer=1&prefer=team:4215") as SearchAnswer;
    expect(a.hits.map((h) => h.ref)).toEqual(["11"]);
    expect(a.understood).toEqual({ kind: "team", label: "Gear Grinders (11)" });
    expect(offlineSource(a)?.bundle?.name).toBe("Midland Robot Qualifier");
  });

  it("a versus of the pack's teams: Compare's hit, the teams and the season-numbers card", async () => {
    const a = await offlineAnswer("/api/search?q=11%20vs%2012%20vs%2013&limit=25&answer=1") as SearchAnswer;
    expect(a.hits.map((h) => `${h.kind}:${h.ref}`)).toEqual(["compare:11,12,13", "team:11", "team:12", "team:13"]);
    expect(a.hits[0].href).toBe(`/compare?teams=11,12,13&season=${S}`);
    expect(a.stat?.headline?.value).toBe("11 leads 60.0 – 50.0 – 40.0");
    expect(a.understood?.label).toBe("Compare: Gear Grinders (11) vs Bolt Brigade (12) vs Circuit Owls (13)");
  });

  it("anything else says what it needs, as the parser read it, and what the pack holds", async () => {
    const decode = await offlineAnswer("/api/search?q=who%20won%20decode&limit=25&answer=1") as SearchAnswer;
    expect(decode.hits).toEqual([]);
    expect(decode.notInPack).toEqual({ about: ["the 2025–26 season"], packs: [{ season: S, code: "USMIQ9", name: "Midland Robot Qualifier", teams: 3, matches: 1, dataAsOf: "2025-11-08T20:09:00Z" }], links: [] });
    expect((await offlineAnswer("/api/search?q=4215&limit=25&answer=1") as SearchAnswer).notInPack?.about).toEqual(["team 4215"]);
    expect((await offlineAnswer("/api/search?q=12%20opr&limit=25&answer=1") as SearchAnswer).notInPack?.links).toEqual([{ label: "12 Bolt Brigade", href: `/teams/12?season=${S}` }]);
  });

  it("the team cards' numbers, in the order asked, without teams the pack doesn't hold", async () => {
    expect(await offlineAnswer(`/api/teams-summary?season=${S}&teams=12,4215,11`)).toEqual({ season: S, teams: [summary(12), summary(11)] });
  });

  it("lib/api.ts: with no network, the pack answers at once (no 10-second slow-search wait)", async () => {
    expect(packSearchSaved("/api/search?q=anything&limit=25&answer=1")).toBe(true);
    expect(packSearchSaved("/api/search?q=anything&limit=8&kinds=team")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { apiFetch } = await import("../api");
    const t0 = performance.now();
    const a = await apiFetch<SearchAnswer>("/api/search?q=who%20won%20decode&limit=25&answer=1");
    expect(a.notInPack?.about).toEqual(["the 2025–26 season"]);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("reads the query as the server does: a question mark or a thousands comma still finds the pack's answer", async () => {
    for (const q of ["gear%20grinders%3F", "11%3F", "Gear%20Grinders!"]) {
      const a = await offlineAnswer(`/api/search?q=${q}&limit=25&answer=1`) as SearchAnswer;
      expect(a.notInPack, q).toBeUndefined();
      expect(a.hits.map((h) => h.ref), q).toEqual(["11"]);
    }
    // "1,111" is 1111, as the route reads it (cleanQuery's joinThousands): the pack's own answer for it, echoing the query.
    for (const q of ["1%2C111", "1%2C111%3F"]) {
      const a = await offlineAnswer(`/api/search?q=${q}&limit=25&answer=1`) as SearchAnswer;
      expect(a.notInPack, q).toBeUndefined();
      expect(a.hits.map((h) => h.ref), q).toEqual(["1111"]);
      expect(a.understood?.label, q).toBe("Thousand Gears (1111)");
      expect(offlineSource(a)?.bundle?.name, q).toBe("Midland Robot Qualifier");
    }
  });

  it("lib/api.ts: a search the pack can't answer while the server is up is bounded: SEARCH_SLOW_MS, then one more try", async () => {
    const { apiFetch, SEARCH_SLOW_MS } = await import("../api");
    const answer: SearchAnswer = { q: "who won decode", hits: [hit(11, NAMES[11])], pages: [], step: "deterministic", weak: false };
    let searches = 0;
    const aborted: number[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (!String(url).startsWith("/api/search")) return Promise.resolve(new Response("{}"));
      const n = ++searches;
      // The first try never answers (a stuck connection); the retry does.
      if (n > 1) return Promise.resolve(new Response(JSON.stringify(answer)));
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => { aborted.push(n); reject(new DOMException("aborted", "AbortError")); }));
    }));
    // The server answers other requests: it's up.
    await apiFetch("/api/health");
    const t0 = performance.now();
    const a = await apiFetch<SearchAnswer>("/api/search?q=who%20won%20decode&limit=25&answer=1");
    const took = performance.now() - t0;
    expect(a.notInPack).toBeUndefined();
    expect(a.hits.map((h) => h.ref)).toEqual(["11"]);
    expect(searches).toBe(2);
    expect(aborted).toEqual([1]);
    expect(took).toBeGreaterThanOrEqual(SEARCH_SLOW_MS - 50);
    expect(took).toBeLessThan(SEARCH_SLOW_MS + 3000);
  }, 30_000);

  it("lib/api.ts: team cards' numbers the pack holds only some of wait for a slow server, which has them all", async () => {
    const { apiFetch } = await import("../api");
    // The server's own answer: every team asked, told apart from the pack's by its OPR.
    const server = (path: string) => ({ season: S, teams: (new URL(path, "http://x.invalid").searchParams.get("teams") ?? "").split(",").map((t) => summary(Number(t), 99)) });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (!String(url).startsWith("/api/teams-summary")) return Promise.resolve(new Response("{}"));
      // Slower than the offline timeout (4 s), then the server's whole answer.
      return new Promise<Response>((r) => setTimeout(() => r(new Response(JSON.stringify(server(String(url))))), 5500));
    }));
    await apiFetch("/api/health");
    // The pack holds 12, not 4215: the server's answer, waited for.
    expect(await apiFetch(`/api/teams-summary?season=${S}&teams=12,4215`)).toEqual(server("/api/teams-summary?teams=12,4215"));
    // Every team asked in the pack: the pack's answer once the server is past the offline timeout, not the server's.
    const t0 = performance.now();
    expect(await apiFetch(`/api/teams-summary?season=${S}&teams=12,11`)).toEqual({ season: S, teams: [summary(12), summary(11)] });
    expect(performance.now() - t0).toBeLessThan(5400);
    // No network at all: the part the pack holds still answers.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await apiFetch(`/api/teams-summary?season=${S}&teams=12,4215`)).toEqual({ season: S, teams: [summary(12)] });
  }, 30_000);

  it("lib/api.ts: whether the server is up is decided when the offline timeout fires, not after the pack is read", async () => {
    const { apiFetch } = await import("../api");
    const server = { season: S, teams: [summary(12, 99), summary(4215, 99)] };
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).startsWith("/api/broken")) return Promise.reject(new TypeError("Failed to fetch"));
      if (!String(url).startsWith("/api/teams-summary")) return Promise.resolve(new Response("{}"));
      return new Promise<Response>((r) => setTimeout(() => r(new Response(JSON.stringify(server))), 5500));
    }));
    await apiFetch("/api/health");
    // Another read fails for want of a network while the pack is read: the server was up when this one ran out of time.
    decode.during = async () => { await apiFetch("/api/broken").catch(() => {}); };
    expect(await apiFetch(`/api/teams-summary?season=${S}&teams=12,4215`)).toEqual(server);
    expect(decode.during).toBeNull();
  }, 30_000);

  it("lib/api.ts: team cards the pack holds only some of wait SEARCH_SLOW_MS at most for a hung server, then show the pack's", async () => {
    const { apiFetch, SEARCH_SLOW_MS } = await import("../api");
    const aborted: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (!String(url).startsWith("/api/teams-summary")) return Promise.resolve(new Response("{}"));
      // Never answers.
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => { aborted.push(String(url)); reject(new DOMException("aborted", "AbortError")); }));
    }));
    await apiFetch("/api/health");
    const t0 = performance.now();
    expect(await apiFetch(`/api/teams-summary?season=${S}&teams=12,4215`)).toEqual({ season: S, teams: [summary(12)] });
    const took = performance.now() - t0;
    expect(took).toBeGreaterThanOrEqual(SEARCH_SLOW_MS - 50);
    expect(took).toBeLessThan(SEARCH_SLOW_MS + 3000);
    // Kept going (lib/api.ts awaitLate): the server's answer, should it come, still replaces the pack's cards.
    expect(aborted).toEqual([]);
  }, 30_000);

  // A search the saved pack gives nothing for, while it lists searches: the server waited for as before any pack was
  // saved, SEARCH_SLOW_MS a try and one more try, never without end.
  for (const [what, q, setup] of [
    ["a query that cleans to nothing", "%3F%3F", () => {}],
    ["a pack whose bytes can't be read", "who%20won%20decode", () => { decode.unreadable = true; }],
  ] as const) {
    it(`lib/api.ts: ${what}: a hung first try, then the retry's answer, in SEARCH_SLOW_MS`, async () => {
      const { apiFetch, SEARCH_SLOW_MS } = await import("../api");
      const answer: SearchAnswer = { q: "x", hits: [hit(12, NAMES[12])], pages: [], step: "deterministic", weak: false };
      let searches = 0;
      const aborted: number[] = [];
      vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
        if (!String(url).startsWith("/api/search")) return Promise.resolve(new Response("{}"));
        const n = ++searches;
        if (n > 1) return Promise.resolve(new Response(JSON.stringify(answer)));
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => { aborted.push(n); reject(new DOMException("aborted", "AbortError")); }));
      }));
      await apiFetch("/api/health");
      setup();
      const t0 = performance.now();
      const a = await apiFetch<SearchAnswer>(`/api/search?q=${q}&limit=25&answer=1`);
      const took = performance.now() - t0;
      expect(a.hits.map((h) => h.ref)).toEqual(["12"]);
      expect(searches).toBe(2);
      expect(aborted).toEqual([1]);
      expect(took).toBeGreaterThanOrEqual(SEARCH_SLOW_MS - 50);
      expect(took).toBeLessThan(SEARCH_SLOW_MS + 3000);
    }, 30_000);
  }
});
