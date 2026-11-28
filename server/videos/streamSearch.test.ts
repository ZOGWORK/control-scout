// The stream search (server/videos/streamSearch.ts): events with a played day no video covers are searched on YouTube
// by name; a result the watcher's rules fit to that day alone, a finished broadcast whose title names the whole event,
// is added; anything short of that for that day goes to the owner's review; channels found twice are proposed.
import { beforeAll, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { namesAll } from "./officialMatch";
import { channelProposals, dismissProposal, dueTargets, regionOf, resultsOf, searchQuery, searchStreams, type SearchHit } from "./streamSearch";

const NOW = Date.parse("2026-11-28T06:00:00Z");
const QLD = "UCgVwYg-vSXKisZCIfKk6xxA", ROOS = "UCxiwXTpSyP-fomk4poTpuqg";
type V = { id: string; title: string; ch: string; start?: string | null; minutes: number; state?: string };
const videos: V[] = [
  { id: "M7ERWeqH5-U", title: "FTC Brisbane North Qualifier 2026 - Day 1", ch: QLD, start: "2026-11-14T03:45:11Z", minutes: 102 },
  { id: "W6Sxrq6g5dI", title: "FTC Brisbane North Qualifier 2026 - Day 2", ch: QLD, start: "2026-11-14T22:54:40Z", minutes: 429 },
  // A highlight, an upload, and one that names only part of the event: never added.
  { id: "shortclipxx", title: "Brisbane North Qualifier 2026 Playoff Match 3", ch: QLD, start: null, minutes: 4 },
  { id: "uploadedxxx", title: "FTC South Bank Qualifier 2026 full day", ch: QLD, start: null, minutes: 300 },
  { id: "botbuilders", title: "FTC Bank Qualifier | BIOBUZZ", ch: "UC6yhvAb53l4bRRyffJnCCRQ", start: "2026-11-21T01:10:23Z", minutes: 154 },
  { id: "Wcge4h-PBww", title: "2026 FIRST Tech Challenge - BioBuzz - South Australia Qualifier", ch: ROOS, start: "2026-11-14T22:23:03Z", minutes: 436 },
  { id: "onairnowxxx", title: "FTC South Australia Qualifier 2026 Day 2 replay", ch: ROOS, start: "2026-11-28T05:00:00Z", minutes: 0, state: "live" },
];
const results: Record<string, string[]> = {
  "Brisbane North Qualifier FTC 2026": ["M7ERWeqH5-U", "W6Sxrq6g5dI", "shortclipxx", "Wcge4h-PBww"],
  "South Australia Qualifier FTC 2026": ["Wcge4h-PBww", "onairnowxxx", "W6Sxrq6g5dI"],
  "South Bank Qualifier FTC 2026": ["uploadedxxx", "botbuilders"],
};
const searched: string[] = [];
const search = async (q: string) => { searched.push(q); return (results[q] ?? []).map((id): SearchHit => ({ videoId: id, title: videos.find((v) => v.id === id)!.title, channelId: null, channel: null })); };
const fakeFetch = (async (url: string) => {
  const u = new URL(url);
  expect(u.pathname).toBe("/youtube/v3/videos");
  const ids = (u.searchParams.get("id") ?? "").split(",");
  return { ok: true, status: 200, json: async () => ({ items: videos.filter((v) => ids.includes(v.id)).map((v) => ({
    id: v.id, snippet: { title: v.title, channelId: v.ch, channelTitle: v.ch === QLD ? "Robotics Events - Queensland" : "Some channel", liveBroadcastContent: v.state ?? "none", publishedAt: v.start ?? "2026-11-22T00:00:00Z" },
    contentDetails: { duration: v.state === "live" ? "P0D" : `PT${v.minutes}M` }, status: { privacyStatus: "public", embeddable: true },
    ...(v.start ? { liveStreamingDetails: { actualStartTime: v.start } } : {}),
  })) }) } as Response;
}) as unknown as typeof fetch;

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, region, start, end, timezone, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 'Australia', 'AU', ?, ?, ?, 0, 0, 'test')";
  await run(ev, [2026, "AUBRQ2", "Brisbane North Qualifier", "Brisbane", "QLD", "2026-11-14", "2026-11-15", "Australia/Brisbane"]);
  await run(ev, [2026, "AUWAQ", "South Australia Qualifier", "Wayville", "SA", "2026-11-14", "2026-11-15", "Australia/Adelaide"]);
  await run(ev, [2026, "AUBRQ3", "South Bank Qualifier", "Brisbane", "QLD", "2026-11-21", "2026-11-21", "Australia/Brisbane"]);
  // Covered already: FIRST's own link plays its day.
  await run(ev, [2026, "AUPEQ", "Western Australia Qualifier", "Perth", "WA", "2026-11-15", "2026-11-15", "Australia/Perth"]);
  await run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at) VALUES ('rQ4boQ2z7zk', 2026, 'AUPEQ', 'recording', '2026-11-15', NULL, 'UCal7624DPridi_9iKLrAbqw', 'x', 'list', 'x', 'x')");
  // Not played yet: never searched.
  await run(ev, [2026, "AUCMP", "Australia Championship", "Sydney", "NSW", "2026-12-05", "2026-12-06", "Australia/Sydney"]);
  const m = "INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2026, ?, 'qual', 0, ?, ?, ?, 1, 'test')";
  for (const [code, day] of [["AUBRQ2", "2026-11-14"], ["AUBRQ2", "2026-11-15"], ["AUWAQ", "2026-11-15"], ["AUBRQ3", "2026-11-21"], ["AUPEQ", "2026-11-15"]] as const)
    for (let i = 1; i <= 2; i++) await run(m, [code, Number(day.slice(8)) * 10 + i, `Q${day.slice(8)}${i}`, `${day}T14:0${i}:00`]);
});

describe("the stream search", () => {
  it("reads a results page's videos and their channels", () => {
    const page = `<script>var ytInitialData = ${JSON.stringify({ contents: { a: [{ videoRenderer: { videoId: "W6Sxrq6g5dI", title: { runs: [{ text: "FTC Brisbane North Qualifier 2026 - Day 2" }] },
      ownerText: { runs: [{ text: "Robotics Events - Queensland", navigationEndpoint: { browseEndpoint: { browseId: QLD } } }] } } }, { shelfRenderer: { videoRenderer: { videoId: "bad" } } }] } })};</script>`;
    expect(resultsOf(page)).toEqual([{ videoId: "W6Sxrq6g5dI", title: "FTC Brisbane North Qualifier 2026 - Day 2", channelId: QLD, channel: "Robotics Events - Queensland" }]);
    expect(resultsOf("<html>consent</html>")).toBeNull();
    expect(searchQuery({ name: "IA  Western Iowa Super Qualifier", start: "2023-02-04" })).toBe("IA Western Iowa Super Qualifier FTC 2023");
    expect(regionOf({ state: "IA", country: "USA" })).toBe("state=IA");
    expect(regionOf({ state: "QLD", country: "Australia" })).toBe("country=Australia");
    // A title must name the event by its own words, not its kind: "November Scrimmage" has none to name.
    expect(namesAll("Lakeshore Scrimmage, Day 1", "November Scrimmage")).toBe(false);
    expect(namesAll("Lakeshore Scrimmage, Day 1", "Lakeshore Scrimmage Day 1")).toBe(true);
    expect(namesAll("2026 FIRST Tech Challenge - BioBuzz - South Australia Qualifier", "South Australia Qualifier")).toBe(true);
    // A name that says only where it is: the title must be of its kind and carry its number.
    const idaho = ["Boise", "id", "idaho", "usa"], chicago = ["Chicago", "il", "illinois", "usa"];
    expect(namesAll("2022 Storm Idaho Open Qualifying", "Idaho State Championship", null, idaho)).toBe(false);
    expect(namesAll("Idaho FTC State Championship 2022", "Idaho State Championship", null, idaho)).toBe(true);
    expect(namesAll("FTC Chicago Qualifier", "IL Chicago Meet 1A", null, chicago)).toBe(false);
    expect(namesAll("FTC Chicago Meet 2C", "IL Chicago Meet 1A", null, chicago)).toBe(false);
    expect(namesAll("FTC Chicago League Meet 1A", "IL Chicago Meet 1A", null, chicago)).toBe(true);
    // A national championship's own stream often names only the country: no other kind, so it's said.
    expect(namesAll("FIRST TECH CHALLENGE VIETNAM 2025-2026 (Day 1)", "Vietnam Championship", null, ["Hanoi", "vietnam"])).toBe(true);
    // A name of no kind can't be contradicted by one: Brăila's meet, Santa Clara's "QT #2" (its number still asked).
    expect(namesAll("BRAILA TECH CHALLENGE - FTC Meet 2024", "Brăila Tech Challenge", null, ["Brăila", "romania"])).toBe(true);
    expect(namesAll("FTC Qualifying Tournament #2 | Santa Clara HS", "Santa Clara QT #2", null, ["Santa Clara", "ca", "california"])).toBe(true);
    expect(namesAll("FTC Qualifying Tournament #3 | Santa Clara HS", "Santa Clara QT #2", null, ["Santa Clara", "ca", "california"])).toBe(false);
    expect(namesAll("FIRST Tech Challenge Vietnam Championship 2023-2024", "Vietnam FIRST Tech Challenge 2023-24", null, ["Hanoi", "vietnam"])).toBe(true);
    // A name with words of its own isn't held to its kind: a league's tournament streamed as its championship.
    expect(namesAll("FTC Space Coast League Championship", "FL Space Coast League Tournament", null, ["Melbourne", "fl", "florida"])).toBe(true);
  });

  it("picks the events with a played day no video covers, never one not played", async () => {
    const t = await dueTargets(NOW, 10);
    expect(t.map((x) => [x.code, x.missing])).toEqual([["AUBRQ3", ["2026-11-21"]], ["AUBRQ2", ["2026-11-14", "2026-11-15"]], ["AUPEQ", []], ["AUWAQ", ["2026-11-15"]]]);
  });

  it("adds a finished broadcast the rules fit alone, and queues what they can't settle", async () => {
    const out = await searchStreams(() => {}, { apiKey: "k", fetchImpl: fakeFetch, search, now: () => NOW, gapMs: 0 });
    expect(out).toMatchObject({ searched: 3, covered: 1, added: 3, queued: 2, blocked: false });
    const rec = await all<any>("SELECT video_id, code, day, source FROM official_videos WHERE source = 'watcher' ORDER BY video_id");
    expect(rec).toEqual([
      { video_id: "M7ERWeqH5-U", code: "AUBRQ2", day: "2026-11-14", source: "watcher" },
      { video_id: "W6Sxrq6g5dI", code: "AUBRQ2", day: "2026-11-15", source: "watcher" },
      { video_id: "Wcge4h-PBww", code: "AUWAQ", day: "2026-11-15", source: "watcher" },
    ]);
    expect(await get("SELECT status, decided_by, channel_id FROM official_watch WHERE video_id = 'W6Sxrq6g5dI'")).toEqual({ status: "added", decided_by: "stream search", channel_id: QLD });
    // South Bank: a title saying only "Bank", and an upload (no broadcast date), both the owner's.
    expect(await get("SELECT status, code, why FROM official_watch WHERE video_id = 'botbuilders'")).toMatchObject({ status: "pending", code: "AUBRQ3", why: /found by the stream search .*doesn't say all of AUBRQ3's name/ });
    expect(await get("SELECT status, code, why FROM official_watch WHERE video_id = 'uploadedxxx'")).toMatchObject({ status: "pending", code: "AUBRQ3", why: /an upload, not a live broadcast/ });
    // On the air: weighed again next time. The clip: kept as read, nothing written for the owner.
    expect(await get("SELECT 1 AS x FROM stream_search_videos WHERE video_id = 'onairnowxxx'")).toBeUndefined();
    expect(await get("SELECT verdict FROM stream_search_videos WHERE video_id = 'shortclipxx'")).toEqual({ verdict: "ignore" });
    expect(await get("SELECT 1 AS x FROM official_watch WHERE video_id = 'shortclipxx'")).toBeUndefined();
    expect(await get("SELECT note, results FROM stream_searches WHERE code = 'AUPEQ'")).toEqual({ note: "covered", results: 0 });
  });

  it("doesn't search an event again before it's due", async () => {
    searched.length = 0;
    const out = await searchStreams(() => {}, { apiKey: "k", fetchImpl: fakeFetch, search, now: () => NOW + 3600_000, gapMs: 0 });
    expect(out?.searched).toBe(0);
    expect(searched).toEqual([]);
  });

  it("proposes a channel found streaming two events, until the owner says no", async () => {
    // Queensland's channel: AUBRQ2 (added) and AUBRQ3 (in review). The others streamed one event each.
    expect(await channelProposals()).toEqual([{ channelId: QLD, channel: "Robotics Events - Queensland", region: "country=Australia",
      events: [{ season: 2026, code: "AUBRQ3", videoId: "uploadedxxx" }, { season: 2026, code: "AUBRQ2", videoId: "M7ERWeqH5-U" }] }]);
    expect((await dismissProposal(QLD, "owner@example.test", NOW)).ok).toBe(true);
    expect(await channelProposals()).toEqual([]);
  });

  it("stops for an hour when YouTube turns the page away", async () => {
    const out = await searchStreams(() => {}, { apiKey: "k", fetchImpl: fakeFetch, search: async () => "blocked", now: () => NOW + 3 * 864e5, gapMs: 0 });
    expect(out).toMatchObject({ blocked: true, searched: 0 });
    expect(await searchStreams(() => {}, { apiKey: "k", fetchImpl: fakeFetch, search, now: () => NOW + 3 * 864e5 + 1800_000, gapMs: 0 })).toBeNull();
  });
});
