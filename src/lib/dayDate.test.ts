// Stamps ("released", "results as of") write a day the way the rest of the app does (dateRange's rule), whatever
// the browser's language: never the browser's 10/31/2026, nor 31 oct. 2026.
import { describe, expect, it } from "vitest";
import { dateRange, dayDate } from "./format";

describe("dayDate", () => {
  it("writes the local day as dateRange does, from an ISO string, a timestamp or a Date", () => {
    expect(dayDate(new Date(2026, 9, 31))).toBe("Oct 31, 2026");
    expect(dayDate(new Date(2026, 9, 31, 23, 59).getTime())).toBe("Oct 31, 2026");
    expect(dayDate(new Date(2026, 0, 5, 12).toISOString())).toBe("Jan 5, 2026");
    expect(dayDate(new Date(2026, 9, 31))).toBe(dateRange("2026-10-31"));
  });
  it("doesn't follow the browser's language or date order", () => {
    const fr = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function () { return "31 oct. 2026"; };
    try { expect(dayDate(new Date(2026, 9, 31))).toBe("Oct 31, 2026"); } finally { Date.prototype.toLocaleDateString = fr; }
  });
});
