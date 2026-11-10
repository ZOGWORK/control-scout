// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AwardsAllTime, OprSection, RowRecord, lineup, nextMatch } from "./TeamPage";
import type { MatchView, TeamEventRow, TeamProfile } from "../shared/api";

// useMeta as the app's metadata would answer it (null: not loaded yet, as with no provider), and the current season.
const meta = vi.hoisted(() => ({ value: null as { statsAt: string | null } | null, current: 2025 }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => meta.value, useCurrentSeason: () => meta.current }));

afterEach(() => { cleanup(); meta.value = null; meta.current = 2025; });

const stat = (value: number, rank: number) => ({ value, rank, of: 8000 });
const profile = {
  team: { number: 4215 }, season: 2025, seasons: [2025],
  stats: {
    opr: { np: stat(101.6, 616), auto: stat(28.3, 883), teleop: stat(73.4, 644), endgame: stat(6.7, 5027), pen: -5 },
    rating: null, record: { wins: 26, losses: 6, ties: 0, matches: 32, events: 5 }, avg: { np: 90, score: 95, pen: 5 },
  },
  events: [], awardsAllTime: [],
} as unknown as TeamProfile;

const tile = (name: RegExp) => screen.getByRole("button", { name });

describe("OprSection tiles", () => {
  it("shows no tile as selected at rest, and opening TeleOp selects only TeleOp (not Total OPR)", () => {
    render(<MemoryRouter><OprSection p={profile} /></MemoryRouter>);
    const total = tile(/^Total OPR/), teleop = tile(/^TeleOp/);
    for (const b of screen.getAllByRole("button", { expanded: false })) expect(b.hasAttribute("data-selected")).toBe(false);
    expect(total.className).not.toContain("ring-2");

    fireEvent.click(teleop);
    expect(teleop.getAttribute("aria-expanded")).toBe("true");
    expect(teleop.getAttribute("data-selected")).toBe("true");
    expect(teleop.className).toContain("ring-2");
    expect(total.getAttribute("aria-expanded")).toBe("false");
    expect(total.hasAttribute("data-selected")).toBe(false);
    expect(total.className).not.toContain("ring-2");
    expect(document.querySelectorAll("[data-selected]")).toHaveLength(1);

    fireEvent.click(teleop); // closes again: nothing selected
    expect(document.querySelectorAll("[data-selected]")).toHaveLength(0);
  });

  it("names each tile from everything it shows, then what pressing does (label in name, WCAG 2.5.3)", () => {
    render(<MemoryRouter><OprSection p={profile} /></MemoryRouter>);
    const auto = tile(/^Autonomous/);
    // No aria-label override: the visible rank line is part of the name, the action follows it.
    expect(auto.hasAttribute("aria-label")).toBe(false);
    // The computed accessible name (not textContent): hiding the rank or the action from assistive tech would fail this.
    expect(tile(/^Autonomous.*28\.3.*OPR #883 of 8,000 with an OPR.*Show event by event$/)).toBe(auto);
  });
});

describe("an event row's record", () => {
  const row = (x: Partial<TeamEventRow>) => ({
    end: "2025-11-01", start: "2025-11-01", wins: null, losses: null, ties: null, played: null, qualPlayed: null, qual: null, onField: false, ...x,
  }) as TeamEventRow;
  const shows = (x: Partial<TeamEventRow>) => { cleanup(); return render(<RowRecord e={row(x)} />).container.textContent; };

  it("says why there's no record: surrogate only, no scores, not played yet, a remote event", () => {
    expect(shows({ onField: true })).toBe("Surrogate only"); // played, but only as a surrogate (not on its record)
    expect(shows({})).toBe("No scored matches");
    expect(shows({ end: "2099-01-01" })).toBe("Not played yet");
    expect(shows({ qualPlayed: 6 })).toBe("6 remote matches");
  });

  it("shows every match, the quals alone under it when playoffs make it differ, and a no-show", () => {
    expect(shows({ wins: 4, losses: 4, ties: 0, played: 8, qual: { wins: 3, losses: 2, ties: 0, played: 5 }, onField: true })).toBe("4-4-0Quals 3-2-0");
    expect(shows({ wins: 5, losses: 1, ties: 0, played: 6, qual: { wins: 5, losses: 1, ties: 0, played: 6 }, onField: true })).toBe("5-1-0");
    expect(shows({ wins: 0, losses: 1, ties: 0, played: 1, qual: { wins: 0, losses: 1, ties: 0, played: 1 }, onField: false })).toBe("0-1-0No-show");
  });
});

describe("OprSection's data-as-of stamp", () => {
  it("says when the stats were last rebuilt, so an old OPR never reads as live", () => {
    meta.value = { statsAt: new Date(Date.now() - 2 * 3600_000).toISOString() };
    render(<MemoryRouter><OprSection p={profile} /></MemoryRouter>);
    expect(screen.getByText(/Stats updated 2 h ago/)).toBeTruthy();
  });
  it("says nothing for a page drawn from a saved season offline (the server's time would date older numbers)", async () => {
    meta.value = { statsAt: new Date().toISOString() };
    const { markOffline } = await import("../lib/offline/saved");
    render(<MemoryRouter><OprSection p={markOffline({ ...profile }, { season: 2025, savedAt: 1, dataAsOf: "2026-10-01T00:00:00Z" })} /></MemoryRouter>);
    expect(screen.queryByText(/Stats updated/)).toBeNull();
  });
  it("says nothing for an earlier season (the rebuild time is the current season's)", () => {
    meta.value = { statsAt: new Date().toISOString() };
    meta.current = 2026;
    render(<MemoryRouter><OprSection p={profile} /></MemoryRouter>);
    expect(screen.queryByText(/Stats updated/)).toBeNull();
  });
  it("says nothing while the time isn't known", () => {
    render(<MemoryRouter><OprSection p={profile} /></MemoryRouter>);
    expect(screen.queryByText(/Stats updated/)).toBeNull();
  });
});

describe("AwardsAllTime", () => {
  it("names the event on each award, in the chip (a tooltip never opens on a tap)", () => {
    const p = { ...profile, awardsAllTime: [{ season: 2025, code: "USNJCMP", event: "New Jersey Championship", type: "Inspire", placement: 1 }] } as unknown as TeamProfile;
    render(<MemoryRouter><AwardsAllTime p={p} /></MemoryRouter>);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/events/2025/USNJCMP");
    expect(link.textContent).toContain("New Jersey Championship");
  });
});

describe("nextMatch (the Upcoming block's next match)", () => {
  const ev = (code: string, start: string, end = start) => ({ code, start, end } as TeamEventRow);
  const match = (code: string, key: string, played: boolean, startsAt: string | null) => ({ code, key, played, startsAt } as MatchView);
  const events = [ev("OLD", "2026-11-01"), ev("NOW", "2026-11-10")];
  const now = Date.parse("2026-11-10T15:00:00Z");

  it("is the first scheduled match still to play at an event that isn't over", () => {
    const ms = [match("OLD", "qual:0:9", false, null), match("NOW", "qual:0:1", true, "2026-11-10T14:00:00Z"), match("NOW", "qual:0:5", false, "2026-11-10T15:20:00Z"), match("NOW", "qual:0:8", false, "2026-11-10T16:00:00Z")];
    expect(nextMatch(ms, events, "2026-11-10", now)?.key).toBe("qual:0:5");
  });

  it("skips a match whose start passed over half an hour ago with no result (late, not next), and none is none", () => {
    expect(nextMatch([match("NOW", "qual:0:2", false, "2026-11-10T14:00:00Z"), match("NOW", "qual:0:3", false, null)], events, "2026-11-10", now)?.key).toBe("qual:0:3");
    expect(nextMatch([match("OLD", "qual:0:9", false, null)], events, "2026-11-10", now)).toBeNull();
  });
});

describe("lineup (Upcoming's Predict link)", () => {
  it("keeps two robots a side, the team itself first", () => {
    expect(lineup([{ number: 1 }, { number: 2 }], 9)).toEqual([1, 2]);
    expect(lineup([{ number: 1 }, { number: 2 }, { number: 4215 }], 4215)).toEqual([4215, 1]);
  });
});
