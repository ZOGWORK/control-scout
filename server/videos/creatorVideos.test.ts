// The creator-video intake end to end, against a fake YouTube (./creatorVideos.ts): FUN is seeded and read through its
// own uploads list and playlists (never a search), each video's series comes from its playlists, FTC teams are tagged
// with nobody confirming, a playlist that didn't change isn't read again, the 30-day refresh drops what YouTube no
// longer plays and re-derives what changed, a removed tag never comes back, and every owner action is audited.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { cachedTeamProfile } from "../api/teams";
import { addCreatorChannel, creatorIfDue, creatorVersion, creatorVideosFor, deactivateCreatorChannel, featuredFor, featuredTeamSet, ownerCreators, ownerTags, removeCreatorTag, retagAll, runCreatorIntake, SEED_CHANNELS } from "./creatorVideos";

const FUN = SEED_CHANNELS[0].channelId;
const UPLOADS = `UU${FUN.slice(2)}`;
const BTB = "PLbtbbtbbtbbtbbtbbtbbtbbtbbtbbtbbt", BUMPERS = "PLbumpersbumpersbumpersbumpersbump";
const T0 = Date.parse("2026-11-01T00:00:00Z");

type V = { id: string; title: string; description?: string; published: string; embeddable?: boolean; live?: string };
let videos: V[] = [];
let lists: Record<string, { title: string; etag: string; items: string[] }> = {};
let calls: string[] = [];
let quota = false;
const fakeFetch = (async (url: string) => {
  const u = new URL(url);
  const path = u.pathname.split("/").pop()!;
  calls.push(path === "playlistItems" ? `playlistItems:${u.searchParams.get("playlistId")}` : path);
  expect(u.pathname).not.toMatch(/search/);
  const json = (b: unknown, status = 200) => ({ ok: status === 200, status, json: async () => b }) as Response;
  if (quota) return json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
  if (path === "playlists") return json({ items: Object.entries(lists).map(([id, p]) => ({ id, etag: p.etag, snippet: { title: p.title } })) });
  if (path === "playlistItems") {
    const id = u.searchParams.get("playlistId")!;
    const all = id === UPLOADS ? [...videos].sort((a, b) => b.published.localeCompare(a.published)).map((v) => v.id) : lists[id]?.items ?? [];
    const page = Number(u.searchParams.get("pageToken") || 0);
    return json({ items: all.slice(page * 2, page * 2 + 2).map((v) => ({ contentDetails: { videoId: v } })), ...(all.length > (page + 1) * 2 ? { nextPageToken: String(page + 1) } : {}) });
  }
  if (path === "videos") {
    const ids = (u.searchParams.get("id") ?? "").split(",");
    return json({ items: videos.filter((v) => ids.includes(v.id)).map((v) => ({
      id: v.id, snippet: { title: v.title, description: v.description ?? "", publishedAt: v.published, liveBroadcastContent: v.live ?? "none" },
      contentDetails: { duration: "PT9M30S" }, status: { privacyStatus: "public", embeddable: v.embeddable !== false },
    })) });
  }
  if (path === "channels") return json({ items: [{ id: "UCabcdefghijklmnopqrstuv", snippet: { title: "Another Creator", customUrl: "@another" }, contentDetails: { relatedPlaylists: { uploads: "UUabcdefghijklmnopqrstuv" } } }] });
  return json({}, 404);
}) as unknown as typeof fetch;

const opts = (now: number) => ({ apiKey: "test-key", fetchImpl: fakeFetch, now: () => now, lockWaitMs: 0 });
const logs: string[] = [];
const log = (s: string) => { logs.push(s); };

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const team = "INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'MI', 'USA')";
  for (const [n, name] of [[21229, "Quality Control"], [13684, "Infinity Tech"], [118, "Steel Hornets"], [16010, "CRAB"], [7777, "Lucky Sevens"]] as const) await run(team, [n, name]);
  for (const n of [21229, 13684, 118, 16010, 7777]) for (const s of [2025, 2026]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
  videos = [
    { id: "qcqcqcqcqc1", title: "21229 Quality Control | Behind the Bot | FTC BIOBUZZ Robot", description: "Ranked 1st, over 400 teams, #1 OPR", published: "2026-11-20T15:00:00Z" },
    { id: "ititititit1", title: "13684 Infinity Tech | Behind the Bot | FTC BIOBUZZ Robot", description: "Team 13684 won. They beat Team 7777 in the final.", published: "2026-11-18T15:00:00Z" },
    { id: "frcfrcfrc11", title: "118 Robonauts | Behind the Bumpers | FRC REBUILT Robot", published: "2026-04-10T15:00:00Z" },
    { id: "crabcrabcr1", title: "16010 Astra Machina | Behind the Bot | FTC BIOBUZZ Robot", published: "2026-11-10T15:00:00Z" },
    { id: "noembednoe1", title: "Turret | 7777 Lucky Sevens | FTC BIOBUZZ Snapshot", published: "2026-11-05T15:00:00Z", embeddable: false },
  ];
  lists = {
    [BTB]: { title: "Behind the Bot (FTC)", etag: "e1", items: ["qcqcqcqcqc1", "ititititit1", "crabcrabcr1"] },
    [BUMPERS]: { title: "Behind the Bumpers (FRC)", etag: "e1", items: ["frcfrcfrc11"] },
  };
});
beforeEach(() => { calls = []; quota = false; });

describe("the creator-video intake", () => {
  it("seeds FUN and backfills it from its uploads and playlists, tagging FTC teams with no one confirming", async () => {
    const out = await runCreatorIntake(log, opts(T0));
    expect(out).toMatchObject({ channels: 1, seen: 4, error: null });
    expect(calls).not.toContain("search");
    expect(calls).toContain(`playlistItems:${UPLOADS}`);
    expect(await get("SELECT channel_id, handle, uploads_playlist, active, added_by FROM creator_channels")).toEqual({ channel_id: FUN, handle: "@funroboticsnetwork", uploads_playlist: UPLOADS, active: 1, added_by: "seed" });
    const rows = await all<any>("SELECT video_id, series, program, season, playlist_ids FROM creator_videos ORDER BY video_id");
    expect(rows.map((r) => [r.video_id, r.series, r.program, r.season])).toEqual([
      ["crabcrabcr1", "behind-the-bot", "ftc", 2026],
      ["frcfrcfrc11", null, "frc", 2025],
      ["ititititit1", "behind-the-bot", "ftc", 2026],
      ["qcqcqcqcqc1", "behind-the-bot", "ftc", 2026],
    ]);
    // Not embeddable: never stored.
    expect(rows.find((r) => r.video_id === "noembednoe1")).toBeUndefined();
    expect(await all("SELECT video_id, team_number, rule FROM video_team_tags ORDER BY video_id, team_number")).toEqual([
      { video_id: "ititititit1", team_number: 7777, rule: "description:cue" },
      { video_id: "ititititit1", team_number: 13684, rule: "title:bare-name" },
      { video_id: "qcqcqcqcqc1", team_number: 21229, rule: "title:bare-name" },
    ]);
    const r = await get<any>("SELECT units, seen, tagged, finished_at, error FROM creator_runs ORDER BY id DESC LIMIT 1");
    expect(r).toMatchObject({ units: out!.units, seen: 4, tagged: 3, error: null });
    expect(r.finished_at).toBeTruthy();
    expect(logs.at(-1)).toMatch(/creator videos: 1 channel \(\d+ units\): 4 new/);
  });

  it("shows the badge's teams: titles only, Behind the Bot only", async () => {
    expect([...(await featuredTeamSet())].sort()).toEqual([13684, 21229]);
    expect(await featuredFor(21229)).toEqual([{ series: "behind-the-bot", videoId: "qcqcqcqcqc1", season: 2026, title: "21229 Quality Control | Behind the Bot | FTC BIOBUZZ Robot" }]);
    // Named in a description only: tagged, but not featured.
    expect(await featuredFor(7777)).toEqual([]);
    expect(await featuredFor(118)).toEqual([]);
    const vids = await creatorVideosFor({ teams: [7777], limit: 10 });
    expect(vids.map((v) => [v.videoId, v.teams])).toEqual([["ititititit1", [7777, 13684]]]);
    expect((await creatorVideosFor({ series: "behind-the-bot", limit: 2 })).map((v) => v.videoId)).toEqual(["qcqcqcqcqc1", "ititititit1"]);
    expect((await creatorVideosFor({ since: "2026-11-15T00:00:00Z", limit: 10 })).map((v) => v.videoId)).toEqual(["qcqcqcqcqc1", "ititititit1"]);
    expect(await creatorVideosFor({ teams: [], limit: 10 })).toEqual([]);
  });

  it("reads only what's new next time, and no playlist that didn't change", async () => {
    videos.push({ id: "newnewnewn1", title: "21229 Quality Control shows its intake | FTC BIOBUZZ Snapshot", published: "2026-11-25T15:00:00Z" });
    lists[BTB].etag = "e1"; // unchanged
    const out = await runCreatorIntake(log, opts(T0 + 13 * 3600_000));
    expect(out).toMatchObject({ seen: 1, error: null });
    expect(calls.filter((c) => c.startsWith("playlistItems:PL"))).toEqual([]);
    // One page of uploads: it holds a stored video, so reading stops.
    expect(calls.filter((c) => c === `playlistItems:${UPLOADS}`)).toHaveLength(1);
    expect(await get("SELECT team_number, rule FROM video_team_tags WHERE video_id = 'newnewnewn1'")).toEqual({ team_number: 21229, rule: "title:bare-name" });
  });

  it("refreshes within 30 days: drops what YouTube no longer plays, re-derives a changed title", async () => {
    // Deleted, and made non-embeddable; the other's title fixed to name another team.
    videos = videos.filter((v) => v.id !== "frcfrcfrc11");
    videos.find((v) => v.id === "crabcrabcr1")!.embeddable = false;
    videos.find((v) => v.id === "ititititit1")!.title = "Infinity Tech's intake | Behind the Bot | FTC BIOBUZZ Robot";
    const out = await runCreatorIntake(log, opts(T0 + 27 * 864e5));
    expect(out).toMatchObject({ dropped: 2, error: null });
    expect(out!.refreshed).toBeGreaterThanOrEqual(3);
    expect((await all<any>("SELECT video_id FROM creator_videos ORDER BY video_id")).map((r) => r.video_id)).toEqual(["ititititit1", "newnewnewn1", "qcqcqcqcqc1"]);
    // The title lost its number: 13684 is now named in the description only (a cue), so no longer featured.
    expect(await get("SELECT rule FROM video_team_tags WHERE video_id = 'ititititit1' AND team_number = 13684")).toEqual({ rule: "description:cue" });
    expect(await featuredFor(13684)).toEqual([]);
    const fresh = await get<{ n: number }>("SELECT COUNT(*) n FROM creator_videos WHERE last_refreshed < ?", [new Date(T0 + 864e5).toISOString()]);
    expect(fresh?.n).toBe(0);
  });

  it("takes a removed tag off for good, audited, and off the cached team page at once", async () => {
    const before = await creatorVersion();
    expect((await cachedTeamProfile(21229))?.featured?.map((f) => f.videoId)).toEqual(["newnewnewn1", "qcqcqcqcqc1"]);
    expect(await removeCreatorTag("qcqcqcqcqc1", 21229, "owner@example.test", T0)).toEqual({ ok: true });
    expect(await creatorVersion()).not.toBe(before);
    expect((await cachedTeamProfile(21229))?.featured?.map((f) => f.videoId)).toEqual(["newnewnewn1"]);
    expect(await removeCreatorTag("qcqcqcqcqc1", 21229, "owner@example.test", T0)).toMatchObject({ ok: false });
    expect(await get("SELECT removed_by FROM video_tag_removals WHERE video_id = 'qcqcqcqcqc1'")).toEqual({ removed_by: "owner" });
    expect(await get("SELECT action, actor FROM owner_audit WHERE action = 'creatorTag.remove'")).toEqual({ action: "creatorTag.remove", actor: "owner@example.test" });
    await runCreatorIntake(log, opts(T0 + 30 * 864e5));
    expect(await get("SELECT 1 x FROM video_team_tags WHERE video_id = 'qcqcqcqcqc1' AND team_number = 21229")).toBeUndefined();
    // Its other video still features it.
    expect((await featuredFor(21229)).map((f) => f.videoId)).toEqual(["newnewnewn1"]);
    expect((await ownerTags({ team: 21229 })).map((t) => t.videoId)).toEqual(["newnewnewn1"]);
  });

  it("never writes a tag back over a removal made while a run was deriving", async () => {
    await run("DELETE FROM video_team_tags WHERE video_id = 'newnewnewn1'");
    const look = { team: () => ({ name: "Quality Control" }), active: () => true, named: () => [] };
    // The removal lands after the run read the removals, just before its write.
    let first = true;
    const locked = async <T,>(fn: () => Promise<T>) => {
      if (first) { first = false; await run("INSERT INTO video_tag_removals (video_id, team_number, removed_by, removed_at) VALUES ('newnewnewn1', 21229, 'owner', 'x')"); }
      return fn();
    };
    await retagAll({ locked }, look);
    expect(await get("SELECT 1 x FROM video_team_tags WHERE video_id = 'newnewnewn1' AND team_number = 21229")).toBeUndefined();
    // Without the removal it's derived again.
    await run("DELETE FROM video_tag_removals WHERE video_id = 'newnewnewn1'");
    await retagAll({ locked: (fn) => fn() }, look);
    expect(await get("SELECT rule FROM video_team_tags WHERE video_id = 'newnewnewn1' AND team_number = 21229")).toEqual({ rule: "title:bare-name" });
  });

  it("moves the version when a retag fails partway, so cached team pages show what was written", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `bulk${String(i).padStart(7, "0")}`);
    for (const id of ids) await run("INSERT INTO creator_videos (video_id, channel_id, title, published_at, program, last_refreshed) VALUES (?, ?, 'FTC Team 7777 clip', '2026-11-01T00:00:00Z', 'unknown', 'x')", [id, FUN]);
    const before = await creatorVersion();
    let calls = 0;
    const locked = async <T,>(fn: () => Promise<T>) => { if (++calls === 2) throw new Error("database busy"); return fn(); };
    await expect(retagAll({ locked }, { team: () => ({ name: "Lucky Sevens" }), active: () => true, named: () => [] })).rejects.toThrow(/busy/);
    expect(await creatorVersion()).not.toBe(before);
    await run(`DELETE FROM video_team_tags WHERE video_id LIKE 'bulk%'`);
    await run(`DELETE FROM creator_videos WHERE video_id LIKE 'bulk%'`);
  });

  it("adds and deactivates channels, each audited; a deactivated channel isn't read", async () => {
    expect(await addCreatorChannel("not a channel", "owner@example.test", { apiKey: "test-key", fetchImpl: fakeFetch })).toMatchObject({ ok: false });
    expect(await addCreatorChannel("https://www.youtube.com/@another", "owner@example.test", { apiKey: "test-key", fetchImpl: fakeFetch })).toEqual({ ok: true, channelId: "UCabcdefghijklmnopqrstuv" });
    expect(await get("SELECT title, handle, uploads_playlist, added_by FROM creator_channels WHERE channel_id = 'UCabcdefghijklmnopqrstuv'")).toEqual({ title: "Another Creator", handle: "@another", uploads_playlist: "UUabcdefghijklmnopqrstuv", added_by: "owner" });
    expect(await deactivateCreatorChannel("UCabcdefghijklmnopqrstuv", "owner@example.test")).toEqual({ ok: true });
    expect(await deactivateCreatorChannel("UCabcdefghijklmnopqrstuv", "owner@example.test")).toMatchObject({ ok: false });
    expect((await all<any>("SELECT action FROM owner_audit WHERE action LIKE 'creatorChannel.%' ORDER BY id")).map((r) => r.action)).toEqual(["creatorChannel.add", "creatorChannel.deactivate"]);
    // Added again with no API key (by its id): it stays named as it was, not renamed to its id.
    expect(await addCreatorChannel(FUN, "owner@example.test", { apiKey: null })).toEqual({ ok: true, channelId: FUN });
    expect(await get("SELECT title, active FROM creator_channels WHERE channel_id = ?", [FUN])).toEqual({ title: "FUN Robotics Network", active: 1 });
    await runCreatorIntake(log, opts(T0 + 31 * 864e5));
    expect(calls).not.toContain("playlistItems:UUabcdefghijklmnopqrstuv");
    const o = await ownerCreators();
    expect(o.channels.map((c) => [c.title, c.active])).toEqual([["FUN Robotics Network", true], ["Another Creator", false]]);
    expect(o.runs.length).toBeGreaterThan(0);
  });

  it("reads a channel turned back on down to its stored videos, so what it posted while off isn't skipped", async () => {
    const at = "2026-11-01T00:00:00.000Z";
    await run("UPDATE creator_channels SET checked_at = ? WHERE channel_id = ?", [at, FUN]);
    // Re-added while still watched: it stays caught up.
    expect(await addCreatorChannel(FUN, "owner@example.test", { apiKey: null })).toEqual({ ok: true, channelId: FUN });
    expect(await get("SELECT checked_at FROM creator_channels WHERE channel_id = ?", [FUN])).toEqual({ checked_at: at });
    // Turned off, then on: the next run reads past the first page.
    expect(await deactivateCreatorChannel(FUN, "owner@example.test")).toEqual({ ok: true });
    expect(await addCreatorChannel(FUN, "owner@example.test", { apiKey: null })).toEqual({ ok: true, channelId: FUN });
    expect(await get("SELECT checked_at, active FROM creator_channels WHERE channel_id = ?", [FUN])).toEqual({ checked_at: null, active: 1 });
  });

  it("stops on a used-up quota, keeps what it read, and waits 4 hours between scheduled runs", async () => {
    quota = true;
    const out = await runCreatorIntake(log, opts(T0 + 32 * 864e5));
    expect(out?.error).toMatch(/quota/);
    expect((await all("SELECT video_id FROM creator_videos")).length).toBe(3);
    quota = false;
    const last = Date.parse((await get<{ started_at: string }>("SELECT started_at FROM creator_runs ORDER BY id DESC LIMIT 1"))!.started_at);
    expect(await creatorIfDue(log, last + 3600_000, { apiKey: "test-key", fetchImpl: fakeFetch, lockWaitMs: 0 })).toBeNull();
    expect(await creatorIfDue(log, last + 5 * 3600_000, { ...opts(last + 5 * 3600_000) })).not.toBeNull();
    expect(await runCreatorIntake(log, { apiKey: null })).toBeNull();
  });

  it("gives a video stored after its playlist was read that playlist's series, the playlist unchanged", async () => {
    // A premiere: in the Behind the Bot playlist (read now, its etag new) but upcoming, so not stored this run.
    videos.push({ id: "premiere001", title: "13684 Infinity Tech | Behind the Bot | FTC BIOBUZZ Robot", published: "2026-12-20T15:00:00Z", live: "upcoming" });
    lists[BTB] = { ...lists[BTB], etag: "e2", items: [...lists[BTB].items, "premiere001"] };
    await runCreatorIntake(log, opts(T0 + 50 * 864e5));
    expect(await get("SELECT 1 x FROM creator_videos WHERE video_id = 'premiere001'")).toBeUndefined();
    // It aired; the playlist didn't change, so it isn't read again.
    videos.find((v) => v.id === "premiere001")!.live = "none";
    calls = [];
    await runCreatorIntake(log, opts(T0 + 51 * 864e5));
    expect(calls).not.toContain(`playlistItems:${BTB}`);
    expect(await get("SELECT series, playlist_ids FROM creator_videos WHERE video_id = 'premiere001'")).toEqual({ series: "behind-the-bot", playlist_ids: JSON.stringify([BTB]) });
    expect((await featuredFor(13684)).map((f) => f.videoId)).toContain("premiere001");
  });

  it("reads past stored uploads after a run cut short, so none under them is skipped for good", async () => {
    // 60 new uploads: the first videos.list (the newest 50) is stored, the second fails.
    const ids = Array.from({ length: 60 }, (_, i) => `cut${String(i).padStart(8, "0")}`);
    ids.forEach((id, i) => videos.push({ id, title: `Robot ${i} | FTC BIOBUZZ`, published: new Date(Date.parse("2027-03-01T00:00:00Z") - i * 3600_000).toISOString() }));
    let n = 0;
    const cut = (async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname.endsWith("/videos") && ++n === 2) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return fakeFetch(url, init);
    }) as typeof fetch;
    await runCreatorIntake(log, { ...opts(T0 + 52 * 864e5), fetchImpl: cut });
    const stored = async () => Number((await get<{ n: number }>("SELECT COUNT(*) n FROM creator_videos WHERE video_id LIKE 'cut%'"))?.n);
    expect(await stored()).toBe(50);
    expect(await get("SELECT checked_at FROM creator_channels WHERE channel_id = ?", [FUN])).toEqual({ checked_at: null });
    // Next run: the newest page is all stored, yet the 10 under it are read.
    await runCreatorIntake(log, opts(T0 + 53 * 864e5));
    expect(await stored()).toBe(60);
    expect((await get<any>("SELECT checked_at FROM creator_channels WHERE channel_id = ?", [FUN]))?.checked_at).toBeTruthy();
  });

  it("keeps refreshing a deactivated channel's videos, and drops the ones YouTube no longer plays", async () => {
    await run("UPDATE creator_channels SET active = 0 WHERE channel_id = ?", [FUN]);
    videos = videos.filter((v) => v.id !== "cut00000059");
    calls = [];
    await runCreatorIntake(log, opts(T0 + 90 * 864e5));
    expect(calls).not.toContain(`playlistItems:${UPLOADS}`);
    expect(calls).toContain("videos");
    expect(await get("SELECT 1 x FROM creator_videos WHERE video_id = 'cut00000059'")).toBeUndefined();
    expect((await get<any>("SELECT COUNT(*) n FROM creator_videos WHERE last_refreshed < ?", [new Date(T0 + 80 * 864e5).toISOString()]))?.n).toBe(0);
  });
});
