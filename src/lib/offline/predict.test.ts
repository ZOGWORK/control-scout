import { describe, expect, it, vi } from "vitest";
import { FITTED_MODEL, RatingBook } from "@control-scout/predict-engine";
import type { LitePack, PackMeta } from "../packs";
import type { EventBundle, SavedBundle } from "../../shared/eventBundle";

// Two books of the same season: "old" (one match) and "new" (two more), so which snapshot answered shows in the numbers.
const match = (n: number, red: [number, number], blue: [number, number], rs: number, bs: number) => ({
  season: 2025, eventCode: "E", level: "qual" as const, series: 0, number: n, time: Date.parse("2025-11-01T10:00:00Z") + n * 6e5,
  red: { teams: red, auto: rs / 4, teleop: rs / 2, endgame: rs / 4, np: rs, penCommitted: 0, total: rs }, blue: { teams: blue, auto: bs / 4, teleop: bs / 2, endgame: bs / 4, np: bs, penCommitted: 0, total: bs },
});
const bookOf = (n: number) => {
  const b = new RatingBook(FITTED_MODEL.rating);
  b.startSeason(2025);
  for (const m of [match(1, [1, 2], [3, 4], 120, 60), match(2, [1, 3], [2, 4], 150, 40), match(3, [1, 4], [2, 3], 160, 50)].slice(0, n)) b.update(m as never);
  return b.toData();
};
const bonus = { model: FITTED_MODEL.bonus["2025"], source: "season" as const, samples: 2000 };

let pack: LitePack | null;
let meta: PackMeta | null;
let bundles: SavedBundle[] = [];
let stored: Record<string, EventBundle> = {};
vi.mock("../packs", () => ({ loadLite: async () => pack, packStatus: () => meta }));
vi.mock("./bundleMeta", () => ({ savedBundles: () => bundles }));
vi.mock("./bundles", () => ({ loadBundle: async (_s: number, code: string) => stored[code] ?? null }));
const { offlineExplain } = await import("./predict");
const { bundleCall, liteCall } = await import("./predictCall");

const lite = (o: Partial<LitePack> = {}): LitePack => ({ format: 1, version: "v", builtAt: "2026-10-21T00:05:00Z", engineVersion: "x", books: { "2025": bookOf(1) }, teams: [[1, "One", null], [2, "Two", null], [3, "Three", null], [4, "Four", null]], ...o });
const liteMeta = (dataAsOf: string): PackMeta => ({ version: "v", bytes: 1, savedAt: 0, builtAt: "2026-10-21T00:05:00Z", engineVersion: "x", seasons: [2025], dataAsOf });
const field = [1, 2, 3, 4].map((team) => ({ team, name: `Field ${team}` }));
const bundle = (withPredict: boolean): EventBundle => ({
  ratings: bookOf(3), event: { field } as never,
  ...(withPredict ? { predict: { bonus, pairs: null, recent: [[3, 10, 2, 0]], names: [[1, "One"], [2, "Two"], [3, "Three"], [4, "Four"]] } } : {}),
} as unknown as EventBundle);
const saved = (code: string, dataAsOf: string): SavedBundle => ({ season: 2025, code, name: `Meet ${code}`, end: null, version: "v", sha256: "s", bytes: 1, savedAt: 0, builtAt: dataAsOf, dataAsOf, team: null, workspace: null, reports: 0, picklist: false, teams: [1, 2, 3, 4] });

describe("offlineExplain", () => {
  it("uses the pack's bonus model for qualification matches, none in playoffs", async () => {
    pack = lite({ bonus: { "2025": bonus } }); meta = liteMeta("2026-10-21T00:00:00Z"); bundles = [];
    const q = await offlineExplain(2025, [1, 2], [3, 4], "qual");
    expect(q?.view.bonus?.red[0]).toBeGreaterThan(0);
    expect((await offlineExplain(2025, [1, 2], [3, 4], "playoff"))?.view.bonus).toBeNull();
  });

  it("shows none from a pack built before bonus models were packed", async () => {
    pack = lite(); meta = liteMeta("2026-10-21T00:00:00Z"); bundles = [];
    const q = await offlineExplain(2025, [1, 2], [3, 4]);
    expect(q?.view.bonus).toBeNull();
    expect(q?.view.winProbRed).toBeGreaterThan(0);
  });

  it("names the teams as the pack does, and words the pack's recent records as the server does", async () => {
    pack = lite({ recent: { "2025": [[4, 10, 3, 0]] } }); meta = liteMeta("2026-10-21T00:00:00Z"); bundles = [];
    const q = (await offlineExplain(2025, [1, 2], [3, 4]))!;
    expect(q.view.teamsRed.map((t) => t.name)).toEqual(["One", "Two"]);
    expect(q.view.reasons).toEqual(["Team 4 was a no-show in 3 of its last 10 matches"]);
    expect(q.source).toEqual({ kind: "lite" });
    // The time shown is the pack's data time (the server's last sync before the build), not when it was built.
    expect(q.asOf).toBe("2026-10-21T00:00:00Z");
  });

  it("a newer event bundle holding the lineup answers, every number from it", async () => {
    pack = lite({ bonus: { "2025": { ...bonus, samples: 10 } } }); meta = liteMeta("2026-10-21T00:00:00Z");
    bundles = [saved("NEW", "2026-10-21T08:00:00Z")]; stored = { NEW: bundle(true) };
    // One clock for both calls (a rating's doubt grows with time since its last match).
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-22T00:00:00Z") });
    const q = (await offlineExplain(2025, [1, 2], [3, 4]))!;
    vi.useRealTimers();
    expect(q.source).toEqual({ kind: "bundle", season: 2025, code: "NEW", name: "Meet NEW" });
    expect(q.asOf).toBe("2026-10-21T08:00:00Z");
    expect(q.view).toEqual(bundleCall(stored.NEW, 2025, [1, 2], [3, 4], "qual", Date.parse("2026-10-22T00:00:00Z")));
    expect(q.view.reasons).toEqual(["Team 3 was a no-show in 2 of its last 10 matches"]);
    expect(q.view.bonus?.reason).toMatch(/2,000/);
    expect(q.view.winProbRed).not.toBe(liteCall(pack, 2025, [1, 2], [3, 4]).winProbRed);
  });

  it("an older bundle loses to a newer lite pack, and a bundle without the server's other inputs never mixes in", async () => {
    pack = lite(); meta = liteMeta("2026-10-21T00:00:00Z");
    bundles = [saved("OLD", "2026-10-20T08:00:00Z")]; stored = { OLD: bundle(true) };
    expect((await offlineExplain(2025, [1, 2], [3, 4]))!.source).toEqual({ kind: "lite" });
    bundles = [saved("BARE", "2026-10-21T08:00:00Z")]; stored = { BARE: bundle(false) };
    expect((await offlineExplain(2025, [1, 2], [3, 4]))!.source).toEqual({ kind: "lite" });
    // With no lite pack, that bundle answers with what it has (the field's names).
    pack = null; meta = null;
    const q = (await offlineExplain(2025, [1, 2], [3, 4]))!;
    expect(q.source.kind).toBe("bundle");
    expect(q.view.teamsBlue.map((t) => t.name)).toEqual(["Field 3", "Field 4"]);
    expect(q.view.bonus).toBeNull();
  });

  it("with `from`, only that snapshot answers (a what-if's swap), and none when it doesn't hold the lineup", async () => {
    pack = lite(); meta = liteMeta("2026-10-21T00:00:00Z");
    // The newer bundle would answer on its own; the lite pack was asked for.
    bundles = [saved("NEW", "2026-10-21T08:00:00Z")]; stored = { NEW: bundle(true) };
    expect((await offlineExplain(2025, [1, 2], [3, 4]))!.source.kind).toBe("bundle");
    expect((await offlineExplain(2025, [1, 2], [3, 4], "qual", { kind: "lite" }))!.source).toEqual({ kind: "lite" });
    const from = { kind: "bundle" as const, season: 2025, code: "NEW", name: "Meet NEW" };
    expect((await offlineExplain(2025, [1, 3], [2, 4], "qual", from))!.source).toEqual(from);
    // Team 9 isn't at the bundle's event: no call from it, never the lite pack's instead.
    expect(await offlineExplain(2025, [1, 9], [3, 4], "qual", from)).toBeNull();
    pack = null;
    expect(await offlineExplain(2025, [1, 2], [3, 4], "qual", { kind: "lite" })).toBeNull();
  });
});
