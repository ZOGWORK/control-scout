// The check after a recording is added or refreshed: every played match gets a clip or a reason, and each event with a
// gap a triage category; only actionable events are the owner's "To review". An unchanged event isn't checked again;
// a reviewed event opens again only when its missing list changes to an actionable one (never on a fingerprint change
// alone, as after a deploy); bulk Reviewed marks a whole category or season, as confirmed, audited; the event page's
// endpoint says the same in plain words.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { forgetRecordings } from "./recordings";
import { currentSeason } from "../api/answers/season";
import { seasonLabel } from "../../src/shared/format";
import { FRAME_TIMINGS, setFrameTimingsForTests } from "../data/frameTimings";
import { CLIP_CHECKS, setClipChecksForTests } from "../data/clipChecks";
import { checkClipCoverage, markCoverageBulkReviewed, markCoverageReviewed, openCoverageCount, ownerClipCoverage, triageUntriaged } from "./coverageCheck";

const S = currentSeason();
const OLD = S - 3;
const SAT = "2026-03-07", SUN = "2026-03-08";
const VID = "SATURDAYv01", OLD_VID = "OLDSEASONv1";
let server: Server;
let base = "";

async function match(code: string, n: number, time: string, season = S) {
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, 50, 50, 40, 40, 'test')",
    [season, code, n, `Q${n}`, time]);
}
async function meta(videoId: string, start: string, end: string, length: number) {
  await run(`INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, ?, ?, 0, ?)
             ON CONFLICT(video_id) DO UPDATE SET start = excluded.start, end = excluded.end, duration = excluded.duration, checked_at = excluded.checked_at`,
    [videoId, start, end, length, new Date().toISOString()]);
  forgetRecordings();
}
const row = (code: string) => get<any>("SELECT state, with_clip, triage, triage_why, reviewed_at, missing_key, detail FROM clip_coverage WHERE code = ?", [code]);
const version = async (code: string) => String((await row(code)).missing_key);

// Saturday's video was read frame by frame and Q1 wasn't found in it (none of its matches placed from frames, so the
// clock still places Q2): Q1 is checked against the video, so To review, not a pending check.
const KEPT_FRAMES = [...FRAME_TIMINGS];
beforeAll(async () => {
  setFrameTimingsForTests([{ videoId: "SATURDAYv01", code: "TWODAY", checked: "2026-11-15", starts: {}, missing: { Q1: "no frame read of it" } }]);
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const s of [S, OLD]) await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [s]);
  // Two days, one video (Saturday's): Sunday has no recording.
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'TWODAY', 'Two Day Qualifier', 'Qualifier', ?, ?, 'UTC', 0, 0, ?, 'test')",
    [S, SAT, SUN, `https://www.youtube.com/watch?v=${VID}`]);
  await match("TWODAY", 1, `${SAT}T14:00:00.5`);
  await match("TWODAY", 2, `${SAT}T15:00:00.5`);
  await match("TWODAY", 3, `${SUN}T14:00:00.5`);
  // No recording, no match video: stats only.
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'NOREC', 'Unrecorded Meet', 'Qualifier', ?, ?, 'UTC', 0, 0, NULL, 'test')", [S, SAT, SAT]);
  await match("NOREC", 1, `${SAT}T14:00:00.5`);
  // An old season's recorded meet.
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'OLDMEET', 'Old Meet', 'Qualifier', ?, ?, 'UTC', 0, 0, ?, 'test')",
    [OLD, SAT, SAT, `https://www.youtube.com/watch?v=${OLD_VID}`]);
  await match("OLDMEET", 1, `${SAT}T14:00:00.5`, OLD);
  await kvSet("data:version", "v1");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { setFrameTimingsForTests(KEPT_FRAMES); return new Promise<void>((r) => server.close(() => r())); });

describe("clip coverage check and triage", () => {
  it("triages a recorded event whose video isn't read yet as No timing, with the reason: listed, never covered, never To review", async () => {
    expect(await checkClipCoverage(() => {})).toBe(2);
    const o = await ownerClipCoverage();
    expect([o.list, o.open, o.events]).toEqual(["actionable", 0, []]);
    expect(o.categories).toEqual({ actionable: 0, unchecked: 0, "no-timing": 1, "early-start": 0, unplayable: 0, "old-season": 1 });
    const n = await ownerClipCoverage({ list: "no-timing" });
    expect(n.events.map((e) => [e.code, e.withClip, e.played, e.triage])).toEqual([["TWODAY", 0, 3, "no-timing"]]);
    expect(n.events[0].triageWhy).toBe("3 matches: Video's facts not read from YouTube yet");
    expect(n.events[0].missing.map((m) => m.reason)).toEqual(["video-unread", "video-unread", "video-unread"]);
    const old = (await ownerClipCoverage({ list: "old-season" })).events;
    expect(old.map((e) => [e.code, e.triage, e.triageWhy])).toEqual([["OLDMEET", "old-season", `${seasonLabel(OLD)} season. 1 match: Video's facts not read from YouTube yet`]]);
    // Stored by its reasons alone: Old season is applied when read, from the current season then.
    expect(await row("OLDMEET")).toMatchObject({ triage: "no-timing", triage_why: "1 match: Video's facts not read from YouTube yet" });
    expect(await openCoverageCount()).toBe(0);
  });

  it("checks again once the video's facts are read: Saturday clipped, Sunday named as unrecorded", async () => {
    await meta(VID, `${SAT}T13:00:00Z`, `${SAT}T18:00:00Z`, 18_000);
    expect(await checkClipCoverage(() => {})).toBe(1);
    const e = (await ownerClipCoverage({ list: "no-timing" })).events[0];
    expect([e.withClip, e.played, e.state, e.triage, e.triageWhy]).toEqual([2, 3, "partial", "no-timing", "1 match: No recording for that day"]);
    expect(e.missing).toEqual([expect.objectContaining({ label: "Q3", reason: "no-recording-day", why: "No recording for Sunday" })]);
    expect(e.daysMissing).toEqual([{ date: SUN, label: "Sunday", matches: 1 }]);
    expect(e.videos).toEqual([expect.objectContaining({ videoId: VID, label: "Saturday", matches: 2, clipped: 2 })]);
  });

  it("a reviewed event stays reviewed when its list changes to another non-actionable one, and opens again on an actionable one", async () => {
    expect(await checkClipCoverage(() => {})).toBe(0);
    expect(await markCoverageReviewed(S, "TWODAY", "an-older-list", "owner@test")).toBe("changed");
    // Any case of the code, as the route gets it.
    expect(await markCoverageReviewed(S, "twoday", await version("TWODAY"), "owner@test")).toBe("ok");
    expect(await markCoverageReviewed(S, "TWODAY", await version("TWODAY"), "owner@test")).toBe("none");
    expect((await ownerClipCoverage({ list: "reviewed" })).events.map((e) => e.code)).toEqual(["TWODAY"]);
    // Now 4 h short: Saturday's clips go, the missing list changes, still No timing: stays reviewed.
    await meta(VID, `${SAT}T13:00:00Z`, `${SAT}T22:00:00Z`, 18_000);
    expect(await checkClipCoverage(() => {})).toBe(1);
    expect(await row("TWODAY")).toMatchObject({ with_clip: 0, triage: "no-timing", reviewed_at: expect.any(String) });
    expect(await openCoverageCount()).toBe(0);
    // The whole video again, and Q1's real start comes in before the broadcast's: by the clock it's outside the video,
    // never checked against the video itself. An actionable list: open again.
    await meta(VID, `${SAT}T13:00:00Z`, `${SAT}T18:00:00Z`, 18_000);
    await run("UPDATE matches SET time = ? WHERE code = 'TWODAY' AND number = 1", [`${SAT}T12:00:00.5`]);
    expect(await checkClipCoverage(() => {})).toBe(1);
    expect(await row("TWODAY")).toMatchObject({ triage: "actionable", reviewed_at: null });
    expect(await openCoverageCount()).toBe(1);
    const e = (await ownerClipCoverage()).events[0];
    expect([e.code, e.triage]).toEqual(["TWODAY", "actionable"]);
    // Said as what the video showed (its frames read, Q1 not found), never what the clock said; the clock's kept apart.
    expect(e.triageWhy).toBe("1 match checked in the video, no start found there (Q1) (1 more held back for other reasons)");
    expect(e.missing.map((m) => [m.label, m.reason])).toEqual([["Q1", "before-broadcast"], ["Q3", "no-recording-day"]]);
    expect(e.missing[0]).toMatchObject({ why: "Checked in the video (2026-11-15): no start found for it (no frame read of it)", clock: "Played before the broadcast started", video: { checked: "2026-11-15" } });
  });

  it("a deploy (every fingerprint new, nothing else) re-opens nothing, nor a non-actionable change after it", async () => {
    expect(await markCoverageReviewed(S, "TWODAY", await version("TWODAY"), "owner@test")).toBe("ok");
    const seen = await row("TWODAY");
    await run("UPDATE clip_coverage SET fingerprint = 'from-the-last-process'");
    expect(await checkClipCoverage(() => {})).toBe(2);
    expect(await row("TWODAY")).toMatchObject({ triage: "actionable", reviewed_at: seen.reviewed_at, missing_key: seen.missing_key });
    expect(await openCoverageCount()).toBe(0);
    // After that boot recheck, the list changes to a non-actionable one (Q1 back in the video, the video 4 h short):
    // a new missing key, still reviewed.
    await run("UPDATE matches SET time = ? WHERE code = 'TWODAY' AND number = 1", [`${SAT}T14:00:00.5`]);
    await meta(VID, `${SAT}T13:00:00Z`, `${SAT}T22:00:00Z`, 18_000);
    expect(await checkClipCoverage(() => {})).toBe(1);
    const changed = await row("TWODAY");
    expect(changed).toMatchObject({ triage: "no-timing", reviewed_at: seen.reviewed_at });
    expect(changed.missing_key).not.toBe(seen.missing_key);
    expect(await openCoverageCount()).toBe(0);
    // Back to the actionable list: one the owner hasn't marked since, so To review again; then marked again.
    await meta(VID, `${SAT}T13:00:00Z`, `${SAT}T18:00:00Z`, 18_000);
    await run("UPDATE matches SET time = ? WHERE code = 'TWODAY' AND number = 1", [`${SAT}T12:00:00.5`]);
    expect(await checkClipCoverage(() => {})).toBe(1);
    expect(await row("TWODAY")).toMatchObject({ triage: "actionable", reviewed_at: null });
    expect(await markCoverageReviewed(S, "TWODAY", await version("TWODAY"), "owner@test")).toBe("ok");
  });

  it("an old season's reviewed event stays reviewed when its list changes", async () => {
    expect(await markCoverageReviewed(OLD, "OLDMEET", await version("OLDMEET"), "owner@test")).toBe("ok");
    // Its facts are read: video-unread becomes 'shorter than its broadcast', a new list, still Old season.
    await meta(OLD_VID, `${SAT}T13:00:00Z`, `${SAT}T22:00:00Z`, 18_000);
    expect(await checkClipCoverage(() => {})).toBe(1);
    const r = await row("OLDMEET");
    expect(r).toMatchObject({ triage: "no-timing", reviewed_at: expect.any(String) });
    expect(JSON.parse(r.detail).missing[0].reason).toBe("gap-unplaced");
    expect((await ownerClipCoverage({ list: "reviewed" })).events.find((e) => e.code === "OLDMEET")?.triage).toBe("old-season");
  });

  it("bulk Reviewed marks a whole category or season as confirmed, leaves the rest, and is audited", async () => {
    const add = (code: string, triage: string, season = S) => run(
      "INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail, triage, triage_why) VALUES (?, ?, 'x', '2026-11-01T00:00:00Z', 'unplaced', 2, 0, 'k', '{}', ?, 'why')",
      [season, code, triage]);
    await add("BULKNT", "no-timing");
    await add("BULKES", "early-start");
    await add("BULKAC", "actionable");
    await add("BULKOLD", "actionable", OLD);
    await add("BULKOLDNT", "no-timing", OLD);
    const before = await ownerClipCoverage();
    expect(before.categories).toEqual({ actionable: 2, unchecked: 0, "no-timing": 1, "early-start": 1, unplayable: 0, "old-season": 1 });
    expect(before.seasons).toEqual([{ season: S, open: 3, actionable: 1 }, { season: OLD, open: 2, actionable: 1 }]);
    // A season's non-actionable ones only (the panel's default): its Actionable one stays To review.
    expect(await markCoverageBulkReviewed({ category: "non-actionable", season: OLD }, 1, "owner@test")).toEqual({ status: "ok", count: 1 });
    expect((await ownerClipCoverage()).seasons).toEqual([{ season: S, open: 3, actionable: 1 }, { season: OLD, open: 1, actionable: 1 }]);
    // Confirmed on a count that moved: nothing marked.
    expect(await markCoverageBulkReviewed({ category: "non-actionable" }, 5, "owner@test")).toEqual({ status: "changed", count: 2 });
    expect(await markCoverageBulkReviewed({ category: "non-actionable" }, 2, "owner@test")).toEqual({ status: "ok", count: 2 });
    expect((await ownerClipCoverage()).categories).toEqual({ actionable: 2, unchecked: 0, "no-timing": 0, "early-start": 0, unplayable: 0, "old-season": 0 });
    // A season with "include Actionable": every one of that season's.
    expect(await markCoverageBulkReviewed({ season: OLD }, 1, "owner@test")).toEqual({ status: "ok", count: 1 });
    expect((await ownerClipCoverage()).events.map((e) => e.code)).toEqual(["BULKAC"]);
    // Marking keeps the rows (and their missing lists): Reviewed holds them, nothing deleted.
    expect((await all<any>("SELECT code FROM clip_coverage WHERE code LIKE 'BULK%' AND reviewed_at IS NOT NULL ORDER BY code")).map((r) => r.code)).toEqual(["BULKES", "BULKNT", "BULKOLD", "BULKOLDNT"]);
    const audit = await all<any>("SELECT actor, details FROM owner_audit WHERE action = 'clipCoverage.bulkReviewed' ORDER BY id");
    expect(audit.map((a) => [a.actor, JSON.parse(a.details)])).toEqual([
      ["owner@test", { category: "non-actionable", season: OLD, count: 1 }],
      ["owner@test", { category: "non-actionable", season: null, count: 2 }],
      ["owner@test", { category: null, season: OLD, count: 1 }],
    ]);
    await run("DELETE FROM clip_coverage WHERE code LIKE 'BULK%'");
  });

  it("rows from before triage are triaged at boot from the missing list they hold, reviewed ones kept reviewed", async () => {
    const detail = (reasons: string[]) => JSON.stringify({ videos: [], daysMissing: [], missing: reasons.map((reason, i) => ({ key: `qual:0:${i + 1}`, label: `Q${i + 1}`, clip: false, videoId: null, reason })) });
    await run("INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail) VALUES (?, 'PRE1', 'x', '2026-11-01T00:00:00Z', 'unplaced', 2, 0, 'k', ?)", [S, detail(["video-unavailable", "video-unavailable"])]);
    await run("INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail, reviewed_at, reviewed_by) VALUES (?, 'PRE2', 'x', '2026-11-01T00:00:00Z', 'partial', 3, 2, 'k', ?, '2026-11-02T00:00:00Z', 'owner@test')", [S, detail(["before-broadcast"])]);
    // Untriaged, a row reads as actionable: PRE1 would be To review until triaged.
    expect((await ownerClipCoverage()).events.map((e) => e.code)).toContain("PRE1");
    // One whose detail can't be read: Actionable (nothing says it's settled), and it doesn't stop the others.
    await run("INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail) VALUES (?, 'PRE3', 'x', '2026-11-01T00:00:00Z', 'unplaced', 2, 0, 'k', '{not json')", [S]);
    expect(await triageUntriaged(() => {})).toBe(3);
    expect(await row("PRE1")).toMatchObject({ triage: "unplayable", triage_why: "2 matches: Recording can't be played: unavailable on YouTube (private or removed)", reviewed_at: null });
    // A list stored before video checks existed: its clock-only match is a pending check (a stored review doesn't hide it).
    expect(await row("PRE2")).toMatchObject({ triage: "unchecked", reviewed_at: "2026-11-02T00:00:00Z" });
    expect((await ownerClipCoverage({ list: "unchecked" })).events.map((e) => e.code)).toContain("PRE2");
    expect((await ownerClipCoverage({ list: "reviewed" })).events.map((e) => e.code)).not.toContain("PRE2");
    // A pending check can't be marked reviewed, alone or in any bulk.
    await run("INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail, triage, triage_why) VALUES (?, 'PRE4', 'x', '2026-11-01T00:00:00Z', 'partial', 3, 2, 'k', '{}', 'unchecked', 'w')", [S]);
    expect(await markCoverageReviewed(S, "PRE4", "k", "owner@test")).toBe("none");
    const all4 = (await ownerClipCoverage()).seasons.find((x) => x.season === S)!.open;
    expect(await markCoverageBulkReviewed({ season: S }, all4, "owner@test")).toMatchObject({ status: "ok" });
    expect(await row("PRE4")).toMatchObject({ triage: "unchecked", reviewed_at: null });
    expect((await ownerClipCoverage()).categories.unchecked).toBe(2);
    await run("UPDATE clip_coverage SET reviewed_at = NULL, reviewed_by = NULL WHERE code IN ('PRE1', 'PRE3') OR code = 'TWODAY'");
    expect(await row("PRE3")).toMatchObject({ triage: "actionable", triage_why: "No missing list to judge from: look at the event" });
    expect((await ownerClipCoverage()).events.find((e) => e.code === "PRE3")).toMatchObject({ missing: [], videos: [] });
    expect((await ownerClipCoverage()).events.map((e) => e.code)).not.toContain("PRE1");
    expect(await triageUntriaged(() => {})).toBe(0);
    await run("DELETE FROM clip_coverage WHERE code LIKE 'PRE%'");
  });

  it("pages the owner's list, every event reachable", async () => {
    await run("UPDATE clip_coverage SET reviewed_at = NULL WHERE code = 'TWODAY'");
    for (let i = 0; i < 3; i++) {
      await run("INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail, triage) VALUES (?, ?, 'x', ?, 'unplaced', 2, 0, 'k', '{}', 'actionable')", [S, `PAGE${i}`, `2026-11-0${i + 1}T00:00:00Z`]);
    }
    const one = await ownerClipCoverage({ limit: 2 });
    expect(one.open).toBe(4);
    // One of the first page leaves the list before the next is asked for: the page after the last shown still holds the rest.
    await run("UPDATE clip_coverage SET with_clip = played WHERE code = ?", [one.events[0].code]);
    const last = one.events[1], two = await ownerClipCoverage({ limit: 2, after: { season: last.season, code: last.code } });
    expect([...one.events, ...two.events].map((e) => e.code).sort()).toEqual(["PAGE0", "PAGE1", "PAGE2", "TWODAY"]);
    await run("DELETE FROM clip_coverage WHERE code LIKE 'PAGE%'");
  });

  it("the event page's endpoint names each day and each missing match in plain words", async () => {
    const c = await (await fetch(`${base}/api/events/${S}/TWODAY/coverage`)).json() as any;
    expect(c.state).toBe("partial");
    expect(c.videos[0]).toMatchObject({ label: "Saturday", clipped: 1 });
    expect(c.daysMissing).toEqual([{ date: SUN, label: "Sunday", matches: 1 }]);
    expect(c.matches.map((m: any) => m.label)).toEqual(["Q1", "Q3"]);
    expect(c.matches[0].teams).toBeUndefined();
    const n = await (await fetch(`${base}/api/events/${S}/NOREC/coverage`)).json() as any;
    expect(n).toMatchObject({ state: "none", played: 1, withClip: 0 });
    expect((await fetch(`${base}/api/events/${S}/NOPE/coverage`)).status).toBe(404);
  });

  it("checks again when an earlier match gets its real start, the latest unchanged", async () => {
    // Q1 posted without its start (on the minute: the schedule), then FIRST gives the real one.
    await run("UPDATE matches SET time = ? WHERE code = 'TWODAY' AND number = 1", [`${SAT}T14:00:00`]);
    expect(await checkClipCoverage(() => {})).toBe(1);
    expect(JSON.parse(String((await row("TWODAY")).detail)).missing[0]).toMatchObject({ label: "Q1", reason: "no-start" });
    expect(await row("TWODAY")).toMatchObject({ triage: "no-timing" });
    await run("UPDATE matches SET time = ? WHERE code = 'TWODAY' AND number = 1", [`${SAT}T12:00:00.5`]);
    expect(await checkClipCoverage(() => {})).toBe(1);
    expect(JSON.parse(String((await row("TWODAY")).detail)).missing[0]).toMatchObject({ label: "Q1", reason: "before-broadcast" });
    expect(await row("TWODAY")).toMatchObject({ triage: "actionable" });
  });

  it("checks again when the recording becomes a day-at-a-time one, the same video and matches", async () => {
    expect(await checkClipCoverage(() => {})).toBe(0);
    await run("INSERT INTO event_broadcasts (season, code, video_id, url, start) VALUES (?, 'TWODAY', ?, ?, ?)", [S, VID, `https://www.youtube.com/watch?v=${VID}`, `${SAT}T13:00:00Z`]);
    forgetRecordings();
    expect(await checkClipCoverage(() => {})).toBe(1);
    await run("DELETE FROM event_broadcasts WHERE code = 'TWODAY'");
    forgetRecordings();
    expect(await checkClipCoverage(() => {})).toBe(1);
  });

  it("lists findings: a match the frames saw with no clip, and a clip pulled by its first frame, with the last pass", async () => {
    const keptChecks = [...CLIP_CHECKS];
    // Q1 seen in the video by one read (not confirmed): no clip, a finding.
    setFrameTimingsForTests([{ videoId: "SATURDAYv01", code: "TWODAY", checked: "2026-11-15", starts: {}, review: { Q1: { t: 1800, why: "one signal only" } } }]);
    setClipChecksForTests([{ videoId: "SATURDAYv01", code: "TWODAY", season: S, checked: "2026-11-15", pulled: { Q2: { t: 3600, showed: "Q1" } } }]);
    try {
      await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
      const logged: string[] = [];
      expect(await checkClipCoverage((l) => logged.push(l))).toBe(1);
      expect(logged[0]).toMatch(/^clip coverage: checked 1 event \(1 recorded\) · 0 fully clipped · \d+ matches clipped · \d+ missing \(.*seen in the video, no clip \(a finding\) 1/);
      const o = await ownerClipCoverage();
      // The review entry, listed once (from the entry itself, with its own why), for the owner to decide.
      expect(o.findings.filter((f) => f.code === "TWODAY")).toEqual([
        { kind: "seen", source: "review", season: S, code: "TWODAY", name: "Two Day Qualifier", label: "Q1", videoId: "SATURDAYv01", at: 1800, why: "one signal only" },
        { kind: "pulled", season: S, code: "TWODAY", name: "Two Day Qualifier", label: "Q2", videoId: "SATURDAYv01", at: 3600, why: "Clip pulled: its first frame shows Q1, not Q2" },
      ]);
      expect(o.clipChecks).toMatchObject({ pulled: 1 });
      expect(o.lastPass).toMatchObject({ checked: 1, events: 1, why: expect.objectContaining({ "seen in the video, no clip (a finding)": 1 }), pending: expect.any(Number) });
      // The breakdown over every stored event, not only this pass's: at least this pass's own.
      expect(o.lastPass!.all!.why["seen in the video, no clip (a finding)"]).toBeGreaterThanOrEqual(1);
      expect(o.lastPass!.all!.missing).toBeGreaterThanOrEqual(o.lastPass!.missing);
      // A start the read holds that the site doesn't serve (Q1 overlaps Q3's) is one too, from the coverage row; rejected at
      // that second, it leaves the list.
      setFrameTimingsForTests([{ videoId: "SATURDAYv01", code: "TWODAY", checked: "2026-11-15", starts: { Q1: 1800, Q3: 1805 } }]);
      await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
      await checkClipCoverage(() => {});
      expect((await ownerClipCoverage()).findings.filter((f) => f.code === "TWODAY" && f.kind === "seen").map((f) => `${f.source} ${f.label}@${f.at}`)).toEqual(["start Q1@1800"]);
      await run("INSERT INTO review_decisions (video_id, code, label, season, t, decision, decided_by, decided_at) VALUES ('SATURDAYv01', 'TWODAY', 'Q1', ?, 1800, 'rejected', 'o', 'x')", [S]);
      expect((await ownerClipCoverage()).findings.filter((f) => f.code === "TWODAY" && f.kind === "seen")).toEqual([]);
      await run("DELETE FROM review_decisions WHERE code = 'TWODAY'");
      expect(o.lastPass!.pendingBefore === null || typeof o.lastPass!.pendingBefore === "number").toBe(true);
      // A finding stays until a pass clears it: here a re-read shows Q1 isn't in the video and the pulled clip's check is
      // gone, so the next pass drops both (never by marking reviewed). The pass before's pending count is kept beside it.
      setClipChecksForTests(keptChecks);
      setFrameTimingsForTests([{ videoId: "SATURDAYv01", code: "TWODAY", checked: "2026-11-15", starts: {}, missing: { Q1: "no frame read of it" } }]);
      await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
      expect(await checkClipCoverage(() => {})).toBe(1);
      const after = await ownerClipCoverage();
      expect(after.findings.filter((f) => f.code === "TWODAY")).toEqual([]);
      expect(after.lastPass!.pendingBefore).toBe(o.lastPass!.pending);
    } finally {
      setClipChecksForTests(keptChecks);
      setFrameTimingsForTests([{ videoId: "SATURDAYv01", code: "TWODAY", checked: "2026-11-15", starts: {}, missing: { Q1: "no frame read of it" } }]);
      await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
      await checkClipCoverage(() => {});
    }
  });

  it("doesn't carry a review given to a pending check over to the list once its video is checked", async () => {
    // Q1 waits for its video check (no frame row): a pending check; say a review was stored on it.
    setFrameTimingsForTests([]);
    await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
    await checkClipCoverage(() => {});
    expect(await row("TWODAY")).toMatchObject({ triage: "unchecked" });
    await run("UPDATE clip_coverage SET reviewed_at = '2026-11-14T00:00:00Z', reviewed_by = 'owner@test' WHERE code = 'TWODAY'");
    const key = (await row("TWODAY")).missing_key;
    // Its frames are read, Q1 not found: the same matches missing, now checked against the video, so To review again.
    setFrameTimingsForTests([{ videoId: "SATURDAYv01", code: "TWODAY", checked: "2026-11-15", starts: {}, missing: { Q1: "no frame read of it" } }]);
    await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
    const logged: string[] = [];
    await checkClipCoverage((l) => logged.push(l));
    expect(await row("TWODAY")).toMatchObject({ triage: "actionable", missing_key: key, reviewed_at: null });
    expect(logged[0]).toMatch(/ · 1 actionable for owner review/);
    expect((await ownerClipCoverage()).events.map((e) => e.code)).toContain("TWODAY");
  });

  it("doesn't carry a review given to a pending check over when the checked list isn't actionable either", async () => {
    setFrameTimingsForTests([]);
    await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
    await checkClipCoverage(() => {});
    expect(await row("TWODAY")).toMatchObject({ triage: "unchecked" });
    await run("UPDATE clip_coverage SET reviewed_at = '2026-11-14T00:00:00Z', reviewed_by = 'owner@test' WHERE code = 'TWODAY'");
    // Its frames are read and Q1 is placed from them: only Q3 is missing (no recording that day), not actionable.
    setFrameTimingsForTests([{ videoId: "SATURDAYv01", code: "TWODAY", checked: "2026-11-15", starts: { Q1: 1800 } }]);
    await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
    await checkClipCoverage(() => {});
    const r = await row("TWODAY");
    expect(r.triage).not.toBe("actionable");
    expect(r.triage).not.toBe("unchecked");
    expect(r.reviewed_at).toBeNull();
    setFrameTimingsForTests([{ videoId: "SATURDAYv01", code: "TWODAY", checked: "2026-11-15", starts: {}, missing: { Q1: "no frame read of it" } }]);
    await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
    await checkClipCoverage(() => {});
  });

  it("still records the pass when a stored detail is unreadable", async () => {
    await run("UPDATE clip_coverage SET detail = '{not json' WHERE code = 'PRE3'");
    await run("UPDATE clip_coverage SET fingerprint = 'x' WHERE code = 'TWODAY'");
    const logged: string[] = [];
    expect(await checkClipCoverage((l) => logged.push(l))).toBeGreaterThan(0);
    expect(logged[0]).toMatch(/^clip coverage: checked /);
    expect(logged[0]).not.toMatch(/  /);
    expect((await ownerClipCoverage()).lastPass).toMatchObject({ pending: expect.any(Number) });
  });

  it("drops an event from every list once it has no recording left (stats only)", async () => {
    await run("UPDATE events SET livestream = NULL WHERE code = 'TWODAY'");
    forgetRecordings();
    expect(await checkClipCoverage(() => {})).toBe(1);
    expect(await row("TWODAY")).toMatchObject({ state: "none" });
    expect(await openCoverageCount()).toBe(0);
    expect((await ownerClipCoverage()).events).toEqual([]);
  });
});
