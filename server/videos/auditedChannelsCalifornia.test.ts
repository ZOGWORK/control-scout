// The owner's audited channels (2026-11-14), California: NorCal FIRST Tech Challenge, FTC SoCal League G and 7419 Tech
// Support. Every checked recording sits on the Scout event its title names (place, QT number, division, meet), and the
// watcher's region rules take only NorCal's events and League G's.
import { describe, expect, it } from "vitest";
import { parseRule, type WatchEvent } from "./officialMatch";
import { OFFICIAL_CHANNELS } from "../data/officialChannels";
import type { OfficialList } from "./officialVideos";
import shipped from "../data/officialVideos.json" with { type: "json" };

const data = shipped as OfficialList;
const NC = "UCsWixqR83vr2poZHfU_FgcQ", G = "UCJAVhMsmeKHf7riEsPafi9w", T7419 = "UCesNcwI6hz2m5T44R2_9rlA";

// Scout's events (season/code → name, city, start, end), as the live database gave them on 2026-11-14.
const EVENTS: Record<string, [name: string, city: string, start: string, end: string]> = {
  "2026/USCANOSJS": ["NorCal Screamage", "San Jose", "2026-11-01", "2026-11-01"],
  "2025/USCANOCMPAU": ["NorCal Regional Championship - Gold Division", "Palo Alto", "2026-02-28", "2026-03-01"],
  "2025/USCANOCMPSI": ["NorCal Regional Championship - Silicon Division", "Palo Alto", "2026-02-28", "2026-03-01"],
  "2025/USCANOMVQ": ["Mountain View QT", "Mountain View", "2026-02-07", "2026-02-07"],
  "2025/USCANOSJQ2": ["The Play Space QT #1", "San Jose", "2026-02-01", "2026-02-01"],
  "2025/USCANOSJQ7": ["The Play Space #8", "San Jose", "2025-12-14", "2025-12-14"],
  "2025/USCANOSJQ6": ["The Play Space #7", "San Jose", "2025-12-13", "2025-12-13"],
  "2025/USCANOSJQ5": ["The Play Space #6", "San Jose", "2025-12-06", "2025-12-06"],
  "2025/USCANOSJQ3": ["The Play Space QT #2", "San Jose", "2025-11-23", "2025-11-23"],
  "2025/USCANOSJQ4": ["The Play Space QT #3", "San Jose", "2025-11-15", "2025-11-15"],
  "2024/USCANOCMPAU": ["California - Northern Championship - Gold Division", "Newark", "2025-02-22", "2025-02-23"],
  "2024/USCANOCMPSI": ["California - Northern Championship - Silicon Division", "Newark", "2025-02-22", "2025-02-23"],
  "2023/USCANOCMPAU": ["California NorCal Regional Championship - Gold Division Division", "San Jose", "2024-02-24", "2024-02-25"],
  "2023/USCANOCMPSI": ["California NorCal Regional Championship - Silicon Division Division", "San Jose", "2024-02-24", "2024-02-25"],
  "2022/USCANOCMPAU": ["California-NorCal FTC Regional Championship - Gold Division", "San Jose", "2023-03-04", "2023-03-05"],
  "2022/USCANOCMPSI": ["California-NorCal FTC Regional Championship - Silicon Division", "San Jose", "2023-03-04", "2023-03-05"],
  "2022/USCANOSJQ": ["CA-NorCal San Jose #4 Qualifying Tournament", "San Jose", "2023-02-05", "2023-02-05"],
  "2022/USCANOSJQ2": ["CA-NorCal San Jose #2 Qualifying Tournament", "San Jose", "2023-01-15", "2023-01-15"],
  "2022/USCANOSJQ1": ["CA-NorCal San Jose #1 Qualifying Tournament", "San Jose", "2023-01-08", "2023-01-08"],
  "2022/USCANOSBM2B": ["CA-NorCal South Bay Metro League Meet 2b", "San Jose", "2022-12-17", "2022-12-17"],
  "2022/USCANOSBM2A": ["CA-NorCal South Bay Metro League Meet 2a", "San Jose", "2022-12-17", "2022-12-17"],
  "2021/USCANOCMPAU": ["California-NorCal Regional Championship - Gold Division", "Newark", "2022-03-12", "2022-03-13"],
  "2021/USCANOCMPSI": ["California-NorCal Regional Championship - Silicon Division", "Newark", "2022-03-12", "2022-03-13"],
  "2021/USCANOSQ2": ["CA-Northern San Jose #2 Qualifying Tournament", "San Jose", "2022-02-19", "2022-02-19"],
  "2021/USCANOFOQ": ["CA-Northern Folsom Qualifying Tournament", "Folsom", "2022-02-12", "2022-02-12"],
  "2021/USCANOEGQ": ["CA-Northern Elk Grove Qualifying Tournament", "Elk Grove", "2022-02-06", "2022-02-06"],
  "2021/USCANOMVQ2": ["CA-Northern Mountain View Qualifying Tournament", "Mountain View", "2022-02-05", "2022-02-05"],
  "2021/USCANOSUQ": ["CA-Northern Sunnyvale Qualifying Tournament", "Sunnyvale", "2022-01-29", "2022-01-29"],
  "2021/USCANOSCQ": ["CA-Northern Santa Clara Qualifying Tournament", "Santa Clara", "2022-01-15", "2022-01-15"],
  "2021/USCANOSAQ2": ["CA-Northern Sacramento Qualifying Tournament", "Sacramento", "2021-12-11", "2021-12-11"],
  "2021/USCANOSAQ": ["CA-Northern Saratoga Qualifying Tournament", "Saratoga", "2021-12-05", "2021-12-05"],
  "2020/USCANSJCT": ["NorCal FTC-Regional Championship REMOTE", "Remote Event", "2021-05-02", "2021-05-02"],
  "2026/USCALACAS2": ["SoCal - G - Scrimmage 1", "Carson", "2026-11-07", "2026-11-07"],
  "2026/USCALACAS1": ["SoCal - G - Scrimmage 0", "Carson", "2026-10-24", "2026-10-24"],
  "2025/USCALACAS3": ["SoCal FTC Group G - Scrimmage 2", "Carson", "2025-12-13", "2025-12-13"],
  "2025/USCALACAS4": ["SoCal FTC Group G - Scrimmage 1", "Carson", "2025-11-15", "2025-11-15"],
  "2025/USCALACAS1": ["SoCal FTC Group G - Scrimmage 0", "Carson", "2025-10-18", "2025-10-18"],
  "2024/USCALAGM3": ["SoCal FTC League G - Meet 3", "Carson", "2025-01-18", "2025-01-18"],
  "2026/USCANOEBM1": ["NorCal EB Meet 1", "Dublin", "2026-11-01", "2026-11-01"],
};

const rowsOf = (ch: string) => data.videos.filter((x) => x.channelId === ch);
const eventOf = (x: OfficialList["videos"][number]) => {
  const e = EVENTS[`${x.season}/${x.code}`];
  expect(e, `${x.season}/${x.code} ${x.videoId}`).toBeTruthy();
  expect(x.kind, x.videoId).toBe("recording");
  expect(x.day! >= e[2] && x.day! <= e[3], `${x.videoId} ${x.day} outside ${e[2]}..${e[3]}`).toBe(true);
  return e[0];
};
const first = (re: RegExp, s: string) => re.exec(s)?.[1]?.toLowerCase() ?? null;

describe("audited channels: California", () => {
  it("NorCal FIRST Tech Challenge: place, QT number, division and meet are the event's; Gold never on Silicon", () => {
    const nc = rowsOf(NC);
    expect(nc).toHaveLength(33);
    const PLACE = /(screamage|play space|san jose|mountain view|folsom|elk grove|sunnyvale|santa clara|sacramento|saratoga|south bay)/i;
    for (const x of nc) {
      const name = eventOf(x);
      const champ = /championship/i.test(x.title);
      expect(/championship/i.test(name), x.videoId).toBe(champ);
      if (!champ) expect(first(PLACE, x.title), x.videoId).toBe(first(PLACE, name));
      expect(first(/(gold|silicon) division/i, x.title), x.videoId).toBe(first(/(gold|silicon) division/i, name));
      expect(first(/#(\d)/, x.title), x.videoId).toBe(first(/#(\d)/, name));
      expect(first(/meet (\d[ab]?)\b/i, x.title), x.videoId).toBe(first(/meet (\d[ab]?)\b/i, name));
    }
    // Journey 16: the BIOBUZZ Screamage (Nov 1, 2026) and the DECODE QTs.
    expect(nc.find((x) => x.videoId === "ffYioYR0TQE")).toMatchObject({ season: 2026, code: "USCANOSJS", day: "2026-11-01" });
    expect(nc.find((x) => x.videoId === "bMhkamaz9Z8")).toMatchObject({ season: 2025, code: "USCANOCMPAU", day: "2026-03-01" });
    expect(nc.filter((x) => x.season === 2025 && /Play Space|Mountain View/.test(x.title))).toHaveLength(7);
    // The one split day names its parts, in broadcast order.
    expect(nc.filter((x) => x.code === "USCANOSCQ").map((x) => `${x.part} ${x.videoId}`)).toEqual(["Part 1 tfCClIb8AnU", "Part 2 eXfH6cxEfwE"]);
  });

  it("FTC SoCal League G: each meet on League G's event with the same number, never another league's", () => {
    const g = rowsOf(G);
    expect(g).toHaveLength(6);
    for (const x of g) {
      const name = eventOf(x);
      expect(name, x.videoId).toMatch(/\bG\b/);
      expect(first(/meet (\d)/i, x.title), x.videoId).toBe(first(/(?:meet|scrimmage) (\d)/i, name));
      const year = /^(\d{4}) /.exec(x.title)?.[1];
      if (year) expect(Number(year), x.videoId).toBe(x.season);
    }
  });

  it("7419 Tech Support: the two long streams of East Bay Meet #1 only, as its two parts", () => {
    const t = rowsOf(T7419);
    expect(t.map((x) => `${x.season}/${x.code} ${x.day} ${x.part} ${x.videoId}`)).toEqual([
      "2026/USCANOEBM1 2026-11-01 Part 1 fdvPInsQ2mY", "2026/USCANOEBM1 2026-11-01 Part 2 44mne4zzkPU"]);
    for (const x of t) eventOf(x);
  });

  it("leaves out what was checked and failed", () => {
    const ids = new Set(data.videos.map((x) => x.videoId));
    // Already FIRST's own link (League G 2024 Meets 0-2); an undated upload (League G 2025 Meet 3); a scrimmage Scout
    // has no event for; a false-start and short restarts; 7419's FRC sim and short test streams; webinars and kickoffs.
    for (const no of ["cJYP0zQX8xk", "2PKJiU7_vuQ", "jgRLlw92hAk", "vGua-Y2ANkA", "mljqisRdhjY", "LizEgCXcMEE", "l3U5ZvvfFws", "6IYa3pcLR28", "ukr74I90ct0",
      "2i1_VVFu3y4", "EijEKNZX27o", "gnaJXc9GP-Y", "fGraUziq-Mc", "A67q1I0mu9Q"]) expect(ids.has(no), no).toBe(false);
  });

  it("the watcher reads NorCal for NorCal's events and League G for League G's only; 7419 isn't watched", () => {
    const ev = (name: string): WatchEvent => ({ season: 2026, code: "X", name, type: "LeagueMeet", city: null, state: "CA", country: "USA", start: "2026-12-05", end: "2026-12-05", timezone: null, divisionCode: null, parent: false });
    const rule = (id: string) => parseRule(OFFICIAL_CHANNELS.find((c) => c.channelId === id)!.region)!;
    expect(rule(NC)(ev("NorCal San Jose #3 QT"))).toBe(true);
    expect(rule(NC)(ev("NorCal EB Meet 2"))).toBe(true);
    expect(rule(NC)(ev("SoCal - G - Scrimmage 2"))).toBe(false);
    expect(rule(NC)({ ...ev("NorCal Screamage"), state: "NV" })).toBe(false);
    for (const n of ["SoCal - G - Scrimmage 2", "SoCal FTC Group G - Scrimmage 3", "SoCal FTC League G - Meet 3"]) expect(rule(G)(ev(n)), n).toBe(true);
    for (const n of ["SoCal - GE - Scrimmage 1", "SoCal FTC Group B - Scrimmage 2", "SoCal FTC League A1 - Meet 2", "NorCal EB Meet 1"]) expect(rule(G)(ev(n)), n).toBe(false);
    expect(OFFICIAL_CHANNELS.some((c) => c.channelId === T7419)).toBe(false);
  });
});
