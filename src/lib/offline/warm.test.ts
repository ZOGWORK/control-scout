// @vitest-environment jsdom
// warmScoutReads (warm.ts): a bundle counts as warmed only when the server itself answered each read and that answer
// was kept for the account the pass started for.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetches = vi.hoisted(() => ({ answer: (_p: string): unknown => ({}), onFetch: () => {} }));
vi.mock("../api", async () => {
  const real = await vi.importActual<typeof import("../api")>("../api");
  const kept = await import("./kept");
  const saved = await import("./saved");
  // As lib/api.ts does: the asker is read when the request starts; a server answer is kept for them.
  return { ...real, apiFetch: async (p: string) => {
    const asker = kept.keptOwner();
    fetches.onFetch();
    const data = fetches.answer(p);
    if (!saved.offlineSource(data)) void kept.keepAnswer(p, data, asker);
    return data;
  } };
});

import { warmScoutReads } from "./warm";
import { writeBundles } from "./bundleMeta";
import { clearKept } from "./kept";
import { markOffline } from "./saved";

const STAMP = "cs-kept-warm";
const stamped = () => Object.keys(JSON.parse(localStorage.getItem(STAMP) ?? "{}"));

beforeEach(async () => {
  localStorage.clear();
  await clearKept();
  localStorage.setItem("cs-personal-owner", "a");
  writeBundles([{ season: 2026, code: "AUBRQ1", name: "Brisbane", end: "2026-11-08", version: "v", sha256: "x", bytes: 1, savedAt: 1, builtAt: "b", dataAsOf: null, team: null, workspace: null, reports: 0, picklist: false, teams: [1, 2] }]);
  fetches.answer = () => ({});
  fetches.onFetch = () => {};
});

describe("warmScoutReads", () => {
  it("server answers, kept: the bundle is stamped warmed for this account", async () => {
    await warmScoutReads(true);
    expect(stamped()).toEqual(["a|2026:AUBRQ1:v"]);
  });

  it("an answer made on this device (the server too slow) leaves the bundle due", async () => {
    fetches.answer = (p) => (p.startsWith("/api/shortlist") ? markOffline({ teams: [] }, { season: 2026, savedAt: 0, dataAsOf: null, kept: true }) : {});
    await warmScoutReads(true);
    expect(stamped()).toEqual([]);
  });

  it("two bundles of one season: the shared event list failing leaves both due", async () => {
    writeBundles([
      { season: 2026, code: "AUBRQ1", name: "Brisbane", end: "2026-11-08", version: "v", sha256: "x", bytes: 1, savedAt: 1, builtAt: "b", dataAsOf: null, team: null, workspace: null, reports: 0, picklist: false, teams: [1, 2] },
      { season: 2026, code: "AUSYQ1", name: "Sydney", end: "2026-11-15", version: "v", sha256: "y", bytes: 1, savedAt: 1, builtAt: "b", dataAsOf: null, team: null, workspace: null, reports: 0, picklist: false, teams: [3] },
    ]);
    let lists = 0;
    fetches.answer = (p) => (p.startsWith("/api/events?") && ++lists ? markOffline({ events: [] }, { season: 2026, savedAt: 0, dataAsOf: null, kept: true }) : {});
    await warmScoutReads(true);
    expect(lists).toBe(1); // asked once
    expect(stamped()).toEqual([]);
  });

  it("another account signing in mid-pass: nothing was kept for the first, so neither is stamped", async () => {
    fetches.onFetch = () => localStorage.setItem("cs-personal-owner", "b");
    await warmScoutReads(true);
    expect(stamped()).toEqual([]);
  });
});
