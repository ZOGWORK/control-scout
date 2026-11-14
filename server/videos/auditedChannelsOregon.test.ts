// The owner's audited channels (2026-11-14), Oregon: Overcharged (Rose City League) and Leo RHS Robotics (SOAR League).
// Every checked recording sits on its league's event with the title's meet number, and the watcher's region rules take
// only that league's events.
import { describe, expect, it } from "vitest";
import { parseRule, type WatchEvent } from "./officialMatch";
import { OFFICIAL_CHANNELS } from "../data/officialChannels";
import type { OfficialList } from "./officialVideos";
import shipped from "../data/officialVideos.json" with { type: "json" };

const data = shipped as OfficialList;
const OC = "UCT6yIFUf6Wr_klDFpdmLsGg", LEO = "UC2MP84F_QCCnbLqHBFBxxeQ", AHOT = "UCks7crvCRkRlJqQaOBV76cQ";

// Scout's events (season/code → name, city, start, end), as the live database gave them on 2026-11-14.
const EVENTS: Record<string, [name: string, city: string, start: string, end: string]> = {
  "2024/USORRCM2": ["Rose City League Meet 2", "Portland", "2024-12-07", "2024-12-07"],
  "2024/USORRCM1": ["Rose City League Meet 1", "Portland", "2024-11-02", "2024-11-02"],
  "2024/USORPOS": ["Rose City League Meet 0", "Portland", "2024-10-19", "2024-10-19"],
  "2023/USORRCLT": ["OR Rose City League Tournament", "Portland", "2024-02-10", "2024-02-10"],
  "2023/USORRCM3": ["OR Rose City League Meet 3", "Portland", "2024-01-27", "2024-01-27"],
  "2023/USORRCM2": ["OR Rose City League Meet 2", "Portland", "2024-01-06", "2024-01-06"],
  "2023/USORRCM1": ["OR Rose City League Meet 1", "Portland", "2023-12-09", "2023-12-09"],
  "2023/USORPOS": ["OR Rose City League Meet 0", "Portland", "2023-10-28", "2023-10-28"],
  "2022/USORRCM3": ["OR Rose City League Meet 3", "Portland", "2023-01-07", "2023-01-07"],
  "2022/USORRCM2": ["OR Rose City League Meet 2", "Portland", "2022-12-10", "2022-12-10"],
  "2022/USORRCM1": ["OR Rose City League Meet 1", "Portland", "2022-11-12", "2022-11-12"],
  "2022/USORPOS": ["OR Rose City League Meet 0", "Portland", "2022-10-29", "2022-10-29"],
  "2026/USORSOM1": ["SOAR League Meet 1", "Roseburg", "2026-11-14", "2026-11-14"],
  "2026/USORRON": ["SOAR Scrimmage", "Roseburg", "2026-10-24", "2026-10-24"],
  "2025/USORSOM2": ["SOAR League Meet 2", "Roseburg", "2025-12-13", "2025-12-13"],
  "2025/USORSOM1": ["SOAR League Meet 1", "Roseburg", "2025-11-15", "2025-11-15"],
  "2025/USORROS": ["SOAR Scrimmage", "Roseburg", "2025-10-25", "2025-10-25"],
  "2024/USORROS": ["SOAR League Meet 0", "Roseburg", "2024-10-19", "2024-10-19"],
};

const rowsOf = (ch: string) => data.videos.filter((x) => x.channelId === ch);
const eventOf = (x: OfficialList["videos"][number]) => {
  const e = EVENTS[`${x.season}/${x.code}`];
  expect(e, `${x.season}/${x.code} ${x.videoId}`).toBeTruthy();
  expect(x.kind, x.videoId).toBe("recording");
  expect(x.day! >= e[2] && x.day! <= e[3], `${x.videoId} ${x.day} outside ${e[2]}..${e[3]}`).toBe(true);
  return e[0];
};
// "Meet 0" is the league's scrimmage: Scout names it "… Meet 0" or "… Scrimmage".
const meetOf = (s: string) => /\bmeet (\d)/i.exec(s)?.[1] ?? (/scrimmage/i.test(s) ? "0" : /tournament|qualifiers|championship/i.test(s) ? "T" : null);

describe("audited channels: Oregon", () => {
  it("Overcharged: each Rose City title on the Rose City event with its meet number", () => {
    const oc = rowsOf(OC);
    expect(oc).toHaveLength(12);
    for (const x of oc) {
      const name = eventOf(x);
      expect(x.title, x.videoId).toMatch(/rose city/i);
      expect(name, x.videoId).toMatch(/rose city/i);
      expect(meetOf(x.title), x.videoId).toBe(meetOf(name));
    }
  });

  it("Leo RHS Robotics: each SOAR title on the SOAR event with its meet number; Meet 1 of Nov 14 listed before it airs", () => {
    const leo = rowsOf(LEO);
    expect(leo).toHaveLength(6);
    for (const x of leo) {
      const name = eventOf(x);
      expect(x.title, x.videoId).toMatch(/\bSOAR\b/);
      expect(name, x.videoId).toMatch(/\bSOAR\b/);
      expect(meetOf(x.title), x.videoId).toBe(meetOf(name));
    }
    expect(leo.find((x) => x.videoId === "09fUwALT9UI")).toMatchObject({ season: 2026, code: "USORSOM1", day: "2026-11-14" });
  });

  it("leaves out what FIRST's own pages already link, and what isn't sure", () => {
    const ids = new Set(data.videos.map((x) => x.videoId));
    // Already FIRST's link for its event (Rose City 2024 LT and Meet 3, 2025 Meet 0 and Qualifiers, 2026 Meets 0-1;
    // SOAR 2024 Meets 1-2, 2025 Meet 3 and Tournament); a second video for a day FIRST already links (Rose City 2025
    // Meets 1-3); SOAR 2024 Meet 3, whose event FIRST links to Meet 2's video (flagged, not stacked on it); a
    // highlights cut, an all-matches compilation and a 24-hour build challenge; and All Hands on Tech, whose Iron
    // Mountain streams FIRST's pages already link.
    for (const no of ["bIL6YGYGbPk", "GsFJBB4QqfM", "WnxOYhHsmCQ", "vytSgpJsr1Q", "nWzwrcKxvAs", "ZLBlDDIbz-k", "iW3dh6qGaSE", "neHlobPVL6U", "WRvXoqEfOgs", "ir2eMixuf2U",
      "Ymt6Yv87Uq0", "ptMFVkezuDM", "mdM4HR02eZk", "BY5kxWXwiXo", "g2IhAaHgj04", "9iuPUHWPVeI", "gkwkAOow5Gs"]) expect(ids.has(no), no).toBe(false);
    expect(rowsOf(AHOT)).toHaveLength(0);
  });

  it("the watcher reads each channel for its own league's events only; All Hands on Tech isn't watched", () => {
    const ev = (name: string): WatchEvent => ({ season: 2026, code: "X", name, type: "LeagueMeet", city: null, state: "OR", country: "USA", start: "2026-12-12", end: "2026-12-12", timezone: null, divisionCode: null, parent: false });
    const rule = (id: string) => parseRule(OFFICIAL_CHANNELS.find((c) => c.channelId === id)!.region)!;
    expect(rule(OC)(ev("Rose City League Meet 2"))).toBe(true);
    expect(rule(OC)(ev("Rose City Scrimmage"))).toBe(true);
    expect(rule(OC)(ev("SOAR League Meet 2"))).toBe(false);
    expect(rule(LEO)(ev("SOAR League Meet 2"))).toBe(true);
    expect(rule(LEO)(ev("Rose City League Meet 2"))).toBe(false);
    expect(rule(LEO)(ev("Three Sisters League Meet 2"))).toBe(false);
    expect(OFFICIAL_CHANNELS.some((c) => c.channelId === AHOT)).toBe(false);
  });
});
