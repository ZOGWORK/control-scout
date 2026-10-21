// @vitest-environment jsdom
// The advancement simulator with a stored projection laid over it: the projection's odds are the
// headline numbers, a team already qualified elsewhere reads "Qualified", and a team that isn't
// eligible to advance reads "Not eligible", never "Qualified" and never odds.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ForecastView } from "../shared/api";
import type { ProjectionsView, ProjectionTeam } from "../shared/projections";

let forecast: ForecastView | undefined;
let projections: ProjectionsView | undefined;
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => ({ data: path?.startsWith("/api/projections") ? projections : path ? forecast : undefined, error: undefined, loading: false, reload: () => {} }),
}));

const { AdvancementView, withProjection } = await import("./Advancement");
const { TooltipProvider } = await import("./ui/overlay");

const fteam = (team: number, pAdvance: number) => ({
  team, pAdvance, pCaptain: 0.2, pPicked: 0.3, pWin: 0.1, pFinalist: 0.1, rank: { mean: 5, p10: 2, p90: 9 },
  points: { quals: 1, alliance: 1, playoffs: 1, matchPoints: 3, awards: null, total: null }, strength: { np: 50, auto: 10, teleop: 30, endgame: 10, sd: 5, matches: 6 },
});
const fc = (): ForecastView => ({
  season: 2026, event: "TQ1", stage: "live", runs: 2000, slots: 2, slotsSource: "official", prequalified: [101], assumptions: [],
  teams: [fteam(101, 0), fteam(102, 0.02), fteam(103, 0.5)], matchesOnly: null, matches: [], generatedAt: "2026-10-21T15:00:00Z",
  eventName: "Test", eventStart: null, eventEnd: null, myTeam: null, engineVersion: "2.2.0", mode: "current", hindsightNote: null, bonusModelled: true,
} as unknown as ForecastView);
const pt = (team: number, pAdvance: number | null, advance: ProjectionTeam["advance"]): ProjectionTeam => ({ team, rank: { p10: 1, p50: 2, p90: 4, mean: 2 }, pPlayoff: 0.5, pCaptain: 0.2, pPicked: 0.3, pAdvance, advance, pWin: 0.1, pFinalist: 0.1 });
const run = (teams: ProjectionTeam[]) => ({ kind: "current" as const, runs: 10000, target: 10000, stage: "live" as const, played: 10, scheduled: 20, through: "Q10", slots: 2, slotsSource: "official", seed: 1, engineVersion: "2.2.0", ms: 1, computedAt: "x", teams });

afterEach(() => cleanup());

describe("advancement simulator with a stored projection", () => {
  it("marks ineligible teams from the projection", () => {
    const shown = withProjection(fc(), run([pt(101, null, "qualified"), pt(102, null, "ineligible"), pt(103, 0.62, "odds")]));
    expect([...shown.ineligible!]).toEqual([102]);
    expect(shown.teams.find((t) => t.team === 103)!.pAdvance).toBe(0.62);
  });

  it("the Field list: Qualified only for the qualified team, Not eligible for the ineligible one", () => {
    forecast = fc();
    projections = { season: 2026, code: "TQ1", current: run([pt(101, null, "qualified"), pt(102, null, "ineligible"), pt(103, 0.62, "odds")]), baseline: null, lastOpen: null };
    render(<MemoryRouter><TooltipProvider><AdvancementView season={2026} code="TQ1" team={null} nameOf={() => ""} /></TooltipProvider></MemoryRouter>);
    const item = (n: number) => screen.getAllByRole("listitem").find((li) => li.textContent?.startsWith(String(n)))! as HTMLElement;
    expect(within(item(101)).getByText("Qualified")).toBeTruthy();
    expect(within(item(102)).getByText("Not eligible")).toBeTruthy();
    expect(within(item(102)).queryByText("Qualified")).toBeNull();
    expect(item(103).textContent).toMatch(/62%/);
  });
});
