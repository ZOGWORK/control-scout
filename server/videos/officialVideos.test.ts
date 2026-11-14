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

  it("puts FIRST in Missouri's and FIRST MOKS's recordings on the Missouri/Kansas meet each title names, one session each", async () => {
    const FIMO = "UCoo2NYUOcTUZB65dGMAp1vg", MOKS = "UCy_GHfjX6LsALdrIceg8_pw";
    const pin = (ch: string) => data.videos.filter((x) => x.channelId === ch).map((x) => `${x.season}/${x.code} ${x.day} ${x.videoId}`).sort();
    // Every row, checked by hand against Scout's event (name, venue, city, date, league, session): season/code day video.
    expect(pin(FIMO)).toEqual([
      "2022/USMOKSSTLMM6 2023-01-06 lId9ThoQI70", "2023/USMOKSSTLNLT1 2024-02-10 m1tp5Ji3ZfA",
      "2023/USMOKSSTLNM9 2024-01-20 prX-wkodWu4", "2024/USMOKSSTLMLT 2025-02-01 -RVQbm2QDwk",
      "2024/USMOKSSTLNM2 2024-12-21 -c-27oGhTNc", "2024/USMOKSSTLNM3 2024-12-07 9i9krw6Filw",
      "2024/USMOKSSTLNM4 2025-01-11 5v8TlEQlf4o", "2024/USMOKSSTLNM5 2025-01-04 654Sz2dZx8g",
      "2024/USMOKSSTLSM7 2024-11-02 wYiPDWPXm94", "2026/USMOKSSEM2 2026-11-14 nR5wKpHZA8g",
      "2026/USMOKSSTLMM1 2026-11-14 TOUW4KHaYNw", "2026/USMOKSSTLNM7 2026-11-14 EHLGE5Rl3qU",
      "2026/USMOKSSTLSM1 2026-11-07 OMN4AaLeIdc", "2026/USMOKSSWM1 2026-11-14 qM3qo5rrmyc",
    ]);
    expect(pin(MOKS)).toEqual([
      "2019/19MOMT1 2019-11-09 wvUDXFu4qN4", "2019/19MOMT16 2019-12-07 pAfNTwtGQz0",
      "2019/19MOMT17 2019-12-07 3dr9bOM4tYg", "2019/19MOMT3 2019-11-16 rg1_UZgT6ZA",
      "2019/19MOMT4 2019-11-16 801wnZZhyMc", "2019/2019MOC1SDIVISION 2020-03-07 VP3ypLKsC2s",
      "2019/2019MOC1TDIVISION 2020-03-07 OhH_jZau2Uw", "2019/2019MOQ2 2019-12-14 06dqg4aHoII",
      "2019/2019MOQ2 2019-12-14 5I0FgkqcIwQ", "2019/2019MOQ4 2020-02-01 m9KLRqFCMBQ",
      "2019/2019MOQ6 2020-01-25 yguoRsl_AwY", "2019/2019MOQ8 2020-02-15 4HDl8nB-pOw",
      "2019/20MOMT10 2020-01-25 7eiJDvT42ik", "2019/20MOMT12 2020-01-25 XZHamtehL_k",
      "2021/USMOKSBELT 2022-01-29 VD84dv9h0JI", "2021/USMOKSCMP 2022-03-05 ZOmJ0CuLWHY",
      "2021/USMOKSKCM1 2021-11-20 sYpBW9SFb04", "2021/USMOKSKCM2 2022-01-15 ZzN574xEf48",
      "2021/USMOKSKNM1 2021-12-11 dHjVrS2RUYY", "2021/USMOKSKNM2 2021-12-11 kQLwiiIQX4k",
      "2021/USMOKSLSM1 2021-12-04 bTnV8z3stTs", "2021/USMOKSLSM2 2021-12-18 YrZoAIriA3M",
      "2021/USMOKSLSM3 2021-12-04 bdZI8ZVBe34", "2021/USMOKSLSM4 2021-12-18 YOmp83gRf14",
      "2021/USMOKSOPM1 2022-01-22 85SpiaRed18", "2021/USMOKSOPM2 2022-01-22 YX_m0H3MskY",
      "2021/USMOKSSPLT 2022-02-19 KOzyNy7DVHc", "2021/USMOKSSPLT 2022-02-19 v3MwITl0Jmo",
      "2022/USMOKSCMP 2023-03-04 7NvwszKfl7Y", "2022/USMOKSKCELT 2023-02-04 K1aa9BGUDcc",
      "2022/USMOKSKCEM1 2022-12-17 evqDX3DFygE", "2022/USMOKSKCEM2 2022-12-03 vZm-zq02FNA",
      "2022/USMOKSKCEM3 2022-12-10 pihIK2DiNtk", "2022/USMOKSKCEM4 2022-11-19 sDkc5p71S-Y",
      "2022/USMOKSKCEM5 2023-01-21 dI4I1AdBBfY", "2022/USMOKSKCEM6 2023-01-14 RJ2iSF0j2hg",
      "2022/USMOKSKCWLT 2023-02-11 DfCFW_7uEYg", "2022/USMOKSKCWM1 2022-12-17 cnONKk5zXGo",
      "2022/USMOKSKCWM2 2022-12-03 2rISyTdmCag", "2022/USMOKSKCWM3 2022-11-19 SNu-XRwDQFg",
      "2022/USMOKSKCWM4 2022-12-10 S7nzGdWDr4s", "2022/USMOKSKCWM5 2023-01-21 GWKqJs9HCys",
      "2022/USMOKSKCWM6 2023-01-14 JhfnJAwaWfw", "2022/USMOKSSWMILT1 2023-01-28 i0x0XtAd1Is",
      "2023/USMOKSCMP 2024-03-02 IQAkzka8GzQ", "2023/USMOKSKCELT 2024-01-27 YAXiWJuLBsk",
      "2023/USMOKSKCEM1 2023-12-16 ECO-_TcPv78", "2023/USMOKSKCEM2 2023-12-16 eAFclqqHNOM",
      "2023/USMOKSKCEM3 2023-12-02 BXAmN5Bdk-c", "2023/USMOKSKCEM5 2024-01-20 wmlCJmmd9H4",
      "2023/USMOKSKCEM6 2023-11-11 rdPswRDxTh0", "2023/USMOKSKCWLT 2024-02-10 dfhDnp7ESPc",
      "2023/USMOKSKCWM1 2023-12-02 _vYBQ5B1QAc", "2023/USMOKSKCWM2 2023-12-09 UwDyv7mU4jc",
      "2023/USMOKSKCWM3 2023-12-09 DImrANzeIsQ", "2023/USMOKSKCWM4 2024-01-20 uvFvN_EzI9Q",
      "2023/USMOKSKCWM5 2023-11-11 mnYjdKM1DVc", "2023/USMOKSKCWM6 2023-11-18 egzqnqcbjJA",
      "2023/USMOKSKCWM7 2023-11-18 DiyUgUbb6xc", "2023/USMOKSSWMILT 2024-02-03 uON4oUZ95qg",
      "2024/USMOKSKCEM1 2024-12-14 iCZ6M2KZbIk", "2024/USMOKSKCEM2 2024-12-21 gdQKve7ft3s",
      "2024/USMOKSKCEM3 2024-12-21 Pv6LWVPHRSI", "2024/USMOKSKCEM4 2025-01-11 vtXR4XRrr00",
      "2024/USMOKSKCEM5 2024-11-02 j0CVFqC3i6g", "2024/USMOKSKCEM6 2024-11-02 _GM2ehbkl2k",
      "2024/USMOKSKCEM7 2024-11-23 4_KPw2DqSiw", "2024/USMOKSKCEM8 2024-12-07 6W3JTqRlzCg",
      "2024/USMOKSKCEM9 2024-12-07 I3JYvCnPYn8", "2024/USMOKSKCWLT 2025-01-18 TjPs-8caGYk",
      "2024/USMOKSKCWM1 2024-12-14 Ew2P58HmP6o", "2024/USMOKSKCWM2 2024-12-14 IjL0jtEWweU",
      "2024/USMOKSKCWM3 2024-12-21 Aw-LD9hzBro", "2024/USMOKSKCWM4 2025-01-11 GbpsnJN-wgY",
      "2024/USMOKSKCWM5 2024-11-16 x3ojlUMBULw", "2024/USMOKSKCWM6 2024-11-16 Sqw-27xckcA",
      "2024/USMOKSKCWM7 2024-11-23 P6Xl3yl9vf0", "2024/USMOKSLSSQ 2025-02-15 5W5V8DRNyHs",
      "2024/USMOKSSWLT 2025-01-25 ar6uGXrwgbI", "2025/USMOKSKCELT1 2026-02-07 J4W8wcuvv90",
      "2025/USMOKSKCEM9 2026-01-10 FejS0SMwcxw", "2025/USMOKSKCWLT1 2026-01-17 2uvgcUltkIA",
      "2025/USMOKSKCWM8 2026-01-10 ZxHkaD8UoXk", "2025/USMOKSKCWM9 2026-01-10 hbWvrvJxyAY",
      "2025/USMOKSLSSQ 2026-02-21 WX4MWK_LwBI", "2025/USMOKSSWLT 2026-01-31 SV63XvPr7AE",
      "2026/USMOKSKCMM1 2026-11-07 bR556QnpUdM", "2026/USMOKSKCMM2 2026-11-07 W4z7U4GojHs",
      "2026/USMOKSKCWM1 2026-11-07 oBRIzLgPBPY",
    ]);
    // Scout's session for each meet a title names a session of: "8AM" is "Belton Meet @ 8 AM", "AM" the morning meet.
    const sessions: Record<string, string> = {
      "2026/USMOKSKCMM2": "8AM", "2026/USMOKSKCWM1": "1030AM", "2026/USMOKSKCMM1": "1PM", "2025/USMOKSKCWM8": "8AM",
      "2025/USMOKSKCEM9": "1030AM", "2025/USMOKSKCWM9": "1PM", "2024/USMOKSKCWM4": "1PM", "2024/USMOKSKCEM4": "8AM",
      "2024/USMOKSKCEM2": "8AM", "2024/USMOKSKCWM3": "1030AM", "2024/USMOKSKCEM3": "1PM", "2024/USMOKSKCWM2": "8AM",
      "2024/USMOKSKCEM1": "1030AM", "2024/USMOKSKCWM1": "1PM", "2024/USMOKSKCEM9": "8AM", "2024/USMOKSKCEM8": "1PM",
      "2024/USMOKSKCWM7": "8AM", "2024/USMOKSKCEM7": "1PM", "2024/USMOKSKCWM5": "8AM", "2024/USMOKSKCWM6": "1PM",
      "2024/USMOKSKCEM6": "8AM", "2024/USMOKSKCEM5": "1PM", "2023/USMOKSKCWM4": "8AM", "2023/USMOKSKCEM5": "1PM",
      "2023/USMOKSKCEM2": "8AM", "2023/USMOKSKCEM1": "1PM", "2023/USMOKSKCWM3": "8AM", "2023/USMOKSKCWM2": "1PM",
      "2023/USMOKSKCEM3": "8AM", "2023/USMOKSKCWM1": "1PM", "2023/USMOKSKCWM7": "8AM", "2023/USMOKSKCWM6": "1PM",
      "2023/USMOKSKCWM5": "8AM", "2023/USMOKSKCEM6": "1PM", "2022/USMOKSKCEM5": "AM", "2022/USMOKSKCWM5": "PM",
      "2022/USMOKSKCWM6": "AM", "2022/USMOKSKCEM6": "PM", "2022/USMOKSKCEM1": "AM", "2022/USMOKSKCWM1": "PM",
      "2022/USMOKSKCWM4": "AM", "2022/USMOKSKCEM3": "PM", "2022/USMOKSKCEM2": "AM", "2022/USMOKSKCWM2": "PM",
      "2022/USMOKSKCWM3": "AM", "2022/USMOKSKCEM4": "PM", "2021/USMOKSOPM2": "AM", "2021/USMOKSOPM1": "PM",
      "2021/USMOKSLSM4": "AM", "2021/USMOKSLSM2": "PM", "2021/USMOKSKNM2": "AM", "2021/USMOKSKNM1": "PM",
      "2021/USMOKSLSM1": "AM", "2021/USMOKSLSM3": "PM", "2019/20MOMT12": "PM", "2019/20MOMT10": "AM",
      "2019/19MOMT16": "AM", "2019/19MOMT17": "PM", "2019/19MOMT3": "AM", "2019/19MOMT4": "PM",
    };
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    for (const x of data.videos.filter((y) => y.channelId === FIMO || y.channelId === MOKS)) {
      expect(x.kind, x.videoId).toBe("recording");
      expect(x.code, x.videoId).toMatch(/^(USMOKS|19MOMT|20MOMT|2019MO)/);
      expect(x.day! >= `${x.season}-09-01` && x.day! <= `${x.season + 1}-08-31`, `${x.videoId} ${x.day}`).toBe(true);
      // A title naming its date names this row's day: "(2026-11-7)" or "November 14, 2026" / "Nov 7, 2026".
      const [y, m, d] = x.day!.split("-").map(Number);
      const iso = /\((\d{4})-(\d{1,2})-(\d{1,2})\)/.exec(x.title);
      if (iso) expect([+iso[1], +iso[2], +iso[3]], x.videoId).toEqual([y, m, d]);
      const long = /\b([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}),? (\d{4})\b/.exec(x.title);
      if (long) expect([+long[3], MONTHS.findIndex((n) => n.startsWith(long[1])) + 1, +long[2]], x.videoId).toEqual([y, m, d]);
      expect(iso || long || x.videoId === "lId9ThoQI70" || /Super Qualifier @ East Trails/.test(x.title), `${x.videoId} names no date`).toBeTruthy();
      // A session in the title ("8AM", "1030AM", "1PM", "AM", "PM") is the meet's own.
      const t = x.title.replace(/\(.*?\)/g, "");
      const s = /\b(\d{1,4})(AM|PM)\b/.exec(t)?.slice(1).join("") ?? /\b(AM|PM)\b/.exec(t)?.[1];
      if (s) expect(sessions[`${x.season}/${x.code}`] ?? "", `${x.videoId} ${s}`).toMatch(new RegExp(`${s}$`));
    }
    // A day in two parts says so, one row each.
    for (const code of ["USMOKSSPLT", "2019MOQ2"]) expect(data.videos.filter((x) => x.code === code).map((x) => x.part).sort()).toEqual(["Part 1", "Part 2"]);
    // Left out: an alternate feed and a second upload of a day that has one, a title fitting two STL North meets,
    // uploads without a date, one video for an AM and a PM meet, a venue that isn't the event's, an awards stream of
    // two leagues, a video that can't be embedded, a scheduled stream that never aired, and days with no FTC event.
    const ids = new Set(data.videos.map((x) => x.videoId));
    for (const no of ["EIqZXe2vG_Y", "lfWTpYkYFg8", "XDeeKNXKdFY", "Mt_K_svg814", "PuINSMGOvxY", "2saRgC8X-Yo", "HSsenMtQQEE", "vJBo3Zyn6qM",
      "LlfD3kfTpY0", "LJH1QKK9Z28", "_tLUXAkOLuA", "PIKtUNsl5i8", "0SEUu04Q_B0", "D5Rc4neQkog", "uXUaw8601sM"]) expect(ids.has(no), no).toBe(false);
    // The watcher reads both channels, for Missouri and Kansas events only.
    const { OFFICIAL_CHANNELS } = await import("../data/officialChannels");
    const ev = { season: 2026, type: "LeagueMeet", city: "Belton", state: "MO", country: "USA", start: "2026-11-07", end: "2026-11-07", timezone: "America/Chicago", divisionCode: null, parent: false, code: "USMOKSKCMM2", name: "Belton Meet @ 8 AM" };
    for (const ch of [FIMO, MOKS]) {
      const inRegion = parseRule(OFFICIAL_CHANNELS.find((c) => c.channelId === ch)!.region)!;
      expect(inRegion(ev)).toBe(true);
      expect(inRegion({ ...ev, city: "Olathe", state: "KS" })).toBe(true);
      expect(inRegion({ ...ev, city: "Tulsa", state: "OK", code: "USOKOKDVM1", name: "DaVinci League Meet 1" })).toBe(false);
    }
  });

  it("puts the audited Kazakhstan, France, Italy, Türkiye and Thailand streams on the event, division and day each title names", async () => {
    const KZ = "UCBXqD1Kn2u3mFnjHsHMMTKQ", FR = "UCDNTYCoNjRd_98Jl1vAUZNQ", IT = "UC3GrZQP1avoMFojc2HeQdhw", TR = "UCq5bJjdyfAQYIs7yb_83vaA", TH = "UC7e1UfLTHCdAoF7VIay_IqA";
    const rows = data.videos.filter((x) => [KZ, FR, IT, TR, TH].includes(x.channelId));
    // Every row, as checked by hand against Scout's event (name, city, dates, division) and the broadcast's date at the venue.
    const want: Record<string, [code: string, day: string, part: string | null, title: RegExp]> = {
      "jZl2tIXY-o8": ["2025/KZCMPJNB2", "2026-02-11", null, /Janibek Division$/], _hcWJRmSqL4: ["2025/KZCMPJNB2", "2026-02-12", null, /Janibek Division \/ 2 day/],
      "wbAPxGO-cYY": ["2025/KZCMPJNB2", "2026-02-13", null, /Janibek Division \/ Final/], "2V7r9Z5fyJU": ["2025/KZCMPKER1", "2026-02-11", null, /Kerei Division$/],
      d011bENwH1E: ["2025/KZCMPKER1", "2026-02-12", null, /Kerei Division \/ 2 day/], LY5qYOH825M: ["2025/KZCMPKER1", "2026-02-13", null, /Kerei Division \/ 3 day/],
      "1VAGi4X7hWA": ["2022/KZCMP", "2023-02-25", null, /Kazakhstan FTC Regional Championship \(day 1/], Qo6LAA4V17s: ["2022/KZASQ", "2023-01-21", null, /NURORDA/],
      pElHMjz2KTI: ["2025/FRVAQ", "2026-01-17", null, /Valence/], C1MZppQZ_9A: ["2025/FRCFQ", "2026-01-24", null, /Clermont-Ferrand/],
      u4xiGfaIJag: ["2025/FRMAQ", "2026-01-31", null, /Marnaz/], KvzkBaGxSKg: ["2025/FRBOQ", "2026-02-07", null, /Nantes/],
      "iU6NmAg5n-Q": ["2025/FRLPQ", "2026-02-14", null, /Levallois-Perret/], Shc82PcKSYk: ["2025/FRNSQ", "2026-02-28", null, /Neuville Sur Saone/],
      X71N6b7Fg5c: ["2022/FRLEOS", "2023-05-13", null, /Lyon - 13 mai 2023/],
      t8sbmKwOgiQ: ["2025/ITCMP", "2026-03-06", null, /Italy Championship \| Matches Day 1/], Ur7GkxC9DHQ: ["2025/ITCMP", "2026-03-07", null, /Italy Championship \| Matches Day 2/],
      "LCaHaXk-4b4": ["2024/ITCMP", "2025-02-21", null, /ITALY day 1/], mSpT17nesA4: ["2024/ITCMP", "2025-02-22", null, /ITALY day 2/],
      M3VDSHGgvAU: ["2025/FPEISTRDIV", "2026-06-26", null, /RUMELİ DIVISION \| 1\. GÜN\/ DAY 1/], VLkKCpUWk60: ["2025/FPEISTRDIV", "2026-06-27", null, /RUMELİ DIVISION \| 2\. GÜN\/ DAY 2/],
      rJ7F9FQRRiw: ["2025/FPEISTRDIV", "2026-06-28", "Matches", /RUMELİ DIVISION \| 3\. GÜN\/ DAY 3/], kLd93Xsg53I: ["2025/FPEISTVDIV", "2026-06-26", null, /VALENS DIVISION \| 1\. GÜN\/ DAY 1/],
      w1CcVoFDMLs: ["2025/FPEISTVDIV", "2026-06-27", null, /VALENS DIVISION \| 2\. GÜN\/ DAY 2/], mq2FtxXkScQ: ["2025/FPEISTVDIV", "2026-06-28", "Matches", /VALENS DIVISION \| 3\. GÜN\/ DAY 3/],
      Jpy3rpbwEjo: ["2025/TRCMP", "2025-12-13", null, /Türkiye Şampiyonası 1\. Gün/], aAvVvXYugZY: ["2025/TRCMP", "2025-12-14", null, /Türkiye Şampiyonası 2\. Gün/],
      XLpFNSr8vCc: ["2024/TRISQ1", "2024-11-30", null, /1\. ÜSKÜDAR TURNUVASI 2\. GÜN/], D0GXMrOPKGQ: ["2024/TRISQ2", "2024-12-01", null, /2\. ÜSKÜDAR TURNUVASI 2\. GÜN/],
      "sJuQqp-bDuc": ["2025/THCMP", "2025-12-10", "Part 1", /Qualification Rounds/], G_jbsYYqJSc: ["2025/THCMP", "2025-12-10", "Part 2", /Qualification Matches/],
      "6xFBmEt2K1U": ["2025/THCMP", "2025-12-11", "Playoffs", /PLAY-OFF Rounds/], qpwV5uDTpZ4: ["2025/THCMP", "2025-12-11", "Awards", /Awards Presentation and Closing Ceremony/],
    };
    expect(rows.map((x) => x.videoId).sort()).toEqual(Object.keys(want).sort());
    for (const x of rows) {
      const [key, day, part, title] = want[x.videoId];
      expect(`${x.season}/${x.code}`, x.videoId).toBe(key);
      expect([x.kind, x.day, x.part ?? null], x.videoId).toEqual(["recording", day, part]);
      expect(x.title, x.videoId).toMatch(title);
      // A division's stream names that division and never the other one; no division stream sits on a parent event.
      if (/Janibek|Kerei|RUMELİ|VALENS/.test(x.title)) expect(x.code, x.videoId).toMatch(/JNB2|KER1|RDIV|VDIV/);
      if (/Janibek/.test(x.title)) expect(x.code).toBe("KZCMPJNB2");
      if (/Kerei/.test(x.title)) expect(x.code).toBe("KZCMPKER1");
      if (/RUMELİ/.test(x.title)) expect(x.code).toBe("FPEISTRDIV");
      if (/VALENS/.test(x.title)) expect(x.code).toBe("FPEISTVDIV");
    }
    // Italy 2026: the two match days only (no Mar 5 opening ceremony, no Day 3).
    expect(rows.filter((x) => x.season === 2025 && x.code === "ITCMP").map((x) => x.day).sort()).toEqual(["2026-03-06", "2026-03-07"]);
    // Left out: the France Finale's full version (FIRST's own link already plays that day), the Italy opening ceremony,
    // Istanbul's Finals & Closing (FIRST's own link on all three events), a 26-minute Janibek warm-up and a 9-minute
    // Thailand fragment (same titles as a full day), kickoffs, the 41-minute Daryn stream, Almaty Tech Cup's
    // multi-programme streams, and the 2023 Kazakhstan regional's second day (after Scout's dates).
    const ids = new Set(data.videos.map((x) => x.videoId));
    for (const no of ["GO9pF-txA7M", "-fyKHoLKOLs", "jNyGYYlRCX4", "cmh8-a6q1ck", "54kqOfIFa10", "W6YMkTyh6zI", "_tqPehio65E", "Vs5PyxLWPkg", "6d1BxiZJZXg",
      "9ywna4SeDoI", "EAkHPgVm-Ow", "sMXxC3mRNWc", "tTFeXzvE4YE", "R6GCegE51So", "W_VOLo2hHds", "ZXdoZmDoHp0", "w0H2auno5c8", "nfpl8OMUD4w"]) expect(ids.has(no), no).toBe(false);
    // The watcher reads the five channels, each for its own country only; the second Italy channel (@ftc-italy) isn't one.
    const { OFFICIAL_CHANNELS } = await import("../data/officialChannels");
    expect(OFFICIAL_CHANNELS.some((c) => c.channelId === "UCoRWIxQP8avk3wcmGEvnGMw")).toBe(false);
    expect(data.channels["UCoRWIxQP8avk3wcmGEvnGMw"]).toBeUndefined();
    const at = (country: string) => ({ season: 2026, code: "X", name: "x", type: "Qualifier", city: "c", state: null, country, start: "2026-12-05", end: "2026-12-05", timezone: "UTC", divisionCode: null, parent: false });
    for (const [id, country] of [[KZ, "Kazakhstan"], [FR, "France"], [IT, "Italy"], [TR, "Türkiye"], [TH, "Thailand"]] as const) {
      const rule = parseRule(OFFICIAL_CHANNELS.find((c) => c.channelId === id)!.region)!;
      expect(rule(at(country)), country).toBe(true);
      for (const other of ["USA", "Uzbekistan", "Belgium", "Romania", "Netherlands"]) expect(rule(at(other)), `${country} ${other}`).toBe(false);
    }
  });

  it("leaves out what the brief rules out", () => {
    const ids = new Set(data.videos.map((x) => x.videoId));
    // Ambiguous, unofficial, a different broadcaster, or blocked (docs/official-videos.md).
    for (const no of ["DIRpIQ4tX9M", "58cbWg355qs", "Hy1RhXR5m_E", "h8YcLrHi-wQ", "-BTNpJ2X1nE", "_HSS2tVlaew", "be0ahU8Eqz8", "cqdU1OSkirQ", "p01TnRl7nvQ", "q7CZqGeJvLo", "trBIleY7mMk", "C7gP557UknQ"]) expect(ids.has(no), no).toBe(false);
    // No Houston highlight from the Romania channel.
    for (const no of ["ftRnZIOtgTQ", "b_Ab_UpLkWo", "NnInm3IP2Ko", "1ZeVXfwUcNo", "8EUpGcyY8vY"]) expect(ids.has(no), no).toBe(false);
  });
});
