// Stamps ("released", "results as of") write a day the way the rest of the app does, not the browser's 10/31/2026.
import { describe, expect, it } from "vitest";
import { dayDate } from "./format";

describe("dayDate", () => {
  it("writes a short month, the day and the year, from an ISO string, a timestamp or a Date", () => {
    const want = new Date(2026, 9, 31).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    expect(dayDate(new Date(2026, 9, 31))).toBe(want);
    expect(dayDate(new Date(2026, 9, 31).getTime())).toBe(want);
    expect(dayDate(new Date(2026, 9, 31, 12).toISOString())).toBe(want);
    expect(dayDate(new Date(2026, 9, 31))).not.toBe(new Date(2026, 9, 31).toLocaleDateString());
  });
});
