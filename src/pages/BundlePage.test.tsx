// @vitest-environment jsdom
// The event-day bundle page leads with the schedule (every match when no team is set, never an empty card),
// says its times in 12-hour form with a short zone, shows the pick list only when it holds teams, and keeps the
// rules reference closed (and unrendered) until it's opened.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { EventBundle, SavedBundle } from "../shared/eventBundle";
import type { MatchView } from "../shared/api";

const h = vi.hoisted(() => ({ meta: null as SavedBundle | null, bundle: null as EventBundle | null, myTeam: null as number | null }));
vi.mock("../lib/offline/useBundle", () => ({ useBundle: () => ({ meta: h.meta, bundle: h.bundle, loading: false }) }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: h.myTeam }, user: null }) }));

import BundlePage from "./BundlePage";

const side = (teams: number[], total: number | null) => ({ teams: teams.map((n) => ({ number: n, surrogate: false, dq: false, onField: true })), score: total == null ? null : { total, np: total, auto: 0, teleop: 0, endgame: 0, pen: 0 } });
const match = (n: number, red: number[], blue: number[], time: string, played = false): MatchView => ({
  season: 2025, code: "USCABLM1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time, startsAt: null, played,
  red: side(red, played ? 120 : null), blue: side(blue, played ? 90 : null), video: null, prediction: null,
});
const field = [11, 22, 33, 44, 55].map((team) => ({ team, name: `Team ${team} name`, city: null, state: null, rank: null, opr: { np: null } }));

function setUp(opts: { team?: number | null; picks?: number[] | null; rules?: boolean } = {}) {
  const at = new Date(Date.now() - 10 * 60_000).toISOString();
  h.meta = { season: 2025, code: "USCABLM1", name: "Bardeen League Meet 1", end: "2099-01-01", version: "v", sha256: "x", bytes: 30_000, savedAt: 1, builtAt: at, dataAsOf: at,
    team: opts.team ?? null, workspace: opts.picks ? { id: "w", name: "Hypnotic Robotics" } : null, reports: 0, picklist: !!opts.picks };
  h.bundle = {
    format: 1,
    manifest: { sections: [] } as unknown as EventBundle["manifest"],
    event: { field, matches: [match(1, [11, 22], [33, 44], "2025-11-16T09:05:00", true), match(2, [55, 11], [22, 33], "2025-11-16T13:40:00"), match(3, [44, 55], [22, 11], "2025-11-16T14:10:00")] } as unknown as EventBundle["event"],
    ratings: null, reports: [],
    picklist: opts.picks ? { key: "picklist", label: "Pick list", time: null, count: opts.picks.length, teams: opts.picks, html: "<p>list</p>" } : null,
    rules: opts.rules ? { title: "BIOBUZZ rules reference", version: "1", html: "<p>rules</p>" } : null,
    venue: { name: "Bardeen League Meet 1", typeLabel: "League meet", venue: null, address: null, city: "Bardeen", state: "CA", country: "USA", start: "2025-11-16", end: null, timezone: "America/Los_Angeles", website: null, livestream: null },
  };
}

const mount = () => render(<MemoryRouter initialEntries={["/bundle/2025/USCABLM1"]}><Routes><Route path="/bundle/:season/:code" element={<BundlePage />} /></Routes></MemoryRouter>);
afterEach(() => { cleanup(); localStorage.clear(); h.myTeam = null; });

describe("BundlePage", () => {
  it("with no team set, shows every match (never an empty card asking to pick one)", () => {
    setUp();
    mount();
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeTruthy();
    expect(document.querySelectorAll("[data-bundle-match]")).toHaveLength(3);
    expect(screen.queryByText(/Pick your team/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Show matches for" })).toBeTruthy();
  });

  it("with a team, shows only its matches and marks the next one", () => {
    setUp({ team: 33 });
    mount();
    expect(screen.getByRole("heading", { name: "Team 33's matches" })).toBeTruthy();
    expect(document.querySelectorAll("[data-bundle-match]")).toHaveLength(2);
    expect(screen.getByText("Next")).toBeTruthy();
  });

  it("falls back to my team when the bundle has none and it plays here", () => {
    setUp();
    h.myTeam = 55;
    mount();
    expect(screen.getByRole("heading", { name: "Team 55's matches" })).toBeTruthy();
  });

  it("says times in 12-hour form with a short zone, never the raw IANA name", () => {
    setUp();
    mount();
    expect(screen.getByText("1:40 PM")).toBeTruthy();
    expect(screen.getByText(/^Times in (PT|PST|PDT)$/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/America\/Los_Angeles/);
    expect(document.querySelector("[data-snapshot-banner]")?.textContent).toMatch(/Saved \d{1,2}:\d{2} (AM|PM)/);
  });

  it("hides an empty pick list", () => {
    setUp({ picks: [] });
    mount();
    expect(screen.queryByRole("heading", { name: /pick list/i })).toBeNull();
  });

  it("names whose pick list it is, how many, when, and the top teams", () => {
    setUp({ picks: [44, 11, 22, 33, 55, 66] });
    mount();
    expect(screen.getByRole("heading", { name: "Your team's pick list" })).toBeTruthy();
    expect(screen.getByText(/Hypnotic Robotics: 6 teams, saved at/)).toBeTruthy();
    expect(screen.getByText("Team 44 name")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See all 6" })).toBeTruthy();
  });

  it("keeps the rules reference closed, and renders it only once opened", () => {
    setUp({ rules: true });
    mount();
    const details = document.querySelector("[data-bundle-rules]") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(document.querySelector("[data-snapshot-frame]")).toBeNull();
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(document.querySelector("[data-snapshot-frame]")).toBeTruthy();
  });
  it("offline, a match whose report isn't in the bundle opens the event's matches instead of a dead report", () => {
    setUp();
    h.bundle!.reports = [{ key: "qual:0:2", label: "Q2", time: null, html: "<p>r</p>" }];
    const on = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mount();
    const hrefs = [...document.querySelectorAll("[data-bundle-match]")].map((a) => a.getAttribute("href"));
    expect(hrefs[0]).toBe("/events/2025/USCABLM1?tab=matches");
    expect(hrefs[1]).toMatch(/qual/i);
    on.mockRestore();
  });
});
