// A linked recording checked again against YouTube's facts and its title today (./linkCheck.ts). The case behind it:
// FIRST in Missouri's qM3qo5rrmyc, listed for Camdenton Meet #1 (Nov 14) while still to come, never aired that day
// and became the channel's "Southwest League Meet #2 … November 21" stream.
import { beforeAll, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { dropWrongLinks, findWrongLinks, freeLinks, linkWrong, meetNumbers } from "./linkCheck";
import { seedOfficialVideos } from "./officialVideos";

const MO = "UCoo2NYUOcTUZB65dGMAp1vg";
const NOW = Date.parse("2026-11-17T14:00:00Z");

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  const ev = "INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, remote, hybrid, livestream, source) VALUES (2026, ?, ?, 'LeagueMeet', 'Springfield', 'MO', 'USA', ?, ?, 'America/Chicago', 0, 0, NULL, 'test')";
  await run(ev, ["USMOKSSWM1", "Camdenton Meet #1  @ 10 AM", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMOKSSTLMM1", "STL Mid League Rolla Meet #1", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMOTODAY", "Today Meet #3", "2026-11-17", "2026-11-17"]);
  await run(ev, ["USMOOWNER", "Owner Meet #1", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMOSTALE", "Stale Meet #1", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMOKSSWM2", "Southwest League Meet #2", "2026-11-21", "2026-11-21"]);
  await run(ev, ["USMOPOST", "Postponed Meet #1", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMORACE", "Race Meet #1", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMOREMOVE", "Removed Meet #1", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMOTZKEEP", "TZ Keep Meet #1", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMOTZDROP", "TZ Drop Meet #1", "2026-11-14", "2026-11-14"]);
  await run(ev, ["USMOFAIL", "Fail Meet #1", "2026-11-14", "2026-11-14"]);
  // Each played on its day but the postponed one (its FIRST dates not moved yet).
  for (const code of ["USMOKSSWM1", "USMOKSSTLMM1", "USMOOWNER", "USMOSTALE", "USMORACE", "USMOREMOVE", "USMOTZKEEP", "USMOTZDROP", "USMOFAIL"])
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2026, ?, 'qual', 0, 1, 'Q1', '2026-11-14T11:37:10', 1, 'test')", [code]);
  const ov = "INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES (?, 2026, ?, 'recording', ?, NULL, ?, ?, ?, 'x', '2026-11-14T05:00:00Z', NULL)";
  const meta = "INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, NULL, NULL, ?, ?)";
  const up = "INSERT INTO official_audit_videos (video_id, channel_id, title, published, first_seen, last_seen) VALUES (?, ?, ?, '2026-11-03T01:02:47Z', 'x', 'x')";
  // Reused for another meet: still to come, its title now Meet #2.
  await run(ov, ["qM3qo5rrmyc", "USMOKSSWM1", "2026-11-14", MO, "FTC Southwest League Camdenton Meet #1 - November 14, 2026", "list"]);
  await run(meta, ["qM3qo5rrmyc", null, 1, "2026-11-17T13:00:00Z"]);
  await run(up, ["qM3qo5rrmyc", MO, "FTC Southwest League Meet #2 at Hillcrest High School - November 21, 2026 - BIOBUZZ"]);
  // Aired on the day, its title still its meet: stays.
  await run(ov, ["TOUW4KHaYNw", "USMOKSSTLMM1", "2026-11-14", MO, "FTC STL Mid League Rolla Meet #1", "list"]);
  await run(meta, ["TOUW4KHaYNw", "2026-11-14T16:44:32Z", 0, "2026-11-17T13:00:00Z"]);
  await run(up, ["TOUW4KHaYNw", MO, "FTC STL Mid League Rolla Meet #1 at  Missouri Protoplex - November 14, 2026 - BIOBUZZ"]);
  // Still to come for an event that's today: FIRST's stream before it starts, right.
  await run(ov, ["todayStream", "USMOTODAY", "2026-11-17", MO, "Today Meet #3", "watcher"]);
  await run(meta, ["todayStream", null, 1, "2026-11-17T13:00:00Z"]);
  // The owner's link is the owner's decision, whatever YouTube says now.
  await run(ov, ["ownerLinked", "USMOOWNER", "2026-11-14", MO, "Owner Meet #1", "owner"]);
  await run(meta, ["ownerLinked", null, 1, "2026-11-17T13:00:00Z"]);
  // YouTube's facts last read before the meet (the read stalled since): "still to come" then proves nothing.
  await run(ov, ["staleFacts1", "USMOSTALE", "2026-11-14", MO, "Stale Meet #1", "list"]);
  await run(meta, ["staleFacts1", null, 1, "2026-11-13T20:00:00Z"]);
  // Postponed: its stream never aired on the listed day, and it played nothing: kept for the day it plays.
  await run(ov, ["postponed01", "USMOPOST", "2026-11-14", MO, "Postponed Meet #1", "list"]);
  await run(meta, ["postponed01", null, 1, "2026-11-17T13:00:00Z"]);
  // Never aired, and the owner rejected its watcher row meanwhile: the link goes, the owner's decision stays.
  await run(ov, ["raceOwner01", "USMORACE", "2026-11-14", MO, "Race Meet #1", "watcher"]);
  await run(meta, ["raceOwner01", null, 1, "2026-11-17T13:00:00Z"]);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES ('raceOwner01', ?, 'Race Meet #1', 'rejected', 2026, 'USMORACE', '2026-11-14', 'not this meet', 'x', '2026-11-17T13:30:00Z', 'owner')", [MO]);
  // Never aired, the watcher's add: the owner presses Remove between the check's read and its write.
  await run(ov, ["raceRemove1", "USMOREMOVE", "2026-11-14", MO, "Removed Meet #1", "watcher"]);
  await run(meta, ["raceRemove1", null, 1, "2026-11-17T13:00:00Z"]);
  await run("INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, why, seen_at, decided_at, decided_by) VALUES ('raceRemove1', ?, 'Removed Meet #1', 'added', 2026, 'USMOREMOVE', '2026-11-14', 'x', 'x', '2026-11-14T20:00:00Z', 'watcher')", [MO]);
  // Renamed to another meet since. One aired 19:30 on Nov 14 in Missouri (01:30Z on the 15th): that day's recording,
  // kept. One aired two days after its meet: dropped.
  await run(ov, ["tzKeepLink1", "USMOTZKEEP", "2026-11-14", MO, "TZ Keep Meet #1", "list"]);
  await run(meta, ["tzKeepLink1", "2026-11-15T01:30:00Z", 0, "2026-11-17T13:00:00Z"]);
  await run(up, ["tzKeepLink1", MO, "TZ Keep League Meet #2"]);
  await run(ov, ["tzDropLink1", "USMOTZDROP", "2026-11-14", MO, "TZ Drop Meet #1", "list"]);
  await run(meta, ["tzDropLink1", "2026-11-16T15:00:00Z", 0, "2026-11-17T13:00:00Z"]);
  await run(up, ["tzDropLink1", MO, "TZ Drop League Meet #2"]);
  // Never aired; its first drop fails mid-write (see the test).
  await run(ov, ["failLink001", "USMOFAIL", "2026-11-14", MO, "Fail Meet #1", "list"]);
  await run(meta, ["failLink001", null, 1, "2026-11-17T13:00:00Z"]);
});

describe("the link check", () => {
  it("reads a name's meet numbers", () => {
    expect(meetNumbers("Camdenton Meet #1  @ 10 AM")).toEqual([1]);
    expect(meetNumbers("NTX FTC N-League Meet #1a (2022.10.22)")).toEqual([1]);
    expect(meetNumbers("Northern League Meet # 1N")).toEqual([1]);
    expect(meetNumbers("Meet #3 / Meet #4")).toEqual([3, 4]);
    // A pair or a date names no one meet.
    expect(meetNumbers("League Meet 3/4")).toEqual([]);
    expect(meetNumbers("Meet 11/14 livestream")).toEqual([]);
    expect(meetNumbers("Meet 2026 - Nov 14")).toEqual([]);
    expect(meetNumbers("Kansas City Qualifier")).toEqual([]);
  });

  it("finds a stream that never aired for a past event, or a title naming another meet", () => {
    const base = { end: "2026-11-14", name: "Camdenton Meet #1", listed: "Camdenton Meet #1 - November 14", title: "Camdenton Meet #1", live: 0, start: "2026-11-14T16:00:00Z", checked: "2026-11-17T13:00:00Z", played: true };
    expect(linkWrong(base, NOW)).toBeNull();
    expect(linkWrong({ ...base, live: 1, start: null }, NOW)).toMatch(/^never aired/);
    // Facts read before the event's days were over, or never: no call.
    expect(linkWrong({ ...base, live: 1, start: null, checked: "2026-11-14T08:00:00Z" }, NOW)).toBeNull();
    expect(linkWrong({ ...base, live: 1, start: null, checked: null }, NOW)).toBeNull();
    // The day after its last day, YouTube's start may still be on its way: not yet.
    expect(linkWrong({ ...base, live: 1, start: null }, Date.parse("2026-11-15T12:00:00Z"))).toBeNull();
    // An event that played nothing (postponed, its dates not moved yet): its stream may still air.
    expect(linkWrong({ ...base, live: 1, start: null, played: false }, NOW)).toBeNull();
    expect(linkWrong({ ...base, title: "Southwest League Meet #2" }, NOW)).toMatch(/names meet #2.*the event is meet #1/);
    // Aired on the event's own days and renamed since: still that day's recording.
    expect(linkWrong({ ...base, title: "Southwest League Meet #2", airedOnDays: true }, NOW)).toBeNull();
    // Only when it was linked under the event's own number: a listed title naming another, or none, is no call.
    expect(linkWrong({ ...base, listed: "League Meet #2 stream", title: "Southwest League Meet #2" }, NOW)).toBeNull();
    expect(linkWrong({ ...base, listed: "League livestream", title: "Southwest League Meet #2" }, NOW)).toBeNull();
    // A title naming two meets, or none, isn't one meet's: no call on it.
    expect(linkWrong({ ...base, title: "Meet #1 / Meet #2" }, NOW)).toBeNull();
    expect(linkWrong({ ...base, title: "Southwest League livestream" }, NOW)).toBeNull();
  });

  it("reads a broadcast's day at the venue: renamed since, one that aired on its meet's day stays, a later one doesn't", async () => {
    const found = await findWrongLinks(NOW);
    expect(found.find((c) => c.videoId === "tzKeepLink1")).toBeUndefined();
    expect(found.find((c) => c.videoId === "tzDropLink1")?.why).toMatch(/names meet #2.*the event is meet #1/);
  });

  it("rolls back a drop that fails mid-write and goes on with the rest", async () => {
    const found = (await findWrongLinks(NOW)).filter((c) => c.videoId === "failLink001" || c.videoId === "tzDropLink1");
    const lines: string[] = [];
    // The first one's set-aside row can't be written (no channel): its whole drop is undone.
    const fail = found.find((c) => c.videoId === "failLink001")!, next = found.find((c) => c.videoId === "tzDropLink1")!;
    const freed = await freeLinks([{ ...fail, channelId: null as unknown as string }, next], new Date(NOW).toISOString(), (l) => lines.push(l));
    expect(freed.map((w) => w.videoId)).toEqual(["tzDropLink1"]);
    expect(lines.join()).toMatch(/failLink001 on 2026 USMOFAIL not freed/);
    expect(await get("SELECT 1 FROM official_videos WHERE video_id = 'failLink001' AND removed_at IS NULL")).toBeTruthy();
    expect(await get("SELECT 1 FROM owner_audit WHERE details LIKE '%failLink001%'")).toBeFalsy();
  });

  it("leaves a link the owner removed between its read and its write: nothing logged, its row as the owner left it", async () => {
    const found = (await findWrongLinks(NOW)).filter((c) => c.videoId === "raceRemove1");
    expect(found).toHaveLength(1);
    // The owner's Remove, meanwhile.
    await run("UPDATE official_videos SET removed_at = '2026-11-17T13:59:00Z' WHERE video_id = 'raceRemove1'");
    await run("UPDATE official_watch SET status = 'rejected', decided_by = 'owner' WHERE video_id = 'raceRemove1'");
    expect(await freeLinks(found, new Date(NOW).toISOString())).toEqual([]);
    expect(await get("SELECT 1 FROM owner_audit WHERE details LIKE '%raceRemove1%'")).toBeFalsy();
    expect(await get<any>("SELECT removed_at FROM official_videos WHERE video_id = 'raceRemove1'")).toEqual({ removed_at: "2026-11-17T13:59:00Z" });
    expect(await get<any>("SELECT status, decided_by FROM official_watch WHERE video_id = 'raceRemove1'")).toEqual({ status: "rejected", decided_by: "owner" });
  });

  it("takes only the wrong links off their events", async () => {
    const off = await dropWrongLinks(() => {}, NOW);
    expect(off.map((w) => [w.videoId, w.code]).sort()).toEqual([["failLink001", "USMOFAIL"], ["qM3qo5rrmyc", "USMOKSSWM1"], ["raceOwner01", "USMORACE"]]);
    expect(off.every((w) => w.why.startsWith("never aired"))).toBe(true);
    expect((await all<{ video_id: string }>("SELECT video_id FROM official_videos ORDER BY video_id")).map((r) => r.video_id))
      .toEqual(["TOUW4KHaYNw", "ownerLinked", "postponed01", "raceRemove1", "staleFacts1", "todayStream", "tzKeepLink1"]);
    // The owner's rejection of its watcher row stands: not turned into a set-aside the audit could add back.
    expect(await get<any>("SELECT status, decided_by FROM official_watch WHERE video_id = 'raceOwner01'")).toEqual({ status: "rejected", decided_by: "owner" });
    // Each drop logged with its event, day, part and source.
    expect(JSON.parse((await get<any>("SELECT details FROM owner_audit WHERE actor = 'link check' AND details LIKE '%qM3qo5rrmyc%'")).details))
      .toMatchObject({ videoId: "qM3qo5rrmyc", season: 2026, code: "USMOKSSWM1", day: "2026-11-14", part: null, source: "list" });
    expect(await dropWrongLinks(() => {}, NOW)).toEqual([]);
  });

  it("frees what it took off: set aside for the audit and the owner, never written back by the list, free to link to its meet", async () => {
    expect(await get<any>("SELECT status, season, code, decided_by, why FROM official_watch WHERE video_id = 'qM3qo5rrmyc'")).toMatchObject({
      status: "ignored", season: null, code: null, decided_by: "link check", why: expect.stringMatching(/^taken off 2026 USMOKSSWM1 2026-11-14 \(list\) by the link check: never aired/),
    });
    const listed = { season: 2026, code: "USMOKSSWM1", videoId: "qM3qo5rrmyc", kind: "recording" as const, day: "2026-11-14", channelId: MO, title: "FTC Southwest League Camdenton Meet #1 - November 14, 2026" };
    expect(await seedOfficialVideos(() => {}, { channels: { [MO]: "FIRST in Missouri" }, videos: [listed] }, NOW, true)).toBe(0);
    expect(await get("SELECT 1 FROM official_videos WHERE video_id = 'qM3qo5rrmyc'")).toBeFalsy();
    // Its id isn't held by a removed row, and the drop names only the event it came off: listed (checked by hand) for
    // the meet it names now, it's written there.
    expect(await seedOfficialVideos(() => {}, { channels: { [MO]: "FIRST in Missouri" }, videos: [{ ...listed, code: "USMOKSSWM2", day: "2026-11-21" }] }, NOW, true)).toBe(1);
    expect(await get<any>("SELECT code FROM official_videos WHERE video_id = 'qM3qo5rrmyc'")).toEqual({ code: "USMOKSSWM2" });
  });
});

describe("the link check's read", () => {
  it("read in parts (300 links each), it finds the same links as before past the first parts", async () => {
    // What is left wrong once the tests above freed theirs.
    const before = (await findWrongLinks(NOW)).map((c) => c.videoId).sort();
    // 700 more links aired on their meet's day (right, kept), read ahead of the rest.
    for (let i = 0; i < 700; i++) {
      await run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES (?, 2026, 'USMOKSSTLMM1', 'recording', '2026-11-14', ?, ?, 'FTC STL Mid League Rolla Meet #1', 'list', 'x', '2026-11-14T05:00:00Z', NULL)", [`fill${String(i).padStart(7, "0")}`, `p${i}`, MO]);
      await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', '2026-11-14T16:44:32Z', NULL, NULL, 0, '2026-11-17T13:00:00Z')", [`fill${String(i).padStart(7, "0")}`]);
    }
    // And one wrong link after them all (never aired, its meet past), in the last part.
    await run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES ('lateWrong01', 2026, 'USMOFAIL', 'recording', '2026-11-14', 'late', ?, 'Fail Meet #1', 'list', 'x', '2026-11-14T05:00:00Z', NULL)", [MO]);
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES ('lateWrong01', 'ok', NULL, NULL, NULL, 1, '2026-11-17T13:00:00Z')");
    expect((await findWrongLinks(NOW)).map((c) => c.videoId).sort()).toEqual([...before, "lateWrong01"].sort());
  });
});
