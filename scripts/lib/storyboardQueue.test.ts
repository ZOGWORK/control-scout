// scripts/storyboards.ts's queue: videos with no storyboard leave it for a while, so they never take every run's budget.
import { describe, expect, it } from "vitest";
import { noteRun, wanted, type NoneSeen } from "./storyboardQueue";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("storyboard queue", () => {
  it("skips fresh specs and recent no-storyboard videos, so older recordings are reached", () => {
    const none: NoneSeen = { live1: { at: ago(0.5), live: true }, gone1: { at: ago(3), live: false }, live2: { at: ago(2), live: true }, gone2: { at: ago(20), live: false } };
    expect(wanted(["live1", "gone1", "fresh", "live2", "gone2", "old1", "old2"], new Set(["fresh"]), none, NOW, 3)).toEqual(["live2", "gone2", "old1"]);
  });
  it("a run's notes: new ones added, read ones forgotten, stale ones dropped", () => {
    const none: NoneSeen = { a: { at: ago(1), live: false }, b: { at: ago(30), live: false }, c: { at: ago(1), live: true } };
    expect(noteRun(none, ["c"], [{ id: "d", live: true }], NOW)).toEqual({ a: none.a, d: { at: new Date(NOW).toISOString(), live: true } });
  });
  it("a run where every video lacks a storyboard: next run reads the next ones", () => {
    const ids = Array.from({ length: 6 }, (_, i) => `v${i}`);
    const first = wanted(ids, new Set(), {}, NOW, 3);
    const none = noteRun({}, [], first.map((id) => ({ id, live: false })), NOW);
    expect(wanted(ids, new Set(), none, NOW + 3_600_000, 3)).toEqual(["v3", "v4", "v5"]);
  });
});
