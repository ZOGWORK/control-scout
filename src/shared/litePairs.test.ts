import { describe, expect, it } from "vitest";
import { FITTED_MODEL, PartnershipBook, PartnershipTable, partnershipFact, type MatchRecord } from "@control-scout/predict-engine";
import { LITE_MIN_MATCHES, decodeLitePairs, encodeLitePairs } from "./litePairs";

const al = (teams: number[], np: number) => ({ teams, auto: 20, teleop: np - 30, endgame: 10, np, penCommitted: 0, total: np });
let n = 0;
const match = (season: number, code: string, red: [number[], number], blue: [number[], number]): MatchRecord =>
  ({ season, eventCode: code, level: "qual", series: 0, number: ++n, time: Date.UTC(season, 10, 1) + n * 60_000, red: al(...red), blue: al(...blue) });

/** 2023: 1 + 2 play together 4 times. 2025: 3 + 4 four times, 5 + 6 twice, 7 + 8 meet 8 + 9 three times as opponents. */
function table() {
  const b = new PartnershipBook(FITTED_MODEL.rating);
  b.nameEvent(2025, "TXCMP", "Texas Championship");
  for (let i = 0; i < 4; i++) b.observe(match(2023, "OLD", [[1, 2], 120], [[20, 21], 90]));
  for (let i = 0; i < 4; i++) b.observe(match(2025, "TXCMP", [[3, 4], 150 + i], [[22, 23], 90]));
  for (let i = 0; i < 2; i++) b.observe(match(2025, "TXCMP", [[5, 6], 100], [[24, 25], 110]));
  for (let i = 0; i < 3; i++) b.observe(match(2025, "TXCMP", [[7, 10], 100], [[8, 11], 90]));
  b.observe(match(2026, "OPEN", [[30, 31], 80], [[32, 33], 70]));
  return { ...b.toData(), season: 2026 };
}

describe("lite pack pair history", () => {
  it("keeps same-alliance pairs from this season and last with enough matches, and words them like the server", () => {
    const d = table();
    const lite = encodeLitePairs(d)!;
    const back = new PartnershipTable(decodeLitePairs(JSON.parse(JSON.stringify(lite)))!);
    const full = new PartnershipTable(d);
    // 3 + 4 and their opponents 22 + 23 (4 together), 7 + 10 and 8 + 11 (3 together), all 2025–26.
    expect(lite.rows.length).toBe(4);
    expect(back.together(3, 4)!.n).toBe(4);
    expect(partnershipFact(back, [3, 4], [40, 41], 2026)!.label).toBe(partnershipFact(full, [3, 4], [40, 41], 2026)!.label);
    expect(partnershipFact(back, [3, 4], [40, 41], 2026)!.label).toContain("best 153 at Texas Championship (2025–26)");
    expect(partnershipFact(back, [3, 4], [40, 41], 2026)!.effect).toBeCloseTo(partnershipFact(full, [3, 4], [40, 41], 2026)!.effect, 2);
    // What offline leaves out: older seasons, pairs under LITE_MIN_MATCHES, head-to-head records.
    expect(full.together(1, 2)!.n).toBeGreaterThanOrEqual(LITE_MIN_MATCHES);
    expect(back.together(1, 2)).toBeUndefined();
    expect(back.together(5, 6)).toBeUndefined();
    expect(full.against(7, 8)).toBeDefined();
    expect(back.against(7, 8)).toBeUndefined();
    expect(decodeLitePairs(null)).toBeNull();
  });

  it("delta-codes sorted rows", () => {
    const d = table();
    d.together.push([50, 60, 3, 3, 0, 0, 3, 1, 2026, 99, 2026, 0], [45, 46, 3, 3, 0, 0, 3, 1, 2026, 99, 2026, 0]);
    const lite = encodeLitePairs(d)!;
    const pairs = new PartnershipTable(decodeLitePairs(lite)!);
    expect(lite.rows.every((r) => r[0] >= 0 && r[1] > 0)).toBe(true); // sorted, delta-coded
    expect([pairs.together(45, 46)?.n, pairs.together(50, 60)?.n, pairs.together(3, 4)?.n]).toEqual([3, 3, 4]);
  });
});
