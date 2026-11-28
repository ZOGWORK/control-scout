// Simulated rankings answer from the ratings pages already use (liveForecaster: the last finished build), so the first
// click after a sync doesn't wait for a full window replay before its 2.5 s budget starts. The kept answer is keyed by
// the build it used and the event input: a newer build or a changed field gives a new answer, a sync that touched
// neither keeps the kept one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ live: "v1", data: "v2", liveCalls: 0, freshCalls: 0, field: [1, 2, 3, 4, 5, 6] }));

vi.mock("../predict/engine.js", () => ({
  dataVersion: async () => engine.data,
  liveVersion: async () => engine.live,
  liveForecaster: async () => { engine.liveCalls++; return { built: engine.live }; },
  forecasterFor: async () => { engine.freshCalls++; return new Promise(() => {}); }, // a rebuild that never finishes
}));
vi.mock("../api/events.js", () => ({
  cachedEventDetail: async () => ({
    event: {}, alliances: [], matches: [],
    field: engine.field.map((team) => ({ team })),
  }),
  toEventInput: (_e: unknown, field: { team: number }[]) => ({ field: field.map((t) => t.team) }),
}));
// No ratings in this stand-in: the answer is "unavailable", which is enough to see which ratings were asked for.
const input = vi.hoisted(() => ({ seen: [] as unknown[] }));
vi.mock("./input.js", () => ({ rankingInput: (f: unknown) => { input.seen.push(f); return null; } }));

const { simulatedRankings } = await import("./rankingSim");

describe("simulated rankings' ratings", () => {
  beforeEach(() => { engine.liveCalls = 0; engine.freshCalls = 0; input.seen.length = 0; });

  it("answer from the last finished build at once, never waiting on the rebuild a sync started", async () => {
    const r = await Promise.race([simulatedRankings(2026, "USNJQ1", 5), new Promise((res) => setTimeout(() => res("waited"), 1000))]);
    expect(r).toMatchObject({ status: "unavailable" });
    expect(engine.freshCalls).toBe(0);
    expect(input.seen).toEqual([{ built: "v1" }]);
  });

  it("are kept per build: the same build's answer again, a newer build's a new one", async () => {
    engine.live = "v3";
    await simulatedRankings(2026, "USNJQ2", 5);
    await simulatedRankings(2026, "USNJQ2", 5);
    expect(input.seen).toEqual([{ built: "v3" }]);
    engine.live = "v4";
    await simulatedRankings(2026, "USNJQ2", 5);
    expect(input.seen).toEqual([{ built: "v3" }, { built: "v4" }]);
  });

  it("a sync that changed nothing about the event keeps the answer; one that added a team doesn't", async () => {
    engine.live = "v5";
    await simulatedRankings(2026, "USNJQ3", 5);
    engine.data = "v9"; // another event's results came in
    await simulatedRankings(2026, "USNJQ3", 5);
    expect(input.seen).toHaveLength(1);
    engine.field = [1, 2, 3, 4, 5, 6, 7];
    await simulatedRankings(2026, "USNJQ3", 5);
    expect(input.seen).toHaveLength(2);
  });
});
