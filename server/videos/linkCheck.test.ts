// A linked recording checked again against YouTube's facts and its title today (./linkCheck.ts). The case behind it:
// FIRST in Missouri's qM3qo5rrmyc, listed for Camdenton Meet #1 (Nov 14) while still to come, never aired that day
// and became the channel's "Southwest League Meet #2 … November 21" stream.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { dropWrongLinks, linkWrong, meetNumbers } from "./linkCheck";

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
  const ov = "INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES (?, 2026, ?, 'recording', ?, NULL, ?, ?, ?, 'x', '2026-11-14T05:00:00Z', NULL)";
  const meta = "INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, NULL, NULL, ?, '2026-11-17T13:00:00Z')";
  const up = "INSERT INTO official_audit_videos (video_id, channel_id, title, published, first_seen, last_seen) VALUES (?, ?, ?, '2026-11-03T01:02:47Z', 'x', 'x')";
  // Reused for another meet: still to come, its title now Meet #2.
  await run(ov, ["qM3qo5rrmyc", "USMOKSSWM1", "2026-11-14", MO, "FTC Southwest League Camdenton Meet #1 - November 14, 2026", "list"]);
  await run(meta, ["qM3qo5rrmyc", null, 1]);
  await run(up, ["qM3qo5rrmyc", MO, "FTC Southwest League Meet #2 at Hillcrest High School - November 21, 2026 - BIOBUZZ"]);
  // Aired on the day, its title still its meet: stays.
  await run(ov, ["TOUW4KHaYNw", "USMOKSSTLMM1", "2026-11-14", MO, "FTC STL Mid League Rolla Meet #1", "list"]);
  await run(meta, ["TOUW4KHaYNw", "2026-11-14T16:44:32Z", 0]);
  await run(up, ["TOUW4KHaYNw", MO, "FTC STL Mid League Rolla Meet #1 at  Missouri Protoplex - November 14, 2026 - BIOBUZZ"]);
  // Still to come for an event that's today: FIRST's stream before it starts, right.
  await run(ov, ["todayStream", "USMOTODAY", "2026-11-17", MO, "Today Meet #3", "watcher"]);
  await run(meta, ["todayStream", null, 1]);
  // The owner's link is the owner's decision, whatever YouTube says now.
  await run(ov, ["ownerLinked", "USMOOWNER", "2026-11-14", MO, "Owner Meet #1", "owner"]);
  await run(meta, ["ownerLinked", null, 1]);
});

describe("the link check", () => {
  it("reads a name's meet numbers", () => {
    expect(meetNumbers("Camdenton Meet #1  @ 10 AM")).toEqual([1]);
    expect(meetNumbers("NTX FTC N-League Meet #1a (2022.10.22)")).toEqual([1]);
    expect(meetNumbers("Northern League Meet # 1N")).toEqual([1]);
    expect(meetNumbers("Meet #3 / Meet #4")).toEqual([3, 4]);
    expect(meetNumbers("Kansas City Qualifier")).toEqual([]);
  });

  it("finds a stream that never aired for a past event, or a title naming another meet", () => {
    const base = { end: "2026-11-14", name: "Camdenton Meet #1", title: "Camdenton Meet #1", live: 0, start: "2026-11-14T16:00:00Z" };
    expect(linkWrong(base, NOW)).toBeNull();
    expect(linkWrong({ ...base, live: 1, start: null }, NOW)).toMatch(/^never aired/);
    // The day after its last day, YouTube's start may still be on its way: not yet.
    expect(linkWrong({ ...base, live: 1, start: null }, Date.parse("2026-11-15T12:00:00Z"))).toBeNull();
    expect(linkWrong({ ...base, title: "Southwest League Meet #2" }, NOW)).toMatch(/names meet #2.*the event is meet #1/);
    // A title naming two meets, or none, isn't one meet's: no call on it.
    expect(linkWrong({ ...base, title: "Meet #1 / Meet #2" }, NOW)).toBeNull();
    expect(linkWrong({ ...base, title: "Southwest League livestream" }, NOW)).toBeNull();
  });

  it("takes only the wrong links off their events", async () => {
    const off = await dropWrongLinks(() => {}, NOW);
    expect(off.map((w) => [w.videoId, w.code])).toEqual([["qM3qo5rrmyc", "USMOKSSWM1"]]);
    expect(off[0].why).toMatch(/^never aired/);
    expect((await all<{ video_id: string }>("SELECT video_id FROM official_videos WHERE removed_at IS NULL ORDER BY video_id")).map((r) => r.video_id))
      .toEqual(["TOUW4KHaYNw", "ownerLinked", "todayStream"]);
    expect(await dropWrongLinks(() => {}, NOW)).toEqual([]);
  });
});
