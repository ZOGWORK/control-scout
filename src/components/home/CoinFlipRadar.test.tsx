// @vitest-environment jsdom
// The Events page's coin flips: each card shows both sides' odds and its confidence tier and opens the match
// page; the closest call is marked; decided ones show the result beside the call made before them; a day with
// none (no events, or no close calls) or a failed load leaves the section out; the skeleton holds its place while loading.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { CoinFlipRadar, CoinFlipRow } from "../../shared/coinFlips";

let data: CoinFlipRadar | undefined;
let error: Error | undefined;
let reloads = 0;
const reload = () => { reloads++; };
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data, error, loading: !data && !error, reload }),
}));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMediaQuery: () => false }));
const { CoinFlipRadarSection, closestKey, dueIn, favourite, hasFlips, meterAt, printedOdds, venueClock } = await import("./CoinFlipRadar");

const row = (n: number, o: Partial<CoinFlipRow> = {}): CoinFlipRow => ({
  season: 2026, code: "USCAQ1", key: `qual:0:${n}`, label: `Q${n}`, eventName: "Los Angeles Qualifier", place: "Los Angeles, CA", timezone: "America/Los_Angeles",
  day: "2026-10-17", time: "2026-10-17T14:05:00", startsAt: null, red: [n * 10 + 1, n * 10 + 2], blue: [n * 10 + 3, n * 10 + 4], pRed: 0.53, tier: "moderate",
  kind: "now", played: false, result: null, ...o,
});
const radar = (o: Partial<CoinFlipRadar>): CoinFlipRadar => ({ generatedAt: new Date().toISOString(), band: { lo: 0.45, hi: 0.55 }, events: 0, calls: 0, thin: 0, tallies: [], upcoming: [], decided: [], ...o });
const show = () => render(<MemoryRouter><CoinFlipRadarSection /></MemoryRouter>);
afterEach(() => { cleanup(); data = undefined; error = undefined; });

describe("CoinFlipRadarSection", () => {
  it("shows each coin flip with both sides' odds and its tier, linked to the match, with the closest call marked", () => {
    data = radar({ events: 1, calls: 9, upcoming: [row(1), row(2, { pRed: 0.49, tier: "confident" })] });
    show();
    const links = screen.getAllByRole("link");
    expect(links[0].getAttribute("href")).toBe("/events/2026/USCAQ1/match/qual:0:1");
    expect(links[0].getAttribute("aria-label")).toMatch(/red 11 and 12 53% to win, blue 13 and 14 47%, confidence: fair/);
    expect(screen.getByText("Closest call").closest("a")).toBe(links[1]);
    expect(screen.getAllByText(/solid/).length).toBeGreaterThan(0);
    expect(screen.getByText("2 to play")).toBeTruthy();
  });

  it("lists decided ones with the result and the call made before the match", () => {
    data = radar({ events: 1, calls: 4, decided: [row(3, { played: true, kind: "live", pRed: 0.54, tier: "confident", result: { red: 98, blue: 120 } })] });
    show();
    expect(screen.getByText(/Every coin flip on today’s schedules has been played/)).toBeTruthy();
    const line = screen.getByText(/called Red 54% before the match/);
    // The saved call keeps its confidence tier beside it.
    expect(line.textContent).toMatch(/called Red 54% before the match\s*confidence: solid · the other side won/);
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

describe("a day with no coin flips", () => {
  it("leaves the whole section out: no events today, or none of today's calls in the band", () => {
    for (const r of [radar({}), radar({ events: 2, calls: 40 }), radar({ events: 2, calls: 40, thin: 3 })]) {
      data = r;
      const { container } = show();
      expect(container.innerHTML).toBe("");
      cleanup();
    }
    expect(hasFlips(radar({ upcoming: [row(1)] }))).toBe(true);
    expect(hasFlips(radar({ decided: [row(1, { played: true, result: { red: 1, blue: 0 } })] }))).toBe(true);
  });

  it("holds its place with a skeleton while loading", () => {
    show();
    expect(screen.getByRole("heading", { name: /Today’s coin flips/ })).toBeTruthy();
    expect(document.querySelector("[aria-busy=true]")).toBeTruthy();
  });

  it("holds no place while loading when the page's HTML said today has none (no layout shift), and still shows ones that turn up", () => {
    const tag = Object.assign(document.createElement("meta"), { name: "cs-coin-flips", content: "0" });
    document.head.append(tag);
    try {
      expect(show().container.innerHTML).toBe("");
      cleanup();
      data = radar({ events: 1, calls: 9, upcoming: [row(1)] });
      show();
      expect(screen.getByText("1 to play")).toBeTruthy();
      cleanup();
      // "1": today has some, so the skeleton holds their place as before.
      data = undefined;
      tag.content = "1";
      show();
      expect(document.querySelector("[aria-busy=true]")).toBeTruthy();
    } finally {
      tag.remove();
    }
  });

  it("leaves the section out when it couldn't load, and keeps the last radar through a failed refresh", () => {
    error = new Error("down");
    expect(show().container.innerHTML).toBe("");
    cleanup();
    data = radar({ events: 1, calls: 9, upcoming: [row(1)] });
    show();
    expect(screen.getByText("1 to play")).toBeTruthy();
  });

  it("puts the page's spacing on the section itself, so a hidden one leaves no gap", () => {
    data = radar({ events: 1, calls: 9, upcoming: [row(1)] });
    render(<MemoryRouter><CoinFlipRadarSection className="mb-8" /></MemoryRouter>);
    expect(screen.getByRole("region", { name: /Today’s coin flips/ }).className.split(" ")).toContain("mb-8");
  });
});

describe("the card's visuals agree with its printed odds", () => {
  it("puts the meter's marker in the favourite's half (red is drawn on the left)", () => {
    expect(meterAt(0.55)).toBeCloseTo(25);
    expect(meterAt(0.45)).toBeCloseTo(75);
    expect(meterAt(0.5)).toBeCloseTo(50);
    data = radar({ events: 1, calls: 2, upcoming: [row(1, { pRed: 0.55 }), row(2, { pRed: 0.45 })] });
    show();
    const [red, blue] = screen.getAllByTestId("coin-marker");
    expect(parseFloat(red.style.left)).toBeLessThan(50);
    expect(red.dataset.side).toBe("red");
    expect(parseFloat(blue.style.left)).toBeGreaterThan(50);
    expect(blue.dataset.side).toBe("blue");
  });

  it("prints both sides from one rounding, so they add up to 100 and the marker, colour and call follow them", () => {
    // 0.495 rounded side by side would print 50 · 51: from one rounding it's 50 · 50, an even call everywhere.
    expect(printedOdds(0.495)).toEqual({ red: 50, blue: 50 });
    expect(printedOdds(0.505)).toEqual({ red: 51, blue: 49 });
    expect(printedOdds(0.5)).toEqual({ red: 50, blue: 50 });
    expect([favourite(0.495), favourite(0.5), favourite(0.505)]).toEqual([null, null, "red"]);
    expect([meterAt(0.495), meterAt(0.5), meterAt(0.505)].map((x) => Math.round(x))).toEqual([50, 50, 45]);
    data = radar({ events: 1, calls: 2, upcoming: [row(1, { pRed: 0.495 }), row(2, { pRed: 0.505 })],
      decided: [row(3, { played: true, kind: "live", pRed: 0.495, result: { red: 70, blue: 60 } })] });
    show();
    const links = screen.getAllByRole("link");
    expect(links[0].textContent).toMatch(/50%50%/);
    expect(links[0].getAttribute("aria-label")).toMatch(/red 11 and 12 50% to win, blue 13 and 14 50%/);
    expect(links[1].textContent).toMatch(/51%49%/);
    const [even, red] = screen.getAllByTestId("coin-marker");
    expect([even.dataset.side, red.dataset.side]).toEqual(["even", "red"]);
    expect(screen.getByText(/called 50:50 before the match/).textContent).toMatch(/a true coin flip/);
    // The even card is the closest call.
    expect(screen.getByText("Closest call").closest("a")).toBe(links[0]);
  });

  it("calls nobody the favourite when both sides print 50%", () => {
    expect(favourite(0.503)).toBeNull();
    expect(favourite(0.506)).toBe("red");
    expect(favourite(0.494)).toBe("blue");
    data = radar({ events: 1, calls: 1, decided: [row(4, { played: true, kind: "live", pRed: 0.503, result: { red: 80, blue: 90 } })] });
    show();
    expect(screen.getByText(/called 50:50 before the match/).textContent).toMatch(/a true coin flip/);
  });

  it("marks the closest call by the printed odds, the sooner on a tie", () => {
    // 0.509 and 0.511 both print 51%: the first (sooner) one gets the mark, not the one with nearer decimals.
    expect(closestKey([row(1, { pRed: 0.511 }), row(2, { pRed: 0.509 })])).toBe("USCAQ1|qual:0:1");
    expect(closestKey([row(1, { pRed: 0.53 }), row(2, { pRed: 0.49 })])).toBe("USCAQ1|qual:0:2");
  });
});

describe("times", () => {
  it("reads the venue's wall clock and how long until the start", () => {
    expect(venueClock("2026-10-17T14:05:00", "America/Los_Angeles")).toMatch(/2:05/);
    // A zoned timestamp is read in the venue's zone: 21:05 UTC is 2:05 PM in Los Angeles (PDT), 8:05 AM in Sydney.
    expect(venueClock("2026-10-17T21:05:00Z", "America/Los_Angeles")).toMatch(/2:05/);
    expect(venueClock("2026-10-17T21:05:00.000+00:00", "Australia/Sydney")).toMatch(/8:05/);
    expect(venueClock(null, "America/Los_Angeles")).toBeNull();
    const now = Date.parse("2026-10-17T20:00:00Z");
    expect(dueIn("2026-10-17T20:25:00Z", now)).toBe("in 25 min");
    expect(dueIn("2026-10-17T22:10:00Z", now)).toBe("in 2 h 10 min");
    expect(dueIn("2026-10-17T19:30:00Z", now)).toBe("awaiting result");
    expect(dueIn(null, now)).toBeNull();
  });
});
