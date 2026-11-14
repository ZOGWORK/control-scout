// @vitest-environment jsdom
// The event pack on the device: a saved bundle's `api` answers any read it holds (the app's spelling of the path,
// any case or order), marked with the bundle's time; the server's own 404 stays a 404; Compare is assembled from the
// pack; a team that isn't in it is said plainly. lib/api.ts treats those reads as answerable with no signal.
import "fake-indexeddb/auto";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBundle, fetchBundleManifest, removeBundle } from "./bundles";
import { bundleCanAnswer, writeBundles } from "./bundleMeta";
import { OfflineAnswerError, offlineAnswer } from "./answer";
import { offlineSource } from "./saved";
import { packPath, type BundleManifest, type EventBundle, type PackApi } from "../../shared/eventBundle";
import type { CompareView, MatchView } from "../../shared/api";
import { compareFromPacks } from "../../shared/compare";

const S = 2025;
const team = (n: number) => ({ number: n, name: `Team ${n}`, fullName: null, school: null, sponsors: [], city: null, state: null, country: null, rookieYear: null, website: null, homeRegion: null });
const view = (key: string, red: number[], blue: number[]): MatchView => ({
  season: S, code: "USTXQ1", key, level: "qual", series: 0, number: Number(key.split(":")[2]), label: `Q${key.split(":")[2]}`, time: `2025-11-01T10:0${key.split(":")[2]}:00`, startsAt: null, played: true,
  red: { teams: red.map((t) => ({ number: t, name: null, onField: true, surrogate: false })), score: null }, blue: { teams: blue.map((t) => ({ number: t, name: null, onField: true, surrogate: false })), score: null }, video: null, prediction: null,
} as unknown as MatchView);

function pack(): EventBundle {
  const api: PackApi = { answers: {}, same: {}, errors: {} };
  const put = (p: string, v: unknown) => { api.answers[packPath(p)!] = v; };
  put(`/api/teams/11?season=${S}`, { team: team(11), season: S });
  api.same[packPath("/api/teams/11")!] = packPath(`/api/teams/11?season=${S}`)!;
  put(`/api/teams/11/matches?season=${S}`, { team: 11, season: S, matches: [view("qual:0:1", [11, 12], [13, 14]), view("qual:0:2", [11, 99], [98, 97])] });
  put(`/api/teams/12/matches?season=${S}`, { team: 12, season: S, matches: [view("qual:0:1", [11, 12], [13, 14])] });
  put("/api/teams/11/matches?season=2024", { team: 11, season: 2024, matches: [] }); // a season it last played, kept for Compare
  put(`/api/events/${S}/USTXQ1/matches/qual:0:1`, { match: { ...view("qual:0:1", [11, 12], [13, 14]), clip: { videoId: "abc", t: 30, url: "https://youtu.be/abc?t=30" } } });
  api.errors[packPath(`/api/teams/7?season=${S}`)!] = { status: 404, error: "No FTC team 7 in our data" };
  const block = (n: number) => ({ team: team(n), stats: null, events: [], awards: [] });
  return {
    format: 1,
    manifest: { format: 1, season: S, code: "USTXQ1", name: "Texas Qualifier", end: "2099-11-01", version: "p1", builtAt: "2026-11-01T12:00:00Z", dataAsOf: "2026-11-01T11:58:00Z", engineVersion: "3.0.0", team: null, workspace: null, sections: [], field: [[11, null], [12, null], [13, null], [14, null]], reportKeys: [],
      apiPaths: [...Object.keys(api.answers), ...Object.keys(api.same), ...Object.keys(api.errors)] },
    event: { event: { season: S, code: "USTXQ1", name: "Texas Qualifier" }, field: [], matches: [] } as never,
    ratings: null, reports: [], picklist: null, rules: null, venue: { name: "Texas Qualifier" } as never,
    api, compare: { 11: { block: block(11), latest: S }, 12: { block: block(12), latest: S }, 13: { block: block(13), latest: S }, 14: { block: block(14), latest: S } } as never,
  };
}

beforeEach(async () => {
  const gz = new Uint8Array(gzipSync(JSON.stringify(pack())));
  const m = { ...pack().manifest, url: "/api/bundles/2025/USTXQ1/file", bytes: gz.length, sha256: createHash("sha256").update(gz).digest("hex") } as BundleManifest;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/manifest") ? new Response(JSON.stringify(m)) : new Response(gz))));
  await downloadBundle({ season: S, code: "USTXQ1", team: null, workspace: null });
});
afterEach(async () => { await removeBundle(S, "USTXQ1"); writeBundles([]); vi.unstubAllGlobals(); });

describe("the event pack answers with no signal", () => {
  it("answers any path it holds, however the app spells it, marked with the bundle's time", async () => {
    const p = await offlineAnswer(`/api/teams/11?season=${S}`) as { team: { number: number } };
    expect(p.team.number).toBe(11);
    expect(offlineSource(p)?.bundle?.name).toBe("Texas Qualifier");
    // The same answer stored once: the path without ?season= reads it.
    expect(await offlineAnswer("/api/teams/11")).toEqual(p);
    const d = await offlineAnswer(`/api/events/${S}/ustxq1/matches/qual:0:1`) as { match: MatchView };
    expect(d.match.key).toBe("qual:0:1");
    expect(offlineSource(d)).not.toBeNull();
    expect(await offlineAnswer(`/api/events/${S}/USTXQ1/matches/qual:0:9`)).toBeNull();
  });

  it("each answer is a copy: marking or changing one never touches the pack", async () => {
    const a = await offlineAnswer(`/api/teams/11?season=${S}`) as { season: number };
    a.season = 1;
    expect((await offlineAnswer(`/api/teams/11?season=${S}`) as { season: number }).season).toBe(S);
  });

  it("the server's 404 the pack recorded stays a 404", async () => {
    await expect(offlineAnswer(`/api/teams/7?season=${S}`)).rejects.toMatchObject({ status: 404, message: "No FTC team 7 in our data" });
  });

  it("Compare of the event's teams comes from the pack, with head-to-head; another team is said plainly", async () => {
    const c = await offlineAnswer(`/api/compare?teams=11,12,13&season=${S}`) as CompareView;
    expect(c.teams.map((t) => t.team.number)).toEqual([11, 12, 13]);
    expect(c.meetings.map((m) => [m.key, m.relation])).toEqual([["qual:0:1", "opponents"]]);
    expect(offlineSource(c)).not.toBeNull();
    const noSeason = await offlineAnswer("/api/compare?teams=11,12") as CompareView;
    expect(noSeason.season).toBe(S);
    expect(noSeason.meetings.map((m) => m.relation)).toEqual(["partners"]);
    const miss = await offlineAnswer(`/api/compare?teams=11,4321&season=${S}`).catch((e: Error) => e) as Error;
    expect(miss).toBeInstanceOf(OfflineAnswerError);
    expect(miss.message).toMatch(/Team 4321 isn't in your downloaded event packs/);
  });

  it("a manifest still being prepared (202) is asked again until it's ready", async () => {
    vi.useFakeTimers();
    try {
      let asks = 0;
      const ready = { ...pack().manifest, url: "/x", bytes: 1, sha256: "s" };
      vi.stubGlobal("fetch", vi.fn(async () => (++asks < 3
        ? new Response(JSON.stringify({ preparing: true, retryAfterMs: 2000 }), { status: 202 })
        : new Response(JSON.stringify(ready)))));
      const got = fetchBundleManifest({ season: S, code: "USTXQ1", team: null, workspace: null });
      await vi.advanceTimersByTimeAsync(4100);
      expect((await got).version).toBe("p1");
      expect(asks).toBe(3);
      // Many phones on one wifi used up the address's budget (429): it waits as told, then asks again.
      asks = 0;
      vi.stubGlobal("fetch", vi.fn(async () => (++asks < 2
        ? new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { "Retry-After": "7" } })
        : new Response(JSON.stringify(ready)))));
      const later = fetchBundleManifest({ season: S, code: "USTXQ1", team: null, workspace: null });
      await vi.advanceTimersByTimeAsync(6900);
      expect(asks).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      expect((await later).version).toBe("p1");
    } finally { vi.useRealTimers(); }
  });

  it("lib/api.ts: with no answer in 4 s, the pack answers, and a 404 it recorded stays a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // venue wifi that connects but carries nothing
    const { apiFetch } = await import("../api");
    const p = apiFetch<{ team: { number: number } }>(`/api/teams/11?season=${S}`);
    expect((await p).team.number).toBe(11);
    await expect(apiFetch(`/api/teams/7?season=${S}`)).rejects.toMatchObject({ status: 404, message: "No FTC team 7 in our data" });
  }, 15_000);

  it("Compare picks the season as the server does when nobody has results (its current season), and says what's missing", () => {
    const p = pack();
    for (const k of Object.keys(p.compare!)) p.compare![k].latest = null;
    const got = compareFromPacks([11, 12], undefined, [{ season: S, bundle: { ...p, currentSeason: 2026 } }]);
    expect("missing" in got && got.missing).toMatch(/don't hold teams 11, 12 for 2026–27/);
    const same = compareFromPacks([11, 12], undefined, [{ season: S, bundle: { ...p, currentSeason: S } }]);
    expect("view" in same && same.view.season).toBe(S);
  });

  it("Compare names the pack the first team's column came from", () => {
    const p = pack();
    const other = { ...pack(), compare: { 99: p.compare!["11"] } };
    const got = compareFromPacks([11, 12], S, [{ season: S, bundle: other }, { season: S, bundle: p }]);
    expect("from" in got && got.from.bundle).toBe(p);
  });

  it("lib/api.ts counts those reads as answerable offline (the 4 s fallback covers them)", () => {
    expect(bundleCanAnswer(`/api/teams/11?season=${S}`)).toBe(true);
    expect(bundleCanAnswer(`/api/events/${S}/ustxq1/matches/qual:0:1`)).toBe(true);
    expect(bundleCanAnswer(`/api/compare?teams=11,14&season=${S}`)).toBe(true);
    expect(bundleCanAnswer(`/api/compare?teams=11,4321`)).toBe(false);
    expect(bundleCanAnswer("/api/teams/4321")).toBe(false);
    // Another season the pack keeps for its teams (Compare with no season asked, early in a season).
    expect(bundleCanAnswer("/api/compare?teams=11&season=2024")).toBe(true);
    expect(bundleCanAnswer("/api/compare?teams=11,12&season=2024")).toBe(false);
  });
});
