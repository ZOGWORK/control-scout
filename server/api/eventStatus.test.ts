// PUB3-F01: an event's status (upcoming / live / finished) goes by its venue's calendar, the same one
// the live fast lane uses (data/live.ts isEventDay). It used to compare dates with UTC's "today", so
// at 02:00 UTC on Oct 19 an Oct 18 Los Angeles event with a match still to play read "finished", and
// at 16:00 UTC on Oct 18 an Oct 19 Brisbane event read "upcoming", while the live lane counted both as
// on: the event page needs both (lib/liveMode.ts isLiveMode), so its LIVE panel never showed. With no
// zone, or one that isn't an IANA zone, both use the same UTC−12 … UTC+14 window.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { isEventDay } from "../data/live";
import { isLiveMode } from "../../src/lib/liveMode";
import { cachedEventDetail, eventDetail, eventSummary, listEvents } from "./events";
import { createApp } from "../app";

const S = 2026;

/** One event with two qualification matches; `played` of them have a result. */
async function event(code: string, start: string, timezone: string | null, o: { end?: string; played?: number } = {}) {
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, ?, 0, 0, 'test')",
    [S, code, code, start, o.end ?? start, timezone]);
  for (const n of [1, 2]) {
    const done = n <= (o.played ?? 0) ? 1 : 0;
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, ?, 'test')",
      [S, code, n, `Q${n}`, done, done ? 50 : null, done ? 50 : null, done ? 40 : null, done ? 40 : null]);
  }
}

/** The status every surface reads (summary, list, detail) and whether the live lane counts the event as on. */
async function statusAt(iso: string, code: string) {
  vi.setSystemTime(Date.parse(iso));
  const summary = (await eventSummary(S, code))!.status;
  const listed = (await listEvents({ season: S })).find((e) => e.code === code)!.status;
  const d = (await eventDetail(S, code))!;
  expect(listed).toBe(summary);
  expect(d.event.status).toBe(summary);
  return { status: summary, live: d.live != null, liveMode: isLiveMode(d) };
}

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  await kvSet("data:version", "v1");
});

describe("event status by the venue's calendar (PUB3-F01)", () => {
  it("an Oct 18 Los Angeles event is still live at 02:00 UTC on the 19th (negative offset)", async () => {
    await event("LA", "2026-10-18", "America/Los_Angeles");
    expect(await statusAt("2026-10-19T02:00:00Z", "LA")).toEqual({ status: "live", live: true, liveMode: true });
    expect(await statusAt("2026-10-19T06:59:59Z", "LA")).toEqual({ status: "live", live: true, liveMode: true }); // 23:59:59 PDT
    expect(await statusAt("2026-10-19T07:00:00Z", "LA")).toEqual({ status: "finished", live: false, liveMode: false }); // midnight there
    expect(await statusAt("2026-10-18T06:59:59Z", "LA")).toEqual({ status: "upcoming", live: false, liveMode: false }); // still the 17th there
  });

  it("an Oct 19 Brisbane event is already live at 16:00 UTC on the 18th (positive offset)", async () => {
    await event("BNE", "2026-10-19", "Australia/Brisbane");
    expect(await statusAt("2026-10-18T16:00:00Z", "BNE")).toEqual({ status: "live", live: true, liveMode: true });
    expect(await statusAt("2026-10-18T13:59:59Z", "BNE")).toEqual({ status: "upcoming", live: false, liveMode: false }); // 23:59:59 on the 18th there
    expect(await statusAt("2026-10-19T14:00:00Z", "BNE")).toEqual({ status: "finished", live: false, liveMode: false }); // the 20th there
  });

  it("Chicago and Sydney at the same instant: each on its own date", async () => {
    // 15:00 UTC on Nov 7: 09:00 on the 7th in Chicago (CST), 02:00 on the 8th in Sydney (AEDT).
    await event("CHI7", "2026-11-07", "America/Chicago");
    await event("CHI6", "2026-11-06", "America/Chicago");
    await event("SYD8", "2026-11-08", "Australia/Sydney");
    await event("SYD7", "2026-11-07", "Australia/Sydney");
    const t = "2026-11-07T15:00:00Z";
    expect((await statusAt(t, "CHI7")).status).toBe("live");
    expect((await statusAt(t, "CHI6")).status).toBe("finished");
    expect((await statusAt(t, "SYD8")).status).toBe("live");
    expect((await statusAt(t, "SYD7")).status).toBe("finished");
  });

  it("follows the venue's midnight across a daylight-saving change", async () => {
    // New York falls back on Nov 1, 2026 (EDT → EST): the 1st ends at 05:00 UTC on the 2nd, not 04:00.
    await event("NYFALL", "2026-11-01", "America/New_York");
    expect((await statusAt("2026-11-02T04:30:00Z", "NYFALL")).status).toBe("live"); // 23:30 EST on the 1st
    expect((await statusAt("2026-11-02T05:00:00Z", "NYFALL")).status).toBe("finished");
    expect((await statusAt("2026-11-01T03:59:59Z", "NYFALL")).status).toBe("upcoming"); // 23:59:59 EDT on Oct 31
    expect((await statusAt("2026-11-01T04:00:00Z", "NYFALL")).status).toBe("live");
    // Sydney springs forward on Oct 4, 2026 (AEST → AEDT): the 4th starts at 14:00 UTC on the 3rd.
    await event("SYDSPRING", "2026-10-04", "Australia/Sydney");
    expect((await statusAt("2026-10-03T13:59:59Z", "SYDSPRING")).status).toBe("upcoming");
    expect((await statusAt("2026-10-03T14:00:00Z", "SYDSPRING")).status).toBe("live");
    expect((await statusAt("2026-10-04T12:59:59Z", "SYDSPRING")).status).toBe("live"); // 23:59:59 AEDT
    expect((await statusAt("2026-10-04T13:00:00Z", "SYDSPRING")).status).toBe("finished");
  });

  it("with no zone, or an invalid one, uses the live lane's anywhere-on-Earth window, so the two still agree", async () => {
    await event("NOZONE", "2026-10-18", null);
    await event("BADZONE", "2026-10-18", "Not/AZone");
    for (const code of ["NOZONE", "BADZONE"]) {
      // Still the 18th at UTC−12 until 12:00 UTC on the 19th; already the 18th at UTC+14 from 10:00 UTC on the 17th.
      expect(await statusAt("2026-10-19T11:59:59Z", code)).toEqual({ status: "live", live: true, liveMode: true });
      expect(await statusAt("2026-10-19T12:00:00Z", code)).toEqual({ status: "finished", live: false, liveMode: false });
      expect(await statusAt("2026-10-17T10:00:00Z", code)).toEqual({ status: "live", live: true, liveMode: true });
      expect(await statusAt("2026-10-17T09:59:59Z", code)).toEqual({ status: "upcoming", live: false, liveMode: false });
    }
  });

  it("a multi-day event is live on every one of its venue dates", async () => {
    await event("LA3", "2026-10-17", "America/Los_Angeles", { end: "2026-10-18" });
    expect((await statusAt("2026-10-18T03:00:00Z", "LA3")).status).toBe("live"); // evening of the 17th there
    expect((await statusAt("2026-10-19T03:00:00Z", "LA3")).status).toBe("live"); // evening of the 18th there
    expect((await statusAt("2026-10-19T08:00:00Z", "LA3")).status).toBe("finished");
  });

  it("is finished on the day once every scheduled match has a result, and the clock never makes it live", async () => {
    await event("DONE", "2026-10-18", "America/Los_Angeles", { played: 2 });
    // Still the event's day there (the live lane keeps checking for playoffs and awards), but nothing left to play.
    expect(await statusAt("2026-10-19T02:00:00Z", "DONE")).toEqual({ status: "finished", live: true, liveMode: false });
    await event("HALF", "2026-10-18", "America/Los_Angeles", { played: 1 });
    expect((await statusAt("2026-10-19T02:00:00Z", "HALF")).status).toBe("live");
    // No schedule at all on the day: live (the event is on), with nothing in it invented.
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'EMPTY', 'EMPTY', 'Qualifier', '2026-10-18', '2026-10-18', 'America/Los_Angeles', 0, 0, 'test')", [S]);
    const empty = (await eventDetail(S, "EMPTY"))!;
    expect(empty.event.status).toBe("live");
    expect(empty.matches).toEqual([]);
  });

  it("status and the live lane agree at every hour around a UTC midnight, east and west", async () => {
    await event("LA", "2026-10-18", "America/Los_Angeles");
    await event("BNE", "2026-10-19", "Australia/Brisbane");
    await event("NOZONE", "2026-10-18", null);
    for (let h = -30; h <= 30; h++) {
      const at = Date.parse("2026-10-19T00:00:00Z") + h * 3600_000;
      vi.setSystemTime(at);
      for (const code of ["LA", "BNE", "NOZONE"]) {
        const e = (await eventSummary(S, code))!;
        const tz = code === "LA" ? "America/Los_Angeles" : code === "BNE" ? "Australia/Brisbane" : null;
        expect(e.status === "live", `${code} at ${new Date(at).toISOString()}`).toBe(isEventDay({ type: "Qualifier", start: e.start, end: e.end, timezone: tz }, at));
      }
    }
  });

  it("a cached detail is rebuilt when the venue's date turns over, though UTC's hasn't", async () => {
    await event("BNE", "2026-10-19", "Australia/Brisbane");
    vi.setSystemTime(Date.parse("2026-10-18T13:50:00Z")); // 23:50 on the 18th in Brisbane
    const before = await cachedEventDetail(S, "BNE");
    expect(before!.event.status).toBe("upcoming");
    vi.setSystemTime(Date.parse("2026-10-18T14:01:00Z")); // 00:01 on the 19th there, same UTC day, same data version
    const after = await cachedEventDetail(S, "BNE");
    expect(after).not.toBe(before);
    expect(after!.event.status).toBe("live");
    expect(isLiveMode(after)).toBe(true);
  });
});

describe("the event page's API (PUB3-F01)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("serves what the LIVE panel needs (status live and live metadata) on the venue's day, east and west", async () => {
    await event("LA", "2026-10-18", "America/Los_Angeles");
    await event("BNE", "2026-10-19", "Australia/Brisbane");
    for (const [code, at] of [["LA", "2026-10-19T02:00:00Z"], ["BNE", "2026-10-18T16:00:00Z"]] as const) {
      vi.setSystemTime(Date.parse(at));
      const d = await (await fetch(`${base}/api/events/${S}/${code}`)).json();
      expect(d.event.status, code).toBe("live");
      expect(d.live, code).not.toBeNull();
      expect(isLiveMode(d), code).toBe(true);
      const list = await (await fetch(`${base}/api/events?season=${S}`)).json();
      expect(list.events.find((e: { code: string }) => e.code === code).status, code).toBe("live");
    }
  });
});
