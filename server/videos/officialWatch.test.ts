// The auto-watcher end to end, against a fake YouTube (docs/official-videos.md): it reads only the watched channels'
// own uploads (never a search), only what was published since a channel was watched, each video once; a sure match
// is added, the rest wait for the owner or are set aside; the owner's approve, reject and remove are checked and
// audited; quota use and a quota stop are logged; a removed channel stays removed.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { OFFICIAL_CHANNELS } from "../data/officialChannels";
import { approveWatched, ownerOfficial, rejectWatched, removeChannel, removeOfficial, runOfficialWatch, saveChannel, seedOfficialChannels, watchIfDue } from "./officialWatch";

const TX = "UCKezDYNRPpAy2_1XRMBWKSw";
const T0 = Date.parse("2026-01-10T00:00:00Z");
const NOW = Date.parse("2026-01-20T00:00:00Z");
const FIRSTS = "firstlinkxx", ADD = "addaddaddad", REV = "revrevrevre", IGN = "ignignignig", OLD = "oldoldoldol", LIVE = "livelivelive".slice(0, 11), DUP = "dupdupdupdu";

type Item = { id: string; title: string; published: string; start?: string | null; minutes?: number; live?: string };
let uploads: Item[] = [];
let calls: string[] = [];
let playlists: string[] = [];
let quota = false;
const fakeFetch = (async (url: string) => {
  const u = new URL(url);
  calls.push(u.pathname.split("/").pop()!);
  expect(u.pathname).not.toMatch(/search/);
  const json = (b: unknown, status = 200) => ({ ok: status === 200, status, json: async () => b }) as Response;
  if (quota) return json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
  if (u.pathname.endsWith("/playlistItems")) {
    playlists.push(u.searchParams.get("playlistId")!);
    if (u.searchParams.get("playlistId") !== `UU${TX.slice(2)}`) return json({ items: [] });
    return json({ items: uploads.map((i) => ({ contentDetails: { videoId: i.id, videoPublishedAt: i.published } })) });
  }
  const ids = (u.searchParams.get("id") ?? "").split(",");
  return json({ items: uploads.filter((i) => ids.includes(i.id)).map((i) => ({
    id: i.id, snippet: { title: i.title, liveBroadcastContent: i.live ?? "none" },
    contentDetails: { duration: `PT${i.minutes ?? 360}M` }, status: { privacyStatus: "public", embeddable: true },
    ...(i.start === null ? {} : { liveStreamingDetails: { actualStartTime: i.start ?? i.published, actualEndTime: i.published } }),
  })) });
}) as unknown as typeof fetch;

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (2025, ?, ?, 'Qualifier', ?, 'TX', 'USA', ?, ?, 'America/Chicago', 0, 0, ?, 'test')";
  await run(ev, ["USTXMOQ", "TX Mockingbird Qualifier", "Austin", "2026-01-17", "2026-01-18", null]);
  await run(ev, ["USTXHOQ", "TX Houston Qualifier", "Houston", "2026-01-17", "2026-01-17", null]);
  // FIRST's link already covers Saturday here.
  await run(ev, ["USTXPEQ", "TX Pecan Qualifier", "Waco", "2026-01-17", "2026-01-17", "https://youtu.be/firstlinkxx"]);
  await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES ('firstlinkxx', 'ok', '2026-01-17T14:00:00Z', '2026-01-17T22:00:00Z', 28800, 0, 'x')");
  await seedOfficialChannels(T0, true);
});
beforeEach(() => { calls = []; playlists = []; quota = false; });

describe("the official-video watcher", () => {
  it("seeds the watchlist once; a removed channel never comes back", async () => {
    expect((await all("SELECT channel_id FROM official_channels")).length).toBe(OFFICIAL_CHANNELS.length);
    const vt = OFFICIAL_CHANNELS.find((c) => c.title === "FIRST in Vermont")!.channelId;
    expect((await removeChannel(vt, "owner@example.test", T0)).ok).toBe(true);
    expect(await seedOfficialChannels(T0, true)).toBe(0);
    expect((await get<{ removed_at: string | null }>("SELECT removed_at FROM official_channels WHERE channel_id = ?", [vt]))?.removed_at).toBeTruthy();
  });

  it("reads each watched channel's new uploads once: adds the sure one, queues the rest, sets aside the rest", async () => {
    uploads = [
      { id: ADD, title: "FiT Mockingbird Qualifier - Day 1", published: "2026-01-17T23:00:00Z", start: "2026-01-17T15:00:00Z" },
      { id: REV, title: "Mockingbird Qualifier Day 2", published: "2026-01-17T23:30:00Z", start: "2026-01-17T15:30:00Z" },
      { id: DUP, title: "FiT Pecan Qualifier", published: "2026-01-17T23:40:00Z", start: "2026-01-17T15:10:00Z" },
      { id: IGN, title: "Coach webinar: judging", published: "2026-01-16T20:00:00Z" },
      { id: LIVE, title: "FiT Houston Qualifier", published: "2026-01-17T15:00:00Z", live: "live" },
      { id: OLD, title: "FiT Mockingbird Qualifier 2025", published: "2025-12-01T00:00:00Z" },
      // FIRST's own link for the Pecan Qualifier, uploaded on the channel too.
      { id: FIRSTS, title: "FiT Pecan Qualifier - live", published: "2026-01-17T22:30:00Z", start: "2026-01-17T14:00:00Z" },
    ];
    const logs: string[] = [];
    const out = await runOfficialWatch((s) => logs.push(s), { apiKey: "k", fetchImpl: fakeFetch, now: () => NOW });
    // Journeys 23-26: the sure one added, the ambiguous one queued with why, duplicates logged, unwatched channels never read.
    expect(out).toMatchObject({ seen: 5, added: 1, queued: 1, duplicates: 2, error: null });
    const vt = OFFICIAL_CHANNELS.find((c) => c.title === "FIRST in Vermont")!.channelId;
    expect(playlists).not.toContain(`UU${vt.slice(2)}`);
    expect(playlists.every((p) => OFFICIAL_CHANNELS.some((c) => `UU${c.channelId.slice(2)}` === p))).toBe(true);
    // One uploads page per watched channel, and one videos call for this channel's new ones.
    expect(out!.units).toBe(OFFICIAL_CHANNELS.length - 1 + 1);
    expect(calls.filter((c) => c === "videos")).toHaveLength(1);
    const st = new Map((await all<{ video_id: string; status: string; why: string }>("SELECT video_id, status, why FROM official_watch")).map((r) => [r.video_id, r]));
    expect(st.get(ADD)?.status).toBe("added");
    expect(st.get(REV)?.status).toBe("pending");
    expect(st.get(REV)?.why).toMatch(/day 2/);
    expect(st.get(DUP)?.status).toBe("duplicate");
    expect(st.get(DUP)?.why).toMatch(/duplicate: USTXPEQ already plays firstlinkxx for 2026-01-17/);
    expect(st.get(FIRSTS)?.status).toBe("duplicate");
    expect(st.get(FIRSTS)?.why).toContain("already 2025 USTXPEQ's video (FIRST's event link)");
    expect(st.get(IGN)?.status).toBe("ignored");
    expect(st.has(OLD)).toBe(false); // published before the channel was watched
    expect(st.has(LIVE)).toBe(false); // still live: read once it's over
    const added = await get<any>("SELECT season, code, day, source FROM official_videos WHERE video_id = ?", [ADD]);
    expect(added).toMatchObject({ code: "USTXMOQ", day: "2026-01-17", source: "watcher" });
    expect(logs.at(-1)).toMatch(/1 added, 1 to review, 2 duplicates/);

    // Again: nothing is proposed twice; the live one, now over, is read.
    uploads = uploads.map((u) => (u.id === LIVE ? { ...u, live: "none", start: "2026-01-17T15:00:00Z" } : u));
    const again = await runOfficialWatch(() => {}, { apiKey: "k", fetchImpl: fakeFetch, now: () => NOW + 1000 });
    expect(again).toMatchObject({ seen: 1, added: 1 });
    expect((await get<any>("SELECT code FROM official_videos WHERE video_id = ?", [LIVE]))?.code).toBe("USTXHOQ");
  });

  it("the owner approves (checked) or rejects, each audited, and can take any official video off", async () => {
    // Outside the event's dates, or a day it already plays: refused.
    expect(await approveWatched(REV, { season: 2025, code: "USTXMOQ", day: "2026-01-19", kind: "recording" }, "owner@example.test")).toMatchObject({ ok: false, error: /runs 2026-01-17 to 2026-01-18/ });
    expect(await approveWatched(REV, { season: 2025, code: "USTXMOQ", day: "2026-01-17", kind: "recording" }, "owner@example.test")).toMatchObject({ ok: false, error: /already plays addaddaddad/ });
    expect(await approveWatched(REV, { season: 2025, code: "NOPE", day: "2026-01-17" }, "owner@example.test")).toMatchObject({ ok: false });
    expect((await approveWatched(REV, { season: 2025, code: "ustxmoq", day: "2026-01-18", kind: "recording" }, "owner@example.test")).ok).toBe(true);
    expect(await get<any>("SELECT code, day, source, added_by FROM official_videos WHERE video_id = ?", [REV])).toMatchObject({ code: "USTXMOQ", day: "2026-01-18", source: "owner", added_by: "owner@example.test" });
    expect((await approveWatched(REV, { season: 2025, code: "USTXMOQ", day: "2026-01-18" }, "owner@example.test")).ok).toBe(false); // decided already
    expect((await rejectWatched(DUP, "x", "owner@example.test")).ok).toBe(false); // a duplicate isn't in the queue
    // A set-aside video can still go on as a highlight.
    expect((await approveWatched(IGN, { season: 2025, code: "USTXMOQ", kind: "highlight" }, "owner@example.test")).ok).toBe(true);
    expect((await get<any>("SELECT kind, day FROM official_videos WHERE video_id = ?", [IGN]))).toMatchObject({ kind: "highlight", day: null });
    expect((await removeOfficial(ADD, "owner@example.test")).ok).toBe(true);
    expect((await get<any>("SELECT removed_at FROM official_videos WHERE video_id = ?", [ADD]))?.removed_at).toBeTruthy();
    const actions = (await all<{ action: string }>("SELECT action FROM owner_audit ORDER BY id")).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["officialVideo.approve", "officialVideo.remove", "officialChannel.remove"]));
    // Journey 27: a rejected video never comes back to the queue.
    const REJ = "rejrejrejre";
    uploads = [{ id: REJ, title: "Qualifier", published: "2026-01-18T23:00:00Z", start: "2026-01-18T15:00:00Z" }];
    await runOfficialWatch(() => {}, { apiKey: "k", fetchImpl: fakeFetch, now: () => NOW + 10_000 });
    expect((await get<any>("SELECT status FROM official_watch WHERE video_id = ?", [REJ]))?.status).toBe("pending");
    expect((await rejectWatched(REJ, "not sure which event", "owner@example.test")).ok).toBe(true);
    await runOfficialWatch(() => {}, { apiKey: "k", fetchImpl: fakeFetch, now: () => NOW + 20_000 });
    expect((await get<any>("SELECT status FROM official_watch WHERE video_id = ?", [REJ]))?.status).toBe("rejected");
    expect(await get<any>("SELECT 1 FROM official_videos WHERE video_id = ?", [REJ])).toBeUndefined();
    expect((await all<{ action: string }>("SELECT action FROM owner_audit WHERE action = 'officialVideo.reject'")).length).toBe(1);
    const o = await ownerOfficial(NOW);
    expect(o.pending).toHaveLength(0);
    expect(o.decided.map((w) => w.status)).toEqual(expect.arrayContaining(["approved", "rejected"]));
  });

  it("stops on YouTube's quota and logs it; without a key it doesn't run", async () => {
    quota = true;
    const out = await runOfficialWatch(() => {}, { apiKey: "k", fetchImpl: fakeFetch, now: () => NOW + 2000 });
    expect(out?.error).toMatch(/quota used up/);
    expect(calls).toHaveLength(1);
    const last = await get<any>("SELECT error, finished_at FROM official_watch_runs ORDER BY id DESC LIMIT 1");
    expect(last.error).toMatch(/quotaExceeded/);
    expect(last.finished_at).toBeTruthy();
    // Journey 28: the owner sees the last run, its error and the units used today.
    const o = await ownerOfficial(NOW + 2000);
    expect(o.runs[0].error).toMatch(/quota used up/);
    expect(o.unitsToday).toBeGreaterThan(0);
    expect(o.nextRunAt).toBeTruthy();
    expect(await runOfficialWatch(() => {}, { apiKey: null, fetchImpl: fakeFetch })).toBeNull();
    expect(await watchIfDue(() => {}, NOW + 3000)).toBeNull(); // no key in tests, and the last run was moments ago
  });

  it("checks a channel the owner adds or edits", async () => {
    expect(await saveChannel({ channelId: "nope", title: "x", region: "state=TX" }, "o")).toMatchObject({ ok: false, error: /starts with UC/ });
    expect(await saveChannel({ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "x", region: "planet=Mars" }, "o")).toMatchObject({ ok: false, error: /region rule/ });
    expect(await saveChannel({ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "x", region: "state=TX", titlePattern: "(" }, "o")).toMatchObject({ ok: false, error: /regular expression/ });
    expect((await saveChannel({ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "Test FTC", region: "state=TX" }, "o", NOW)).ok).toBe(true);
    expect((await saveChannel({ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "Test FTC", region: "state=OK" }, "o", NOW + 5)).ok).toBe(true);
    expect(await get<any>("SELECT region, watch_from FROM official_channels WHERE channel_id = 'UCaaaaaaaaaaaaaaaaaaaaaa'")).toMatchObject({ region: "state=OK", watch_from: new Date(NOW).toISOString() });
  });
});
