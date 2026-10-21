// The event page follows new projection runs live: each `projections` event on the stream re-reads the
// stored runs (no reload); a broken stream retries a few times, then leaves it to the results refresh.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STREAM_BACKOFF_MS, bandHits, followProjections, projectionTier, rankMovement } from "./projections";
import type { ProjectionRun, ProjectionTeam } from "../shared/projections";

class FakeES {
  static all: FakeES[] = [];
  listeners = new Map<string, (e: unknown) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeES.all.push(this); }
  addEventListener(k: string, fn: (e: unknown) => void) { this.listeners.set(k, fn); }
  emit(k: string) { this.listeners.get(k)?.({ data: "{}" }); }
  close() { this.closed = true; }
}

beforeEach(() => { FakeES.all = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("followProjections", () => {
  it("re-reads on each new run, from the event's own stream", () => {
    const onRun = vi.fn();
    const stop = followProjections(2026, "USNJQ1", onRun, { EventSource: FakeES as unknown as typeof EventSource });
    expect(FakeES.all[0].url).toBe("/api/projections/2026/USNJQ1/stream");
    FakeES.all[0].emit("ready");
    expect(onRun).not.toHaveBeenCalled();
    FakeES.all[0].emit("projections");
    FakeES.all[0].emit("projections");
    expect(onRun).toHaveBeenCalledTimes(2);
    stop();
    expect(FakeES.all[0].closed).toBe(true);
  });

  it("reconnects with backoff, then gives up (the results refresh keeps the page current)", () => {
    followProjections(2026, "X1", () => {}, { EventSource: FakeES as unknown as typeof EventSource });
    for (let i = 0; i < STREAM_BACKOFF_MS.length; i++) {
      FakeES.all.at(-1)!.onerror!();
      vi.advanceTimersByTime(STREAM_BACKOFF_MS[i]);
      expect(FakeES.all).toHaveLength(i + 2);
    }
    FakeES.all.at(-1)!.onerror!();
    vi.advanceTimersByTime(120_000);
    expect(FakeES.all).toHaveLength(STREAM_BACKOFF_MS.length + 1);
  });

  it("does nothing without EventSource", () => {
    const stop = followProjections(2026, "X1", () => {}, { EventSource: undefined });
    expect(FakeES.all).toHaveLength(0);
    stop();
  });
});

const team = (t: number, p10: number, p50: number, p90: number): ProjectionTeam => ({ team: t, rank: { p10, p50, p90, mean: p50 }, pPlayoff: 0.5, pCaptain: 0.2, pPicked: 0.3, pAdvance: 0.1, pWin: 0.05, pFinalist: 0.05 });
const run = (o: Partial<ProjectionRun>): ProjectionRun => ({ kind: "current", runs: 10000, target: 10000, stage: "live", played: 10, scheduled: 40, through: "Q10", slots: 4, slotsSource: "official", seed: 1, engineVersion: "x", ms: 1, computedAt: "", teams: [], ...o });

describe("projection helpers", () => {
  it("movement: up is positive", () => {
    expect(rankMovement(team(1, 1, 3, 6), team(1, 2, 7, 12))).toBe(4);
    expect(rankMovement(team(1, 1, 9, 12), team(1, 2, 7, 12))).toBe(-2);
    expect(rankMovement(team(1, 1, 3, 6), undefined)).toBeNull();
  });
  it("counts final seeds inside their bands (inclusive)", () => {
    const r = run({ teams: [team(1, 1, 2, 4), team(2, 3, 5, 8), team(3, 5, 9, 12)] });
    expect(bandHits(r, new Map([[1, 4], [2, 9], [3, 5]]))).toEqual({ inside: 2, total: 3 });
  });
  it("confidence follows the stage and how much is left", () => {
    expect(projectionTier(run({ played: 0 })).tier).toBe("provisional");
    expect(projectionTier(run({ played: 10 })).tier).toBe("provisional");
    expect(projectionTier(run({ played: 30 })).tier).toBe("moderate");
    expect(projectionTier(run({ stage: "quals", played: 40 })).tier).toBe("confident");
  });
});
