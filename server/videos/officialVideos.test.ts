// Official event videos: the checked list is written once (an event missing from the database, a video it already
// plays, and a day it already has a video for are skipped; a removed row never comes back), and each day's official
// broadcast joins the event's player a day at a time, in broadcast order, next to FIRST's own link. Highlights never
// join the player. The shipped list itself: every row well-formed, one row per video, no highlight as a recording.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { eventRecording, recordingStream } from "./recordings";
import { eventHighlightVideos, localDate, seedOfficialVideos, type OfficialList } from "./officialVideos";
import { eventView, withPageExtras } from "../api/eventView";
import { parseRule } from "./officialMatch";
import shipped from "../data/officialVideos.json" with { type: "json" };

const S = 2025;
const CH = "UCBWrlxpmYKv4b_jE5mDsckw";
const D1 = "pvmxbH8YW-k", D2 = "zG45zl5pcDw", D3 = "AMgGg3Hfzxs", AW = "mvYjbQmqoJc", HL = "criv3nMj_Kg";
const W1 = "76X4pB5eljY", W4 = "iCMhB5nhEZU", W4B = "aaaaaaaaaaa", GONE = "bbbbbbbbbbb", NOEV = "ccccccccccc";
const v = (code: string, videoId: string, day: string | null, extra: Partial<OfficialList["videos"][number]> = {}) =>
  ({ season: S, code, videoId, kind: "recording" as const, day, channelId: CH, title: `t ${videoId}`, ...extra });

describe("official videos", () => {
  beforeAll(async () => {
    setDb(openDb(":memory:"));
    await migrate();
    const ev = "INSERT INTO events (season, code, name, type, city, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'Championship', ?, ?, ?, ?, 0, 0, ?, 'test')";
    await run(ev, [S, "ROCMPCND", "Romania Championship - COANDA Division", "Bucharest", "2026-03-13", "2026-03-15", "Europe/Bucharest", null]);
    await run(ev, [S, "ROCMP", "Romania Championship", "Bucharest", "2026-03-13", "2026-03-15", "Europe/Bucharest", null]);
    // FIRST's own link is the division's last day (Worlds 2026: each division's Day 4).
    await run(ev, [S, "FTCCMP1FRAN", "FIRST Championship - Franklin Division", "Houston", "2026-04-29", "2026-05-02", "America/Chicago", `https://www.youtube.com/watch?v=${W4}`]);
    const meta = "INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, ?, ?, 0, '2026-11-12T00:00:00Z')";
    await run(meta, [W4, "2026-05-02T13:00:00Z", "2026-05-02T18:00:00Z", 16_000]);
    await run(meta, [D1, "2026-03-13T07:00:00Z", "2026-03-13T13:00:00Z", 20_000]);
    await run(meta, [D2, "2026-03-14T06:00:00Z", "2026-03-14T16:00:00Z", 34_000]);
    await run(meta, [D3, "2026-03-15T06:30:00Z", "2026-03-15T11:00:00Z", 14_000]);
    await run(meta, [W1, "2026-04-29T19:00:00Z", "2026-04-29T22:30:00Z", 12_000]);
    // Removed once: it must stay out.
    await run("INSERT INTO official_videos (video_id, season, code, kind, day, channel_id, title, source, added_at, removed_at) VALUES (?, ?, 'ROCMPCND', 'recording', '2026-03-13', ?, 'x', 'list', 'a', 'b')", [GONE, S, CH]);
    clearAllCaches();
  });

  const list: OfficialList = {
    channels: { [CH]: "Nație Prin Educație" },
    videos: [
      v("ROCMPCND", D3, "2026-03-15"), v("ROCMPCND", D1, "2026-03-13"), v("ROCMPCND", D2, "2026-03-14"),
      v("ROCMP", AW, "2026-03-15", { part: "Finals & awards" }),
      v("ROCMP", HL, null, { kind: "highlight" }),
      v("FTCCMP1FRAN", W1, "2026-04-29"),
      v("FTCCMP1FRAN", W4, "2026-05-02"), // FIRST's link already: skipped
      v("FTCCMP1FRAN", W4B, "2026-05-02"), // another video for a day FIRST's link covers: skipped
      v("ROCMPCND", GONE, "2026-03-13"), // removed before: never written again
      v("NOPE", NOEV, "2026-03-13"), // no such event here
    ],
  };

  it("writes each checked video once, and skips what the event already plays", async () => {
    const logs: string[] = [];
    expect(await seedOfficialVideos((s) => logs.push(s), list, Date.parse("2026-11-12T00:00:00Z"), true)).toBe(6);
    const rows = await all<{ video_id: string; removed_at: string | null }>("SELECT video_id, removed_at FROM official_videos ORDER BY video_id");
    expect(rows.map((r) => r.video_id).sort()).toEqual([AW, D1, D2, D3, GONE, HL, W1].sort());
    expect(rows.find((r) => r.video_id === GONE)?.removed_at).toBe("b");
    expect(logs[0]).toMatch(/6 added from the checked list, 3 skipped/);
    // Again: nothing new.
    expect(await seedOfficialVideos(() => {}, list, Date.now(), true)).toBe(0);
  });

  it("waits while a video the event plays has no timing yet, then decides on a later run", async () => {
    const ev = "INSERT INTO events (season, code, name, type, city, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'Qualifier', 'Iasi', '2026-02-07', '2026-02-08', 'Europe/Bucharest', 0, 0, ?, 'test')";
    const L = "ddddddddddd", SAT = "eeeeeeeeeee", SUN = "fffffffffff";
    await run(ev, [S, "ROWAIT", "Iasi Qualifier", `https://youtu.be/${L}`]);
    const later: OfficialList = { channels: list.channels, videos: [v("ROWAIT", SAT, "2026-02-07"), v("ROWAIT", SUN, "2026-02-08")] };
    const logs: string[] = [];
    // FIRST's link isn't timed yet: either day could be its, so nothing is written.
    expect(await seedOfficialVideos((x) => logs.push(x), later, Date.now(), true)).toBe(0);
    expect(logs.at(-1)).toMatch(/2 waiting for a video's timing/);
    // A read that failed (no start): its day still can't be told.
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'error', NULL, NULL, NULL, 0, '2026-11-12T00:00:00Z')", [L]);
    expect(await seedOfficialVideos(() => {}, later, Date.now(), true)).toBe(0);
    // Once the backfill has read it (Saturday's broadcast), Sunday is added and Saturday stays FIRST's.
    await run("UPDATE video_meta SET status = 'ok', start = '2026-02-07T07:00:00Z', end = '2026-02-07T15:00:00Z', duration = 28800 WHERE video_id = ?", [L]);
    expect(await seedOfficialVideos(() => {}, later, Date.now(), true)).toBe(1);
    expect((await all<{ video_id: string }>("SELECT video_id FROM official_videos WHERE code = 'ROWAIT'")).map((r) => r.video_id)).toEqual([SUN]);
  });

  it("plays an event's official days a day at a time, in broadcast order", async () => {
    clearAllCaches();
    const r = await eventRecording(S, "ROCMPCND");
    expect(r?.videoId).toBe(D1);
    expect(r?.more?.map((d) => d.videoId)).toEqual([D2, D3]);
    expect(r?.daily).toBe(true);
    // The organiser's video, never labelled FIRST's.
    expect(r?.source).toBe("official");
    expect(recordingStream(r!, "Europe/Bucharest").source).toBe("official");
    expect(recordingStream(r!, "Europe/Bucharest").days?.map((d) => d.label)).toEqual(["Friday", "Saturday", "Sunday"]);
  });

  it("puts FIRST's link among the official days by its broadcast date", async () => {
    const r = await eventRecording(S, "FTCCMP1FRAN");
    expect([r!.videoId, ...(r!.more ?? []).map((d) => d.videoId)]).toEqual([W1, W4]);
    // An official day sorted first is still the organiser's, not FIRST's link.
    expect(r?.source).toBe("official");
    expect(recordingStream(r!, "America/Chicago").days?.map((d) => d.label)).toEqual(["Wednesday", "Saturday"]);
  });

  it("a parent event's one official video plays alone; its highlight is never the recording", async () => {
    const r = await eventRecording(S, "ROCMP");
    expect(r?.videoId).toBe(AW);
    expect(r?.more).toBeUndefined();
    expect(await eventHighlightVideos(S, "ROCMP")).toEqual([{ videoId: HL, title: `t ${HL}` }]);
    expect(await eventHighlightVideos(S, "ROCMPCND")).toEqual([]);
  });

  it("the event page gets an event's highlights beside its recording, never in it", async () => {
    const d = await eventView(S, "ROCMP");
    expect(d?.highlightVideos).toEqual([{ videoId: HL, title: `t ${HL}` }]);
    expect(d?.event.stream?.videoId).toBe(AW);
    expect(JSON.stringify(d?.event.stream)).not.toContain(HL);
    expect(d?.matches.some((m) => m.clip?.videoId === HL || m.video?.includes(HL))).toBe(false);
    expect((await eventView(S, "ROCMPCND"))?.highlightVideos).toBeUndefined();
    // "Refresh results" answers through the same extras, so the section doesn't vanish on a refresh.
    expect((await withPageExtras({ event: { season: S, code: "ROCMP" } })).highlightVideos).toEqual(d?.highlightVideos);
  });

  it("dates a broadcast at the venue", () => {
    expect(localDate("2026-05-03T03:00:00Z", "America/Chicago")).toBe("2026-05-02");
    expect(localDate("2026-03-13T23:30:00Z", "Europe/Bucharest")).toBe("2026-03-14");
    expect(localDate("2026-03-13T23:30:00Z", "Not/AZone")).toBe("2026-03-13");
  });
});

describe("the shipped list", () => {
  const data = shipped as OfficialList;
  it("is well-formed: YouTube ids, known channels, a day on every recording, one row per video", () => {
    const seen = new Set<string>();
    for (const x of data.videos) {
      expect(x.videoId, x.title).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(seen.has(x.videoId), x.videoId).toBe(false);
      seen.add(x.videoId);
      expect(data.channels[x.channelId], x.videoId).toBeTruthy();
      expect(["recording", "highlight"]).toContain(x.kind);
      if (x.kind === "recording") expect(x.day, x.videoId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(x.season).toBeGreaterThanOrEqual(2019);
    }
  });
  it("keeps one video per event, day and part", () => {
    const k = new Set<string>();
    for (const x of data.videos.filter((y) => y.kind === "recording")) {
      const key = `${x.season}/${x.code}/${x.day}/${x.part ?? ""}`;
      expect(k.has(key), key).toBe(false);
      k.add(key);
    }
  });
  it("puts FIRST Australia's recordings on the Australian event each title names, inside that event's season", () => {
    const au = data.videos.filter((x) => x.channelId === "UCal7624DPridi_9iKLrAbqw");
    // Each event's own name, as its broadcasts' titles give it.
    const names: Record<string, RegExp> = {
      AUCMP: /australian national championship/i, AUSYOS: /\bAPOC\b|asia pacific open/i, AUSYQ1: /sydney south/i,
      AUSYQ2: /sydney north/i, AUBRQ1: /brisbane south/i, AUTBQ: /victoria/i,
    };
    expect(au).toHaveLength(16);
    for (const x of au) {
      expect(x.kind, x.videoId).toBe("recording");
      expect(names[x.code], `${x.code} ${x.videoId}`).toBeTruthy();
      expect(x.title, x.videoId).toMatch(names[x.code]);
      // A season runs from its kickoff (September) to the next summer's off-season events.
      expect(x.day! >= `${x.season}-09-01` && x.day! <= `${x.season + 1}-08-31`, `${x.videoId} ${x.day}`).toBe(true);
    }
    // A day in two parts says so, one row each.
    const apocSat = au.filter((x) => x.code === "AUSYOS" && x.day === "2026-07-04");
    expect(apocSat.map((x) => x.part).sort()).toEqual(["Part 1", "Part 2"]);
  });
  it("puts Tulsa Robotics Center's and FTC Louisiana's recordings on the event each title names, in its season", async () => {
    const TRC = "UC6y0o2J7b05YIL7w95cwg0w", LA = "UCQYT4ZXN54khn_n7ebsRRtQ";
    const pin = (ch: string) => data.videos.filter((x) => x.channelId === ch).map((x) => `${x.season}/${x.code} ${x.day} ${x.videoId}`).sort();
    // Every row, checked by hand against Scout's event (name, city, date, league, meet number): season/code day video.
    expect(pin(TRC)).toEqual([
      "2024/USOKOKDVM2 2024-11-16 HedOy2nlu8Y", "2024/USOKOKMYM4 2024-12-14 jNQS-ds27_A", "2025/USOKCMP 2026-02-14 2dfab82v9LI",
      "2025/USOKOKBKLT 2026-02-07 RqS999RYvr4", "2025/USOKOKDVM1 2025-11-01 58jTgjgNnVM", "2025/USOKOKDVM2 2025-11-22 N826JxMkOJw",
      "2025/USOKOKDVM4 2026-01-16 IxTxYxnwb-o", "2025/USOKOKHRM1 2025-11-22 iWor_qAwe3w", "2025/USOKOKHRM2 2025-12-13 CEk_HdaWCbk",
      "2025/USOKOKHRM3 2026-01-17 a-hJWs1qdPk", "2025/USOKOKMYM3 2025-12-06 G-ci5QKhIHk", "2025/USOKTUS 2025-11-28 Dolp4XFMw8o",
      "2025/USOKTUS3 2026-04-18 pjlm3mw8GLY", "2026/USOKOKDVM1 2026-10-24 gBloQhx9MTo",
    ]);
    expect(pin(LA)).toEqual([
      "2022/USLACMP 2023-03-04 _7HGgO9UXKY", "2023/USLACMP 2024-03-02 SneU-PEazzo", "2023/USLATBQ3 2024-02-03 czERhRmqsHY",
      "2024/USLAALQ 2025-02-08 S3Gjrsx6NQI", "2024/USLACMP 2025-02-22 CLKCw6Ze4t0", "2024/USLAHAQ 2024-12-07 tjqt_qQ1okQ",
      "2024/USLANOQ 2025-01-18 b7XSFe4M11c", "2024/USLAWAQ 2025-01-11 Kdg5JfNBPkE", "2025/USLABRQ 2026-01-31 xjqDJX7x5bE",
      "2025/USLABRS 2025-11-16 jNe8zTc_FSU", "2025/USLACMP 2026-02-28 -0YyERucycY", "2025/USLAGEQ 2026-02-07 yBzQFVpiaCM",
      "2025/USLAHAQ 2026-01-17 horCKP6Ya6I",
    ]);
    // Each event as Scout names it: the league and meet number, or the event's own words. DaVinci never on Herrington,
    // Meet 2 never on Meet 3, Hammond never on Walker.
    const names: Record<string, RegExp> = {
      "2024/USOKOKDVM2": /DaVinci League Meet #2$/, "2024/USOKOKMYM4": /May League Meet #4$/, "2025/USOKCMP": /Oklahoma State Championship/,
      "2025/USOKOKBKLT": /Bishop Kelley League Tournament/, "2025/USOKOKDVM1": /DaVinci League Meet #1 /, "2025/USOKOKDVM2": /DaVinci League Meet #2 /,
      "2025/USOKOKDVM4": /DaVinci League Meet #4$/, "2025/USOKOKHRM1": /Herrington League Meet +#1 /, "2025/USOKOKHRM2": /Herrington League Meet +#2 /,
      "2025/USOKOKHRM3": /Herrington League Meet +#3 /, "2025/USOKOKMYM3": /May League Meet #3 /, "2025/USOKTUS": /Black Friday FTC Scrimmage 2025/,
      "2025/USOKTUS3": /Pre-Worlds FTC Scrimmage/, "2026/USOKOKDVM1": /DaVinci League Meet #1 - BIOBUZZ/,
      "2022/USLACMP": /Regional Championship/, "2023/USLACMP": /Regional Championship/, "2023/USLATBQ3": /Lafayette Qualifier/,
      "2024/USLAALQ": /Alexandria Qualifier/, "2024/USLACMP": /Regional Championship/, "2024/USLAHAQ": /Hammond Qualifier/,
      "2024/USLANOQ": /New Orleans Qualifier/, "2024/USLAWAQ": /Walker Qualifier/, "2025/USLABRQ": /Baton Rouge Qualifier/,
      "2025/USLABRS": /LSU Scrimmage/, "2025/USLACMP": /Regional Championship/, "2025/USLAGEQ": /Geismar Qualifier/, "2025/USLAHAQ": /Hammond Qualifier/,
    };
    // A title naming its game names the event's season.
    const games: [RegExp, number][] = [[/BIOBUZZ/i, 2026], [/DECODE/i, 2025], [/INTO THE DEEP/i, 2024], [/CENTERSTAGE/i, 2023], [/POWERPLAY/i, 2022]];
    for (const x of data.videos.filter((y) => y.channelId === TRC || y.channelId === LA)) {
      const key = `${x.season}/${x.code}`;
      expect(x.kind, x.videoId).toBe("recording");
      expect(names[key], key).toBeTruthy();
      expect(x.title, x.videoId).toMatch(names[key]);
      const game = games.find(([re]) => re.test(x.title));
      if (game) expect(x.season, x.videoId).toBe(game[1]);
      expect(x.channelId === LA ? !!game : true, `${x.videoId} names its game`).toBe(true);
      expect(x.day! >= `${x.season}-09-01` && x.day! <= `${x.season + 1}-08-31`, `${x.videoId} ${x.day}`).toBe(true);
    }
    // Left out: videos that can't be embedded (most of Tulsa's 2024 season), the Herrington Meet 1 of 2026-10-24 that
    // YouTube blocks in 247 countries (the US among them), one stream for two meets (DaVinci #3 / May #4), a DaVinci
    // Meet #4 whose date isn't the event's, an off-season invitational Scout lists twice, and a summit with no event.
    const ids = new Set(data.videos.map((x) => x.videoId));
    for (const no of ["rbPPJ3YonGM", "PRUrAecDmyU", "CDZvEuYkmg0", "IxU-PzxWU8g", "Fb6hDpb-MwQ", "Lxg-sZQadBE", "aXqVxd9iZI8", "ipIeH72xkRg",
      "Pz-o9l1MU5M", "bPRhM5FKsEM", "Og4Ser-WdSI", "j-L5Wrj5gKc", "9DE-ivNDi10"]) expect(ids.has(no), no).toBe(false);
    // The watcher reads the four channels for their own events only.
    const { OFFICIAL_CHANNELS } = await import("../data/officialChannels");
    const rule = (ch: string) => parseRule(OFFICIAL_CHANNELS.find((c) => c.channelId === ch)!.region)!;
    const ev = { season: 2026, type: "LeagueMeet", city: "Tulsa", state: "OK", country: "USA", start: "2026-11-14", end: "2026-11-14", timezone: "America/Chicago", divisionCode: null, parent: false };
    expect(rule(TRC)({ ...ev, code: "USOKOKHGM2", name: "Herrington League Meet 2" })).toBe(true);
    expect(rule(TRC)({ ...ev, code: "USOKCMP", name: "Oklahoma Championship", type: "Championship" })).toBe(true);
    expect(rule(TRC)({ ...ev, code: "USOKOKCRM2", name: "Carver League Meet 2" })).toBe(false);
    expect(rule(TRC)({ ...ev, code: "USARBEQ", name: "Bentonville Bash", state: "AR" })).toBe(false);
    const ar = { ...ev, state: "AR", type: "Qualifier", city: "Benton" };
    expect(rule("UClcqdD9sHnwtN7FCW6Vj1Ug")({ ...ar, code: "USARBEQ2", name: "Battle at Benton" })).toBe(true);
    expect(rule("UClcqdD9sHnwtN7FCW6Vj1Ug")({ ...ar, code: "USARMHQ", name: "Mountain Home Mayhem" })).toBe(true);
    expect(rule("UClcqdD9sHnwtN7FCW6Vj1Ug")({ ...ar, code: "USARFSQ", name: "Fort Smith Frenzy" })).toBe(false);
    expect(rule("UCvA42eBzkRpd-x23-AvOnvw")({ ...ar, code: "USARCMP", name: "Arkansas Championship", type: "Championship" })).toBe(true);
    expect(rule("UCvA42eBzkRpd-x23-AvOnvw")({ ...ar, code: "USARBEQ", name: "Bentonville Bash" })).toBe(false);
    expect(rule(LA)({ ...ev, state: "LA", code: "USLANOQ", name: "New Orleans Qualifier" })).toBe(true);
    expect(rule(LA)({ ...ev, code: "USOKCMP", name: "Oklahoma Championship" })).toBe(false);
  });

  it("leaves out what the brief rules out", () => {
    const ids = new Set(data.videos.map((x) => x.videoId));
    // Ambiguous, unofficial, a different broadcaster, or blocked (docs/official-videos.md).
    for (const no of ["DIRpIQ4tX9M", "58cbWg355qs", "Hy1RhXR5m_E", "h8YcLrHi-wQ", "-BTNpJ2X1nE", "_HSS2tVlaew", "be0ahU8Eqz8", "cqdU1OSkirQ", "p01TnRl7nvQ", "q7CZqGeJvLo", "trBIleY7mMk", "C7gP557UknQ"]) expect(ids.has(no), no).toBe(false);
    // No Houston highlight from the Romania channel.
    for (const no of ["ftRnZIOtgTQ", "b_Ab_UpLkWo", "NnInm3IP2Ko", "1ZeVXfwUcNo", "8EUpGcyY8vY"]) expect(ids.has(no), no).toBe(false);
  });
});
