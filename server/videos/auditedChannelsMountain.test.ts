// The owner's audited channels (2026-11-14), Nevada, North Dakota and Montana: every checked recording sits on the
// Scout event its title names (name, city, dates, meet number, North or South), and the watcher's region rules take
// only those states' events.
import { describe, expect, it } from "vitest";
import { matchVideo, parseRule, type WatchEvent, type WatchVideo } from "./officialMatch";
import { OFFICIAL_CHANNELS } from "../data/officialChannels";
import type { OfficialList } from "./officialVideos";
import shipped from "../data/officialVideos.json" with { type: "json" };

const data = shipped as OfficialList;
const NV = "UCqDnAXt0clPQww74v7bUVkQ", ND = "UCowF1UaXnuuFV_sNIvpX-zQ", MT = "UCpPjg0KF7cwfbWoKAl0jiXQ";

// Scout's events (season/code → name, city, start, end), as the live database gave them on 2026-11-14.
const EVENTS: Record<string, [name: string, city: string, start: string, end: string]> = {
  "2026/USNVNNM1": ["Northern League Meet # 1N", "Reno", "2026-10-31", "2026-10-31"],
  "2026/USNVRES": ["Northern Tinker & Play Scrimmage", "Reno", "2026-10-10", "2026-10-10"],
  "2025/USNVCMP": ["Nevada Championship", "Reno", "2026-02-20", "2026-02-21"],
  "2025/USNVSNLT": ["NV Southern League Tournament", "Las Vegas", "2026-02-06", "2026-02-07"],
  "2025/USNVNNLT": ["NV Northern League Tournament", "Reno", "2026-02-06", "2026-02-07"],
  "2025/USNVSNM6": ["NV Southern League Meet # 6S", "Boulder City", "2026-01-24", "2026-01-24"],
  "2025/USNVSNM5": ["NV Southern League Meet # 5S", "Boulder City", "2026-01-24", "2026-01-24"],
  "2025/USNVNNM4": ["NV Northern League Meet # 4N", "Sparks", "2026-01-24", "2026-01-24"],
  "2025/USNVNNM3": ["NV Northern League Meet # 3N", "Sparks", "2026-01-24", "2026-01-24"],
  "2025/USNVSNM4": ["NV Southern League Meet # 4S", "Mesquite", "2026-01-10", "2026-01-10"],
  "2025/USNVSNM3": ["NV Southern League Meet # 3S", "Mesquite", "2026-01-10", "2026-01-10"],
  "2025/USNVNNM2": ["NV Northern League Meet # 2N", "Yerington", "2026-01-10", "2026-01-10"],
  "2025/USNVSNM2": ["NV Southern League Meet # 2S", "Las Vegas", "2025-12-06", "2025-12-06"],
  "2025/USNVSNM1": ["NV Southern League Meet # 1S", "Las Vegas", "2025-12-06", "2025-12-06"],
  "2025/USNVNNM1": ["NV Northern League Meet # 1N", "Reno", "2025-12-06", "2025-12-06"],
  "2025/USNVZCS": ["NV Northern Scrimmage", "Zephyr Cove", "2025-11-01", "2025-11-01"],
  "2024/USNVCMP": ["Nevada Championship", "Las Vegas", "2025-02-21", "2025-02-22"],
  "2024/USNVSOLT": ["NV Southern League Tournament", "Las Vegas", "2025-02-07", "2025-02-08"],
  "2024/USNVNOLT": ["NV Northern League Tournament", "Reno", "2025-02-07", "2025-02-08"],
  "2024/USNVSOM6": ["NV Southern League Meet # 6S", "Las Vegas", "2025-01-25", "2025-01-25"],
  "2024/USNVSOM5": ["NV Southern League Meet # 5S", "Las Vegas", "2025-01-25", "2025-01-25"],
  "2024/USNVNOM6": ["NV Northern League Meet # 6N", "Sparks", "2025-01-25", "2025-01-25"],
  "2024/USNVNOM5": ["NV Northern League Meet # 5N", "Sparks", "2025-01-25", "2025-01-25"],
  "2024/USNVSOM4": ["NV Southern League Meet # 4S", "Pahrump", "2025-01-11", "2025-01-11"],
  "2024/USNVSOM3": ["NV Southern League Meet # 3S", "Pahrump", "2025-01-11", "2025-01-11"],
  "2024/USNVNOM4": ["NV Northern League Meet # 4N", "Yerington", "2025-01-11", "2025-01-11"],
  "2024/USNVNOM3": ["NV Northern League Meet # 3N", "Yerington", "2025-01-11", "2025-01-11"],
  "2024/USNVSOM2": ["NV Southern League Meet # 1S", "Las Vegas", "2024-12-07", "2024-12-07"],
  "2024/USNVSOM1": ["NV Southern League Meet # 2S", "Las Vegas", "2024-12-07", "2024-12-07"],
  "2024/USNVNOM1": ["NV Northern League Meet # 1N", "Reno", "2024-12-07", "2024-12-07"],
  "2024/USNVRES": ["NV Northern Scrimmage", "Virginia City", "2024-10-26", "2024-10-26"],
  "2023/USNVCMP": ["Nevada Championship", "Reno", "2024-03-01", "2024-03-02"],
  "2023/USNVSOLT": ["NV League Tournament - Southern Nevada", "Las Vegas", "2024-02-09", "2024-02-10"],
  "2023/USNVNOLT": ["NV League Tournament - Northern Nevada", "Reno", "2024-02-09", "2024-02-10"],
  "2023/USNVSOM2": ["NV League Meet # 5S - Southern Nevada", "Las Vegas", "2024-02-03", "2024-02-03"],
  "2023/USNVSOM3": ["NV League Meet # 6S - Southern Nevada", "Las Vegas", "2024-02-03", "2024-02-03"],
  "2023/USNVNOM2": ["NV League Meet # 6N - Northern Nevada", "Carson City", "2024-02-03", "2024-02-03"],
  "2023/USNVNOM3": ["NV League Meet # 5N - Northern Nevada", "Carson City", "2024-02-03", "2024-02-03"],
  "2023/USNVSOM4": ["NV League Meet # 4S - Southern Nevada", "Pahrump", "2024-01-20", "2024-01-20"],
  "2023/USNVSOM5": ["NV League Meet # 3S - Southern Nevada", "Pahrump", "2024-01-20", "2024-01-20"],
  "2023/USNVNOM4": ["NV League Meet # 4N - Northern Nevada", "Reno", "2024-01-20", "2024-01-20"],
  "2023/USNVNOM5": ["NV League Meet # 3N - Northern Nevada", "Reno", "2024-01-20", "2024-01-20"],
  "2023/USNVSOM1": ["NV League Meet # 2S - Southern Nevada", "Las Vegas", "2023-12-13", "2023-12-13"],
  "2023/USNVNOM1": ["NV League Meet # 2N - Northern Nevada", "Sparks", "2023-12-13", "2023-12-13"],
  "2023/USNVNOM6": ["NV League Meet # 1N - Northern Nevada", "Fallon", "2023-11-18", "2023-11-18"],
  "2023/USNVRES": ["NV Scrimmage - Northern Nevada", "Reno", "2023-10-28", "2023-10-28"],
  "2025/USNDBIQ": ["Dakota FTC Bismarck Qualifier", "Bismarck", "2026-01-06", "2026-01-11"],
  "2025/USNDCMP": ["North Dakota Championship", "Bismarck", "2026-02-13", "2026-02-15"],
  "2025/USNDMIQ": ["Dakota FTC Minot Qualifier", "Minot", "2026-01-13", "2026-01-18"],
  "2024/USNDBIQ": ["Bismarck Qualifier", "Bismarck", "2025-02-01", "2025-02-02"],
  "2024/USNDMIQ": ["Minot Qualifier", "Minot", "2025-01-18", "2025-01-19"],
  "2023/USNDCMP": ["North Dakota FTC State Championships", "Bismarck", "2024-02-03", "2024-02-04"],
  "2023/USNDMAQ": ["ND Western Dakota FTC Qualifier", "Bismarck", "2024-01-12", "2024-01-13"],
  "2023/USMTCMP": ["MT Montana FTC Regional Championship", "Bozeman", "2024-02-01", "2024-02-02"],
  "2023/USMTBUQ": ["MT Butte CENTERSTAGE Qualifier - Montana Technological University", "Butte", "2023-12-01", "2023-12-02"],
  "2022/USMTCMP": ["Montana Regional Championship", "Bozeman", "2023-02-02", "2023-02-03"],
};

const rowsOf = (ch: string) => data.videos.filter((x) => x.channelId === ch);
const eventOf = (x: OfficialList["videos"][number]) => {
  const e = EVENTS[`${x.season}/${x.code}`];
  expect(e, `${x.season}/${x.code} ${x.videoId}`).toBeTruthy();
  expect(x.kind, x.videoId).toBe("recording");
  expect(x.day! >= e[2] && x.day! <= e[3], `${x.videoId} ${x.day} outside ${e[2]}..${e[3]}`).toBe(true);
  return e;
};
const kindOf = (s: string) => /championship/i.test(s) ? "championship" : /league tournament/i.test(s) ? "tournament" : /scrimmage/i.test(s) ? "scrimmage" : /meet/i.test(s) ? "meet" : /qual/i.test(s) ? "qualifier" : "?";

describe("audited channels: Nevada, North Dakota, Montana", () => {
  it("FIRST Nevada: each title's date, meet, kind and half of the state are its event's; North never on South", () => {
    const nv = rowsOf(NV);
    expect(nv).toHaveLength(46);
    for (const x of nv) {
      const [name] = eventOf(x);
      // Every title starts with the broadcast's date ("2026-02-07" or "2026 10 31").
      expect(x.title.slice(0, 10).replace(/ /g, "-"), x.videoId).toBe(x.day);
      expect(kindOf(x.title), x.videoId).toBe(kindOf(name));
      // The meet's number ("# 4S", or "Meet 1" in 2026); its half of the state is checked below.
      const meet = (s: string) => /(?:# ?|\bmeet )(\d)/i.exec(s)?.[1] ?? null;
      expect(meet(x.title), x.videoId).toBe(meet(name));
      if (kindOf(name) !== "championship") {
        const north = /northern|\bnonv\b/i.test(x.title), south = /southern|\bsonv\b/i.test(x.title);
        expect(north !== south, x.videoId).toBe(true);
        expect(north, x.videoId).toBe(/northern/i.test(name));
      }
    }
    // Journey 6: the 2026 State Championship and both Feb 7 League Tournaments.
    const at = (code: string) => nv.filter((x) => x.season === 2025 && x.code === code).map((x) => x.videoId);
    expect(at("USNVCMP")).toEqual(["rPW61bXBHIM"]);
    expect(at("USNVNNLT")).toEqual(["GNU-OERFgFI"]);
    expect(at("USNVSNLT")).toEqual(["_mm4KvzN6CI"]);
  });

  it("BCA Activities: Bismarck, Minot, Western and State titles on those events only; no Fargo stream", () => {
    const nd = rowsOf(ND);
    expect(nd).toHaveLength(7);
    for (const x of nd) {
      const [name] = eventOf(x);
      const place = /bismarck|minot|western/i.exec(x.title)?.[0].toLowerCase();
      if (place) expect(name.toLowerCase(), x.videoId).toContain(place);
      else expect(x.title, x.videoId).toMatch(/\bstate\b/i);
      expect(/championship/i.test(name), x.videoId).toBe(!place);
    }
    expect(nd.some((x) => /USNDFAQ/.test(x.code))).toBe(false);
    // Journey 10: Bismarck Qualifier Jan 10, 2026 and State Championship Feb 14, 2026.
    expect(nd.find((x) => x.videoId === "rLKw84eo9cQ")).toMatchObject({ season: 2025, code: "USNDBIQ", day: "2026-01-10" });
    expect(nd.find((x) => x.videoId === "5WEV3WXMpGA")).toMatchObject({ season: 2025, code: "USNDCMP", day: "2026-02-14" });
  });

  it("MT Robotics Alliance: Butte on Butte, State on the championship; the 2023 championship's two parts in order", () => {
    const mt = rowsOf(MT);
    expect(mt).toHaveLength(4);
    for (const x of mt) {
      const [name] = eventOf(x);
      if (/butte/i.test(x.title)) expect(name, x.videoId).toMatch(/butte/i);
      else { expect(x.title, x.videoId).toMatch(/state|championship/i); expect(name, x.videoId).toMatch(/championship/i); }
    }
    expect(mt.filter((x) => x.code === "USMTCMP" && x.season === 2022).map((x) => `${x.part} ${x.videoId}`)).toEqual(["Part 1 07rq8bjW4WQ", "Part 2 FNGBYCP5oHs"]);
    // One day's broadcast restarted (docs rule 7): YouTube's times, Part 1 17:01:33-23:13:53Z, Part 2 from 23:15:48Z.
    const [p1End, p2Start] = [Date.parse("2023-02-03T23:13:53Z"), Date.parse("2023-02-03T23:15:48Z")];
    expect(p2Start >= p1End && p2Start - p1End <= 30 * 60_000).toBe(true);
  });

  it("leaves out what was checked and failed", () => {
    const ids = new Set(data.videos.map((x) => x.videoId));
    // Blocked in nearly every country (Nevada #2N, 2024-12-07); empty or opening-ceremony-only streams; kickoffs,
    // workshops and coaches' calls (no event); the not-embeddable 2023 Dakota kickoff; Montana 2023 uploads with no
    // broadcast date; and every 2024-26 Montana / 2024 North Dakota State video, already played through FIRST's link.
    for (const no of ["829qOnD2too", "1WtCwHAdx-U", "ppp0SiSuuSE", "Kem3EzmwkGs", "TF-Re9AuH6s", "u1n82xBJYOQ", "J-M-mhsZUL8", "pbfNfL5dYlE", "-vsBYis5D9E", "53W34aRi_3c",
      "Qx6C9jxzy5g", "Hc7_ksYEi-E", "Xw9sHITGd3o", "vn3mSf5v47k", "bloW1Y5Zrek", "qY48xuLlr0A", "85TQ8zDMYtk"]) expect(ids.has(no), no).toBe(false);
  });

  it("the watcher reads each channel for its own state's events only", () => {
    const ev = (state: string, name: string): WatchEvent => ({ season: 2026, code: "X", name, type: "LeagueMeet", city: null, state, country: "USA", start: "2026-12-05", end: "2026-12-05", timezone: null, divisionCode: null, parent: false });
    const rule = (id: string) => parseRule(OFFICIAL_CHANNELS.find((c) => c.channelId === id)!.region)!;
    expect(rule(NV)(ev("NV", "Southern League Meet # 3S"))).toBe(true);
    expect(rule(NV)(ev("CA", "NorCal EB Meet 2"))).toBe(false);
    expect(rule(ND)(ev("ND", "Bismarck Qualifier"))).toBe(true);
    expect(rule(ND)(ev("SD", "Dakota Qualifier"))).toBe(false);
    expect(rule(MT)(ev("MT", "Montana Qualifier - Butte MT-Tech"))).toBe(true);
    expect(rule(MT)(ev("ID", "Magic Valley Qualifying Event"))).toBe(false);
  });

  it("BCA Activities, a school activities channel: a place-named Dakota FTC qualifier is added, a State title goes to review", () => {
    const seed = OFFICIAL_CHANNELS.find((c) => c.channelId === ND)!;
    const cmp: WatchEvent = { season: 2026, code: "USNDCMP", name: "North Dakota Championship", type: "Championship", city: "Bismarck", state: "ND", country: "USA", start: "2027-02-13", end: "2027-02-13", timezone: "America/Chicago", divisionCode: null, parent: false };
    const biq: WatchEvent = { ...cmp, code: "USNDBIQ", name: "Bismarck Qualifier", type: "Qualifier", start: "2027-01-09", end: "2027-01-09" };
    const vid = (title: string, start: string): WatchVideo => ({ videoId: "xxxxxxxxxxx", title, start, durationS: 5 * 3600, privacy: "public", embeddable: true, blockedIn: 0 });
    // Another activity's stream on the FTC championship's day shares only the state's words: never added.
    expect(matchVideo(vid("North Dakota State Championship", "2027-02-13T15:00:00Z"), seed, [cmp, biq]).kind).toBe("review");
    expect(matchVideo(vid("2027 Dakota FTC State Championship", "2027-02-13T15:00:00Z"), seed, [cmp, biq]).kind).toBe("review");
    expect(matchVideo(vid("2027 Bismarck ND FLL Qualifier", "2027-01-09T15:00:00Z"), seed, [cmp, biq]).kind).toBe("ignore");
    expect(matchVideo(vid("Dakota FTC Bismarck Qualifier", "2027-01-09T15:00:00Z"), seed, [cmp, biq])).toMatchObject({ kind: "add", event: { code: "USNDBIQ" } });
  });
});
