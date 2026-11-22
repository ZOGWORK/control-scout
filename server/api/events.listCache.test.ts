// The Events list's rows are cached by the data version (server/api/events.ts listRows): a repeat list skips the
// driver's 50–150 ms, a new version or data:settled rebuilds it, a write that moves neither shows within LIST_TTL_MS,
// and each event's status is worked out on every call (it turns over with the venue's clock, not with the data).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { LIST_TTL_MS, listEvents } from "./events";

const S = 2026;
const add = (code: string, day = "2026-11-14") =>
  run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 0, 0, 'test')", [S, code, code, day, day]);
const codes = async () => (await listEvents({ season: S, hideNoMatch: true })).map((e) => e.code).sort();

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  await kvSet("data:version", "v1");
  await add("Q1");
});
afterEach(() => vi.useRealTimers());

describe("the events list cache", () => {
  it("reuses the rows until the data version moves", async () => {
    expect(await codes()).toEqual(["Q1"]);
    await add("Q2");
    expect(await codes()).toEqual(["Q1"]);
    await kvSet("data:version", "v2");
    expect(await codes()).toEqual(["Q1", "Q2"]);
  });

  it("rebuilds when data:settled moves", async () => {
    await codes();
    await add("Q2");
    await kvSet("data:settled", "s1");
    expect(await codes()).toEqual(["Q1", "Q2"]);
  });

  it("shows a write that moves neither within LIST_TTL_MS", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await codes();
    await add("Q2");
    vi.setSystemTime(Date.now() + LIST_TTL_MS + 1);
    expect(await codes()).toEqual(["Q1", "Q2"]);
  });

  it("keeps each filter apart", async () => {
    await add("LATE", "2026-12-20");
    await kvSet("data:version", "v2");
    expect((await listEvents({ season: S, from: "2026-12-01" })).map((e) => e.code)).toEqual(["LATE"]);
    expect((await listEvents({ season: S })).map((e) => e.code).sort()).toEqual(["LATE", "Q1"]);
  });

  it("works out each event's status on every call, from a cached row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 30 s before the event's day starts somewhere on Earth (no timezone: UTC+14 counts), then 10 s after, inside one cached window.
    vi.setSystemTime(new Date("2026-11-13T09:59:30Z"));
    expect((await listEvents({ season: S })).map((e) => e.status)).toEqual(["upcoming"]);
    await add("Q2");
    vi.setSystemTime(new Date("2026-11-13T10:00:10Z"));
    const now = await listEvents({ season: S });
    // Still the cached rows (Q2 isn't in them), with Q1's status read for the clock now.
    expect(now.map((e) => [e.code, e.status])).toEqual([["Q1", "live"]]);
  });
});
