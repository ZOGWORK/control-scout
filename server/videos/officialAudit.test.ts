// The channel audit end to end, against a fake YouTube (docs/official-videos.md, "The channel audit"): it reads each
// watched channel's whole uploads list (never a search), records where Scout has each video, sets aside what isn't a
// competition with the reason, finds a watcher miss and sends it to review once a later watcher run still misses it
// (never adds it), keeps older possible recordings as
// findings with a best guess, re-checks the watcher's own adds, reads only new pages between weekly full reads, and
// marks what left the channel.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { seedOfficialChannels, decide } from "./officialWatch";
import { FULL_EVERY_MS, dismissFinding, measureAdds, ownerAudit, queueFinding, runChannelAudit } from "./officialAudit";

const TX = "UCKezDYNRPpAy2_1XRMBWKSw";
const NOW = Date.parse("2026-01-20T00:00:00Z");
type Item = { id: string; title: string; published: string; start?: string | null; minutes?: number; privacy?: string };
const FIRSTS = "firstlinkxx", LISTED = "listedlisto", WEB = "webinarwebi", OLDUP = "oldupload01", MISS = "missmissmis", GOOD = "goodaddgood", BAD = "badaddbadad", LATE = "latelatelat", DRONE = "dronedronex";
let uploads: Item[] = [];
let calls: string[] = [];
let pageSize = 50;
const fakeFetch = (async (url: string) => {
  const u = new URL(url);
  calls.push(u.pathname.split("/").pop()!);
  expect(u.pathname).not.toMatch(/search/);
  const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
  if (u.pathname.endsWith("/playlistItems")) {
    expect(u.searchParams.get("part")).toBe("snippet,contentDetails");
    if (u.searchParams.get("playlistId") !== `UU${TX.slice(2)}`) return json({ items: [] });
    const page = Number(u.searchParams.get("pageToken") || 0);
    const items = uploads.slice(page * pageSize, (page + 1) * pageSize);
    return json({ items: items.map((i) => ({ snippet: { title: i.title }, contentDetails: { videoId: i.id, videoPublishedAt: i.published } })), ...(uploads.length > (page + 1) * pageSize ? { nextPageToken: String(page + 1) } : {}) });
  }
  const ids = (u.searchParams.get("id") ?? "").split(",");
  return json({ items: uploads.filter((i) => ids.includes(i.id)).map((i) => ({
    id: i.id, snippet: { title: i.title, liveBroadcastContent: "none" },
    contentDetails: { duration: `PT${i.minutes ?? 360}M` }, status: { privacyStatus: i.privacy ?? "public", embeddable: true },
    ...(i.start === null ? {} : { liveStreamingDetails: { actualStartTime: i.start ?? i.published } }),
  })) });
}) as unknown as typeof fetch;
const audit = (now = NOW, maxUnits?: number) => runChannelAudit(() => {}, { apiKey: "k", fetchImpl: fakeFetch, now: () => now, lockWaitMs: 1000, maxUnits });
const row = (id: string) => get<any>("SELECT * FROM official_audit_videos WHERE video_id = ?", [id]);

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'Qualifier', ?, 'TX', 'USA', ?, ?, 'America/Chicago', 0, 0, ?, 'test')";
  await run(ev, [2025, "USTXMOQ", "TX Mockingbird Qualifier", "Austin", "2026-01-17", "2026-01-18", null]);
  await run(ev, [2025, "USTXHOQ", "TX Houston Qualifier", "Houston", "2026-01-10", "2026-01-10", null]);
  await run(ev, [2025, "USTXPEQ", "TX Pecan Qualifier", "Waco", "2026-01-17", "2026-01-17", `https://youtu.be/${FIRSTS}`]);
  await run(ev, [2024, "USTXMOQ", "TX Mockingbird Qualifier", "Austin", "2025-01-11", "2025-01-11", null]);
  await run(ev, [2024, "USTXBLQ", "TX Bluebonnet Qualifier", "Dallas", "2025-01-12", "2025-01-12", null]);
  await seedOfficialChannels(NOW, true);
  // Only the Texas channel answers: the others are taken off the list here.
  await run("UPDATE official_channels SET removed_at = 'x', watch_from = ? WHERE channel_id != ?", [new Date(NOW - 30 * 864e5).toISOString(), TX]);
  await run("UPDATE official_channels SET watch_from = ? WHERE channel_id = ?", [new Date(NOW - 30 * 864e5).toISOString(), TX]);
  const ov = "INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES (?, 2025, ?, 'recording', ?, NULL, ?, ?, ?, 'x', ?, NULL)";
  await run(ov, [LISTED, "USTXPEQ", "2026-01-18", TX, "Pecan Sunday", "list", "2026-01-01T00:00:00Z"]);
  await run(ov, [GOOD, "USTXMOQ", "2026-01-17", TX, "FTC Texas Mockingbird Qualifier", "watcher", "2026-01-18T06:00:00Z"]);
  await run(ov, [BAD, "USTXHOQ", "2026-01-11", TX, "FTC Texas Houston Qualifier", "watcher", "2026-01-18T06:00:00Z"]);
  await run(ov, [DRONE, "USTXMOQ", "2026-01-18", TX, "FTC Texas Mockingbird Qualifier drone race", "watcher", "2026-01-18T06:00:00Z"]);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES (?, ?, ?, 'added', 2025, ?, ?, 'x', ?, ?, 'watcher')", [GOOD, TX, "FTC Texas Mockingbird Qualifier", "USTXMOQ", "2026-01-17", "2026-01-18T06:00:00Z", "2026-01-18T06:00:00Z"]);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES (?, ?, ?, 'added', 2025, ?, ?, 'x', ?, ?, 'watcher')", [BAD, TX, "FTC Texas Houston Qualifier", "USTXHOQ", "2026-01-11", "2026-01-18T06:00:00Z", "2026-01-18T06:00:00Z"]);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES (?, ?, ?, 'added', 2025, ?, ?, 'x', ?, ?, 'watcher')", [DRONE, TX, "FTC Texas Mockingbird Qualifier drone race", "USTXMOQ", "2026-01-18", "2026-01-18T06:00:00Z", "2026-01-18T06:00:00Z"]);
  await run("INSERT INTO official_watch_runs (started_at, finished_at, units, channels, seen, added) VALUES ('2026-01-18T05:59:00Z', '2026-01-18T06:01:00Z', 3, 1, 2, 2)");
  uploads = [
    { id: FIRSTS, title: "FTC Texas Pecan Qualifier", published: "2026-01-17T22:00:00Z", start: "2026-01-17T14:00:00Z" },
    { id: LISTED, title: "FTC Texas Pecan Qualifier Sunday", published: "2026-01-18T22:00:00Z", start: "2026-01-18T14:00:00Z" },
    { id: WEB, title: "FTC Texas coaches webinar", published: "2026-01-05T22:00:00Z", start: null, minutes: 60 },
    { id: OLDUP, title: "FTC Texas Mockingbird Qualifier 2025", published: "2025-01-14T22:00:00Z", start: null },
    { id: MISS, title: "FTC Texas Houston Qualifier", published: "2026-01-10T23:00:00Z", start: "2026-01-10T15:00:00Z" },
    { id: GOOD, title: "FTC Texas Mockingbird Qualifier", published: "2026-01-17T23:00:00Z", start: "2026-01-17T15:00:00Z" },
    { id: BAD, title: "FTC Texas Houston Qualifier", published: "2026-01-11T23:00:00Z", start: "2026-01-11T15:00:00Z" },
    // Live when the watcher last ran (it started 2026-01-18 05:59Z): its next run reads it.
    { id: LATE, title: "FTC Texas Mockingbird Qualifier Day 2", published: "2026-01-18T14:00:00Z", start: "2026-01-18T14:00:00Z" },
    { id: DRONE, title: "FTC Texas Mockingbird Qualifier drone race", published: "2026-01-18T03:00:00Z", start: "2026-01-18T02:00:00Z", minutes: 60 },
  ];
});
beforeEach(() => { calls = []; pageSize = 50; });

describe("the channel audit", () => {
  it("reads the whole uploads list and records where Scout has each video", async () => {
    const out = await audit();
    expect(out).toMatchObject({ channels: 1, fullChannels: 1, uploads: 9, setAside: 1, missed: 1, queued: 0, findings: 2, addsChecked: 3, addsWrong: 2, error: null });
    // One uploads page, one facts read (what may be a competition and isn't recorded, and the watcher's adds); no search.
    expect(calls).toEqual(["playlistItems", "videos"]);
    expect(out!.units).toBe(2);
    expect((await row(FIRSTS)).record).toBe("FIRST's event link");
    expect((await row(LISTED)).record).toBe("the checked list");
    const ch = await get<any>("SELECT * FROM official_audit_channels WHERE channel_id = ?", [TX]);
    // Playing on an event: FIRST's link, the list's, the two adds still on their events (the drone stream came off).
    expect(ch).toMatchObject({ uploads: 9, linked: 4, linked_current: 0, open_findings: 2 });
  });

  it("leaves what went up or ended after the watcher's last run to its next run: not a miss", async () => {
    const l = await row(LATE);
    expect(l).toMatchObject({ record: null, finding: null, in_window: 1 });
    expect(l.why).toMatch(/^not read by the watcher yet \(it went up or ended after the watcher's last run\): /);
    expect(await get("SELECT 1 FROM official_watch WHERE video_id = ?", [LATE])).toBeUndefined();
  });

  it("takes an add the watcher's title rules set aside today off its event, and counts it wrong", async () => {
    expect((await get<any>("SELECT removed_at FROM official_videos WHERE video_id = ?", [DRONE])).removed_at).toBeTruthy();
    expect(await get<any>("SELECT status, decided_by, why FROM official_watch WHERE video_id = ?", [DRONE])).toMatchObject({ status: "rejected", decided_by: "channel audit",
      why: `taken off its event by the channel audit: not a competition stream: the title says "drone" (was: added by the watcher)` });
    expect((await get<any>("SELECT ok FROM official_audit_adds WHERE video_id = ?", [DRONE])).ok).toBe(0);
  });

  it("sets aside what isn't a competition stream, naming what in its title says so, with a best guess", async () => {
    const w = await row(WEB);
    expect(w).toMatchObject({ record: null, verdict: "ignore", why: `not a competition stream: the title says "webinar"`, finding: null });
    expect(w.guess_why).toMatch(/^best guess USTXHOQ .*only the nearest event by date|^no best guess/);
  });

  it("finds a watcher miss in its window, and sends it to review once a later watcher run still misses it, never adds it", async () => {
    const found = await row(MISS);
    expect(found).toMatchObject({ finding: "open", in_window: 1, found_at: new Date(NOW).toISOString() });
    expect(found.why).toMatch(/^a watcher miss, found by the channel audit: every check of the watcher's passes/);
    expect(await get("SELECT 1 FROM official_watch WHERE video_id = ?", [MISS])).toBeUndefined();
    await run("INSERT INTO official_watch_runs (started_at, finished_at, units, channels) VALUES (?, ?, 1, 1)", [new Date(NOW + 1800_000).toISOString(), new Date(NOW + 1860_000).toISOString()]);
    const out = await audit(NOW + 1900_000);
    // LATE ended before that watcher run too: found now, queued only after another run.
    expect(out).toMatchObject({ missed: 2, queued: 1 });
    expect((await row(LATE)).finding).toBe("open");
    const q = await get<any>("SELECT status, code, why FROM official_watch WHERE video_id = ?", [MISS]);
    expect(q).toMatchObject({ status: "pending", code: "USTXHOQ" });
    expect(q.why).toMatch(/^a watcher miss, found by the channel audit: every check of the watcher's passes/);
    expect(await get("SELECT 1 FROM official_videos WHERE video_id = ?", [MISS])).toBeUndefined();
    expect((await row(MISS)).finding).toBe("queued");
  });

  it("keeps an older possible recording as a finding, with its verdict and best guess", async () => {
    const o = await row(OLDUP);
    expect(o).toMatchObject({ finding: "open", in_window: 0, verdict: "review", why: "an upload, not a live broadcast: no broadcast date confirms its day", guess_season: 2024, guess_code: "USTXMOQ" });
    expect(o.guess_why).toBe(`best guess USTXMOQ (TX Mockingbird Qualifier), 3 days from the day it was published: the title shares "mockingbird" with it`);
  });

  it("checks each of the watcher's own adds again", async () => {
    const adds = await all<any>("SELECT video_id, ok, why FROM official_audit_adds ORDER BY video_id");
    expect(adds.find((a) => a.video_id === GOOD)).toMatchObject({ ok: 1 });
    const bad = adds.find((a) => a.video_id === BAD);
    expect(bad.ok).toBe(0);
    expect(bad.why).toMatch(/its day 2026-01-11 isn't one of the event's \(2026-01-10 to 2026-01-10\)/);
    const m = await measureAdds();
    expect(m).toMatchObject({ runs: 2, lastRuns: { added: 3, ok: 1, wrong: 2, unchecked: 0 } });
  });

  it("reads only the newest page between full reads", async () => {
    pageSize = 3;
    const out = await audit(NOW + 3600_000);
    // Nothing new on the first page: one page, and the adds' facts.
    expect(calls).toEqual(["playlistItems", "videos"]);
    expect(out).toMatchObject({ fullChannels: 0, uploads: 9 });
  });

  it("reads the whole list again after a week, and marks what left the channel", async () => {
    pageSize = 3;
    const was = uploads;
    uploads = uploads.filter((u) => u.id !== WEB);
    try {
      const out = await audit(NOW + FULL_EVERY_MS + 3600_000);
      expect(calls.filter((c) => c === "playlistItems")).toHaveLength(3);
      expect(out).toMatchObject({ fullChannels: 1, uploads: 8 });
      expect((await row(WEB)).gone_at).toBeTruthy();
    } finally { uploads = was; }
  });

  it("lets the owner send a finding to review, or say why it isn't a recording", async () => {
    expect((await dismissFinding(OLDUP, "  ", "owner@example.test")).ok).toBe(false);
    expect((await queueFinding(OLDUP, "owner@example.test")).ok).toBe(true);
    expect(await get<any>("SELECT status, code, guess_why FROM official_watch WHERE video_id = ?", [OLDUP])).toMatchObject({ status: "pending", code: "USTXMOQ" });
    expect((await queueFinding(OLDUP, "owner@example.test")).ok).toBe(false);
    const a = await ownerAudit();
    expect(a.openFindings).toBe(1);
    expect(a.findings.map((f) => f.videoId)).toEqual([LATE]);
    expect(a.wrongAdds.map((w) => w.videoId).sort()).toEqual([BAD, DRONE].sort());
    expect(a.wrongAdds.find((w) => w.videoId === DRONE)?.removed).toBe(true);
    expect(a.channels.find((c) => c.channelId === TX)).toMatchObject({ uploads: 8 });
  });

  it("gives a watcher verdict that names no event a best guess", async () => {
    const v = await decide({ videoId: "uploadxxxxx", title: "FTC Texas Bluebonnet Qualifier", start: null, published: "2025-01-15T00:00:00Z", durationS: 6 * 3600, privacy: "public", embeddable: true, blockedIn: 0 },
      { region: "state=TX", words: "texas", titlePattern: null });
    expect(v.kind).toBe("review");
    expect(v.guess).toMatchObject({ event: { season: 2024, code: "USTXBLQ" }, day: "2025-01-12" });
  });
});
