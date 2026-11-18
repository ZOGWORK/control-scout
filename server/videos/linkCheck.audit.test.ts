// A video the link check took off (./linkCheck.ts), through the channel audit against a fake YouTube: set aside, it
// waits out its stream (still to come: set aside, nothing in the owner's review), is added to the meet its title
// names once it aired there, and one the rules send to review stays set aside rather than queued. The checked list's
// seed never writes a dropped video back, whatever is decided of it since.
import { beforeAll, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { seedOfficialChannels, pendingCount } from "./officialWatch";
import { runChannelAudit } from "./officialAudit";
import { dropWrongLinks } from "./linkCheck";
import { seedOfficialVideos } from "./officialVideos";

const TX = "UCKezDYNRPpAy2_1XRMBWKSw";
const NOW = Date.parse("2026-01-20T00:00:00Z");
// Listed for Meet #1 (Jan 10) while still to come, then reused by the channel for Meet #2 (Jan 24).
const REUSED = "reusedmeet2", DAYTWO = "meet2daytwo";
type Item = { id: string; title: string; published: string; start: string | null; live: string };
let uploads: Item[] = [];
const fakeFetch = (async (url: string) => {
  const u = new URL(url);
  const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
  if (u.pathname.endsWith("/playlistItems")) {
    if (u.searchParams.get("playlistId") !== `UU${TX.slice(2)}`) return json({ items: [] });
    return json({ items: uploads.map((i) => ({ snippet: { title: i.title }, contentDetails: { videoId: i.id, videoPublishedAt: i.published } })) });
  }
  const ids = (u.searchParams.get("id") ?? "").split(",");
  return json({ items: uploads.filter((i) => ids.includes(i.id)).map((i) => ({
    id: i.id, snippet: { title: i.title, liveBroadcastContent: i.live }, contentDetails: { duration: i.start ? "PT6H" : "P0D" },
    status: { privacyStatus: "public", embeddable: true }, ...(i.start ? { liveStreamingDetails: { actualStartTime: i.start } } : {}),
  })) });
}) as unknown as typeof fetch;
const audit = (now: number) => runChannelAudit(() => {}, { apiKey: "k", fetchImpl: fakeFetch, now: () => now, lockWaitMs: 1000 });
const watch = (id: string) => get<any>("SELECT status, season, code, decided_by FROM official_watch WHERE video_id = ?", [id]);
const LIST = { channels: { [TX]: "FIRST in Texas" }, videos: [REUSED, DAYTWO].map((videoId, i) => ({ season: 2025, code: "USTXLGM1", videoId, kind: "recording" as const, day: "2026-01-10", part: i ? "Afternoon" : "Morning", channelId: TX, title: "FTC Texas League Meet #1" })) };

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (2025, ?, ?, 'LeagueMeet', 'Austin', 'TX', 'USA', ?, ?, 'America/Chicago', 0, 0, NULL, 'test')";
  await run(ev, ["USTXLGM1", "TX League Meet #1", "2026-01-10", "2026-01-10"]);
  await run(ev, ["USTXLGM2", "TX League Meet #2", "2026-01-24", "2026-01-24"]);
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2025, 'USTXLGM1', 'qual', 0, 1, 'Q1', '2026-01-10T10:00:00', 1, 'test')");
  await seedOfficialChannels(NOW, true);
  await run("UPDATE official_channels SET removed_at = 'x' WHERE channel_id != ?", [TX]);
  await run("UPDATE official_channels SET watch_from = ? WHERE channel_id = ?", [new Date(NOW - 30 * 864e5).toISOString(), TX]);
  await run("INSERT INTO official_watch_runs (started_at, finished_at, units, channels, seen, added) VALUES ('2026-01-19T23:00:00Z', '2026-01-19T23:01:00Z', 1, 1, 0, 0)");
  // Both on Meet #1 from the list; the second also the watcher's own row, added.
  expect(await seedOfficialVideos(() => {}, LIST, NOW, true)).toBe(2);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES (?, ?, 'FTC Texas League Meet #1', 'added', 2025, 'USTXLGM1', '2026-01-10', 'x', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z', 'watcher')", [DAYTWO, TX]);
  uploads = [
    { id: REUSED, title: "FTC Texas League Meet #2", published: "2026-01-02T00:00:00Z", start: null, live: "upcoming" },
    { id: DAYTWO, title: "FTC Texas League Meet #2 Day 2", published: "2026-01-02T00:01:00Z", start: null, live: "upcoming" },
  ];
  // The audit reads the channel's titles today: both name Meet #2.
  expect((await audit(NOW))?.error).toBeNull();
});

describe("a video the link check took off, through the channel audit", () => {
  it("is set aside for the link check, the watcher's own row included", async () => {
    expect((await dropWrongLinks(() => {}, NOW)).map((w) => w.videoId).sort()).toEqual([DAYTWO, REUSED].sort());
    expect(await all("SELECT video_id FROM official_videos")).toEqual([]);
    for (const id of [REUSED, DAYTWO]) expect(await watch(id)).toMatchObject({ status: "ignored", season: null, decided_by: "link check" });
  });

  it("while its stream is still to come: stays set aside, nothing waits in the owner's review", async () => {
    expect((await audit(NOW + 3600_000))?.error).toBeNull();
    expect(await watch(REUSED)).toMatchObject({ status: "ignored", decided_by: "link check" });
    expect(await pendingCount()).toBe(0);
  });

  it("once it aired as the meet its title names: added there; one the rules would send to review stays set aside", async () => {
    uploads = [
      { id: REUSED, title: "FTC Texas League Meet #2", published: "2026-01-02T00:00:00Z", start: "2026-01-24T15:00:00Z", live: "none" },
      // Broadcast on Meet #2's only day, its title saying day 2: the rules send it to the owner's review.
      { id: DAYTWO, title: "FTC Texas League Meet #2 Day 2", published: "2026-01-02T00:01:00Z", start: "2026-01-24T15:05:00Z", live: "none" },
    ];
    expect((await audit(Date.parse("2026-01-26T00:00:00Z")))?.error).toBeNull();
    expect(await get<any>("SELECT season, code, day FROM official_videos WHERE video_id = ?", [REUSED])).toEqual({ season: 2025, code: "USTXLGM2", day: "2026-01-24" });
    expect(await watch(DAYTWO)).toMatchObject({ status: "ignored", decided_by: "link check" });
    expect(await get("SELECT verdict, why FROM official_audit_videos WHERE video_id = ?", [DAYTWO])).toEqual({ verdict: "review", why: "the title says day 2, the broadcast was the event's day 1" });
    expect(await pendingCount()).toBe(0);
  });

  it("is never written back by the checked list's seed, whatever is decided of it since", async () => {
    await run("UPDATE official_watch SET status = 'rejected', decided_by = 'owner' WHERE video_id = ?", [DAYTWO]);
    expect(await seedOfficialVideos(() => {}, LIST, NOW, true)).toBe(0);
    expect(await get("SELECT 1 FROM official_videos WHERE video_id = ?", [DAYTWO])).toBeFalsy();
    // The one on Meet #2 stays there.
    expect(await get<any>("SELECT code FROM official_videos WHERE video_id = ?", [REUSED])).toEqual({ code: "USTXLGM2" });
  });
});
