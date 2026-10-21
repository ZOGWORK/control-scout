import { describe, expect, it, vi } from "vitest";
import { FITTED_MODEL, RatingBook } from "@control-scout/predict-engine";
import type { LitePack } from "../packs";

const book = new RatingBook(FITTED_MODEL.rating);
book.startSeason(2025);
let pack: LitePack;
vi.mock("../packs", () => ({ loadLite: async () => pack }));
const { offlineExplain } = await import("./predict");

const base = (): LitePack => ({ format: 1, version: "v", builtAt: "2026-10-21T00:00:00Z", engineVersion: "x", books: { "2025": book.toData() }, teams: [] });

describe("offlineExplain bonus odds", () => {
  it("uses the pack's bonus model for qualification matches", async () => {
    pack = { ...base(), bonus: { "2025": { model: FITTED_MODEL.bonus["2025"], source: "season", samples: 2000 } } };
    const q = await offlineExplain(2025, [1, 2], [3, 4], "qual");
    expect(q?.bonus?.samples).toBe(2000);
    expect(q?.bonus?.A.p.movement).toBeGreaterThan(0);
    const po = await offlineExplain(2025, [1, 2], [3, 4], "playoff");
    expect(po?.bonus).toBeNull();
  });

  it("shows none from a pack built before bonus models were packed", async () => {
    pack = base();
    const q = await offlineExplain(2025, [1, 2], [3, 4], "qual");
    expect(q?.bonus).toBeNull();
    expect(q?.winProbA).toBeGreaterThan(0);
  });
});
