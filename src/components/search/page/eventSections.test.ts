// Events in sections (./eventSections.ts): status first (Live now, Upcoming, Finished), then date (a day this week, a
// week after that), a family placed whole; every event in exactly one section, every count the events under it.
import { describe, expect, it } from "vitest";
import type { SearchEventInfo, SearchHit } from "../../../shared/api";
import { dateSection, eventSections, eventStatuses } from "./eventSections";
import { whenCounts } from "./results";

// Friday 2026-11-06: this week runs Monday Nov 2 to Sunday Nov 8.
const TODAY = "2026-11-06";
const ev = (code: string, start: string, status: SearchEventInfo["status"], extra: Partial<SearchHit> = {}): SearchHit =>
  ({ kind: "event", ref: `2026:${code}`, title: `${code} Meet`, subtitle: `${code} · ${start} · Somewhere`, season: 2026, event: { start, end: start, type: "LeagueMeet", venue: null, status }, ...extra });

describe("dateSection", () => {
  it("a day this week by its own name, a later or earlier week by its Monday, no date last", () => {
    expect(dateSection("2026-11-06", TODAY).title).toBe("Today, Nov 6, 2026");
    expect(dateSection("2026-11-07", TODAY).title).toBe("Tomorrow, Nov 7, 2026");
    expect(dateSection("2026-11-05", TODAY).title).toBe("Yesterday, Nov 5, 2026");
    expect(dateSection("2026-11-08", TODAY).title).toBe("Sun, Nov 8, 2026");
    expect(dateSection("2026-11-12", TODAY).title).toBe("Week of Nov 9, 2026");
    expect(dateSection("2026-10-28", TODAY).title).toBe("Week of Oct 26, 2026");
    expect(dateSection(null, TODAY).title).toBe("Date to be announced");
  });
});

describe("eventSections", () => {
  const hits = [
    ev("U3", "2026-11-14", "upcoming"), ev("L1", "2026-11-06", "live"), ev("U1", "2026-11-07", "upcoming"),
    ev("F1", "2026-10-31", "finished"), ev("U2", "2026-11-07", "upcoming"), ev("L2", "2026-11-05", "live"), ev("F2", "2026-10-03", "finished"),
  ];
  it("Live now first (by start), then Upcoming by date soonest first, then Finished newest first; each event once", () => {
    const s = eventSections(hits, TODAY);
    expect(s.map((x) => [x.title, x.count])).toEqual([["Live now", 2], ["Upcoming", 3], ["Finished", 2]]);
    const codes = (i: number) => s[i].dates.map((d) => [d.title, d.count, d.groups.map((g) => (g.kind === "event" ? g.hits[0].ref.split(":")[1] : "family"))]);
    expect(codes(0)).toEqual([[null, 2, ["L2", "L1"]]]);
    expect(codes(1)).toEqual([["Tomorrow, Nov 7, 2026", 2, ["U1", "U2"]], ["Week of Nov 9, 2026", 1, ["U3"]]]);
    expect(codes(2)).toEqual([["Week of Oct 26, 2026", 1, ["F1"]], ["Week of Sep 28, 2026", 1, ["F2"]]]);
  });

  it("a family is placed whole, by its status and first day, and counts all its events", () => {
    const fam = [ev("P", "2026-11-08", "upcoming"), ev("PA", "2026-11-07", "upcoming", { parent: "P" }), ev("PB", "2026-11-07", "upcoming", { parent: "P" })];
    const s = eventSections([...fam, ev("X", "2026-11-08", "upcoming")], TODAY);
    expect(s).toHaveLength(1);
    expect(s[0].dates.map((d) => [d.title, d.count, d.groups.map((g) => g.kind)])).toEqual([["Tomorrow, Nov 7, 2026", 3, ["family"]], ["Sun, Nov 8, 2026", 1, ["event"]]]);
  });

  it("Greptile on #805: a family with finished divisions and live finals is live as one, in the sections and every count", () => {
    const fam = [ev("P", "2026-11-05", "live"), ev("PA", "2026-11-04", "finished", { parent: "P" }), ev("PB", "2026-11-04", "finished", { parent: "P" })];
    expect(eventSections(fam, TODAY).map((x) => [x.title, x.count])).toEqual([["Live now", 3]]);
    const statuses = eventStatuses(fam);
    expect(whenCounts(fam, { when: "all", season: null, type: null }, TODAY, statuses)).toEqual({ all: 3, upcoming: 0, live: 3, past: 0 });
  });

  it("the time tabs count the same: Upcoming says its live ones apart", () => {
    expect(whenCounts(hits, { when: "all", season: null, type: null }, TODAY)).toEqual({ all: 7, upcoming: 3, live: 2, past: 2 });
  });
});
