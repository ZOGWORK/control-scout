import { describe, expect, it } from "vitest";
import { markedLabel, officialOnlySql, unofficialLine, unofficialWhy, type UnofficialEntry } from "./unofficialRecords";
import { allianceRow, type Row } from "../api/answers/families/topMatches";

const q49 = { season: 2025, code: "FPECAR", level: "qual", series: 0, number: 49 };

describe("matches that are not official records", () => {
  it("DECODE's Q49 at Carolinas Premier Event is marked, with why", () => {
    expect(unofficialWhy(q49)).toContain("usual rules");
    expect(unofficialLine(q49)).toMatch(/^Not an official record: /);
  });
  it("the whole event is marked: Q54 there too, and its playoffs", () => {
    expect(unofficialWhy({ ...q49, number: 54 })).toContain("usual rules");
    expect(unofficialWhy({ ...q49, level: "playoff", series: 3, number: 1 })).toContain("usual rules");
  });
  it("a match at any other event, or the same code in another season, is not marked", () => {
    expect(unofficialWhy({ ...q49, code: "USNCCMP" })).toBeNull();
    expect(unofficialLine({ ...q49, season: 2024 })).toBeNull();
  });
  it("a one-match entry marks that match only, and wins over its event's reason", () => {
    const entries: UnofficialEntry[] = [
      { season: 2024, code: "X", level: "qual", series: 0, number: 3, why: "one match" },
      { season: 2024, code: "Y", why: "whole event" },
      { season: 2024, code: "Y", level: "qual", series: 0, number: 1, why: "this match" },
    ];
    expect(unofficialWhy({ season: 2024, code: "X", level: "qual", series: 0, number: 3 }, entries)).toBe("one match");
    expect(unofficialWhy({ season: 2024, code: "X", level: "qual", series: 0, number: 4 }, entries)).toBeNull();
    expect(unofficialWhy({ season: 2024, code: "Y", level: "qual", series: 0, number: 1 }, entries)).toBe("this match");
    expect(unofficialWhy({ season: 2024, code: "Y", level: "qual", series: 0, number: 2 }, entries)).toBe("whole event");
  });
  it("its row in a list of best matches carries the mark", () => {
    const r = { ...q49, label: "Q49", time: null, name: "Carolinas Premier Event", type: "Premier", start: "2026-07-25", end: "2026-07-26", red_total: 260, red_np: 205, blue_total: 724, blue_np: 714,
      red_auto: 0, red_teleop: 0, red_endgame: 0, red_pen: 0, blue_auto: 63, blue_teleop: 641, blue_endgame: 10, blue_pen: 55, breakdown: 1 } as Row;
    expect(allianceRow(r, "blue", () => []).unofficial).toMatch(/^Not an official record: /);
    expect(allianceRow(r, "blue", () => []).note).toBeUndefined();
    expect(allianceRow({ ...r, number: 50 }, "blue", () => []).unofficial).toMatch(/^Not an official record: /);
    expect(allianceRow({ ...r, code: "USNCCMP" }, "blue", () => []).unofficial).toBeUndefined();
  });
  it("its label in a table of scores says so too", () => {
    expect(markedLabel({ ...q49, label: "Q49" })).toBe("Q49 (not an official record)");
    expect(markedLabel({ ...q49, number: 54, label: "Q54" })).toBe("Q54 (not an official record)");
    expect(markedLabel({ ...q49, code: "USNCCMP", label: "Q50" })).toBe("Q50");
  });
  it("an 'official' question leaves out a whole event's matches, or one match, of that season only", () => {
    const entries: UnofficialEntry[] = [{ season: 2025, code: "FPECAR", why: "x" }, { season: 2025, code: "USNJCMP", level: "qual", series: 0, number: 3, why: "y" }, { season: 2024, code: "OLD", why: "z" }];
    expect(officialOnlySql(2025, entries)).toEqual({
      sql: ["m.code <> ?", "NOT (m.code = ? AND m.level = ? AND m.series = ? AND m.number = ?)"],
      args: ["FPECAR", "USNJCMP", "qual", 0, 3],
    });
    expect(officialOnlySql(2023, entries)).toEqual({ sql: [], args: [] });
  });
});
