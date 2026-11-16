// The channel audit end to end, against a fake YouTube (docs/official-videos.md, "The channel audit"): it reads each
// watched channel's whole uploads list (never a search), records where Scout has each video, sets aside what isn't a
// competition with the reason, finds a watcher miss and sends it to review once a later watcher run still misses it
// (adding one that passes every check), adds an older upload that passes every check, keeps older possible recordings
// as findings with a best guess, re-checks the watcher's own adds, reads only new pages between weekly full reads, and
// marks what left the channel.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { seedOfficialChannels, decide, pendingCount } from "./officialWatch";
import { FULL_EVERY_MS, dismissFinding, measureAdds, ownerAudit, queueFinding, runChannelAudit } from "./officialAudit";

const TX = "UCKezDYNRPpAy2_1XRMBWKSw";
const NOW = Date.parse("2026-01-20T00:00:00Z");
type Item = { id: string; title: string; published: string; start?: string | null; minutes?: number; privacy?: string; live?: string };
const OLDADD = "oldaddoldad", FIRSTS = "firstlinkxx", LISTED = "listedlisto", WEB = "webinarwebi", OLDUP = "oldupload01", MISS = "missmissmis", GOOD = "goodaddgood", BAD = "badaddbadad", LATE = "latelatelat", DRONE = "dronedronex", COPY = "pecancopyxx", OLDCOV = "oldcovered1", OLDNONE = "oldnoevent1";
let uploads: Item[] = [];
let calls: string[] = [];
let pageSize = 50;
/** The videos call answers that the day's quota is spent. */
let quotaOnVideos = false;
/** The videos call fails with a server error this many more times (Infinity: every time). */
let failVideos = 0;
/** The status that failure answers (a 503 unless set). */
let failStatus = 503;
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
  if (failVideos > 0) { failVideos--; return { ok: false, status: failStatus, json: async () => ({}) } as Response; }
  if (quotaOnVideos) return { ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: "quotaExceeded" }] } }) } as Response;
  const ids = (u.searchParams.get("id") ?? "").split(",");
  return json({ items: uploads.filter((i) => ids.includes(i.id)).map((i) => ({
    id: i.id, snippet: { title: i.title, liveBroadcastContent: i.live ?? "none" },
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
  await run(ev, [2024, "USTXLOQ", "TX Longhorn Qualifier", "Austin", "2025-02-08", "2025-02-08", null]);
  await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', '2026-01-17T14:00:00Z', '2026-01-17T22:00:00Z', 28800, 0, 'x')", [FIRSTS]);
  await seedOfficialChannels(NOW, true);
  // Only the Texas channel answers: the others are taken off the list here.
  await run("UPDATE official_channels SET removed_at = 'x', watch_from = ? WHERE channel_id != ?", [new Date(NOW - 30 * 864e5).toISOString(), TX]);
  await run("UPDATE official_channels SET watch_from = ? WHERE channel_id = ?", [new Date(NOW - 30 * 864e5).toISOString(), TX]);
  const ov = "INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES (?, 2025, ?, 'recording', ?, NULL, ?, ?, ?, 'x', ?, NULL)";
  await run(ov, [LISTED, "USTXPEQ", "2026-01-18", TX, "Pecan Sunday", "list", "2026-01-01T00:00:00Z"]);
  await run(ov, [GOOD, "USTXMOQ", "2026-01-17", TX, "FTC Texas Mockingbird Qualifier", "watcher", "2026-01-18T06:00:00Z"]);
  await run(ov, [BAD, "USTXHOQ", "2026-01-11", TX, "FTC Texas Houston Qualifier", "watcher", "2026-01-18T06:00:00Z"]);
  // Bluebonnet 2024 already plays a video for its one day.
  await run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES ('bluebonnet1', 2024, 'USTXBLQ', 'recording', '2025-01-12', NULL, ?, 'Bluebonnet', 'list', 'x', '2025-01-01T00:00:00Z', NULL)", [TX]);
  await run(ov, [DRONE, "USTXMOQ", "2026-01-18", TX, "FTC Texas Mockingbird Qualifier drone race", "watcher", "2026-01-18T06:00:00Z"]);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES (?, ?, ?, 'added', 2025, ?, ?, 'x', ?, ?, 'watcher')", [GOOD, TX, "FTC Texas Mockingbird Qualifier", "USTXMOQ", "2026-01-17", "2026-01-18T06:00:00Z", "2026-01-18T06:00:00Z"]);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES (?, ?, ?, 'added', 2025, ?, ?, 'x', ?, ?, 'watcher')", [BAD, TX, "FTC Texas Houston Qualifier", "USTXHOQ", "2026-01-11", "2026-01-18T06:00:00Z", "2026-01-18T06:00:00Z"]);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES (?, ?, ?, 'added', 2025, ?, ?, 'x', ?, ?, 'watcher')", [DRONE, TX, "FTC Texas Mockingbird Qualifier drone race", "USTXMOQ", "2026-01-18", "2026-01-18T06:00:00Z", "2026-01-18T06:00:00Z"]);
  await run("INSERT INTO official_watch_runs (started_at, finished_at, units, channels, seen, added) VALUES ('2026-01-18T05:59:00Z', '2026-01-18T06:01:00Z', 3, 1, 2, 2)");
  uploads = [
    { id: FIRSTS, title: "FTC Texas Pecan Qualifier", published: "2026-01-17T22:00:00Z", start: "2026-01-17T14:00:00Z" },
    { id: LISTED, title: "FTC Texas Pecan Qualifier Sunday", published: "2026-01-18T22:00:00Z", start: "2026-01-18T14:00:00Z" },
    { id: WEB, title: "FTC Texas coaches webinar", published: "2026-01-05T22:00:00Z", start: null, minutes: 60 },
    // Uploaded nineteen days after its event: too late to be dated by when it went up.
    { id: OLDUP, title: "FTC Texas Mockingbird Qualifier 2025", published: "2025-01-30T22:00:00Z", start: null },
    // In the window, older than the watcher's last run, and not every check passes (its title's day isn't the broadcast's).
    { id: MISS, title: "FTC Texas Houston Qualifier Day 2", published: "2026-01-10T23:00:00Z", start: "2026-01-10T15:00:00Z" },
    { id: GOOD, title: "FTC Texas Mockingbird Qualifier", published: "2026-01-17T23:00:00Z", start: "2026-01-17T15:00:00Z" },
    { id: BAD, title: "FTC Texas Houston Qualifier", published: "2026-01-11T23:00:00Z", start: "2026-01-11T15:00:00Z" },
    // Live when the watcher last ran (it started 2026-01-18 05:59Z): its next run reads it.
    { id: LATE, title: "FTC Texas Mockingbird Qualifier Day 2", published: "2026-01-18T14:00:00Z", start: "2026-01-18T14:00:00Z" },
    { id: DRONE, title: "FTC Texas Mockingbird Qualifier drone race", published: "2026-01-18T03:00:00Z", start: "2026-01-18T02:00:00Z", minutes: 60 },
    // The channel's own copy of a day FIRST's link already plays: a duplicate, as the watcher would log it.
    { id: COPY, title: "FTC Texas Pecan Qualifier (channel copy)", published: "2026-01-17T23:30:00Z", start: "2026-01-17T14:05:00Z" },
    // Older than the window: an upload of an event that already plays every day, and a broadcast on a day with no event.
    { id: OLDCOV, title: "FTC Texas Bluebonnet Qualifier 2025", published: "2025-01-30T22:00:00Z", start: null },
    { id: OLDNONE, title: "FTC Texas Scrimmage", published: "2025-03-01T22:00:00Z", start: "2025-03-01T15:00:00Z" },
    // Older than the window, every check of the watcher's passes, and its event plays nothing: the audit adds it.
    { id: OLDADD, title: "FTC Texas Longhorn Qualifier", published: "2025-02-08T23:00:00Z", start: "2025-02-08T15:00:00Z" },
  ];
});
beforeEach(() => { calls = []; pageSize = 50; quotaOnVideos = false; failVideos = 0; });

describe("the channel audit", () => {
  it("reads the whole uploads list and records where Scout has each video", async () => {
    const out = await audit();
    expect(out).toMatchObject({ channels: 1, fullChannels: 1, uploads: 13, setAside: 4, added: 1, missed: 1, queued: 0, findings: 2, addsChecked: 3, addsWrong: 2, error: null });
    // One uploads page, one facts read (what may be a competition and isn't recorded, and the watcher's adds); no search.
    expect(calls).toEqual(["playlistItems", "videos"]);
    expect(out!.units).toBe(2);
    expect((await row(FIRSTS)).record).toBe("FIRST's event link");
    expect((await row(LISTED)).record).toBe("the checked list");
    const ch = await get<any>("SELECT * FROM official_audit_channels WHERE channel_id = ?", [TX]);
    // Playing on an event: FIRST's link, the list's, the two adds still on their events (the drone stream came off),
    // and the one the audit added.
    expect(ch).toMatchObject({ uploads: 13, linked: 5, linked_current: 0, open_findings: 2 });
  });

  it("adds an older upload that passes every check of the watcher's, as the watcher would, and checks it with its adds", async () => {
    expect(await get<any>("SELECT season, code, day, source, removed_at FROM official_videos WHERE video_id = ?", [OLDADD])).toMatchObject({ season: 2024, code: "USTXLOQ", day: "2025-02-08", source: "watcher", removed_at: null });
    expect(await get<any>("SELECT status, decided_by FROM official_watch WHERE video_id = ?", [OLDADD])).toMatchObject({ status: "added", decided_by: "channel audit" });
    expect(await row(OLDADD)).toMatchObject({ record: "added by the channel audit", finding: null, verdict: "add" });
    expect((await row(OLDADD)).why).toMatch(/^added by the channel audit: USTXLOQ, 2025-02-08/);
  });

  it("sets aside a copy of a day its event already plays, as the watcher's duplicate", async () => {
    const c = await row(COPY);
    expect(c).toMatchObject({ record: null, verdict: "duplicate", finding: null, guess_code: "USTXPEQ" });
    expect(c.why).toBe("duplicate: USTXPEQ already plays firstlinkxx for 2026-01-17");
  });

  it("sets aside an old video that can't fill a day Scout has no video for, saying why", async () => {
    expect(await row(OLDCOV)).toMatchObject({ finding: null, verdict: "ignore",
      why: "set aside by the audit: its event 2024 USTXBLQ (TX Bluebonnet Qualifier) already plays a video for its one day (bluebonnet1)" });
    expect(await row(OLDNONE)).toMatchObject({ finding: null, verdict: "ignore",
      why: "no Scout event in the channel's region on the broadcast date or a day either side: nothing to put it on" });
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

  it("finds a watcher miss in its window: sends one that fails a check to review once a later watcher run still misses it, adds one that passes", async () => {
    const found = await row(MISS);
    expect(found).toMatchObject({ finding: "open", in_window: 1, found_at: new Date(NOW).toISOString() });
    expect(found.why).toBe("a watcher miss, found by the channel audit: the title says day 2, the broadcast was the event's day 1");
    expect(await get("SELECT 1 FROM official_watch WHERE video_id = ?", [MISS])).toBeUndefined();
    await run("INSERT INTO official_watch_runs (started_at, finished_at, units, channels) VALUES (?, ?, 1, 1)", [new Date(NOW + 1800_000).toISOString(), new Date(NOW + 1860_000).toISOString()]);
    const out = await audit(NOW + 1900_000);
    // LATE ended before that watcher run too, and passes every check: a miss, added now (its day's drone stream came off).
    expect(out).toMatchObject({ missed: 2, queued: 1, added: 1 });
    expect(await row(LATE)).toMatchObject({ finding: null, record: "added by the channel audit" });
    expect(await get<any>("SELECT code, day FROM official_videos WHERE video_id = ? AND removed_at IS NULL", [LATE])).toMatchObject({ code: "USTXMOQ", day: "2026-01-18" });
    const q = await get<any>("SELECT status, code, why FROM official_watch WHERE video_id = ?", [MISS]);
    expect(q).toMatchObject({ status: "pending", code: "USTXHOQ" });
    expect(q.why).toBe("a watcher miss, found by the channel audit: the title says day 2, the broadcast was the event's day 1");
    expect(await get("SELECT 1 FROM official_videos WHERE video_id = ?", [MISS])).toBeUndefined();
    expect((await row(MISS)).finding).toBe("queued");
  });

  it("keeps an older possible recording as a finding, with its verdict and best guess", async () => {
    const o = await row(OLDUP);
    expect(o).toMatchObject({ finding: "open", in_window: 0, verdict: "review", why: "an upload, not a live broadcast: no broadcast date confirms its day", guess_season: 2024, guess_code: "USTXMOQ" });
    expect(o.guess_why).toBe(`best guess USTXMOQ (TX Mockingbird Qualifier), 19 days from the day it was published: the title shares "mockingbird" with it`);
  });

  it("checks each of the watcher's own adds again", async () => {
    const adds = await all<any>("SELECT video_id, ok, why FROM official_audit_adds ORDER BY video_id");
    expect(adds.find((a) => a.video_id === GOOD)).toMatchObject({ ok: 1 });
    const bad = adds.find((a) => a.video_id === BAD);
    expect(bad.ok).toBe(0);
    expect(bad.why).toMatch(/its day 2026-01-11 isn't one of the event's \(2026-01-10 to 2026-01-10\)/);
    const m = await measureAdds();
    // The audit's own add (OLDADD) counts with the watcher's, checked like them.
    expect(m).toMatchObject({ runs: 2, lastRuns: { added: 4, ok: 2, wrong: 2, unchecked: 0 } });
  });

  it("reads only the newest page between full reads", async () => {
    pageSize = 3;
    const out = await audit(NOW + 3600_000);
    // Nothing new on the first page: one page, and the adds' facts.
    expect(calls).toEqual(["playlistItems", "videos"]);
    expect(out).toMatchObject({ fullChannels: 0, uploads: 13 });
  });

  it("reads the whole list again after a week, and marks what left the channel", async () => {
    pageSize = 3;
    const was = uploads;
    uploads = uploads.filter((u) => u.id !== WEB);
    try {
      const out = await audit(NOW + FULL_EVERY_MS + 3600_000);
      expect(calls.filter((c) => c === "playlistItems")).toHaveLength(4);
      expect(out).toMatchObject({ fullChannels: 1, uploads: 12 });
      expect((await row(WEB)).gone_at).toBeTruthy();
    } finally { uploads = was; }
  });

  it("lets the owner send a finding to review, or say why it isn't a recording", async () => {
    expect((await dismissFinding(OLDUP, "  ", "owner@example.test")).ok).toBe(false);
    expect((await queueFinding(OLDUP, "owner@example.test")).ok).toBe(true);
    expect(await get<any>("SELECT status, code, guess_why FROM official_watch WHERE video_id = ?", [OLDUP])).toMatchObject({ status: "pending", code: "USTXMOQ" });
    expect((await queueFinding(OLDUP, "owner@example.test")).ok).toBe(false);
    const a = await ownerAudit();
    expect(a.openFindings).toBe(0);
    expect(a.findings).toEqual([]);
    expect(a.wrongAdds.map((w) => w.videoId).sort()).toEqual([BAD, DRONE].sort());
    expect(a.wrongAdds.find((w) => w.videoId === DRONE)?.removed).toBe(true);
    expect(a.channels.find((c) => c.channelId === TX)).toMatchObject({ uploads: 12 });
  });

  it("gives a watcher verdict that names no event a best guess", async () => {
    const v = await decide({ videoId: "uploadxxxxx", title: "FTC Texas Bluebonnet Qualifier", start: null, published: "2025-01-30T00:00:00Z", durationS: 6 * 3600, privacy: "public", embeddable: true, blockedIn: 0 },
      { region: "state=TX", words: "texas", titlePattern: null });
    expect(v.kind).toBe("review");
    expect(v.guess).toMatchObject({ event: { season: 2024, code: "USTXBLQ" }, day: "2025-01-12" });
  });

  it("keeps a channel's whole-list read when the run fails after it, so the next run doesn't spend it again", async () => {
    await run("UPDATE official_audit_channels SET full_at = NULL WHERE channel_id = ?", [TX]);
    uploads.push({ id: "quotanewxxx", title: "FTC Texas Mockingbird Qualifier stream 2", published: "2025-02-01T22:00:00Z", start: "2025-02-01T15:00:00Z" });
    quotaOnVideos = true;
    try {
      const out = await audit(NOW + 2 * FULL_EVERY_MS);
      expect(out?.error).toMatch(/quota/);
      expect((await get<any>("SELECT full_at FROM official_audit_channels WHERE channel_id = ?", [TX])).full_at).toBe(new Date(NOW + 2 * FULL_EVERY_MS).toISOString());
    } finally { uploads.pop(); }
  });

  it("reads a video's facts again once it's no longer live", async () => {
    const id = "livenowxxxx";
    uploads.unshift({ id, title: "FTC Texas Mockingbird Qualifier Day 3", published: "2026-02-20T14:00:00Z", start: "2026-02-20T14:00:00Z", live: "live" });
    try {
      await audit(Date.parse("2026-02-20T18:00:00Z"));
      expect(await row(id)).toMatchObject({ facts_at: null, finding: null });
      expect((await row(id)).why).toMatch(/live now or still to come/);
      uploads[0] = { ...uploads[0], live: "none" };
      calls = [];
      await audit(Date.parse("2026-02-21T06:00:00Z"));
      expect(calls).toContain("videos");
      expect((await row(id)).facts_at).toBe("2026-02-21T06:00:00.000Z");
    } finally { uploads.shift(); }
  });

  it("keeps a channel's last check when the units ran out before it was read", async () => {
    const before = await get<any>("SELECT checked_at FROM official_audit_channels WHERE channel_id = ?", [TX]);
    expect(before.checked_at).toBeTruthy();
    const out = await audit(NOW + 3 * FULL_EVERY_MS, 0);
    expect(out?.channels).toBe(0);
    const after = await get<any>("SELECT checked_at, last_error FROM official_audit_channels WHERE channel_id = ?", [TX]);
    expect(after.checked_at).toBe(before.checked_at);
    expect(after.last_error).toMatch(/not read this run: the audit stopped at its 0 units/);
  });

  it("goes on with the run when a facts call fails twice, and reads those facts next run", async () => {
    const id = "fail503xxxx";
    uploads.unshift({ id, title: "FTC Texas Mockingbird Qualifier Day 4", published: "2026-02-22T14:00:00Z", start: "2026-02-22T14:00:00Z" });
    failVideos = Infinity;
    try {
      const out = await audit(Date.parse("2026-02-23T06:00:00Z"));
      expect(out?.error).toMatch(/facts of \d+ videos couldn't be read: YouTube videos answered 503/);
      expect((await row(id)).facts_at).toBeNull();
      expect((await row(id)).why).toMatch(/facts weren't read yet/);
      expect((await get<any>("SELECT checked_at FROM official_audit_channels WHERE channel_id = ?", [TX])).checked_at).toBe("2026-02-23T06:00:00.000Z");
      failVideos = 0;
      await audit(Date.parse("2026-02-23T12:00:00Z"));
      expect((await row(id)).facts_at).toBe("2026-02-23T12:00:00.000Z");
    } finally { uploads.shift(); failVideos = 0; }
  });

  it("tries a failed facts call once more in the same run: a clip in the owner's review is set aside now", async () => {
    const id = "retryclip01";
    uploads.unshift({ id, title: "Compact Swerve Drive | 99999 Testers | FTC Intake Explainer", published: "2026-02-22T14:00:00Z", start: null, minutes: 1 });
    await run("INSERT INTO official_watch (video_id, channel_id, title, published, duration, status, why, seen_at) VALUES (?, ?, 'Compact Swerve Drive | 99999 Testers | FTC Intake Explainer', '2026-02-22T14:00:00Z', 60, 'pending', 'an upload, not a live broadcast', 'x')", [id, TX]);
    failVideos = 1;
    try {
      const out = await audit(Date.parse("2026-02-23T06:00:00Z"));
      expect(failVideos).toBe(0);
      expect(out?.error ?? "").not.toMatch(/couldn't be read/);
      expect((await row(id)).facts_at).toBe("2026-02-23T06:00:00.000Z");
      expect(await get<any>("SELECT status, decided_by FROM official_watch WHERE video_id = ?", [id])).toMatchObject({ status: "ignored", decided_by: "channel audit" });
    } finally { uploads.shift(); failVideos = 0; await run("DELETE FROM official_watch WHERE video_id = ?", [id]); }
  });

  it("never tries a 4xx facts call twice: it would answer the same, at a unit a try", async () => {
    const id = "fourxxclip1";
    uploads.unshift({ id, title: "Compact Swerve Drive | 99999 Testers | FTC Intake Explainer", published: "2026-02-22T14:00:00Z", start: null, minutes: 1 });
    failVideos = 1; failStatus = 403;
    try {
      const out = await audit(Date.parse("2026-02-23T06:00:00Z"));
      // The one failure was spent on the first call; the batch waits for the next run, its error said.
      expect(failVideos).toBe(0);
      expect(out?.error).toMatch(/facts of \d+ videos couldn't be read: YouTube videos answered 403/);
      expect((await row(id)).facts_at).toBeNull();
    } finally { uploads.shift(); failVideos = 0; failStatus = 503; }
  });

  it("keeps an add found unplayable as wrong when its facts can't be read next run", async () => {
    const it0 = uploads.find((u) => u.id === GOOD)!;
    it0.privacy = "private";
    try {
      await audit(Date.parse("2026-02-24T06:00:00Z"));
      expect(await get<any>("SELECT ok, why FROM official_audit_adds WHERE video_id = ?", [GOOD])).toMatchObject({ ok: 0, why: expect.stringMatching(/it is private now/) });
      failVideos = Infinity;
      await audit(Date.parse("2026-02-24T12:00:00Z"));
      expect(await get<any>("SELECT ok, why FROM official_audit_adds WHERE video_id = ?", [GOOD])).toMatchObject({ ok: 0, why: expect.stringMatching(/it is private now/) });
    } finally { delete it0.privacy; failVideos = 0; }
  });

  it("leaves a channel the owner stopped watching out of the findings and their count", async () => {
    await run("UPDATE official_audit_videos SET finding = 'open', found_at = 'x' WHERE video_id = ?", [OLDNONE]);
    expect((await ownerAudit()).openFindings).toBeGreaterThan(0);
    await run("UPDATE official_channels SET removed_at = 'x' WHERE channel_id = ?", [TX]);
    try {
      const a = await ownerAudit();
      expect(a.openFindings).toBe(0);
      expect(a.findings).toEqual([]);
      expect(a.channels.find((c) => c.channelId === TX)).toBeUndefined();
    } finally {
      await run("UPDATE official_channels SET removed_at = NULL WHERE channel_id = ?", [TX]);
      await run("UPDATE official_audit_videos SET finding = NULL, found_at = NULL WHERE video_id = ?", [OLDNONE]);
    }
  });

  it("decides the review queue again with today's rules: sets aside what they decide, adds what passes every check", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (2024, 'USTXCAQ', 'TX Cactus Qualifier', 'Qualifier', 'El Paso', 'TX', 'USA', '2025-03-08', '2025-03-08', 'America/Denver', 0, 0, NULL, 'test')");
    const CLIP = "pendclip001", CACTUS = "pendcactus1";
    uploads.unshift(
      // A 12-minute broadcast of a day: a clip, which today's rules set aside.
      { id: CLIP, title: "FTC Texas Mockingbird Qualifier highlights", published: "2026-01-17T23:00:00Z", start: "2026-01-17T16:00:00Z", minutes: 12 },
      // An undated upload two days after a one-day event its title names in full: dated by when it went up, and added.
      { id: CACTUS, title: "FTC Texas Cactus Qualifier", published: "2025-03-10T22:00:00Z", start: null },
    );
    const q = "INSERT INTO official_watch (video_id, channel_id, title, status, why, seen_at) VALUES (?, ?, ?, 'pending', 'waiting for the owner', '2025-03-11T00:00:00Z')";
    await run(q, [CLIP, TX, "FTC Texas Mockingbird Qualifier highlights"]);
    await run(q, [CACTUS, TX, "FTC Texas Cactus Qualifier"]);
    const before = await pendingCount();
    try {
      await run("UPDATE official_audit_channels SET full_at = NULL WHERE channel_id = ?", [TX]);
      const out = await audit(Date.parse("2026-02-26T06:00:00Z"));
      expect(await get<any>("SELECT status, decided_by, why FROM official_watch WHERE video_id = ?", [CLIP])).toMatchObject({ status: "ignored", decided_by: "channel audit",
        why: "set aside by the channel audit: 12 minutes long: a clip or highlight of USTXMOQ, not a day's recording (set aside; add it as a highlight if it is one)" });
      expect(await get<any>("SELECT status, decided_by, code, day FROM official_watch WHERE video_id = ?", [CACTUS])).toMatchObject({ status: "added", decided_by: "channel audit", code: "USTXCAQ", day: "2025-03-08" });
      expect(await get<any>("SELECT code, day, source, removed_at FROM official_videos WHERE video_id = ?", [CACTUS])).toMatchObject({ code: "USTXCAQ", day: "2025-03-08", source: "watcher", removed_at: null });
      expect(await row(CACTUS)).toMatchObject({ record: "added by the channel audit", finding: null });
      expect(await pendingCount()).toBe(before - 2);
      expect(out!.added).toBeGreaterThanOrEqual(1);
    } finally { uploads.splice(0, 2); }
  });

  it("adds neither of two videos that fit one event's day at once: which plays is for the owner", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (2024, 'USTXODQ', 'TX Odessa Qualifier', 'Qualifier', 'Odessa', 'TX', 'USA', '2025-03-15', '2025-03-15', 'America/Chicago', 0, 0, NULL, 'test')");
    uploads.unshift(
      { id: "odessaearly", title: "FTC Texas Odessa Qualifier", published: "2025-03-15T17:00:00Z", start: "2025-03-15T15:00:00Z", minutes: 90 },
      { id: "odessamain1", title: "FTC Texas Odessa Qualifier", published: "2025-03-15T23:00:00Z", start: "2025-03-15T17:00:00Z", minutes: 300 },
    );
    try {
      await run("UPDATE official_audit_channels SET full_at = NULL WHERE channel_id = ?", [TX]);
      await audit(Date.parse("2026-02-27T06:00:00Z"));
      for (const id of ["odessaearly", "odessamain1"]) {
        expect(await get("SELECT 1 FROM official_videos WHERE video_id = ?", [id])).toBeUndefined();
        expect(await row(id)).toMatchObject({ verdict: "review", why: expect.stringMatching(/2 videos fit USTXODQ's 2025-03-15 at once/) });
      }
    } finally { uploads.splice(0, 2); }
  });

  it("sets aside a video the channel has made unlisted since, not a watcher miss", async () => {
    const id = "hiddencopyx";
    uploads.unshift({ id, title: "FTC Texas Houston Qualifier", published: "2026-01-10T23:30:00Z", start: "2026-01-10T15:05:00Z", privacy: "unlisted" });
    try {
      await audit(Date.parse("2026-02-25T06:00:00Z"));
      expect(await row(id)).toMatchObject({ verdict: "ignore", finding: null, why: "unlisted now: the channel took it off its public list, so it isn't for Scout" });
    } finally { uploads.shift(); }
  });
});
