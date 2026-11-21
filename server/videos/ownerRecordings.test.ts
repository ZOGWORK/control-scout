// The owner's corrections to an event's recordings from its own page (server/videos/ownerRecordings.ts), end to end on
// the real app and an in-memory database: Replace, Remove and Add through /api/owner/event-recordings/*, a non-owner
// refused, the owner's choice winning over FIRST's link on every later read (the next automatic pass included), and
// the event page's player reading it at once. The case: USMIFRQ2 2026, whose FIRST link was the practice-day stream.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { forgetRecordings, picked, seasonRecordings, type RecordingVideo } from "./recordings";
import { eventVideosByDay, forgetOfficial } from "./officialVideos";
import { videoIdOf } from "./ownerRecordings";

const PRACTICE = "practiceAAA", DAY1 = "qualDay1BBB", DAY2 = "qualDay2CCC", OTHER = "otherEvtDDD";
let server: Server;
let base = "";
const saved = process.env.OWNER_EMAILS;
let ownerCookie = "", otherCookie = "";

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}
async function call(method: string, path: string, cookie: string, body?: unknown) {
  const res = await fetch(`${base}/api/owner/event-recordings/2026/USMIFRQ2${path}`, { method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const played = async () => { const r = (await seasonRecordings(2026)).get("USMIFRQ2"); return r ? [r.videoId, ...(r.more ?? []).map((v) => v.videoId)] : []; };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (2026, ?, ?, 'Qualifier', 'Detroit', 'MI', 'USA', ?, ?, 'America/Detroit', 0, 0, ?, 'test')";
  // FIRST's link names the practice day's stream (broadcast the day before the qualifier: within a day of its dates).
  await run(ev, ["USMIFRQ2", "MI Qualifier 2", "2026-11-14", "2026-11-15", `https://www.youtube.com/watch?v=${PRACTICE}`]);
  await run(ev, ["USMIOTHER", "MI Other", "2026-11-14", "2026-11-14", null]);
  await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', '2026-11-14T13:00:00Z', '2026-11-14T22:00:00Z', 32400, 0, 'x')", [PRACTICE]);
  await run(`INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES (?, 2026, 'USMIOTHER', 'recording', '2026-11-14', NULL, 'UCx', 't', 'list', 'w', 'x', NULL)`, [OTHER]);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerCookie = await signIn("owner@example.com");
  otherCookie = await signIn("scout@example.com");
});
afterAll(() => {
  server?.close();
  if (saved === undefined) delete process.env.OWNER_EMAILS; else process.env.OWNER_EMAILS = saved;
});
beforeEach(() => { process.env.OWNER_EMAILS = "owner@example.com"; forgetRecordings(); forgetOfficial(); });

describe("the owner's recording controls", () => {
  it("are the owner's only", async () => {
    for (const [m, p, b] of [["GET", "", undefined], ["POST", "/add", { video: DAY1, day: "2026-11-14" }], ["POST", "/replace", { from: PRACTICE, video: DAY1, day: "2026-11-14" }], ["POST", "/remove", { videoId: PRACTICE }]] as const) {
      expect((await call(m, p, otherCookie, b)).status).toBe(403);
      expect((await call(m, p, "", b)).status).toBe(403);
    }
    expect(await played()).toEqual([PRACTICE]);
  });

  it("lists the event's days and what its player plays", async () => {
    const r = await call("GET", "", ownerCookie);
    expect(r.status).toBe(200);
    expect(r.json.days).toEqual(["2026-11-14", "2026-11-15"]);
    expect(r.json.videos).toEqual([{ videoId: PRACTICE, day: "2026-11-14", part: null, owner: false }]);
  });

  it("checks the video, the day and the event", async () => {
    expect((await call("POST", "/add", ownerCookie, { video: "not a video", day: "2026-11-15" })).json.error).toMatch(/YouTube/);
    expect((await call("POST", "/add", ownerCookie, { video: DAY2, day: "2026-11-20" })).json.error).toMatch(/USMIFRQ2's days/);
    // A day the player already has a video for is a Replace.
    expect((await call("POST", "/add", ownerCookie, { video: DAY1, day: "2026-11-14" })).json.error).toMatch(/replace it instead/);
    // A video another event's official list holds stays there.
    expect((await call("POST", "/add", ownerCookie, { video: OTHER, day: "2026-11-15" })).json.error).toMatch(/USMIOTHER/);
    expect((await call("POST", "/replace", ownerCookie, { from: PRACTICE, video: PRACTICE, day: "2026-11-14" })).status).toBe(400);
    const bad = await fetch(`${base}/api/owner/event-recordings/2026/NOPE/add`, { method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ video: DAY1, day: "2026-11-14" }) });
    expect(bad.status).toBe(400);
    expect(await played()).toEqual([PRACTICE]);
  });

  it("replaces a day's video, and the replaced one never comes back on the next automatic pass", async () => {
    const r = await call("POST", "/replace", ownerCookie, { from: PRACTICE, video: `https://youtu.be/${DAY1}`, day: "2026-11-14" });
    expect(r.status).toBe(200);
    expect(r.json.videos).toEqual([{ videoId: DAY1, day: "2026-11-14", part: null, owner: true }]);
    expect(r.json.removed).toEqual([{ videoId: PRACTICE, day: "2026-11-14" }]);
    expect(await played()).toEqual([DAY1]);
    // The next pass: FIRST still gives the practice link, every cache read again. The owner's choice still wins.
    forgetRecordings(); forgetOfficial();
    expect(await played()).toEqual([DAY1]);
    expect((await eventVideosByDay(2026, "USMIFRQ2")).map((v) => v.videoId)).toEqual([DAY1]);
    const audit = await all<{ action: string; details: string }>("SELECT action, details FROM owner_audit WHERE action LIKE 'eventRecording.%' ORDER BY id");
    expect(audit.at(-1)!.action).toBe("eventRecording.replace");
    expect(JSON.parse(audit.at(-1)!.details)).toMatchObject({ from: PRACTICE, videoId: DAY1, day: "2026-11-14" });
  });

  it("adds a recording for a day, and the event page's player plays it at once", async () => {
    const r = await call("POST", "/add", ownerCookie, { video: DAY2, day: "2026-11-15" });
    expect(r.status).toBe(200);
    expect(await played()).toEqual([DAY1, DAY2]);
    const page = await (await fetch(`${base}/api/events/2026/USMIFRQ2`)).json() as any;
    expect(page.event.stream.days.map((d: { videoId: string }) => d.videoId)).toEqual([DAY1, DAY2]);
  });

  it("removes one for good", async () => {
    const r = await call("POST", "/remove", ownerCookie, { videoId: DAY2 });
    expect(r.status).toBe(200);
    expect(await played()).toEqual([DAY1]);
    expect(r.json.removed.map((x: { videoId: string }) => x.videoId).sort()).toEqual([DAY2, PRACTICE].sort());
    expect((await all("SELECT 1 FROM owner_audit WHERE action = 'eventRecording.remove'")).length).toBe(1);
  });
});

describe("replacing one part of a day", () => {
  it("replaces that part only: the day's other part stays, and the new video takes the replaced one's part", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (2026, 'USMIPARTS', 'MI Parts', 'Qualifier', 'Detroit', 'MI', 'USA', '2026-11-14', '2026-11-14', 'America/Detroit', 0, 0, NULL, 'test')");
    const off = `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES (?, 2026, 'USMIPARTS', 'recording', '2026-11-14', ?, 'UCx', 't', 'list', 'w', 'x', NULL)`;
    await run(off, ["partOneAAAA", "Part 1"]);
    await run(off, ["partTwoBBBB", "Part 2"]);
    forgetOfficial(); forgetRecordings();
    const res = await fetch(`${base}/api/owner/event-recordings/2026/USMIPARTS/replace`, { method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ from: "partOneAAAA", video: "partOneNEWW", day: "2026-11-14" }) });
    expect(res.status).toBe(200);
    const r = (await seasonRecordings(2026)).get("USMIPARTS")!;
    expect([r, ...(r.more ?? [])].map((x) => [x.videoId, x.part ?? null]).sort()).toEqual([["partOneNEWW", "Part 1"], ["partTwoBBBB", "Part 2"]]);
    expect(await get("SELECT removed_at FROM official_videos WHERE video_id = 'partTwoBBBB'")).toEqual({ removed_at: null });
  });
});

describe("the owner's picks over automatic links", () => {
  const v = (videoId: string, start: string | null, day?: string): RecordingVideo => ({ videoId, meta: start ? { videoId, start } as RecordingVideo["meta"] : null, ...(day ? { day } : {}) });
  it("leave out what was removed, and keep only the owner's video on a day they picked", () => {
    const picks = { blocked: new Set(["gonegonegon"]), days: new Map([["2026-11-14", [{ videoId: DAY1, part: null }]]]), timezone: "America/Detroit" };
    const list = [v("gonegonegon", "2026-11-15T14:00:00Z"), v("autoSatAAAA", "2026-11-14T14:00:00Z"), v(DAY1, null, "2026-11-14"), v("autoSunBBBB", "2026-11-15T14:00:00Z"), v("untimedCCCC", null)];
    expect(picked(list, picks).map((x) => x.videoId)).toEqual([DAY1, "autoSunBBBB", "untimedCCCC"]);
    expect(picked(list, undefined)).toBe(list);
  });
  it("keep a day's other parts: a pick for one part leaves out only that part's other videos", () => {
    const picks = { blocked: new Set<string>(), days: new Map([["2026-11-14", [{ videoId: "pickPart1AA", part: "Part 1" }]]]), timezone: "America/Detroit" };
    const list = [v("pickPart1AA", null, "2026-11-14"), { ...v("oldPart1AAA", null, "2026-11-14"), part: "Part 1" }, { ...v("keptPart2AA", null, "2026-11-14"), part: "Part 2" }, v("autoWholeDA", "2026-11-14T14:00:00Z")];
    expect(picked(list, picks).map((x) => x.videoId)).toEqual(["pickPart1AA", "keptPart2AA", "autoWholeDA"]);
  });
  it("read a day at the venue (a broadcast after midnight UTC is still the evening before in Detroit)", () => {
    const picks = { blocked: new Set<string>(), days: new Map([["2026-11-14", [{ videoId: DAY1, part: null }]]]), timezone: "America/Detroit" };
    expect(picked([v("lateSatAAAA", "2026-11-15T02:00:00Z")], picks)).toEqual([]);
  });
});

describe("videoIdOf", () => {
  it("takes a link or a bare id", () => {
    expect(videoIdOf("qualDay1BBB")).toEqual({ ok: true, videoId: "qualDay1BBB" });
    expect(videoIdOf("https://www.youtube.com/watch?v=qualDay1BBB&t=5")).toEqual({ ok: true, videoId: "qualDay1BBB" });
    expect(videoIdOf("https://youtube.com/live/qualDay1BBB")).toEqual({ ok: true, videoId: "qualDay1BBB" });
    expect(videoIdOf("https://twitch.tv/x").ok).toBe(false);
    expect(videoIdOf(42).ok).toBe(false);
  });
});
