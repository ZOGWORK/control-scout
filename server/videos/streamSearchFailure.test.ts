// The stream search (server/videos/streamSearch.ts) when writing for the owner fails partway: what it already added
// is kept as read (stream_search_videos) at once, so a retry, which skips it as known, still counts it.
import { beforeAll, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../db";
import { record } from "./officialWatch";
import { searchStreams, type SearchHit } from "./streamSearch";

const NOW = Date.parse("2026-11-28T06:00:00Z");
const QLD = "UCgVwYg-vSXKisZCIfKk6xxA";
const videos = [
  { id: "M7ERWeqH5-U", title: "FTC Brisbane North Qualifier 2026 - Day 1", start: "2026-11-14T03:45:11Z", minutes: 102 },
  { id: "W6Sxrq6g5dI", title: "FTC Brisbane North Qualifier 2026 - Day 2", start: "2026-11-14T22:54:40Z", minutes: 429 },
];
const search = async (): Promise<SearchHit[]> => videos.map((v) => ({ videoId: v.id, title: v.title, channelId: null, channel: null }));
const fakeFetch = (async (url: string) => {
  const ids = (new URL(url).searchParams.get("id") ?? "").split(",");
  return { ok: true, status: 200, json: async () => ({ items: videos.filter((v) => ids.includes(v.id)).map((v) => ({
    id: v.id, snippet: { title: v.title, channelId: QLD, channelTitle: "Robotics Events - Queensland", liveBroadcastContent: "none", publishedAt: v.start },
    contentDetails: { duration: `PT${v.minutes}M` }, status: { privacyStatus: "public", embeddable: true }, liveStreamingDetails: { actualStartTime: v.start },
  })) }) } as Response;
}) as unknown as typeof fetch;

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  await run("INSERT INTO events (season, code, name, type, city, state, country, region, start, end, timezone, remote, hybrid, source) VALUES (2026, 'AUBRQ2', 'Brisbane North Qualifier', 'Qualifier', 'Brisbane', 'QLD', 'Australia', 'AU', '2026-11-14', '2026-11-15', 'Australia/Brisbane', 0, 0, 'test')");
  const m = "INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2026, 'AUBRQ2', 'qual', 0, ?, ?, ?, 1, 'test')";
  for (const day of ["2026-11-14", "2026-11-15"]) for (let i = 1; i <= 2; i++) await run(m, [Number(day.slice(8)) * 10 + i, `Q${day.slice(8)}${i}`, `${day}T14:0${i}:00`]);
});

it("keeps a video it added as read when a later write for the owner fails", async () => {
  let calls = 0;
  const failing: typeof record = async (...a) => { if (++calls > 1) throw new Error("data lock busy"); return record(...a); };
  await searchStreams(() => {}, { apiKey: "k", fetchImpl: fakeFetch, search, now: () => NOW, gapMs: 0, recordImpl: failing }).catch(() => null);
  expect(calls).toBe(2);
  expect(await get("SELECT status FROM official_watch WHERE video_id = 'M7ERWeqH5-U'")).toEqual({ status: "added" });
  expect(await get("SELECT verdict, event_code FROM stream_search_videos WHERE video_id = 'M7ERWeqH5-U'")).toEqual({ verdict: "add", event_code: "AUBRQ2" });
  // The one whose write failed is written nowhere, so the next search weighs it again.
  expect(await get("SELECT 1 AS x FROM stream_search_videos WHERE video_id = 'W6Sxrq6g5dI'")).toBeUndefined();
});
