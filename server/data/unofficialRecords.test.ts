import { describe, expect, it } from "vitest";
import { unofficialLine, unofficialWhy } from "./unofficialRecords";
import { allianceRow, type Row } from "../api/answers/families/topMatches";

const q49 = { season: 2025, code: "FPECAR", level: "qual", series: 0, number: 49 };

describe("matches that are not official records", () => {
  it("DECODE's Q49 at Carolinas Premier Event is marked, with why", () => {
    expect(unofficialWhy(q49)).toContain("usual rules");
    expect(unofficialLine(q49)).toMatch(/^Not an official record: /);
  });
  it("any other match is not marked", () => {
    expect(unofficialWhy({ ...q49, number: 50 })).toBeNull();
    expect(unofficialLine({ ...q49, season: 2024 })).toBeNull();
  });
  it("its row in a list of best matches carries the mark", () => {
    const r = { ...q49, label: "Q49", time: null, name: "Carolinas Premier Event", type: "Premier", start: "2026-07-25", end: "2026-07-26", red_total: 260, red_np: 205, blue_total: 724, blue_np: 714,
      red_auto: 0, red_teleop: 0, red_endgame: 0, red_pen: 0, blue_auto: 63, blue_teleop: 641, blue_endgame: 10, blue_pen: 55, breakdown: 1 } as Row;
    expect(allianceRow(r, "blue", () => []).note).toBe("Not an official record");
    expect(allianceRow({ ...r, number: 50 }, "blue", () => []).note).toBeUndefined();
  });
});
