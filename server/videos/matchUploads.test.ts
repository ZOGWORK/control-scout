// Per-match uploads end to end (./matchUploads.ts, ./uploadClips.ts): the channel audit's short uploads are decided once
// each and written; an add plays as its match's clip only where nothing else clips the match; two uploads for one
// match wait for the owner; the owner's approve, reject and remove are checked and audited; a decided upload is never
// read again, an ignored recent one is.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { applyMatchUploads, approveMatchUpload, ownerMatchUploads, planMatchUploads, rejectMatchUpload, removeMatchUpload, runMatchUploads } from "./matchUploads";
import { loadMatchUploads, refreshMatchUploads, uploadClip, uploadMatches, withUploads } from "./uploadClips";

const CH = "UCaaaaaaaaaaaaaaaaaaaaaa";
const NOW = Date.parse("2025-02-10T00:00:00Z");
const upload = (id: string, title: string, o: { published?: string; duration?: number; privacy?: string; start?: string | null } = {}) =>
  run(`INSERT INTO official_audit_videos (video_id, channel_id, title, published, start, duration, privacy, embeddable, blocked_in, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 'x', 'x')`, [id, CH, title, o.published ?? "2025-02-04T20:00:00Z", o.start ?? null, o.duration ?? 190, o.privacy ?? "public"]);

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  await run("INSERT INTO official_channels (channel_id, title, region, words, watch_from, added_at) VALUES (?, 'FTC Ontario', 'country=Canada;state=ON', 'ontario canada', '2024-01-01', 'x')", [CH]);
  await run(`INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, source)
             VALUES (2024, 'CAONSCQ2', 'North Scarborough Qualifier', 'Qualifier', 'Scarborough', 'ON', 'Canada', '2025-01-25', '2025-01-25', 'America/Toronto', 0, 0, 'test')`);
  for (let q = 1; q <= 6; q++) {
    await run("INSERT INTO matches (season, code, level, series, number, label, description, time, played, source) VALUES (2024, 'CAONSCQ2', 'qual', 0, ?, ?, ?, ?, ?, 'test')",
      [q, `Q${q}`, `Qualification ${q}`, `2025-01-25T${String(9 + q).padStart(2, "0")}:00:00`, q === 6 ? 0 : 1]);
    for (const [i, t] of [10000 + q, 20000 + q, 30000 + q, 40000 + q].entries())
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (2024, 'CAONSCQ2', 'qual', 0, ?, ?, ?, ?)", [q, t, i < 2 ? "red" : "blue", (i % 2) + 1]);
  }
  await upload("uploadQ1aaa", "Qualification Match 1 - 2024 ONT North Scarborough Qualifier");
  await upload("uploadQ2aaa", "Qualification Match 2 - 2024 ONT North Scarborough Qualifier");
  // Two uploads of Q3 (a re-upload): the owner's to tell.
  await upload("uploadQ3aaa", "Qualification Match 3 - 2024 ONT North Scarborough Qualifier");
  await upload("uploadQ3bbb", "Qualification Match 3 - 2024 ONT North Scarborough Qualifier");
  // Q6 wasn't played; a bare "Match 4"; a day's recording; a webinar; an old ignored one; a recent ignored one.
  await upload("uploadQ6aaa", "Qualification Match 6 - 2024 ONT North Scarborough Qualifier");
  await upload("uploadM4aaa", "North Scarborough Qualifier - Match 4");
  await upload("fulldayaaaa", "2024 ONT North Scarborough Qualifier - full day", { duration: 8 * 3600 });
  await upload("webinaraaaa", "Coaches webinar - Q1 recap", { published: "2024-09-01T00:00:00Z" });
  await upload("recentaaaaa", "Qualification Match 5 - an event Scout hasn't heard of", { published: "2025-02-05T00:00:00Z" });
});
beforeEach(() => {});

describe("planMatchUploads + applyMatchUploads", () => {
  it("decides each short upload once: adds, set-asides for the owner, ignored ones kept with why", async () => {
    const plan = await planMatchUploads({ now: NOW });
    const kind = (id: string) => plan.find((p) => p.video.videoId === id)?.verdict.kind;
    expect(kind("uploadQ1aaa")).toBe("add");
    expect(kind("uploadQ2aaa")).toBe("add");
    expect(kind("uploadQ3aaa")).toBe("review");
    expect(kind("uploadQ3bbb")).toBe("review");
    expect(kind("uploadQ6aaa")).toBe("review");
    expect(kind("uploadM4aaa")).toBe("review");
    expect(kind("webinaraaaa")).toBe("ignore");
    // A day's recording is the watcher's, never read here.
    expect(kind("fulldayaaaa")).toBeUndefined();
    const logs: string[] = [];
    const n = await applyMatchUploads(plan, (s) => logs.push(s), NOW);
    expect(n).toEqual({ added: 2, review: 4, ignored: 2 });
    expect(logs[0]).toMatch(/2 added, 4 set aside/);
    const audit = await get<{ details: string }>("SELECT details FROM owner_audit WHERE actor = 'match uploads' AND action = 'matchUpload.add'");
    expect(JSON.parse(audit!.details)).toMatchObject({ count: 2 });
    expect(uploadClip(2024, "CAONSCQ2", "Q1")).toMatchObject({ videoId: "uploadQ1aaa", t: 0, end: 190 });
    expect(uploadMatches(2024).map((u) => `${u.code} ${u.label} ${u.level}:${u.series}:${u.number}`).sort()).toEqual(["CAONSCQ2 Q1 qual:0:1", "CAONSCQ2 Q2 qual:0:2"]);
  });

  it("never reads a decided upload again; an ignored one only while it's recent", async () => {
    const again = await planMatchUploads({ now: NOW });
    expect(again.map((p) => p.video.videoId)).toEqual(["recentaaaaa"]);
    expect((await planMatchUploads({ now: NOW + 60 * 864e5 })).length).toBe(0);
  });

  it("sets aside a new upload of a match an upload already plays", async () => {
    await upload("uploadQ1ccc", "Qualification Match 1 - 2024 ONT North Scarborough Qualifier - replay");
    const plan = await planMatchUploads({ now: NOW });
    expect(plan.find((p) => p.video.videoId === "uploadQ1ccc")?.verdict).toMatchObject({ kind: "review", why: expect.stringContaining("already plays another upload") });
  });
});

describe("withUploads", () => {
  it("fills only a played match nothing else clips, and leaves the given objects as they are", () => {
    const recording = { videoId: "recordingaa", t: 600, url: "u" };
    const ms = [{ label: "Q1", played: true, clip: recording }, { label: "Q2", played: true, clip: undefined }, { label: "Q3", played: true, clip: undefined }];
    const out = withUploads(ms, 2024, "CAONSCQ2");
    expect(out[0].clip).toBe(recording);
    expect(out[1].clip).toMatchObject({ videoId: "uploadQ2aaa", t: 0 });
    expect(out[2].clip).toBeUndefined();
    expect(ms[1].clip).toBeUndefined();
    // Nothing to lay over: the same array back.
    const none = [{ label: "Q9", played: true, clip: undefined }];
    expect(withUploads(none, 2024, "CAONSCQ2")).toBe(none);
  });
  it("plays only what the audit last read as public and on its channel", async () => {
    await run("UPDATE official_audit_videos SET privacy = 'private' WHERE video_id = 'uploadQ2aaa'");
    await loadMatchUploads();
    expect(uploadClip(2024, "CAONSCQ2", "Q2")).toBeNull();
    await run("UPDATE official_audit_videos SET privacy = 'public' WHERE video_id = 'uploadQ2aaa'");
    await loadMatchUploads();
    expect(uploadClip(2024, "CAONSCQ2", "Q2")).not.toBeNull();
  });
});

describe("refreshMatchUploads", () => {
  it("after an audit: an added upload it read as gone stops playing, and says so; nothing new says nothing", async () => {
    expect(await refreshMatchUploads()).toBe(false);
    await run("UPDATE official_audit_videos SET gone_at = 'x' WHERE video_id = 'uploadQ2aaa'");
    expect(await refreshMatchUploads()).toBe(true);
    expect(uploadClip(2024, "CAONSCQ2", "Q2")).toBeNull();
    expect(await refreshMatchUploads()).toBe(false);
    await run("UPDATE official_audit_videos SET gone_at = NULL WHERE video_id = 'uploadQ2aaa'");
    expect(await refreshMatchUploads()).toBe(true);
  });
});

describe("the owner's decisions", () => {
  it("approves a set-aside as the match it names or one typed, refuses an unplayed or taken match", async () => {
    expect((await ownerMatchUploads()).review.map((r) => r.videoId).sort()).toEqual(["uploadM4aaa", "uploadQ3aaa", "uploadQ3bbb", "uploadQ6aaa"]);
    expect(await approveMatchUpload("uploadQ6aaa", {}, "owner@example.test", NOW)).toMatchObject({ ok: false, error: expect.stringContaining("wasn't played") });
    expect(await approveMatchUpload("uploadM4aaa", { label: "Q1" }, "owner@example.test", NOW)).toMatchObject({ ok: false, status: 409 });
    expect(await approveMatchUpload("uploadM4aaa", { label: "q4" }, "owner@example.test", NOW)).toEqual({ ok: true });
    expect(uploadClip(2024, "CAONSCQ2", "Q4")).toMatchObject({ videoId: "uploadM4aaa" });
    expect(await approveMatchUpload("uploadQ3aaa", {}, "owner@example.test", NOW)).toEqual({ ok: true });
    expect(await rejectMatchUpload("uploadQ3bbb", "a re-upload", "owner@example.test", NOW)).toEqual({ ok: true });
    expect(await rejectMatchUpload("uploadQ3bbb", null, "owner@example.test", NOW)).toMatchObject({ ok: false, status: 404 });
    const acts = await all<{ action: string }>("SELECT action FROM owner_audit WHERE actor = 'owner@example.test' ORDER BY id");
    expect(acts.map((a) => a.action)).toEqual(["matchUpload.approve", "matchUpload.approve", "matchUpload.reject"]);
    expect((await ownerMatchUploads()).added).toBe(4);
  });
  it("takes an added upload off its match for good", async () => {
    expect(await removeMatchUpload("uploadQ1aaa", "owner@example.test", NOW)).toEqual({ ok: true });
    expect(uploadClip(2024, "CAONSCQ2", "Q1")).toBeNull();
    expect(await removeMatchUpload("uploadQ1aaa", "owner@example.test", NOW)).toMatchObject({ ok: false });
    // Never read again, so never added again.
    expect((await planMatchUploads({ now: NOW })).some((p) => p.video.videoId === "uploadQ1aaa")).toBe(false);
  });
});

describe("runMatchUploads", () => {
  it("writes under the data lease, and does nothing with nothing new", async () => {
    await runMatchUploads(() => {}, NOW);
    expect(await runMatchUploads(() => {}, NOW + 60 * 864e5)).toEqual({ added: 0, review: 0, ignored: 0, changed: false });
  });
  it("loads what plays again each run: an added upload the audit read as gone stops playing", async () => {
    await run("UPDATE official_audit_videos SET gone_at = 'x' WHERE video_id = 'uploadQ2aaa'");
    expect(await runMatchUploads(() => {}, NOW + 60 * 864e5)).toMatchObject({ added: 0, changed: true });
    expect(uploadClip(2024, "CAONSCQ2", "Q2")).toBeNull();
    await run("UPDATE official_audit_videos SET gone_at = NULL WHERE video_id = 'uploadQ2aaa'");
    expect(await runMatchUploads(() => {}, NOW + 60 * 864e5)).toMatchObject({ changed: true });
  });
  it("never lets a match hold two added uploads, whatever writes them", async () => {
    await expect(run(`INSERT INTO match_uploads (video_id, channel_id, title, season, code, level, series, number, label, t, status, why, seen_at)
      VALUES ('uploadQ2zzz', ?, 'x', 2024, 'CAONSCQ2', 'qual', 0, 2, 'Q2', 0, 'added', 'x', 'x')`, [CH])).rejects.toThrow(/UNIQUE/);
  });
});
