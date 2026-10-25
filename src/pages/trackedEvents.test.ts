import { describe, expect, it } from "vitest";
import type { EventListItem } from "../shared/api";
import { lookupPath, orderTracked, parseTracked, resolveTracked } from "./trackedEvents";

const ev = (code: string, status: EventListItem["status"], start: string | null, more: Partial<EventListItem> = {}) =>
  ({ code, name: `Event ${code}`, season: 2026, start, end: start, status, type: "Qualifier", typeLabel: "Qualifier", teams: 0, matchesPlayed: 0, matchesTotal: 0, ...more }) as EventListItem;

describe("tracked event refs", () => {
  it("reads season:code and skips anything else", () => {
    expect(parseTracked("2025:USNJQ1")).toEqual({ ref: "2025:USNJQ1", season: 2025, code: "USNJQ1" });
    for (const bad of ["USNJQ1", ":USNJQ1", "2025:", "x:USNJQ1"]) expect(parseTracked(bad)).toBeNull();
  });

  it("looks one event up by its code in its own season, hidden types included", () => {
    expect(lookupPath({ ref: "2024:USNJQ1", season: 2024, code: "USNJQ1" })).toBe("/api/events?season=2024&q=USNJQ1&all=1&limit=50");
  });
});

describe("tracked event order", () => {
  it("puts live first, then upcoming soonest first (no date last), then finished most recent first", () => {
    const out = orderTracked([
      ev("F_OLD", "finished", "2025-10-01"),
      ev("U_LATE", "upcoming", "2026-12-01"),
      ev("U_TBA", "upcoming", null),
      ev("L", "live", "2026-11-01"),
      ev("F_NEW", "finished", "2026-10-20"),
      ev("U_SOON", "upcoming", "2026-11-08"),
    ]);
    expect(out.map((e) => e.code)).toEqual(["L", "U_SOON", "U_LATE", "U_TBA", "F_NEW", "F_OLD"]);
  });

  it("orders finished events by their last day", () => {
    const out = orderTracked([ev("A", "finished", "2026-01-01", { end: "2026-01-02" }), ev("B", "finished", "2026-01-01", { end: "2026-01-04" })]);
    expect(out.map((e) => e.code)).toEqual(["B", "A"]);
  });
});

describe("resolving tracked events", () => {
  const list = [ev("USNJQ1", "upcoming", "2026-11-08"), ev("USTXQ1", "live", "2026-10-25")];
  it("takes events from the season list on screen and leaves the rest to look up", () => {
    const { found, missing } = resolveTracked(["2026:USNJQ1", "2025:OLDQ1", "2026:USTXQ1", "2026:USNJQ1", "junk"], new Map([[2026, list]]), {});
    expect(found.map((e) => e.code)).toEqual(["USTXQ1", "USNJQ1"]);
    expect(missing.map((r) => r.ref)).toEqual(["2025:OLDQ1"]);
  });

  it("uses a lookup's answer, matching the code exactly", () => {
    const r = { ref: "2025:OLDQ1", season: 2025, code: "OLDQ1" };
    const lookups = { [lookupPath(r)]: [ev("OLDQ10", "finished", "2025-03-01", { season: 2025 }), ev("OLDQ1", "finished", "2025-02-01", { season: 2025 })] };
    const { found, missing } = resolveTracked(["2025:OLDQ1"], new Map(), lookups);
    expect(found.map((e) => `${e.season}:${e.code}`)).toEqual(["2025:OLDQ1"]);
    expect(missing).toEqual([]);
  });
});
