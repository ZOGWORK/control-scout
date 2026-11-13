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
    expect(await approveWatched(REV, { season: 2025, code: "USTXMOQ", day: "2026-01-18" }, "owner@example.test")).toMatchObject({ ok: false }); // decided already
    // Two approvals of one day at once: the second can't land (the unique day index under the same write).
    await run("INSERT INTO official_watch (video_id, channel_id, title, status, why, seen_at) VALUES ('raceraceRAC', ?, 't', 'pending', 'x', 'x')", [TX]);
    await expect(run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, added_at) VALUES ('raceraceRA2', 2025, 'USTXMOQ', 'recording', '2026-01-18', NULL, ?, 't', 'owner', 'x')", [TX])).rejects.toThrow(/UNIQUE/);
    const raced = await approveWatched("raceraceRAC", { season: 2025, code: "USTXMOQ", day: "2026-01-18", kind: "recording" }, "owner@example.test");
    expect(raced.ok).toBe(false);
    expect((await get<any>("SELECT status FROM official_watch WHERE video_id = 'raceraceRAC'"))?.status).toBe("pending");
    expect((await rejectWatched("raceraceRAC", "same day", "owner@example.test")).ok).toBe(true);
    // A rejection can't overwrite a decision that landed first.
    expect(await rejectWatched("raceraceRAC", "again", "owner@example.test")).toMatchObject({ ok: false });
    expect(await rejectWatched(REV, "late", "owner@example.test")).toMatchObject({ ok: false });
    expect((await get<any>("SELECT status FROM official_watch WHERE video_id = ?", [REV]))?.status).toBe("approved");
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
    expect((await all<{ action: string }>("SELECT action FROM owner_audit WHERE action = 'officialVideo.reject'")).length).toBe(2);
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
    // A run that can't even start (its log row fails) leaves the watcher free for the next one.
    await run("ALTER TABLE official_watch_runs RENAME TO official_watch_runs_away");
    await expect(runOfficialWatch(() => {}, { apiKey: "k", fetchImpl: fakeFetch, now: () => NOW + 2500 })).rejects.toThrow();
    await run("ALTER TABLE official_watch_runs_away RENAME TO official_watch_runs");
    quota = false;
    expect(await runOfficialWatch(() => {}, { apiKey: "k", fetchImpl: fakeFetch, now: () => NOW + 2600 })).not.toBeNull();
    expect(await watchIfDue(() => {}, NOW + 3000)).toBeNull(); // no key in tests, and the last run was moments ago
  });

  it("waits out a busy database: no run while the sync holds the lease, a busy stop is tried again in 30 minutes", async () => {
    const T = NOW + 10 * 3600_000;
    const opts = (at: number, f: typeof fetch = fakeFetch) => ({ apiKey: "k", fetchImpl: f, clock: () => at, now: () => at, lockWaitMs: 0 });
    const lease = () => run("INSERT INTO kv (key, value, updated_at) VALUES ('lock:data-writer', ?, 'x') ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify({ token: "t", what: "cycle", until: Date.now() + 60_000 })]);
    // The data sync holds the writer lease: the watcher doesn't start (no run row, nothing read).
    await lease();
    const before = (await all("SELECT id FROM official_watch_runs")).length;
    expect(await watchIfDue(() => {}, T, opts(T))).toBeNull();
    expect(calls).toHaveLength(0);
    expect((await all("SELECT id FROM official_watch_runs")).length).toBe(before);
    await run("DELETE FROM kv WHERE key = 'lock:data-writer'");
    // The sync takes the lease after the run started: the run's writes wait for it, and stop as busy (nothing is
    // written while the sync holds it; the run isn't closed, so it doesn't count).
    const seenBefore = (await all("SELECT video_id FROM official_watch")).length;
    uploads = [{ id: "leaseleasel", title: "FIRST in Texas - Mockingbird Qualifier", published: "2026-01-17T23:00:00Z", start: "2026-01-17T14:00:00Z" }];
    const takeLease = (async (url: string) => { await lease(); return fakeFetch(url); }) as unknown as typeof fetch;
    const raced = await watchIfDue(() => {}, T, opts(T, takeLease));
    expect(raced?.error).toMatch(/database busy/);
    expect((await all("SELECT video_id FROM official_watch")).length).toBe(seenBefore);
    expect(await get<any>("SELECT finished_at FROM official_watch_runs ORDER BY id DESC LIMIT 1")).toMatchObject({ finished_at: null });
    await run("DELETE FROM kv WHERE key = 'lock:data-writer'");
    uploads = [];
    // A write that waits out the busy timeout stops the run as busy (not as the channel's own error)...
    const busyFetch = (async () => { throw Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" }); }) as unknown as typeof fetch;
    // (26 minutes on: the raced run above is unfinished, and blocks a start until then, like another process's run.)
    const S = T + 26 * 60_000;
    const stopped = await watchIfDue(() => {}, S, opts(S, busyFetch));
    expect(stopped?.error).toMatch(/database busy/);
    expect(await get<any>("SELECT COUNT(*) AS n FROM official_channels WHERE last_error LIKE '%SQLITE_BUSY%'")).toMatchObject({ n: 0 });
    // ...and doesn't count as the 6-hourly run: the next check, 30 minutes on, runs.
    const again = await watchIfDue(() => {}, S + 30 * 60_000, opts(S + 30 * 60_000));
    expect(again?.error).toBeNull();
    // A run that finished does count: the next check waits.
    expect(await watchIfDue(() => {}, S + 60 * 60_000, opts(S + 60 * 60_000))).toBeNull();
    expect((await ownerOfficial(S + 60 * 60_000)).nextRunAt).toBe(new Date(S + 30 * 60_000 + 6 * 3600_000).toISOString());
    // Two starts at once (a scheduled check and Run now): only one runs.
    const both = await Promise.all([runOfficialWatch(() => {}, opts(S + 61 * 60_000)), runOfficialWatch(() => {}, opts(S + 61 * 60_000))]);
    expect(both.filter((x) => x === null)).toHaveLength(1);
    // Another process's run: one still going (unfinished, minutes old) blocks a start here; one that died long ago doesn't.
    const T2 = T + 3 * 3600_000;
    await run("INSERT INTO official_watch_runs (started_at) VALUES (?)", [new Date(T2 - 60_000).toISOString()]);
    expect(await runOfficialWatch(() => {}, opts(T2))).toBeNull();
    expect(await runOfficialWatch(() => {}, opts(T2 + 26 * 60_000))).not.toBeNull();
    // A scheduled check re-checks the 6-hour wait as it claims the run (another process may have just run).
    expect(await runOfficialWatch(() => {}, { ...opts(T2 + 60 * 60_000), scheduled: true })).toBeNull();
    expect(await runOfficialWatch(() => {}, { ...opts(T2 + 7 * 3600_000), scheduled: true })).not.toBeNull();
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
