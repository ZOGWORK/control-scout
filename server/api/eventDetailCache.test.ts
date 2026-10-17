// The event detail cache (server/api/events.ts cachedEventDetail): reused while the data version, the
// ratings in use and the day stay the same; built afresh when the data moves on, for an event that's on
// today, and after "Clear caches".
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { cachedEventDetail } from "./events";

const S = 2024;
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO events (season, code, name, type, region, start, end, remote, hybrid, source) VALUES (?, 'OLD', 'Old Qualifier', 'Qualifier', 'USTX', '2024-11-02', '2024-11-02', 0, 0, 'test')", [S]);
  await run("INSERT INTO events (season, code, name, type, region, start, end, remote, hybrid, source) VALUES (?, 'NOW', 'Today Qualifier', 'Qualifier', 'USTX', ?, ?, 0, 0, 'test')", [S, today(), today()]);
  await kvSet("data:version", "v1");
});
beforeEach(() => { clearAllCaches(); });

describe("cachedEventDetail", () => {
  it("reuses the detail while the data version is the same", async () => {
    const a = await cachedEventDetail(S, "OLD");
    await run("UPDATE events SET name = 'Renamed' WHERE season = ? AND code = 'OLD'", [S]);
    const b = await cachedEventDetail(S, "OLD");
    expect(b).toBe(a);
    expect(b!.event.name).toBe("Old Qualifier");
    await run("UPDATE events SET name = 'Old Qualifier' WHERE season = ? AND code = 'OLD'", [S]);
  });

  it("is built afresh once the data version moves on (a sync or a live result)", async () => {
    const a = await cachedEventDetail(S, "OLD");
    await run("UPDATE events SET name = 'After Sync' WHERE season = ? AND code = 'OLD'", [S]);
    await kvSet("data:version", "v2");
    const b = await cachedEventDetail(S, "OLD");
    expect(b).not.toBe(a);
    expect(b!.event.name).toBe("After Sync");
  });

  it("a detail built mid-sync (new version, stats still being written) is built again once the writes settle", async () => {
    await kvSet("data:version", "v3"); // a sync has started: the version moves before its stats are written
    const mid = await cachedEventDetail(S, "OLD");
    await run("UPDATE events SET name = 'Stats Written' WHERE season = ? AND code = 'OLD'", [S]);
    expect(await cachedEventDetail(S, "OLD")).toBe(mid);
    await kvSet("data:settled", "s3"); // the run's writes are done
    expect((await cachedEventDetail(S, "OLD"))!.event.name).toBe("Stats Written");
  });

  it("\"Clear caches\" drops it", async () => {
    const a = await cachedEventDetail(S, "OLD");
    clearAllCaches();
    expect(await cachedEventDetail(S, "OLD")).not.toBe(a);
  });

  it("never caches an event that's on today, or one that doesn't exist", async () => {
    const a = await cachedEventDetail(S, "NOW");
    expect(a!.live).not.toBeNull();
    expect(await cachedEventDetail(S, "NOW")).not.toBe(a);
    expect(await cachedEventDetail(S, "NOPE")).toBeNull();
    await run("INSERT INTO events (season, code, name, type, region, start, end, remote, hybrid, source) VALUES (?, 'NOPE', 'Late', 'Qualifier', 'USTX', '2024-11-09', '2024-11-09', 0, 0, 'test')", [S]);
    expect((await cachedEventDetail(S, "NOPE"))?.event.name).toBe("Late");
  });
});
