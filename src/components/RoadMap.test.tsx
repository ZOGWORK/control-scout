// @vitest-environment jsdom
// The road map's two views: an encoded region shows its target, the points earned and the ruleset's sources and
// season; a neutral region shows results and what's next, says no rules are encoded, and shows no points figure.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RoadStop, TeamRoadMap } from "../shared/roadmap";

const data: { current: TeamRoadMap | null } = { current: null };
vi.mock("../lib/api", () => ({ useApi: () => ({ data: data.current, error: null, loading: false, reload: () => {} }) }));
vi.mock("./states", () => ({ Async: ({ state, children }: any) => children(state.data) }));
const { RoadMapSection } = await import("./RoadMap");

afterEach(cleanup);

const stop = (o: Partial<RoadStop>): RoadStop => ({
  code: "E1", name: "Event one", type: "LeagueTournament", start: "2026-10-01", end: "2026-10-01", when: "done", level: null, home: true,
  rank: 3, ranked: 20, roster: 20, record: { wins: 4, losses: 1, ties: 0 }, qualPlayed: 5, awards: [], alliance: null,
  advancement: null, points: null, cutoff: null, counts: null, ...o,
});

const modelled: TeamRoadMap = {
  team: 100, season: 2026, region: "USNJ", stage: "regional", next: null, encoded: [{ region: "USNJ", name: "New Jersey" }],
  stops: [stop({ level: "League tournament", counts: true, advancement: { status: "advanced", to: "New Jersey Championship", slots: 6 }, points: { total: 76, awards: 0, playoffs: 40, alliance: 20, quals: 16 }, cutoff: 53 })],
  ruleset: {
    region: "USNJ", name: "New Jersey", season: 2026, checked: "2026-10-30",
    levels: [{ kind: "meet", label: "League meet", next: "League tournament", note: null }, { kind: "entry", label: "League tournament", next: "New Jersey Championship", note: null }, { kind: "regional", label: "State championship", next: "FIRST Championship or a Premier event", note: null }],
    sources: [{ label: "FTC New Jersey: important season dates (2026–27)", url: "https://newjerseyftc.com/important-season-dates.html" }],
    points: { source: { label: "Manual", url: "https://ftc-resources.firstinspires.org/ftc/game/manual" }, where: "Section 4", playoff: [40, 20, 10, 5], inspire: [60, 30, 15], otherAwards: [12, 6, 3], qual: { max: 16, min: 2 }, entryEvents: 3 },
  },
  need: {
    event: { code: "USNJCMP", name: "New Jersey Championship", start: "2027-03-14" }, fromCalendar: false, options: [], level: "State championship", leadsTo: "FIRST Championship or a Premier event",
    slots: null, target: 46, teams: 48, best: 76, leagueMatches: null, overLimit: false,
    lastSeason: { season: 2025, events: 1, codes: ["USNJCMP"], slots: { min: 19, max: 19 }, cutoff: { median: 30, min: 30, max: 30 }, fcmp: { slots: { min: 8, max: 8 }, cutoff: { median: 46, min: 46, max: 46 } } },
    routes: [{ label: "Inspire Award, 1st place", min: 62, clears: true }, { label: "Another judged award, 1st place", min: 14, clears: false }],
  },
};

const show = (m: TeamRoadMap) => { data.current = m; return render(<MemoryRouter><RoadMapSection team={m.team} season={m.season} /></MemoryRouter>); };

describe("season road map", () => {
  it("an encoded region: target, official points, advancement and the ruleset's sources", () => {
    show(modelled);
    expect(screen.getByTestId("roadmap-need").textContent).toMatch(/~46\s*points/);
    expect(screen.getByText(/For a FIRST Championship slot/)).toBeTruthy();
    expect(screen.getAllByText("76").length).toBe(2); // earned at the event, and the season best
    expect(screen.getByText(/last team in had 53/)).toBeTruthy();
    expect(screen.getByText("Advanced to New Jersey Championship")).toBeTruthy();
    expect(screen.getByRole("link", { name: /FTC New Jersey: important season dates \(2026–27\)/ }).getAttribute("href")).toBe("https://newjerseyftc.com/important-season-dates.html");
    expect(screen.getByText(/New Jersey rules for 2026–27/)).toBeTruthy();
    expect(document.querySelector("[aria-current=step]")?.textContent).toMatch(/^State championship/);
  });

  it("a neutral region: results and what's next, no points target", () => {
    show({ ...modelled, region: "USTXNO", ruleset: null, stage: null, need: null, stops: [stop({ advancement: { status: "pending", to: "North Texas Championship", slots: null }, when: "upcoming" })], next: stop({ when: "upcoming" }) });
    expect(screen.getByTestId("roadmap-neutral").textContent).toMatch(/hasn't encoded the USTXNO region's 2026–27 advancement rules/);
    expect(screen.getByText(/Encoded for 2026–27: New Jersey/)).toBeTruthy();
    expect(screen.queryByTestId("roadmap-need")).toBeNull();
    expect(screen.queryByText(/~d+/)).toBeNull();
    expect(screen.queryByText(/advancement points (official)/)).toBeNull();
  });
});
