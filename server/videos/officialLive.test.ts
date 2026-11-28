// The live pass (server/videos/officialWatch.ts, watchLive): a watched channel's broadcast on the air now at an event on
// today joins that event at once, by the watcher's own rules; one that ends short of a day's recording comes off
// again. And the region rules reading FIRST's region code and the event code (officialMatch.ts parseRule).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { matchVideo, parseRule, type WatchEvent } from "./officialMatch";
import { seedOfficialChannels, watchLive } from "./officialWatch";

const AU = "UCal7624DPridi_9iKLrAbqw";
// 2026-11-28 12:00 in Sydney: AUMPQ1's Saturday.
const NOW = Date.parse("2026-11-28T01:00:00Z");
const LIVE = "VtYecVi59fs", OTHER = "otherotherO", AWARDS = "awardsawarA", SHORT = "shortshortS";

type Item = { id: string; title: string; state: "live" | "none" | "upcoming"; start?: string; minutes?: number; channel?: string };
let items: Item[] = [];
let calls: string[] = [];
const fakeFetch = (async (url: string) => {
  const u = new URL(url);
  calls.push(`${u.pathname.split("/").pop()} ${u.searchParams.get("playlistId") ?? ""}`.trim());
  const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
  if (u.pathname.endsWith("/playlistItems")) {
    const ch = `UC${u.searchParams.get("playlistId")!.slice(2)}`;
    return json({ items: items.filter((i) => (i.channel ?? AU) === ch).map((i) => ({ contentDetails: { videoId: i.id, videoPublishedAt: "2026-11-27T21:10:39Z" } })) });
  }
  const ids = (u.searchParams.get("id") ?? "").split(",");
  return json({ items: items.filter((i) => ids.includes(i.id)).map((i) => ({
    id: i.id, snippet: { title: i.title, liveBroadcastContent: i.state },
    contentDetails: { duration: i.state === "live" || i.minutes === 0 ? "P0D" : `PT${i.minutes ?? 420}M` }, status: { privacyStatus: "public", embeddable: true },
    liveStreamingDetails: { actualStartTime: i.start ?? "2026-11-27T23:52:04Z" },
  })) });
}) as unknown as typeof fetch;

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, region, start, end, timezone, remote, hybrid, source) VALUES (2026, ?, ?, 'Qualifier', ?, ?, 'Australia', 'AU', ?, ?, ?, 0, 0, 'test')";
  await run(ev, ["AUMPQ1", "Sydney North Macquarie Park Qualifier (Saturday)", "Macquarie Park", "NSW", "2026-11-28", "2026-11-28", "Australia/Sydney"]);
  await run(ev, ["AUMPQ2", "Sydney North Macquarie Park Qualifier (Sunday)", "Macquarie Park", "NSW", "2026-11-29", "2026-11-29", "Australia/Sydney"]);
  await seedOfficialChannels(NOW, true);
});
beforeEach(() => { calls = []; });
const opts = (now = NOW) => ({ apiKey: "k", fetchImpl: fakeFetch, now: () => now, lockWaitMs: 2000 });

describe("the live pass", () => {
  it("puts a broadcast on the air now on its event, as that day's recording", async () => {
    items = [
      { id: LIVE, title: "FIRST Tech Challenge Sydney North Macquarie Park Qualifier (Saturday)", state: "live" },
      // A part of the day (its awards) waits for its length; so does anything not live.
      { id: AWARDS, title: "Sydney North Macquarie Park Qualifier (Saturday) Awards Ceremony", state: "live" },
      { id: OTHER, title: "FIRST Tech Challenge Sydney North Macquarie Park Qualifier (Saturday)", state: "upcoming" },
    ];
    const out = await watchLive(() => {}, opts());
    expect(out).toMatchObject({ added: 1, live: 2 });
    expect(await get("SELECT season, code, day, part, source FROM official_videos WHERE video_id = ?", [LIVE])).toMatchObject({ season: 2026, code: "AUMPQ1", day: "2026-11-28", part: null, source: "watcher" });
    expect(await get("SELECT status, decided_by, duration FROM official_watch WHERE video_id = ?", [LIVE])).toMatchObject({ status: "added", decided_by: "live watcher", duration: null });
    // Nothing else written: the 6-hourly run reads those once they're over.
    expect(await all("SELECT video_id FROM official_watch WHERE video_id IN (?, ?)", [AWARDS, OTHER])).toEqual([]);
    // Only the channel whose region has an event on today was read.
    expect(calls.filter((c) => c.startsWith("playlistItems"))).toEqual([`playlistItems UU${AU.slice(2)}`]);
  });

  it("reads no channel once today's events have their video", async () => {
    // Still on the air: its own end is checked (1 unit), and no channel is read.
    items = [{ id: LIVE, title: "x", state: "live" }];
    const out = await watchLive(() => {}, opts());
    expect(out).toMatchObject({ channels: 0, added: 0 });
    expect(calls.some((c) => c.startsWith("playlistItems"))).toBe(false);
  });

  it("keeps an add that ran a day's recording, and takes off one that ended short", async () => {
    // Just over, still processing (no length yet): left for the next check, never taken off as 0 minutes.
    items = [{ id: LIVE, title: "x", state: "none", minutes: 0 }];
    expect(await watchLive(() => {}, opts(NOW + 7 * 3600_000))).toMatchObject({ settled: 0, dropped: 0 });
    expect(await get("SELECT removed_at FROM official_videos WHERE video_id = ?", [LIVE])).toEqual({ removed_at: null });
    // Its facts call fails: logged, and left for the next check.
    const failing = (async (url: string) => (String(url).includes("/videos?") && !String(url).includes("liveStreamingDetails")
      ? ({ ok: false, status: 503, json: async () => ({}) }) as Response : fakeFetch(url))) as unknown as typeof fetch;
    const logs: string[] = [];
    expect(await watchLive((m) => logs.push(m), { ...opts(NOW + 7 * 3600_000), fetchImpl: failing })).toMatchObject({ settled: 0, dropped: 0 });
    expect(logs.join(" ")).toMatch(/checking ended adds: YouTube videos answered 503/);
    // Over, 7 hours: kept, its length written.
    items = [{ id: LIVE, title: "x", state: "none", minutes: 420 }];
    expect(await watchLive(() => {}, opts(NOW + 8 * 3600_000))).toMatchObject({ settled: 1, dropped: 0 });
    expect(await get("SELECT duration FROM official_watch WHERE video_id = ?", [LIVE])).toEqual({ duration: 420 * 60 });

    // The next day's stream stops after 4 minutes (started again under a new id): off its event, so the new one can take it.
    const sunday = Date.parse("2026-11-28T23:00:00Z");
    items = [{ id: SHORT, title: "FIRST Tech Challenge Sydney North Macquarie Park Qualifier (Sunday)", state: "live", start: "2026-11-28T22:50:00Z" }];
    expect(await watchLive(() => {}, opts(sunday))).toMatchObject({ added: 1 });
    items = [{ id: SHORT, title: "x", state: "none", minutes: 4 }];
    expect(await watchLive(() => {}, opts(sunday + 600_000))).toMatchObject({ dropped: 1 });
    expect(await get("SELECT removed_at IS NOT NULL AS off FROM official_videos WHERE video_id = ?", [SHORT])).toEqual({ off: 1 });
    expect(await get("SELECT status, why FROM official_watch WHERE video_id = ?", [SHORT])).toMatchObject({ status: "ignored", why: /4 minutes once its broadcast ended/ });
  });
});

describe("the region rules", () => {
  const e = (extra: Partial<WatchEvent>): WatchEvent => ({ season: 2022, code: "USIATBSQ", name: "IA Western Iowa Super Qualifier", type: "SuperQualifier", city: "Omaha", state: "NE", country: "USA",
    start: "2023-02-04", end: "2023-02-04", timezone: "America/Chicago", divisionCode: null, parent: false, ...extra });

  it("holds an event a state's FIRST region runs across the state line", () => {
    expect(parseRule("state=IA")!(e({ firstRegion: "USIA" }))).toBe(true);
    expect(parseRule("state=IA")!(e({ firstRegion: null }))).toBe(false);
    expect(parseRule("state=NE")!(e({ firstRegion: "USIA" }))).toBe(true);
    // A region over parts of a state (USNYNY, USCALA) is its state's; a multi-state one (USCHS) names no one state.
    expect(parseRule("state=NY")!(e({ state: "NJ", firstRegion: "USNYNY" }))).toBe(true);
    expect(parseRule("state=CH")!(e({ firstRegion: "USCHS" }))).toBe(false);
    // The Western Iowa Super Qualifier streamed by FTC Iowa: added.
    const v = matchVideo({ videoId: "tCUXOCebQaM", title: "Western Iowa Super Qualifier", start: "2023-02-04T14:00:00Z", durationS: 390 * 60, privacy: "public", embeddable: true, blockedIn: 0 },
      { region: "state=IA", words: "iowa" }, [e({ firstRegion: "USIA" })]);
    expect(v).toMatchObject({ kind: "add", event: { code: "USIATBSQ" } });
  });

  it("reads a name rule against the event's code too", () => {
    // NYC FIRST's 2019 events: "The Dalton School Super-Qualifier # 1" is NYCSQ1.
    const dalton = e({ season: 2019, code: "NYCSQ1", name: "The Dalton School Super-Qualifier # 1", state: "NY", firstRegion: null });
    expect(parseRule("state=NY;name=NYC")!(dalton)).toBe(true);
    expect(parseRule("state=NY;name=NYC")!({ ...dalton, code: "USNYEXQ1" })).toBe(false);
  });

  it("weighs a live broadcast without a length", () => {
    const sat: WatchEvent = { season: 2026, code: "AUMPQ1", name: "Sydney North Macquarie Park Qualifier (Saturday)", type: "Qualifier", city: "Macquarie Park", state: "NSW", country: "Australia",
      start: "2026-11-28", end: "2026-11-28", timezone: "Australia/Sydney", divisionCode: null, parent: false };
    const v = { videoId: LIVE, title: "FIRST Tech Challenge Sydney North Macquarie Park Qualifier (Saturday)", start: "2026-11-27T23:52:04Z", durationS: null, privacy: "public", embeddable: true, blockedIn: 0 };
    const rule = { region: "country=Australia", words: "australia australian" };
    expect(matchVideo(v, rule, [sat])).toMatchObject({ kind: "review", why: /no length/ });
    expect(matchVideo({ ...v, live: true }, rule, [sat])).toMatchObject({ kind: "add", event: { code: "AUMPQ1" }, day: "2026-11-28" });
  });
});
