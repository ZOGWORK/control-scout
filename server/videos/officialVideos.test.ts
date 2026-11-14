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
  it("puts Westwood Robotics' streams on the GEMS league each title names: Diamond never on Emerald, Meet 1 never on Meet 2", async () => {
    const WW = "UCyv6fRBcoK6mD6Br5M366yA";
    const ww = data.videos.filter((x) => x.channelId === WW);
    // Each event's league and meet, as Scout's event names give them (seasons 2024-26).
    const meets: Record<string, [league: "Diamond" | "Emerald", meet: number]> = {
      "2026/USTXCEGDM1": ["Diamond", 1], "2026/USTXCEGEM1": ["Emerald", 1], "2026/USTXCEGDM2": ["Diamond", 2], "2026/USTXCEGEM2": ["Emerald", 2],
      "2025/USTXCRDM1": ["Diamond", 1], "2025/USTXCREM1": ["Emerald", 1], "2025/USTXCRDM2": ["Diamond", 2], "2025/USTXCREM2": ["Emerald", 2],
      "2025/USTXCRDM3": ["Diamond", 3], "2025/USTXCREM3": ["Emerald", 3],
      "2024/USTXCGM6": ["Diamond", 1], "2024/USTXCGM1": ["Emerald", 1], "2024/USTXCGM2": ["Diamond", 2], "2024/USTXCGM4": ["Emerald", 2],
      "2024/USTXCGM5": ["Diamond", 3], "2024/USTXCGM3": ["Emerald", 3],
    };
    const others: Record<string, RegExp> = { "2025/USTXCRLT1": /GEMS League Tournament/, "2024/USTXCGLT": /GEMS League Tournament/, "2025/USTXAUSQ": /Austin Semi-Regional/, "2024/USTXAUQ": /Austin Semi-Area Championship/ };
    expect(ww).toHaveLength(21);
    for (const x of ww) {
      const key = `${x.season}/${x.code}`;
      expect(x.kind, x.videoId).toBe("recording");
      const m = meets[key];
      if (m) {
        expect(x.title, x.videoId).toMatch(new RegExp(`\\b${m[0]}\\b`));
        expect(x.title, x.videoId).not.toMatch(m[0] === "Diamond" ? /Emerald/ : /Diamond/);
        expect(x.title, x.videoId).toMatch(new RegExp(`\\bMeet ${m[1]}\\b`));
      } else {
        expect(others[key], key).toBeTruthy();
        expect(x.title, x.videoId).toMatch(others[key]);
      }
      expect(x.day! >= `${x.season}-09-01` && x.day! <= `${x.season + 1}-08-31`, `${x.videoId} ${x.day}`).toBe(true);
    }
    // Meet 2 of 2026-11-14 is listed before it airs, like FIRST's own livestream link.
    expect(ww.filter((x) => x.day === "2026-11-14").map((x) => x.videoId).sort()).toEqual(["rZ988MTkb5U", "tN9INIKnCT4"]);
    // The one split day names its parts (Qual 1-3, Qual 4-14).
    expect(ww.filter((x) => x.code === "USTXCGM4").map((x) => `${x.part} ${x.videoId}`).sort()).toEqual(["Part 1 5bz2KShacYM", "Part 2 ZMHn9_sK_AI"]);
    // Never: the overlays-only test stream, a scheduled stream that never aired, or Round Rock Gems titles (the 2023 events are in Austin).
    const ids = new Set(data.videos.map((x) => x.videoId));
    for (const no of ["28VU7025PRI", "6JHyF5LlZgA", "zazjO7ceiaE", "L_1obJYg4ew", "e7ogZt3pf5s", "YUWd0jBUM3g", "6n2jU5JXAqI"]) expect(ids.has(no), no).toBe(false);
    // The watcher reads the channel too, for those events only.
    const { OFFICIAL_CHANNELS } = await import("../data/officialChannels");
    const seed = OFFICIAL_CHANNELS.find((c) => c.channelId === WW)!;
    const inRegion = parseRule(seed.region)!;
    const tx = { season: 2026, type: "LeagueMeet", city: "Austin", state: "TX", country: "USA", start: "2026-11-14", end: "2026-11-14", timezone: "America/Chicago", divisionCode: null, parent: false };
    expect(inRegion({ ...tx, code: "USTXCEGDM2", name: "CTX GEMS Diamond League Meet 2" })).toBe(true);
    expect(inRegion({ ...tx, code: "USTXAUSQ", name: "FiT-Central Austin Semi-Regional" })).toBe(true);
    expect(inRegion({ ...tx, code: "USTXNONIM1", name: "NTX I-League Meet #1" })).toBe(false);
    expect(inRegion({ ...tx, code: "USIAIRISM3", name: "Iris Manson", state: "IA" })).toBe(false);
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

  it("puts FANGV's West Michigan streams on the meet each title names, and watches Stars of the Galaxy for Central Ohio only", async () => {
    const FANGV = "UCaojFS3JFPWY9kaoW6bhvvQ", SOTG = "UC576ZA1td9ZvsAUwPq1Ymaw";
    const rows = data.videos.filter((x) => x.channelId === FANGV).map((x) => `${x.season}/${x.code} ${x.day} ${x.videoId} ${x.kind}`).sort();
    // Meet 1, 3 and 4 already play FIRST's own link to the same streams; Meet 2 (Sat 08:45 EST) and Meet 5 (Sat 11-14, listed before it airs) don't.
    expect(rows).toEqual(["2026/USMIWMM2 2026-11-07 1K5DNOqzuIg recording", "2026/USMIWMM5 2026-11-14 6lcZz9UrOdE recording"]);
    // Each title's meet number is the event's ("West Michigan Meet 2" is USMIWMM2 in Scout).
    const meet: Record<string, number> = { USMIWMM2: 2, USMIWMM5: 5 };
    for (const x of data.videos.filter((v) => v.channelId === FANGV)) expect(x.title, x.videoId).toBe(`West Michigan FTC League Meet ${meet[x.code]} - BIOBUZZ`);
    // Stars of the Galaxy's streams are all FIRST's own links already (Central Ohio 2025 and 2026): nothing added twice.
    expect(data.videos.some((x) => x.channelId === SOTG)).toBe(false);
    // Never FANGV's Robot in 3 Days (FRC) streams.
    const ids = new Set(data.videos.map((x) => x.videoId));
    for (const no of ["39f7WaZNFxw", "8oSb8QlFMKg", "QyzpYTuXL1o", "Chmx9cPSsg8", "ek8azJdipFE", "Xtf13QgWN9w"]) expect(ids.has(no), no).toBe(false);
    const { OFFICIAL_CHANNELS } = await import("../data/officialChannels");
    const rule = (id: string) => parseRule(OFFICIAL_CHANNELS.find((c) => c.channelId === id)!.region)!;
    const base = { season: 2026, type: "LeagueMeet", country: "USA", start: "2026-11-14", end: "2026-11-14", timezone: "America/New_York", divisionCode: null, parent: false };
    const mi = { ...base, city: "Grand Rapids", state: "MI" }, oh = { ...base, city: "Columbus", state: "OH" };
    expect(rule(FANGV)({ ...mi, code: "USMIWMM6", name: "West Michigan Meet 6" })).toBe(true);
    expect(rule(FANGV)({ ...mi, code: "USMIWMLT", name: "West Michigan League Tournament" })).toBe(true);
    expect(rule(FANGV)({ ...mi, code: "USMISAM1", name: "MSCRL Saline Meet 1", city: "Saline" })).toBe(false);
    expect(rule(FANGV)({ ...oh, code: "USOHWEM1", name: "West Michigan Meet 1" })).toBe(false);
    expect(rule(SOTG)({ ...oh, code: "USOHCOHM3", name: "Central Ohio League Meet 3" })).toBe(true);
    expect(rule(SOTG)({ ...oh, code: "USOHCOHLT", name: "Central Ohio League Tournament" })).toBe(true);
    expect(rule(SOTG)({ ...oh, code: "USOHNEQ", name: "Ohio Qualifier", city: "Newark" })).toBe(false);
    expect(rule(SOTG)({ ...mi, code: "USMIWMM6", name: "West Michigan Meet 6" })).toBe(false);
    // The watcher puts FANGV's next stream on its own meet, never on the other meet that day.
    const { matchVideo } = await import("./officialMatch");
    const seed = OFFICIAL_CHANNELS.find((c) => c.channelId === FANGV)!;
    const day = [5, 6].map((n) => ({ ...mi, code: `USMIWMM${n}`, name: `West Michigan Meet ${n}` }));
    const v = { videoId: "x", title: "West Michigan FTC League Meet 6 - BIOBUZZ", start: "2026-11-14T18:00:00Z", durationS: 7200, privacy: "public", embeddable: true, blockedIn: 0 };
    const got = matchVideo(v, seed, day);
    expect(got.kind === "add" && got.event.code).toBe("USMIWMM6");
  });

  it("puts the audited Rhode Island, NYC, Long Island and Ontario streams on the event and day each title names", async () => {
    const RI = "UCHgwJxb_Y5SRtrAGCzk73MQ", ON = "UCUXJ0amrR15tPMgXvhDLJQw", LI = "UCe22ftqf7OwtH40JBuP-anA", NYC = "UCibawtHwGEggHlSiBOSPVtw", PEN = "UCLctix0o61bACiWd6Oa-S5Q";
    const rows = data.videos.filter((x) => [RI, ON, LI, NYC, PEN].includes(x.channelId));
    // Every row, as checked against Scout's event (name, city, dates, division) and the broadcast's date at the venue:
    // channel, event, day, part (consecutive broadcasts of one day, in broadcast order), and the qualifier number in Scout's name.
    const want: Record<string, [channel: string, key: string, day: string, part: string | null, n: number | null]> = {
      "q0GOfMdya9Y": [RI, "2025/USRICMP", "2026-02-08", null, null],
      "vFssfVAOVY8": [RI, "2025/USRILCQ", "2026-01-17", null, 2],
      "wNIXavozWP8": [RI, "2025/USRIWOQ", "2026-01-31", null, null],
      "SENZnQoIOsc": [RI, "2024/USRINKS", "2024-11-23", null, null],
      "lQhGe32YLF4": [RI, "2024/USRINKQ", "2025-01-04", null, null],
      "tfadc2DvS4Q": [RI, "2024/USRIWOQ", "2025-01-11", null, null],
      "xOrM2oUfKDY": [RI, "2024/USRIPRQ", "2025-01-18", null, null],
      "p178qoPWNw4": [RI, "2024/USRICMP", "2025-02-08", null, null],
      "zHUlOizdf-U": [RI, "2023/USRINKQ", "2024-01-20", null, null],
      "Dh3gs0rYAxw": [RI, "2023/USRIWOQ", "2024-01-27", null, null],
      "oiugk0ztCdc": [RI, "2023/USRICMP", "2024-02-10", null, null],
      "rYYSXefbrfs": [RI, "2022/USRIPRQ", "2023-01-07", null, null],
      "Gt8cKxj0hCo": [RI, "2022/USRIEGQ", "2023-01-14", null, null],
      "n3NY8-UinQk": [RI, "2022/USRIWOQ", "2023-01-21", null, null],
      "-pf6meP7LDM": [RI, "2022/USRICMP", "2023-03-04", null, null],
      "-IAzDKKLNuw": [NYC, "2025/USNYNYNYQ1", "2025-11-16", null, 1],
      "G55bnpcodlw": [NYC, "2025/USNYNYBRQ1", "2025-12-06", null, 2],
      "CoS0qLUPftA": [NYC, "2025/USNYNYBRQ3", "2025-12-20", null, 4],
      "Qy3WtzBQErs": [NYC, "2025/USNYNYBRQ4", "2025-12-21", null, 5],
      "JRzsvPM5lqo": [NYC, "2025/USNYNYOPQ1", "2026-01-03", "Part 1", 6],
      "tUudcW8havo": [NYC, "2025/USNYNYOPQ1", "2026-01-03", "Part 2", 6],
      "SmQVlTgs2pk": [NYC, "2025/USNYNYOPQ2", "2026-01-04", null, 7],
      "tFTQ-4jSPpE": [NYC, "2025/USNYNYFMQ1", "2026-01-17", null, 8],
      "whQHG4hKk_E": [NYC, "2025/USNYNYFMQ2", "2026-01-18", null, 9],
      "vAb0jDv4wp0": [NYC, "2025/USNYNYSIQ", "2026-02-07", null, 10],
      "OpnhJC-vOTY": [NYC, "2025/USNYNYNYQ2", "2026-02-14", "Part 1", 11],
      "QaoFkx2WSpo": [NYC, "2025/USNYNYNYQ2", "2026-02-14", "Part 2", 11],
      "uZ7GTFhUuCM": [NYC, "2025/USNYNYNYQ3", "2026-02-15", null, 12],
      "LSdO_WMsDps": [NYC, "2025/USNYNYBRSQ1", "2026-02-28", null, 1],
      "U48OrXvSQ1g": [NYC, "2025/USNYNYBRSQ2", "2026-03-01", "Part 1", 2],
      "7qaN4KDIo-0": [NYC, "2025/USNYNYBRSQ2", "2026-03-01", "Part 2", 2],
      "JPtpfMJDVc4": [NYC, "2025/USNYNYCMP", "2026-03-08", null, null],
      "EX7pPUu4cPw": [NYC, "2024/USNYNYNYQ", "2024-11-17", null, 1],
      "0NPcADwhNaU": [NYC, "2024/USNYNYBRQ1", "2024-12-07", null, 2],
      "yF-rG4-79K4": [NYC, "2024/USNYNYBRQ2", "2024-12-08", null, 3],
      "bhqGvlo8iD8": [NYC, "2024/USNYNYQUQ1", "2025-01-18", null, 4],
      "kZ0bNKld2nI": [NYC, "2024/USNYNYQUQ3", "2025-01-25", null, 6],
      "k6Fc0ugxs8Y": [NYC, "2024/USNYNYQUQ4", "2025-01-26", null, 7],
      "kQX_8NNSd74": [NYC, "2024/USNYNYBRQ3", "2025-02-01", null, 8],
      "acLq5K2aYik": [NYC, "2024/USNYNYBRSQ1", "2025-02-08", "Part 1", 1],
      "uYhtaGBoPSE": [NYC, "2024/USNYNYBRSQ1", "2025-02-08", "Part 2", 1],
      "x37u8TMx80M": [NYC, "2024/USNYNYBRSQ2", "2025-02-09", null, 2],
      "PrcJN6KO-jw": [NYC, "2024/USNYNYCMP1", "2025-03-02", "Part 1", null],
      "pWqoUgYqdM0": [NYC, "2024/USNYNYCMP1", "2025-03-02", "Part 2", null],
      "uWu3CvfZ8kM": [NYC, "2023/USNYNYBRQ2", "2023-12-09", null, 2],
      "8WYcC7-irQw": [NYC, "2023/USNYNYBRQ1", "2023-12-10", "Part 1", 3],
      "4f-1Pb6sKXY": [NYC, "2023/USNYNYBRQ1", "2023-12-10", "Part 2", 3],
      "ERObpss0too": [NYC, "2023/USNYNYQUQ4", "2024-01-14", "Part 1", 5],
      "pJNqDE35UXs": [NYC, "2023/USNYNYQUQ4", "2024-01-14", "Part 2", 5],
      "B-f697Ai05s": [NYC, "2023/USNYNYQUQ3", "2024-01-27", null, 6],
      "cyda6s2qfCU": [NYC, "2023/USNYNYQUQ2", "2024-01-28", null, 7],
      "qUp9Tt1fchY": [NYC, "2023/USNYNYBRSQ2", "2024-02-04", null, null],
      "pi7404qoAww": [NYC, "2022/USNYNYQUQ1", "2022-11-05", null, 1],
      "sM21G_St-nE": [NYC, "2022/USNYNYOPQ", "2022-11-06", null, 2],
      "VaCRr5f4sP0": [NYC, "2022/USNYNYQUQ6", "2023-01-15", null, 6],
      "JQnHdd8lfb8": [NYC, "2022/USNYNYBRQ7", "2023-02-04", null, 7],
      "fNaOqiBGbII": [NYC, "2022/USNYNYBRQ8", "2023-02-05", null, 8],
      "P34D_YVFs-Y": [NYC, "2022/USNYNYNYSQ", "2023-02-11", null, 1],
      "Az6YSXVJ710": [NYC, "2022/USNYNYNYSQ2", "2023-02-12", null, 2],
      "R_CFejqerGI": [NYC, "2022/USNYNYCMP", "2023-03-05", null, null],
      "S-zsWzkH9KI": [LI, "2025/USNYLIBAQ", "2025-12-07", null, 1],
      "dtQqffR7rr8": [LI, "2025/USNYLILVQ4", "2026-01-31", null, 4],
      "F7XYVwiMp-o": [LI, "2025/USNYLILVQ5", "2026-02-01", null, 5],
      "l0BXMZiglD8": [LI, "2025/USNYLICMP", "2026-03-01", null, null],
      "we8IuWzo61s": [LI, "2024/USNYLILVQ3", "2025-02-01", null, 3],
      "WmiSa9j0Lfg": [LI, "2024/USNYLILVQ4", "2025-02-02", null, 4],
      "VtaAXQ2SWlg": [LI, "2024/USNYLICMP", "2025-03-16", null, null],
      "Df8xuBU8pXk": [LI, "2023/USNYLILVQ4", "2024-02-03", null, 4],
      "ujPky20sJy0": [LI, "2023/USNYLILVQ5", "2024-02-04", null, 5],
      "3Fx_9Vsp288": [LI, "2023/USNYLICMP", "2024-03-03", null, null],
      "Jh8OJMFh3lU": [ON, "2024/CAONOTQ", "2024-12-07", null, null],
      "fs6fgO9vxJI": [ON, "2025/CAONCMP", "2026-02-22", null, null],
      "xQewZrzObUc": [ON, "2025/FPECCNSCIE", "2026-06-15", null, null],
      "IiSNRPTeu44": [ON, "2025/FPECCNSCIE", "2026-06-16", null, null],
      "Rj6gfqq23Zs": [ON, "2025/FPECCNTECH", "2026-06-15", null, null],
      "3m1Cv3ZMYXk": [ON, "2025/FPECCNTECH", "2026-06-16", null, null],
    };
    expect(rows.map((x) => x.videoId).sort()).toEqual(Object.keys(want).sort());
    for (const x of rows) {
      const [channel, key, day, part, n] = want[x.videoId];
      expect([x.channelId, `${x.season}/${x.code}`, x.kind, x.day, x.part ?? null], x.videoId).toEqual([channel, key, "recording", day, part]);
      // A numbered qualifier's title names that number: Qualifier 5 never goes to Qualifier 4.
      const t = /(?:Qualif\w*|Qualfier|Tournament|Tournement)[\s#-]*(\d+)/i.exec(x.title);
      if (n != null) expect(Number(t?.[1]), x.videoId).toBe(n);
      // A Canada Cup division stream names its own division.
      if (x.code === "FPECCNSCIE") expect(x.title).toMatch(/Science Division - Day [12]$/);
      if (x.code === "FPECCNTECH") expect(x.title).toMatch(/Technology Division - Day [12]$/);
      // A title's own date, where it has one, is the broadcast's.
      const d = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(x.title);
      if (d) expect(`${d[3].length === 2 ? "20" + d[3] : d[3]}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}`, x.videoId).toBe(x.day);
    }
    // Penfield TV's FTC videos are uploads of NY Excelsior events that NY Excelsior FIRST's own recordings already cover.
    expect(rows.some((x) => x.channelId === PEN)).toBe(false);
    // Left out: FIRST's own links to the same videos; titles whose date or number disagrees with the broadcast
    // (NYC 2025 Qualifier 3 dated 12/6, 2024 Qualifier 5 dated 12/19/2025, 2024 "Super Qualifier-2" aired 2/3, 2024
    // Championship dated 2/3); North York 2025's unnamed morning half (FIRST links the afternoon); Ontario's "Full
    // Field" second camera; short fragments; uploads without a broadcast date; and the 2026-27 streams not yet aired.
    const ids = new Set(data.videos.map((x) => x.videoId));
    for (const no of ["bjwZWaiMwnc", "7aom0H3ZfWI", "H0i2yhkxMCM", "wDcRnpNlqMc", "ov23pPcnYyI", "hRn_bOe1UtE", "uUZ03ZjR1WM", "WiN8BWcsN_0",
      "Rq_wGsWqnGo", "HFMdGKV4kNQ", "SQSPbhc3Kic", "LEv6I6K7DH8", "b_yw_UJAlL0", "iVjjczvTYNo", "XEKw5t0quig", "7VMoBFfo5CE", "ki9Nud5FGJk",
      "-BTNpJ2X1nE", "_HSS2tVlaew", "a1Mhn922of0", "ynP0JWj1gos", "a3BaTdugU5E", "gF8G9Vb-GHY"]) expect(ids.has(no), no).toBe(false);
    // The watcher: each channel only for its own events, and each next-season title on its own event.
    const { OFFICIAL_CHANNELS } = await import("../data/officialChannels");
    const { matchVideo } = await import("./officialMatch");
    const seed = (id: string) => OFFICIAL_CHANNELS.find((c) => c.channelId === id)!;
    const ev = (code: string, name: string, state: string, start: string, country = "USA") => ({ season: 2026, code, name, type: "Qualifier", city: "c", state, country, start, end: start, timezone: "America/New_York", divisionCode: null, parent: false });
    const all = [
      ev("USRIWAQ", "Rhode Island Qualifier 1", "RI", "2027-01-09"), ev("USRICMP", "Rhode Island Championship", "RI", "2027-02-28"),
      ev("CAONMIQ", "Mississauga Qualifier", "ON", "2026-11-21", "Canada"), ev("CAONNYQ", "North York Qualifier", "ON", "2026-11-21", "Canada"),
      ev("USNYLIBEQ1", "Qualifier 1", "NY", "2026-12-19"), ev("USNYNYBRQ5", "NYC Qualifier 5", "NY", "2026-12-19"),
      ev("USNYNYBRQ1", "NYC Qualifier 3", "NY", "2026-12-05"), ev("USNYEXHJQ", "John Jay Qualifier", "NY", "2026-12-05"),
    ];
    const v = (title: string, start: string) => ({ videoId: "x", title, start, durationS: 20000, privacy: "public", embeddable: true, blockedIn: 0 });
    const to = (id: string, title: string, start: string) => { const r = matchVideo(v(title, start), seed(id), all); return r.kind === "add" ? r.event.code : r.kind; };
    expect(to(RI, "2026-2027 Rhode Island FTC Qualifier 1", "2027-01-09T15:00:00Z")).toBe("USRIWAQ");
    // Its championship stream is scheduled for Feb 27, a day before Scout's date: the owner decides.
    expect(to(RI, "2026-2027 Rhode Island FTC Championship", "2027-02-27T15:00:00Z")).toBe("review");
    expect(to(ON, "2026 FTC Mississauga Qualifier", "2026-11-21T15:00:00Z")).toBe("CAONMIQ");
    expect(to(ON, "2026 FTC North York Qualifier", "2026-11-21T15:00:00Z")).toBe("CAONNYQ");
    expect(to(LI, "[FTC] FIRST Long Island Qualifier 1 - Bethpage (USNYLIBEQ1)", "2026-12-19T15:00:00Z")).toBe("USNYLIBEQ1");
    expect(to(NYC, "FTC NYC Qualifier 5 | 12/19/2026 | FTC BioBuzz", "2026-12-19T15:00:00Z")).toBe("USNYNYBRQ5");
    expect(to(NYC, "FTC NYC Qualifier 3 | 12/5/2026 | FTC BioBuzz", "2026-12-05T15:00:00Z")).toBe("USNYNYBRQ1");
    expect(to(PEN, "FTC Robotics Qualifier | John Jay | Dec. 2026", "2026-12-05T15:00:00Z")).toBe("USNYEXHJQ");
    const rule = (id: string) => parseRule(seed(id).region)!;
    expect(all.filter(rule(LI)).map((e) => e.code)).toEqual(["USNYLIBEQ1"]);
    expect(all.filter(rule(NYC)).map((e) => e.code)).toEqual(["USNYNYBRQ5", "USNYNYBRQ1"]);
    expect(all.filter(rule(PEN)).map((e) => e.code)).toEqual(["USNYEXHJQ"]);
    expect(all.filter(rule(ON)).map((e) => e.code)).toEqual(["CAONMIQ", "CAONNYQ"]);
    expect(all.filter(rule(RI)).map((e) => e.code)).toEqual(["USRIWAQ", "USRICMP"]);
    // MSC Robotics (one confirmed MSCRL video, nothing else closes it) is neither watched nor linked.
    expect(OFFICIAL_CHANNELS.some((c) => c.channelId === "UCqo3u6lcGkpPoqjrtn0zvdw")).toBe(false);
  });

  it("leaves out what the brief rules out", () => {
    const ids = new Set(data.videos.map((x) => x.videoId));
    // Ambiguous, unofficial, a different broadcaster, or blocked (docs/official-videos.md).
    for (const no of ["DIRpIQ4tX9M", "58cbWg355qs", "Hy1RhXR5m_E", "h8YcLrHi-wQ", "-BTNpJ2X1nE", "_HSS2tVlaew", "be0ahU8Eqz8", "cqdU1OSkirQ", "p01TnRl7nvQ", "q7CZqGeJvLo", "trBIleY7mMk", "C7gP557UknQ"]) expect(ids.has(no), no).toBe(false);
    // No Houston highlight from the Romania channel.
    for (const no of ["ftRnZIOtgTQ", "b_Ab_UpLkWo", "NnInm3IP2Ko", "1ZeVXfwUcNo", "8EUpGcyY8vY"]) expect(ids.has(no), no).toBe(false);
  });
});
