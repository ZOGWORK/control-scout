import { describe, it, expect } from "vitest";
import { localToUtcMs } from "./time";

describe("localToUtcMs", () => {
  it("converts event-local wall time to the real instant", () => {
    // Sydney is UTC+11 in November (daylight time).
    expect(new Date(localToUtcMs("2025-11-16T11:58:48.832", "Australia/Sydney")!).toISOString()).toBe("2025-11-16T00:58:48.832Z");
    // New York is UTC-5 in December.
    expect(new Date(localToUtcMs("2025-12-06T09:00:00", "America/New_York")!).toISOString()).toBe("2025-12-06T14:00:00.000Z");
  });
  it("handles a time just after a DST switch", () => {
    // US clocks went forward at 02:00 on 2026-03-08; 03:30 local is EDT (UTC-4).
    expect(new Date(localToUtcMs("2026-03-08T03:30:00", "America/New_York")!).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });
  it("keeps explicit offsets and refuses to guess without a zone", () => {
    expect(localToUtcMs("2024-01-27T19:40:00.096Z", null)).toBe(Date.parse("2024-01-27T19:40:00.096Z"));
    expect(localToUtcMs("2025-11-16T11:58:48", null)).toBeNull();
    expect(localToUtcMs(null, "Australia/Sydney")).toBeNull();
    expect(localToUtcMs("2025-11-16T11:58:48", "Not/AZone")).toBeNull();
  });
});
