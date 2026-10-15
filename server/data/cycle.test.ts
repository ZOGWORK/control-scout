import { describe, expect, it } from "vitest";
import { quietHours } from "./cycle";

describe("backfill window", () => {
  it("is the night across the Americas only", () => {
    expect(quietHours(new Date("2026-10-15T05:59:00Z"))).toBe(false);
    expect(quietHours(new Date("2026-10-15T06:00:00Z"))).toBe(true);
    expect(quietHours(new Date("2026-10-15T11:59:00Z"))).toBe(true);
    expect(quietHours(new Date("2026-10-15T12:00:00Z"))).toBe(false);
    expect(quietHours(new Date("2026-10-15T18:00:00Z"))).toBe(false);
  });
});
