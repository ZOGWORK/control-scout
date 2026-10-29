// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OprSection, RowRecord } from "./TeamPage";
import type { TeamEventRow, TeamProfile } from "../shared/api";

afterEach(cleanup);

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
    expect(tile(/^Autonomous.*28\.3.*Rank #883 of 8,000.*Show event by event$/)).toBe(auto);
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
