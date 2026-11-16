// Decisions from evidence (server/data/videoDecisions.ts): each lands the way an owner's decision does, decided_by
// "evidence" with its reason and evidence line; a link only on a free day of its event (or one held by a video YouTube
// no longer plays, which it replaces); a video already decided keeps that decision; the audit's finding is settled.
import { beforeAll, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../db";
import { VIDEO_DECISIONS, type VideoDecision } from "../data/videoDecisions";
import { applyVideoDecisions, decisionProblem, decisionWhy } from "./videoDecisions";
import { ownerOfficial } from "./officialWatch";

const CH = "UCKezDYNRPpAy2_1XRMBWKSw";
const apply = (list: VideoDecision[]) => applyVideoDecisions(() => {}, list, { again: true, now: Date.parse("2026-11-16T06:00:00Z"), lockWaitMs: 1000 });
const watch = (id: string) => get<any>("SELECT status, season, code, day, part, why, decided_by FROM official_watch WHERE video_id = ?", [id]);
const finding = (id: string) => get<any>("SELECT finding, finding_why, finding_by FROM official_audit_videos WHERE video_id = ?", [id]);

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'LeagueMeet', 'Columbia', 'MO', 'USA', ?, ?, 'America/Chicago', 0, 0, NULL, 'test')";
  await run(ev, [2026, "USMOBATTLE", "Battle Meet @ 10 AM", "2026-11-14", "2026-11-14"]);
  await run(ev, [2026, "USMOPIPER", "Piper Meet @ 8 AM", "2026-11-14", "2026-11-14"]);
  await run(ev, [2026, "USMOROLLA", "Rolla Meet @ 10 AM", "2026-11-14", "2026-11-14"]);
  const ov = "INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at) VALUES (?, 2026, ?, 'recording', '2026-11-14', NULL, ?, 'x', 'list', 'x', '2026-11-14T00:00:00Z')";
  // Battle's listed stream is gone from YouTube; Piper's plays.
  await run(ov, ["deadstream1", "USMOBATTLE", CH]);
  await run(ov, ["piperstream", "USMOPIPER", CH]);
  await run("INSERT INTO video_meta (video_id, status, checked_at) VALUES ('deadstream1', 'unavailable', 'x')");
  await run("INSERT INTO video_meta (video_id, status, start, checked_at) VALUES ('piperstream', 'ok', '2026-11-14T14:00:00Z', 'x')");
  // In the owner's review queue.
  const q = "INSERT INTO official_watch (video_id, channel_id, title, status, why, seen_at) VALUES (?, ?, ?, 'pending', ?, '2026-11-15T00:00:00Z')";
  await run(q, ["battlereupl", CH, "FTC STL North League Meet at Battle High School", "an upload, not a live broadcast"]);
  await run(q, ["councilmeet", CH, "Monroe County Legislature Regular Meeting", "an upload, not a live broadcast"]);
  await run(q, ["pipercopy01", CH, "Piper Meet (channel copy)", "an upload"]);
  // Decided by the owner already.
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, why, seen_at, decided_by) VALUES ('ownersaidno', ?, 'x', 'rejected', 'no', 'x', 'owner@example.test')", [CH]);
  // Channel-audit findings, with no queue row.
  const f = "INSERT INTO official_audit_videos (video_id, channel_id, title, published, start, duration, first_seen, last_seen, finding, found_at) VALUES (?, ?, ?, '2026-11-14T20:00:00Z', ?, 7200, 'x', 'x', 'open', 'x')";
  await run(f, ["rollalive01", CH, "FTC STL Mid League Rolla Meet", "2026-11-14T15:00:00Z"]);
  await run(f, ["frcoffseasn", CH, "Battle o' Baltimore — Day 1", "2026-11-14T13:00:00Z"]);
  // A finding the owner dismissed (no queue row).
  await run("INSERT INTO official_audit_videos (video_id, channel_id, title, published, start, duration, first_seen, last_seen, finding, finding_why, finding_by) VALUES ('ownerdismis', ?, 'FTC STL Mid League Rolla Meet replay', '2026-11-14T20:00:00Z', '2026-11-14T15:00:00Z', 7200, 'x', 'x', 'dismissed', 'a replay', 'owner@example.test')", [CH]);
});

const link = (videoId: string, code: string, extra: Partial<VideoDecision> = {}): VideoDecision =>
  ({ videoId, decision: "link", season: 2026, code, day: "2026-11-14", evidence: "frame: the overlay names it", ...extra });

describe("decisions from evidence", () => {
  it("links a re-upload in place of the day's video YouTube no longer plays, as an approval from evidence", async () => {
    const out = await apply([link("battlereupl", "USMOBATTLE", { replaces: "deadstream1" })]);
    expect(out).toMatchObject({ applied: 1, linked: 1 });
    expect(await watch("battlereupl")).toMatchObject({ status: "approved", code: "USMOBATTLE", day: "2026-11-14", decided_by: "evidence" });
    expect((await watch("battlereupl")).why).toBe("linked from evidence to 2026 USMOBATTLE 2026-11-14. Checked: frame: the overlay names it");
    expect(await get("SELECT source, removed_at FROM official_videos WHERE video_id = 'battlereupl'")).toMatchObject({ source: "evidence", removed_at: null });
    expect((await get<any>("SELECT removed_at FROM official_videos WHERE video_id = 'deadstream1'")).removed_at).toBeTruthy();
  });

  it("never links over a day a playable video holds", async () => {
    const out = await apply([link("pipercopy01", "USMOPIPER", { replaces: "piperstream" })]);
    expect(out!.skipped[0]).toMatch(/USMOPIPER already plays piperstream for 2026-11-14/);
    expect(await watch("pipercopy01")).toMatchObject({ status: "pending" });
    expect(await get("SELECT 1 FROM official_videos WHERE video_id = 'pipercopy01'")).toBeUndefined();
  });

  it("rejects and sets aside with the reason, leaving the review queue", async () => {
    const out = await apply([
      { videoId: "councilmeet", decision: "reject", reason: "a municipal meeting, not robotics", evidence: "title names the legislature" },
      { videoId: "pipercopy01", decision: "setAside", reason: "a second copy of the day piperstream plays", evidence: "same title" },
    ]);
    expect(out).toMatchObject({ applied: 2, rejected: 1, setAside: 1 });
    expect(await watch("councilmeet")).toMatchObject({ status: "rejected", decided_by: "evidence", why: "rejected from evidence: a municipal meeting, not robotics. Checked: title names the legislature" });
    expect((await watch("pipercopy01")).why).toMatch(/^set aside from evidence: a second copy/);
    const o = await ownerOfficial();
    expect(o.pending).toEqual([]);
    expect(o.decided.find((w) => w.videoId === "councilmeet")).toMatchObject({ decidedBy: "evidence", status: "rejected" });
  });

  it("decides an audit finding: a queue row from the audit's facts, and the finding settled", async () => {
    const out = await apply([
      link("rollalive01", "USMOROLLA"),
      { videoId: "frcoffseasn", decision: "reject", reason: "FRC, not FTC", evidence: "frame: REBUILT field" },
    ]);
    expect(out).toMatchObject({ applied: 2, linked: 1, rejected: 1 });
    expect(await watch("rollalive01")).toMatchObject({ status: "approved", code: "USMOROLLA", decided_by: "evidence" });
    expect(await finding("rollalive01")).toMatchObject({ finding: null });
    expect(await finding("frcoffseasn")).toMatchObject({ finding: "dismissed", finding_why: "FRC, not FTC", finding_by: "evidence" });
  });

  it("keeps what the owner decided, and waits for a video the audit hasn't read", async () => {
    const out = await apply([
      { videoId: "ownersaidno", decision: "setAside", reason: "x", evidence: "y" },
      { videoId: "notreadyet1", decision: "reject", reason: "x", evidence: "y" },
    ]);
    expect(out).toMatchObject({ applied: 0, kept: 1 });
    expect(await watch("ownersaidno")).toMatchObject({ status: "rejected", decided_by: "owner@example.test" });
    expect(await watch("notreadyet1")).toBeUndefined();
  });

  it("keeps a finding the owner dismissed: never linked over it", async () => {
    const out = await apply([link("ownerdismis", "USMOROLLA", { part: "Replay" })]);
    expect(out).toMatchObject({ applied: 0, kept: 1 });
    expect(await watch("ownerdismis")).toBeUndefined();
    expect(await get("SELECT 1 FROM official_videos WHERE video_id = 'ownerdismis'")).toBeUndefined();
    expect(await finding("ownerdismis")).toMatchObject({ finding: "dismissed", finding_by: "owner@example.test" });
  });

  it("applies once a process: a second pass does nothing", async () => {
    await apply([]);
    expect(await applyVideoDecisions(() => {}, [link("x2345678901", "USMOROLLA")])).toBeNull();
  });
});

describe("the shipped decisions", () => {
  it("are each complete, one per video, with no two links on one event's day and part", () => {
    for (const d of VIDEO_DECISIONS) expect([d.videoId, decisionProblem(d)]).toEqual([d.videoId, null]);
    expect(new Set(VIDEO_DECISIONS.map((d) => d.videoId)).size).toBe(VIDEO_DECISIONS.length);
    const slots = new Map<string, (string | null)[]>();
    for (const d of VIDEO_DECISIONS.filter((x) => x.decision === "link")) {
      const k = `${d.season}/${d.code}/${d.day}`;
      slots.set(k, [...(slots.get(k) ?? []), d.part ?? null]);
    }
    // Two videos of one day only when both name their part, and never the same part.
    for (const [k, parts] of slots) if (parts.length > 1) expect([k, parts.includes(null) || new Set(parts).size < parts.length]).toEqual([k, false]);
    // What the owner reads stays within its column.
    for (const d of VIDEO_DECISIONS) expect(decisionWhy(d).length).toBeLessThan(1000);
  });
});
