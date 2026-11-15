// @vitest-environment jsdom
// apiFetch and the scouting pages' kept reads (lib/offline/kept.ts): a good answer is kept; with no network the kept
// answer comes back (marked offline, offline mode on); an HTTP error is never replaced; a read that isn't kept still fails.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./offline/answer", async () => {
  const reads = await import("./offline/scoutReads");
  return { offlineAnswer: (p: string) => reads.scoutReadAnswer(p) };
});
vi.mock("./offline/bundles", () => ({ loadBundle: async () => null }));

import { ApiError, apiFetch } from "./api";
import { clearKept, keptAt } from "./offline/kept";
import { offlineSource } from "./offline/saved";

const PATH = "/api/events/2026/AUBRQ1/pick-ratings";
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(async () => { localStorage.clear(); await clearKept(); vi.unstubAllGlobals(); });

describe("kept reads", () => {
  it("online answers are kept; with no network the kept answer comes back, marked as offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ season: 2026, teams: [{ team: 23332 }] })));
    await apiFetch(PATH);
    await vi.waitFor(() => expect(keptAt(PATH)).not.toBeNull());
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const got = await apiFetch<{ teams: { team: number }[] }>(PATH);
    expect(got.teams[0].team).toBe(23332);
    expect(offlineSource(got)?.kept).toBe(true);
  });

  it("an HTTP error is the server's answer, never replaced; an unkept read still fails offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ teams: [] })));
    await apiFetch(PATH);
    await vi.waitFor(() => expect(keptAt(PATH)).not.toBeNull());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "No event" }), { status: 404 })));
    await expect(apiFetch(PATH)).rejects.toMatchObject({ status: 404 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(apiFetch("/api/events/2026/OTHER/pick-ratings")).rejects.toBeInstanceOf(ApiError);
  });

  it("the home page's season totals are kept, and answer with no network", async () => {
    const home = "/api/home/overview?season=2026";
    vi.stubGlobal("fetch", vi.fn(async () => ok({ season: 2026, coverage: { teamListings: 8123, events: 412, matchScores: 9050 } })));
    await apiFetch(home);
    await vi.waitFor(() => expect(keptAt(home)).not.toBeNull());
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const got = await apiFetch<{ coverage: { teamListings: number } }>(home);
    expect(got.coverage.teamListings).toBe(8123);
    expect(offlineSource(got)?.kept).toBe(true);
    // Another season was never loaded here: no answer, never someone else's numbers.
    await expect(apiFetch("/api/home/overview?season=2025")).rejects.toBeInstanceOf(ApiError);
  });

  it("the home page's prediction record is kept, and answers with no network", async () => {
    const path = "/api/predict/accuracy";
    vi.stubGlobal("fetch", vi.fn(async () => ok({ matches: 1234, brier: 0.151 })));
    await apiFetch(path);
    await vi.waitFor(() => expect(keptAt(path)).not.toBeNull());
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const got = await apiFetch<{ matches: number }>(path);
    expect(got.matches).toBe(1234);
    expect(offlineSource(got)?.kept).toBe(true);
  });

  it("a shortlist made entirely offline (nothing kept, no bundle) still lists its teams, by number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const got = await apiFetch<{ teams: { team: number; opr: number | null }[] }>("/api/shortlist?teams=18439%2C23332&season=2026");
    expect(got.teams.map((t) => [t.team, t.opr])).toEqual([[18439, null], [23332, null]]);
    expect(offlineSource(got)?.savedAt).toBe(0);
  });
});
