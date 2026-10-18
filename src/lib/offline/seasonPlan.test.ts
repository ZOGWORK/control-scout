import { describe, expect, it } from "vitest";
import { bytesOf, planSeasons } from "./seasonPlan";
import type { PackFile } from "../packs";
import type { SavedSeason } from "./seasons";

const file = (season: number, sha: string, bytes = 10, seasons = [season]): PackFile => ({ name: `s${season}`, url: `/packs/${season}.db`, bytes, sha256: sha, seasons, kind: "full", contents: "" });
const saved = (season: number, sha: string): SavedSeason => ({ season, sha256: sha, version: "v1", bytes: 10, savedAt: 1 } as unknown as SavedSeason);

describe("planSeasons", () => {
  const full = [file(2024, "a"), file(2026, "b", 25), file(2025, "c", 37), file(2023, "d"), file(2022, "x", 5, [2021, 2022])];
  const plan = planSeasons(full, [saved(2024, "old"), saved(2023, "d")]);

  it("orders updates, then saved, then not saved, newest first in each; multi-season packs aren't listed", () => {
    expect(plan.rows.map((r) => [r.season, r.state])).toEqual([[2024, "update"], [2023, "saved"], [2026, "available"], [2025, "available"]]);
  });

  it("knows what Download all and Update all fetch, and their size", () => {
    expect(plan.toDownload.map((r) => r.season)).toEqual([2026, 2025]);
    expect(bytesOf(plan.toDownload)).toBe(62);
    expect(plan.toUpdate.map((r) => r.season)).toEqual([2024]);
    expect(plan.savedCount).toBe(2);
  });

  it("has nothing to do when every season is saved and current", () => {
    const p = planSeasons([file(2026, "b")], [saved(2026, "b")]);
    expect(p.toDownload).toEqual([]);
    expect(p.toUpdate).toEqual([]);
  });
});
