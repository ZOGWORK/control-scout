import { beforeEach, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { nextBackfill, quietHours } from "./cycle";

describe("backfill window", () => {
  it("is the night across the Americas only", () => {
    expect(quietHours(new Date("2026-10-15T05:59:00Z"))).toBe(false);
    expect(quietHours(new Date("2026-10-15T06:00:00Z"))).toBe(true);
    expect(quietHours(new Date("2026-10-15T11:59:00Z"))).toBe(true);
    expect(quietHours(new Date("2026-10-15T12:00:00Z"))).toBe(false);
    expect(quietHours(new Date("2026-10-15T18:00:00Z"))).toBe(false);
  });
});

describe("next backfill", () => {
  beforeEach(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    for (const s of [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]) await run("INSERT OR REPLACE INTO seasons (season, name, frozen) VALUES (?, ?, 1)", [s, String(s)]);
  });
  it("is a past season not fully fetched, newest first", async () => {
    await run("UPDATE seasons SET frozen = 0 WHERE season IN (2019, 2021)");
    expect(await nextBackfill()).toBe(2021);
  });
  it("comes back for a fetched season whose stats never finished (stopped between sync and stats)", async () => {
    expect(await nextBackfill()).toBeNull();
    await kvSet("backfill:stats-pending", [2020]);
    expect(await nextBackfill()).toBe(2020);
  });
});
