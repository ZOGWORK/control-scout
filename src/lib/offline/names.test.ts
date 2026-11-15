import { describe, expect, it, vi } from "vitest";
import type { LitePack, PackMeta } from "../packs";
import type { EventBundle, SavedBundle } from "../../shared/eventBundle";

// The team-number boxes' names with no signal (names.ts): a saved event pack's, else the lite pack's.
let pack: LitePack | null = null;
let meta: PackMeta | null = null;
let bundles: SavedBundle[] = [];
let stored: Record<string, EventBundle> = {};
const loadLite = vi.fn(async () => pack);
vi.mock("../packs", () => ({ loadLite: () => loadLite(), packStatus: () => meta }));
vi.mock("./bundleMeta", () => ({ savedBundles: () => bundles }));
vi.mock("./bundles", () => ({ loadBundle: async (_s: number, code: string) => stored[code] ?? null }));
const { savedTeamName } = await import("./names");

const saved = (code: string, dataAsOf: string, teams: number[]): SavedBundle => ({ season: 2026, code, name: code, end: null, version: "v", sha256: "s", bytes: 1, savedAt: 0, builtAt: dataAsOf, dataAsOf, team: null, workspace: null, reports: 0, picklist: false, teams });
const bundle = (names: [number, string | null][] | null, field: [number, string | null][]): EventBundle =>
  ({ ratings: null, event: { field: field.map(([team, name]) => ({ team, name })) }, ...(names ? { predict: { bonus: null, pairs: null, recent: [], names } } : {}) }) as unknown as EventBundle;

describe("savedTeamName", () => {
  it("takes the newest pack holding the team: the names its prediction shows, else its field list's", async () => {
    bundles = [saved("OLD", "2026-11-01T00:00:00Z", [10653, 5386]), saved("NEW", "2026-11-14T00:00:00Z", [10653, 33429])];
    stored = { OLD: bundle(null, [[10653, "Old name"], [5386, "Fabricators"]]), NEW: bundle([[10653, "Dragatrons"], [33429, null]], [[10653, "Field name"], [33429, null]]) };
    expect(await savedTeamName(10653)).toBe("Dragatrons");
    expect(await savedTeamName(5386)).toBe("Fabricators"); // a pack from before the names shipped: its field list
    expect(await savedTeamName(33429)).toBe(""); // held, with no name
    expect(loadLite).not.toHaveBeenCalled();
  });

  it("falls back to the lite pack, and opens it only when one is saved", async () => {
    bundles = []; stored = {};
    pack = { teams: [[9931, "Northeast Viking Vortex", null], [8, null, null]] } as unknown as LitePack;
    meta = null;
    expect(await savedTeamName(9931)).toBeUndefined();
    expect(loadLite).not.toHaveBeenCalled();
    meta = { version: "v" } as PackMeta;
    expect(await savedTeamName(9931)).toBe("Northeast Viking Vortex");
    expect(await savedTeamName(8)).toBe("");
    expect(await savedTeamName(12345)).toBeUndefined(); // in nothing saved: can't tell
  });
});
