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

  it("leaves out what the brief rules out", () => {
    const ids = new Set(data.videos.map((x) => x.videoId));
    // Ambiguous, unofficial, a different broadcaster, or blocked (docs/official-videos.md).
    for (const no of ["DIRpIQ4tX9M", "58cbWg355qs", "Hy1RhXR5m_E", "h8YcLrHi-wQ", "-BTNpJ2X1nE", "_HSS2tVlaew", "be0ahU8Eqz8", "cqdU1OSkirQ", "p01TnRl7nvQ", "q7CZqGeJvLo", "trBIleY7mMk", "C7gP557UknQ"]) expect(ids.has(no), no).toBe(false);
    // No Houston highlight from the Romania channel.
    for (const no of ["ftRnZIOtgTQ", "b_Ab_UpLkWo", "NnInm3IP2Ko", "1ZeVXfwUcNo", "8EUpGcyY8vY"]) expect(ids.has(no), no).toBe(false);
  });
});
