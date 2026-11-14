// The check after a recording is added or refreshed: every played match gets a clip or lands, with its reason, in the
// owner's review list; an unchanged event isn't checked again; a reviewed event opens again only when its missing
// list changes; the event page's endpoint says the same in plain words.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { forgetRecordings } from "./recordings";
import { checkClipCoverage, markCoverageReviewed, openCoverageCount, ownerClipCoverage } from "./coverageCheck";

const S = 2025;
const SAT = "2026-03-07", SUN = "2026-03-08";
const VID = "SATURDAYv01";
let server: Server;
let base = "";

async function match(code: string, n: number, time: string, played = true) {
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, 50, 50, 40, 40, 'test')",
    [S, code, n, `Q${n}`, time, played ? 1 : 0]);
}
async function meta(start: string, end: string, length: number) {
  await run(`INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, ?, ?, 0, ?)
             ON CONFLICT(video_id) DO UPDATE SET start = excluded.start, end = excluded.end, duration = excluded.duration, checked_at = excluded.checked_at`,
    [VID, start, end, length, new Date().toISOString()]);
  forgetRecordings();
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
  // Two days, one video (Saturday's): Sunday has no recording.
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'TWODAY', 'Two Day Qualifier', 'Qualifier', ?, ?, 'UTC', 0, 0, ?, 'test')",
    [S, SAT, SUN, `https://www.youtube.com/watch?v=${VID}`]);
  await match("TWODAY", 1, `${SAT}T14:00:00.5`);
  await match("TWODAY", 2, `${SAT}T15:00:00.5`);
  await match("TWODAY", 3, `${SUN}T14:00:00.5`);
  // No recording, no match video: stats only.
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'NOREC', 'Unrecorded Meet', 'Qualifier', ?, ?, 'UTC', 0, 0, NULL, 'test')", [S, SAT, SAT]);
  await match("NOREC", 1, `${SAT}T14:00:00.5`);
  await kvSet("data:version", "v1");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("clip coverage check", () => {
  it("lists a recorded event whose video isn't read yet for review, with the reason, never as covered", async () => {
    expect(await checkClipCoverage(() => {})).toBe(1);
    const o = await ownerClipCoverage();
    expect(o.open.map((e) => [e.code, e.withClip, e.played])).toEqual([["TWODAY", 0, 3]]);
    expect(o.open[0].missing.map((m) => m.reason)).toEqual(["video-unread", "video-unread", "video-unread"]);
  });

  it("checks again once the video's facts are read: Saturday clipped, Sunday named as unrecorded", async () => {
    await meta(`${SAT}T13:00:00Z`, `${SAT}T18:00:00Z`, 18_000);
    expect(await checkClipCoverage(() => {})).toBe(1);
    const e = (await ownerClipCoverage()).open[0];
    expect([e.withClip, e.played, e.state]).toEqual([2, 3, "partial"]);
    expect(e.missing).toEqual([expect.objectContaining({ label: "Q3", reason: "no-recording-day", why: "No recording for Sunday" })]);
    expect(e.daysMissing).toEqual([{ date: SUN, label: "Sunday", matches: 1 }]);
    expect(e.videos).toEqual([expect.objectContaining({ videoId: VID, label: "Saturday", matches: 2, clipped: 2 })]);
  });

  it("leaves an unchanged event be, and keeps a reviewed one reviewed until its missing list changes", async () => {
    expect(await checkClipCoverage(() => {})).toBe(0);
    expect(await markCoverageReviewed(S, "TWODAY", "owner@test")).toBe(true);
    expect(await openCoverageCount()).toBe(0);
    // Refreshed facts, same outcome: still reviewed.
    await run("UPDATE video_meta SET checked_at = ? WHERE video_id = ?", [new Date().toISOString(), VID]);
    await meta(`${SAT}T13:00:00Z`, `${SAT}T18:00:00Z`, 18_001);
    expect(await checkClipCoverage(() => {})).toBe(1);
    expect(await openCoverageCount()).toBe(0);
    // Now 4 h short: Saturday's clips go, the list changes, it's open again.
    await meta(`${SAT}T13:00:00Z`, `${SAT}T22:00:00Z`, 18_000);
    await checkClipCoverage(() => {});
    expect(await openCoverageCount()).toBe(1);
    expect((await get<any>("SELECT with_clip, reviewed_at FROM clip_coverage WHERE code = 'TWODAY'"))).toEqual({ with_clip: 0, reviewed_at: null });
  });

  it("the event page's endpoint names each day and each missing match in plain words", async () => {
    const c = await (await fetch(`${base}/api/events/${S}/TWODAY/coverage`)).json() as any;
    expect(c.state).toBe("unplaced");
    expect(c.videos[0]).toMatchObject({ label: "Saturday", why: expect.stringContaining("4 h shorter than its broadcast") });
    expect(c.daysMissing).toEqual([{ date: SUN, label: "Sunday", matches: 1 }]);
    expect(c.matches.map((m: any) => m.label)).toEqual(["Q1", "Q2", "Q3"]);
    expect(c.matches[0].teams).toBeUndefined();
    const n = await (await fetch(`${base}/api/events/${S}/NOREC/coverage`)).json() as any;
    expect(n).toMatchObject({ state: "none", played: 1, withClip: 0 });
    expect((await fetch(`${base}/api/events/${S}/NOPE/coverage`)).status).toBe(404);
  });
});
