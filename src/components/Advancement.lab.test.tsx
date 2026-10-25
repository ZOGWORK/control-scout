// @vitest-environment jsdom
// The advancement view as the owner asked for it: Outlook first, Field rows that open in place with names,
// switching team without dropping to the loading animation, partner scenarios before the event, and a
// team's stats in a side panel instead of leaving for the team page.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ForecastView } from "../shared/api";

let answers: (path: string) => unknown;
/** Teams whose forecast request fails. */
let failing = new Set<string>();
const asked: string[] = [];
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    if (path) asked.push(path);
    const fails = !!path?.startsWith("/api/predict/event") && failing.has(new URLSearchParams(path.split("?")[1]).get("team") ?? "");
    return { data: path && !fails ? answers(path) : undefined, error: fails ? new Error("Server error.") : undefined, loading: false, reload: () => {} };
  },
  load: () => Promise.resolve(),
}));

const { AdvancementView } = await import("./Advancement");
const { TooltipProvider } = await import("./ui/overlay");

const fteam = (team: number, pAdvance: number) => ({
  team, pAdvance, pCaptain: 0.2, pPicked: 0.3, pWin: 0.1, pFinalist: 0.15, rank: { mean: 5, p10: 2, p90: 9 },
  points: { quals: 1, alliance: 1, playoffs: 1, matchPoints: 3, awards: null, total: null }, strength: { np: 50, auto: 10, teleop: 30, endgame: 10, sd: 5, matches: 6 },
});
const fc = (myTeam: number | null): ForecastView => ({
  season: 2026, event: "TQ1", stage: "live", runs: 2000, slots: 2, slotsSource: "official", prequalified: [], assumptions: [],
  teams: [fteam(103, 0.5), fteam(102, 0.2), fteam(101, 0.1)], matchesOnly: null, matches: [], generatedAt: "2026-10-21T15:00:00Z",
  eventName: "Test Qualifier", eventStart: "2026-10-20", eventEnd: "2026-10-21", myTeam, engineVersion: "3.2.0", mode: "current", hindsightNote: null, bonusModelled: true,
} as unknown as ForecastView);
const fieldRow = (team: number, name: string) => ({ team, name, city: null, state: null, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null, opr: { np: null, auto: null, teleop: null, endgame: null, pen: null }, avgNp: null, rating: null, seasonOpr: 41.5 });
const detail = { field: [fieldRow(101, "Alpha Bots"), fieldRow(102, "Beta Gears"), fieldRow(103, "Gamma Rays")] };
const partners = { role: "captain", myTeam: 103, baseline: { pAdvance: 0.4, pWin: 0.1, pCaptain: 0.7 }, options: [{ team: 102, pAdvance: 0.55, pWin: 0.2 }, { team: 101, pAdvance: 0.45, pWin: 0.1 }] };
const profile = (n: number) => ({ team: { number: n, name: "Beta Gears", city: "Oradell", state: "NJ", country: "USA", rookieYear: 2010 }, season: 2026, seasons: [2026], stats: null, events: [], awardsAllTime: [] });

function route(forecasts: Record<string, ForecastView | undefined>) {
  return (path: string) => {
    if (path.startsWith("/api/predict/event")) return forecasts[new URLSearchParams(path.split("?")[1]).get("team") ?? ""];
    if (path.startsWith("/api/events/")) return detail;
    if (path.startsWith("/api/predict/partners")) return partners;
    if (path.startsWith("/api/teams/")) return profile(Number(path.split("/")[3].split("?")[0]));
    return undefined;
  };
}
const view = (team: number | null, onPickTeam?: (t: number) => void) => (
  <MemoryRouter><TooltipProvider><AdvancementView season={2026} code="TQ1" team={team} nameOf={() => ""} onPickTeam={onPickTeam} /></TooltipProvider></MemoryRouter>
);

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("advancement view", () => {
  it("opens on the Outlook with a team, and the Field without one", () => {
    answers = route({ "103": fc(103), "": fc(null) });
    render(view(103));
    expect(screen.getByRole("tab", { name: "Outlook" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Gamma Rays")).toBeTruthy(); // the Outlook names the team
    cleanup();
    render(view(null));
    expect(screen.getByRole("tab", { name: "Field" }).getAttribute("aria-selected")).toBe("true");
  });

  it("Field rows show the team's name and open in place, with a way to its outlook", () => {
    answers = route({ "": fc(null) });
    const onPickTeam = vi.fn();
    render(view(null, onPickTeam));
    const row = screen.getByRole("button", { name: /^102\s*Beta Gears/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(row.getAttribute("aria-controls")!)!;
    expect(within(panel).getByText("Likely rank")).toBeTruthy();
    expect(within(panel).getByText("41.5")).toBeTruthy(); // season OPR from the event's field
    fireEvent.click(within(panel).getByRole("button", { name: "See 102's outlook" }));
    expect(onPickTeam).toHaveBeenCalledWith(102);
    expect(screen.getByRole("tab", { name: "Outlook" }).getAttribute("aria-selected")).toBe("true");
  });

  it("switching team keeps the forecast on screen, marked as updating, instead of the loading animation", () => {
    answers = route({ "": fc(null) }); // 102's forecast hasn't arrived yet
    const { rerender } = render(view(null));
    rerender(view(102));
    expect(screen.getByRole("tab", { name: "Outlook" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("status").textContent).toMatch(/Simulating for 102/);
    expect(screen.getByText("Beta Gears")).toBeTruthy();
    answers = route({ "": fc(null), "102": fc(102) });
    rerender(view(102));
    expect(screen.queryByText(/Simulating for 102/)).toBeNull();
    // A switch whose forecast fails says so, with Try again, instead of passing the old numbers off as the new team's.
    failing = new Set(["101"]);
    rerender(view(101));
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't simulate the event for 101: Server error/);
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
    failing = new Set();
    // Clearing the team goes back to the Field (an empty Outlook says nothing).
    rerender(view(null));
    expect(screen.getByRole("tab", { name: "Field" }).getAttribute("aria-selected")).toBe("true");
  });

  it("before the event, the Alliance tab simulates partners from the pre-event view (no hindsight)", async () => {
    answers = route({ "103": fc(103) });
    render(view(103));
    fireEvent.click(screen.getByRole("radio", { name: /Before the event/ }));
    await act(async () => { fireEvent.mouseDown(screen.getByRole("tab", { name: "Alliance" })); });
    expect(asked.some((p) => p.startsWith("/api/predict/partners") && p.includes("mode=pre-event"))).toBe(true);
    expect(screen.queryByText(/Partner scenarios use the current forecast/)).toBeNull();
    expect(screen.getByText("Who should 103 pick?")).toBeTruthy();
    expect(screen.getAllByText("Before the event").length).toBeGreaterThan(0);
  });

  it("a team opens in a side panel with its numbers and a link to the full team page", async () => {
    answers = route({ "103": fc(103) });
    render(view(103));
    await act(async () => { fireEvent.mouseDown(screen.getByRole("tab", { name: "Alliance" })); });
    fireEvent.click(screen.getByRole("button", { name: /^102\s*Beta Gears/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("At Test Qualifier")).toBeTruthy();
    expect(within(sheet).getByText(/to advance/).parentElement!.textContent).toMatch(/^20%/); // its chance to advance here
    expect(within(sheet).getByRole("link", { name: /Full team page/ }).getAttribute("href")).toBe("/teams/102?season=2026");
  });
});
