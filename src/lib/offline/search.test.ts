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
import { packSearchSaved, writeBundles } from "./bundleMeta";
import { offlineAnswer } from "./answer";
import { offlineSource } from "./saved";
import { packPath, searchPackPath, type BundleManifest, type EventBundle, type PackApi } from "../../shared/eventBundle";
import type { SearchAnswer, SearchHit } from "../../shared/api";
import type { PackSearch, SeasonRow } from "../../shared/searchVersus";

const S = 2025;
const hit = (n: number, name: string): SearchHit => ({ kind: "team", ref: String(n), title: `${n} | ${name}`, subtitle: "Midland, MI, USA", season: S, team: { season: S, opr: 40, record: { w: 3, l: 1, t: 0 }, rank: { n: n - 10, of: 40 } } } as SearchHit);
const row = (team: number, opr: number): SeasonRow => ({ team, season: S, opr_np: opr, opr_auto: opr / 4, opr_teleop: opr / 2, opr_endgame: opr / 4, rank_np: team - 10, rank_auto: null, rank_teleop: null, rank_endgame: null, ranked_teams: 40, rating_np: opr, rating_auto: null, rating_teleop: null, rating_endgame: null, rating_sd: 4, rating_rank: 1, matches: 4, wins: 3, losses: 1, ties: 0 });
const NAMES: Record<number, string> = { 11: "Gear Grinders", 12: "Bolt Brigade", 13: "Circuit Owls" };

function pack(): EventBundle {
  const api: PackApi = { answers: {}, same: {}, errors: {} };
  const lone: SearchAnswer = { q: "11", hits: [hit(11, NAMES[11])], pages: [], step: "deterministic", weak: false, understood: { kind: "team", label: "Gear Grinders (11)" } };
  api.answers[packPath(searchPackPath("11"))!] = lone;
  api.answers[packPath(`/api/teams-summary?season=${S}&teams=12`)!] = { season: S, teams: [{ number: 12, name: "Bolt Brigade" }] };
  api.answers[packPath(`/api/teams-summary?season=${S}&teams=11`)!] = { season: S, teams: [{ number: 11, name: "Gear Grinders" }] };
  const search: PackSearch = {
    teams: Object.fromEntries([11, 12, 13].map((n, i) => [String(n), { facts: { number: n, name: NAMES[n], city: "Midland", state: "MI", country: "USA" }, hit: hit(n, NAMES[n]), rows: [row(n, 60 - i * 10)] }])),
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
afterEach(async () => { await removeBundle(S, "USMIQ9"); writeBundles([]); vi.unstubAllGlobals(); });

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
    expect(await offlineAnswer(`/api/teams-summary?season=${S}&teams=12,4215,11`)).toEqual({ season: S, teams: [{ number: 12, name: "Bolt Brigade" }, { number: 11, name: "Gear Grinders" }] });
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
});
