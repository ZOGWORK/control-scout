// @vitest-environment jsdom
// The home page's coin flips: each card shows both sides' odds and its confidence tier and opens the match
// page; the closest call is marked; decided ones show the result beside the call made before them; an empty
// day says why in words (no events, or no close calls, with the thin-data ones counted), never a blank.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { CoinFlipRadar, CoinFlipRow } from "../../shared/coinFlips";

let data: CoinFlipRadar | undefined;
let reloads = 0;
const reload = () => { reloads++; };
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data, error: undefined, loading: !data, reload }),
}));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMediaQuery: () => false }));
const { CoinFlipRadarSection, dueIn, emptyLine, venueClock } = await import("./CoinFlipRadar");

const row = (n: number, o: Partial<CoinFlipRow> = {}): CoinFlipRow => ({
  season: 2026, code: "USCAQ1", key: `qual:0:${n}`, label: `Q${n}`, eventName: "Los Angeles Qualifier", place: "Los Angeles, CA", timezone: "America/Los_Angeles",
  day: "2026-10-17", time: "2026-10-17T14:05:00", startsAt: null, red: [n * 10 + 1, n * 10 + 2], blue: [n * 10 + 3, n * 10 + 4], pRed: 0.53, tier: "moderate",
  kind: "now", played: false, result: null, ...o,
});
const radar = (o: Partial<CoinFlipRadar>): CoinFlipRadar => ({ generatedAt: new Date().toISOString(), band: { lo: 0.45, hi: 0.55 }, events: 0, calls: 0, thin: 0, tallies: [], upcoming: [], decided: [], ...o });
const show = () => render(<MemoryRouter><CoinFlipRadarSection /></MemoryRouter>);
afterEach(() => { cleanup(); data = undefined; });

describe("CoinFlipRadarSection", () => {
  it("shows each coin flip with both sides' odds and its tier, linked to the match, with the closest call marked", () => {
    data = radar({ events: 1, calls: 9, upcoming: [row(1), row(2, { pRed: 0.49, tier: "confident" })] });
    show();
    const links = screen.getAllByRole("link");
    expect(links[0].getAttribute("href")).toBe("/events/2026/USCAQ1/match/qual:0:1");
    expect(links[0].getAttribute("aria-label")).toMatch(/red 11 and 12 53% to win, blue 13 and 14 47%, moderate confidence/);
    expect(screen.getByText("Closest call").closest("a")).toBe(links[1]);
    expect(screen.getAllByText(/confident/).length).toBeGreaterThan(0);
    expect(screen.getByText("2 to play")).toBeTruthy();
  });

  it("lists decided ones with the result and the call made before the match", () => {
    data = radar({ events: 1, calls: 4, decided: [row(3, { played: true, kind: "live", pRed: 0.54, result: { red: 98, blue: 120 } })] });
    show();
    expect(screen.getByText(/Every coin flip on today’s schedules has been played/)).toBeTruthy();
    expect(screen.getByText(/called Red 54% before the match · the other side won/)).toBeTruthy();
  });

  it("shows six cards, then all on request", () => {
    data = radar({ events: 2, calls: 30, upcoming: Array.from({ length: 8 }, (_, i) => row(i + 1)) });
    show();
    expect(screen.getAllByRole("link")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show all 8 to play" }));
    expect(screen.getAllByRole("link")).toHaveLength(8);
  });
});

describe("refresh", () => {
  it("reloads every minute while the tab is showing, not while it's hidden", () => {
    vi.useFakeTimers();
    try {
      data = radar({});
      show();
      reloads = 0;
      vi.advanceTimersByTime(60_000);
      expect(reloads).toBe(1);
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      vi.advanceTimersByTime(120_000);
      expect(reloads).toBe(1);
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(reloads).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});

describe("emptyLine", () => {
  it("says there are no events today, or no close calls with the thin-data ones counted", () => {
    expect(emptyLine(radar({}))).toMatch(/No event has matches scheduled for today/);
    expect(emptyLine(radar({ events: 2, calls: 40 }))).toBe("None of the 40 calls on today’s schedules at 2 events is between 45% and 55%.");
    expect(emptyLine(radar({ events: 2, calls: 40, thin: 3 }))).toBe(
      "Of the 40 calls on today’s schedules at 2 events, 3 are between 45% and 55% but left out: a robot in them has played fewer than 3 matches this season, so the call rests on thin data.");
    expect(emptyLine(radar({ upcoming: [row(1)] }))).toBeNull();
  });
});

describe("times", () => {
  it("reads the venue's wall clock and how long until the start", () => {
    expect(venueClock("2026-10-17T14:05:00")).toMatch(/2:05/);
    expect(venueClock(null)).toBeNull();
    const now = Date.parse("2026-10-17T20:00:00Z");
    expect(dueIn("2026-10-17T20:25:00Z", now)).toBe("in 25 min");
    expect(dueIn("2026-10-17T22:10:00Z", now)).toBe("in 2 h 10 min");
    expect(dueIn("2026-10-17T19:30:00Z", now)).toBe("awaiting result");
    expect(dueIn(null, now)).toBeNull();
  });
});
