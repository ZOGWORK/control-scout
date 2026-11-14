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

beforeAll(async () => {
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
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("clip coverage check and triage", () => {
  it("triages a recorded event whose video isn't read yet as No timing, with the reason: listed, never covered, never To review", async () => {
    expect(await checkClipCoverage(() => {})).toBe(2);
    const o = await ownerClipCoverage();
    expect([o.list, o.open, o.events]).toEqual(["actionable", 0, []]);
    expect(o.categories).toEqual({ actionable: 0, "no-timing": 1, "early-start": 0, "old-season": 1 });
    const n = await ownerClipCoverage({ list: "no-timing" });
    expect(n.events.map((e) => [e.code, e.withClip, e.played, e.triage])).toEqual([["TWODAY", 0, 3, "no-timing"]]);
    expect(n.events[0].triageWhy).toBe("3 matches: Video's facts not read from YouTube yet");
    expect(n.events[0].missing.map((m) => m.reason)).toEqual(["video-unread", "video-unread", "video-unread"]);
    expect((await ownerClipCoverage({ list: "old-season" })).events.map((e) => [e.code, e.triage])).toEqual([["OLDMEET", "old-season"]]);
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
    expect(e.triageWhy).toBe("1 match played before the broadcast started, by the clock: not yet checked against the video (1 more held back for other reasons)");
    expect(e.missing.map((m) => [m.label, m.reason])).toEqual([["Q1", "before-broadcast"], ["Q3", "no-recording-day"]]);
  });

  it("a deploy (every fingerprint new, nothing else) re-opens nothing", async () => {
    expect(await markCoverageReviewed(S, "TWODAY", await version("TWODAY"), "owner@test")).toBe("ok");
    await run("UPDATE clip_coverage SET fingerprint = 'from-the-last-process'");
    expect(await checkClipCoverage(() => {})).toBe(2);
    expect(await row("TWODAY")).toMatchObject({ triage: "actionable", reviewed_at: expect.any(String) });
    expect(await openCoverageCount()).toBe(0);
  });

  it("an old season's reviewed event stays reviewed when its list changes", async () => {
    expect(await markCoverageReviewed(OLD, "OLDMEET", await version("OLDMEET"), "owner@test")).toBe("ok");
    // Its facts are read: video-unread becomes 'shorter than its broadcast', a new list, still Old season.
    await meta(OLD_VID, `${SAT}T13:00:00Z`, `${SAT}T22:00:00Z`, 18_000);
    expect(await checkClipCoverage(() => {})).toBe(1);
    const r = await row("OLDMEET");
    expect(r).toMatchObject({ triage: "old-season", reviewed_at: expect.any(String) });
    expect(JSON.parse(r.detail).missing[0].reason).toBe("gap-unplaced");
  });

  it("bulk Reviewed marks a whole category or season as confirmed, leaves the rest, and is audited", async () => {
    const add = (code: string, triage: string, season = S) => run(
      "INSERT INTO clip_coverage (season, code, fingerprint, checked_at, state, played, with_clip, missing_key, detail, triage, triage_why) VALUES (?, ?, 'x', '2026-11-01T00:00:00Z', 'unplaced', 2, 0, 'k', '{}', ?, 'why')",
      [season, code, triage]);
    await add("BULKNT", "no-timing");
    await add("BULKES", "early-start");
    await add("BULKAC", "actionable");
    await add("BULKOLD", "actionable", OLD);
    expect((await ownerClipCoverage()).categories).toEqual({ actionable: 2, "no-timing": 1, "early-start": 1, "old-season": 0 });
    // Confirmed on a count that moved: nothing marked.
    expect(await markCoverageBulkReviewed({ category: "non-actionable" }, 5, "owner@test")).toEqual({ status: "changed", count: 2 });
    expect(await markCoverageBulkReviewed({ category: "non-actionable" }, 2, "owner@test")).toEqual({ status: "ok", count: 2 });
    expect((await ownerClipCoverage()).categories).toEqual({ actionable: 2, "no-timing": 0, "early-start": 0, "old-season": 0 });
    // A season: only that season's.
    expect(await markCoverageBulkReviewed({ season: OLD }, 1, "owner@test")).toEqual({ status: "ok", count: 1 });
    expect((await ownerClipCoverage()).events.map((e) => e.code)).toEqual(["BULKAC"]);
    // Marking keeps the rows (and their missing lists): Reviewed holds them, nothing deleted.
    expect((await all<any>("SELECT code FROM clip_coverage WHERE code LIKE 'BULK%' AND reviewed_at IS NOT NULL ORDER BY code")).map((r) => r.code)).toEqual(["BULKES", "BULKNT", "BULKOLD"]);
    const audit = await all<any>("SELECT actor, details FROM owner_audit WHERE action = 'clipCoverage.bulkReviewed' ORDER BY id");
    expect(audit.map((a) => [a.actor, JSON.parse(a.details)])).toEqual([
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
    expect(await triageUntriaged(() => {})).toBe(2);
    expect(await row("PRE1")).toMatchObject({ triage: "no-timing", triage_why: "2 matches: Video unavailable or private", reviewed_at: null });
    expect(await row("PRE2")).toMatchObject({ triage: "actionable", reviewed_at: "2026-11-02T00:00:00Z" });
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

  it("drops an event from every list once it has no recording left (stats only)", async () => {
    await run("UPDATE events SET livestream = NULL WHERE code = 'TWODAY'");
    forgetRecordings();
    expect(await checkClipCoverage(() => {})).toBe(1);
    expect(await row("TWODAY")).toMatchObject({ state: "none" });
    expect(await openCoverageCount()).toBe(0);
    expect((await ownerClipCoverage()).events).toEqual([]);
  });
});
