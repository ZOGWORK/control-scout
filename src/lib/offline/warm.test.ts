// @vitest-environment jsdom
// warmScoutReads (warm.ts): a bundle counts as warmed only when the server itself answered each read, and only for
// the account the pass started for.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetches = vi.hoisted(() => ({ answer: (_p: string): unknown => ({}), onFetch: () => {} }));
vi.mock("../api", async () => {
  const real = await vi.importActual<typeof import("../api")>("../api");
  return { ...real, apiFetch: async (p: string) => { fetches.onFetch(); return fetches.answer(p); } };
});

import { warmScoutReads } from "./warm";
import { writeBundles } from "./bundleMeta";
import { markOffline } from "./saved";

const STAMP = "cs-kept-warm";
const stamped = () => Object.keys(JSON.parse(localStorage.getItem(STAMP) ?? "{}"));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cs-personal-owner", "a");
  writeBundles([{ season: 2026, code: "AUBRQ1", name: "Brisbane", end: "2026-11-08", version: "v", sha256: "x", bytes: 1, savedAt: 1, builtAt: "b", dataAsOf: null, team: null, workspace: null, reports: 0, picklist: false, teams: [1, 2] }]);
  fetches.answer = () => ({});
  fetches.onFetch = () => {};
});

describe("warmScoutReads", () => {
  it("server answers: the bundle is stamped warmed for this account", async () => {
    await warmScoutReads(true);
    expect(stamped()).toEqual(["a|2026:AUBRQ1:v"]);
  });

  it("an answer made on this device (the server too slow) leaves the bundle due", async () => {
    fetches.answer = (p) => (p.startsWith("/api/shortlist") ? markOffline({ teams: [] }, { season: 2026, savedAt: 0, dataAsOf: null, kept: true }) : {});
    await warmScoutReads(true);
    expect(stamped()).toEqual([]);
  });

  it("another account signing in mid-pass is never credited with it", async () => {
    fetches.onFetch = () => localStorage.setItem("cs-personal-owner", "b");
    await warmScoutReads(true);
    expect(stamped()).toEqual(["a|2026:AUBRQ1:v"]);
  });
});
