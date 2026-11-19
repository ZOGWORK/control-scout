// @vitest-environment jsdom
// The match report in v8 (docs/design/v8-revamp-brief.md §7.5): two columns on wide screens (the match left, the
// call right), the favourite's win chance as the hero number, the score breakdown as zero-based paired bars in the
// alliance colours, no coloured card fills. With v8 off the report is drawn exactly as before.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../shared/api";
import type { MatchReport, ReportTeam, WatchFlag } from "../shared/matchReport";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0, useVideoCount: () => 0 }));

const { MatchReportView } = await import("./MatchReport");
const { PairedBar, barMax } = await import("./MatchDetails");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], s?: { total: number; auto: number; teleop: number; endgame: number; pen: number }) =>
  ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: s ? { ...s, np: s.total - s.pen } : null });
function match(o: Partial<MatchView> = {}): MatchView {
  return { season: 2025, code: "RPTQ1", key: "qual:0:12", level: "qual", series: 0, number: 12, label: "Q12", time: null, startsAt: null, played: false,
    red: side([11, 12]), blue: side([13, 14]), video: null,
    prediction: { pRed: 0.36, redMean: 98, blueMean: 120, tier: "confident", kind: "now", predictedAt: null, factors: [{ id: "f1", label: "Blue's auto is stronger", favors: "B" } as never] }, ...o };
}
const played = () => match({ played: true,
  red: side([11, 12], { total: 130, auto: 30, teleop: 60, endgame: 30, pen: 10 }),
  blue: side([13, 14], { total: 90, auto: 20, teleop: 50, endgame: 20, pen: 0 }),
  prediction: { pRed: 0.64, redMean: 120, blueMean: 98, tier: "moderate", kind: "live", predictedAt: null } });
const team = (n: number): ReportTeam => ({
  team: n, name: `Team ${n}`, city: null, state: null,
  event: { rank: n - 10, wins: 3, losses: 1, ties: 0, qualPlayed: 2, opr: { np: 40, auto: 10, teleop: 20, endgame: 10, pen: 2 } },
  season: { opr: { np: 50 + n, auto: 12, teleop: 30, endgame: 13, pen: 1.5 }, rank: 7, of: 300, matches: 10, wins: 7, losses: 3, ties: 0 },
  trend: [], flags: [],
});
const report = (m: MatchView): MatchReport => ({ event: { season: 2025, code: "RPTQ1", name: "Report Qualifier", remote: false } as MatchReport["event"], live: null, match: m, description: null, bonus: null, teams: [11, 12, 13, 14].map(team), prev: null, next: null });
const show = (r: MatchReport) => render(<MemoryRouter><TooltipProvider><MatchReportView r={r} ws={null} watch={new Map<number, WatchFlag[]>()} /></TooltipProvider></MemoryRouter>);

beforeEach(() => {
  document.documentElement.setAttribute("data-v8", "");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

describe("match report in v8", () => {
  it("two columns on wide screens: the call in the right column; on a phone it follows the result", () => {
    show(report(played()));
    const layout = document.querySelector<HTMLElement>('[data-report-layout="v8"]')!;
    expect(layout.className).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_minmax\(18rem,22rem\)\]/);
    const call = screen.getByRole("complementary", { name: "The call" });
    expect(call.className).toMatch(/lg:col-start-2/);
    // Markup order: result, call, breakdown, teams.
    const kids = Array.from(layout.children);
    expect(kids.indexOf(screen.getByTestId("report-result"))).toBeLessThan(kids.indexOf(call));
    expect(kids.indexOf(call)).toBeLessThan(kids.indexOf(screen.getByTestId("report-breakdown")));
  });

  it("an unplayed match: the favourite's win chance is the hero number, with the slim bar and no result", () => {
    show(report(match()));
    const hero = screen.getByTestId("report-hero");
    expect(hero.textContent).toMatch(/64%\s*Blue to win/);
    expect(within(hero).getByText("64%").className).toMatch(/font-display/);
    expect(screen.queryByTestId("report-result")).toBeNull();
    expect(screen.queryByTestId("report-breakdown")).toBeNull();
    expect(screen.getByTestId("report-call").querySelector("[data-winbar]")).toBeTruthy();
  });

  it("a played match: the result, the call's verdict, and the breakdown as paired bars on one zero-based scale", () => {
    show(report(played()));
    expect(screen.getByTestId("report-result").textContent).toMatch(/130–90\s*Red won by 40/);
    expect(screen.getByTestId("report-called").textContent).toMatch(/Called it/);
    const rows = screen.getByTestId("report-breakdown").querySelectorAll("li[data-label]");
    expect(Array.from(rows).map((r) => r.getAttribute("data-label"))).toEqual(["Auto", "TeleOp", "Endgame", "Fouls given away", "Total"]);
    // TeleOp red 60 is the largest phase value: its bar is full; blue's 50 is 5/6 of it.
    const teleop = rows[1];
    expect((teleop.querySelector('[data-bar="red"]') as HTMLElement).style.width).toBe("100%");
    expect(parseFloat((teleop.querySelector('[data-bar="blue"]') as HTMLElement).style.width)).toBeCloseTo(83.33, 1);
    // A zero gets no bar at all (zero-based), and the total has numbers only.
    expect((rows[3].querySelector('[data-bar="blue"]') as HTMLElement).style.width).toBe("0%");
    expect(rows[4].querySelector("[data-paired-bar]")).toBeNull();
  });

  it("no coloured card fills: the alliance is a heading over plain cards", () => {
    show(report(played()));
    const red = screen.getByRole("region", { name: "Red alliance" });
    expect(red.className).toMatch(/v8:bg-transparent/);
    expect(red.className).toMatch(/v8:border-0/);
    expect(screen.getAllByTestId("report-team")).toHaveLength(4);
  });
});

describe("paired bar", () => {
  it("scales to the shared max and ignores totals, counts and the no-penalty sum", () => {
    expect(barMax([{ label: "Auto", red: 10, blue: 40 }, { label: "No penalties", red: 90, blue: 90 }, { label: "Total", red: 99, blue: 99, total: true }])).toBe(40);
    render(<PairedBar red={20} blue={null} max={40} />);
    expect((document.querySelector('[data-bar="red"]') as HTMLElement).style.width).toBe("50%");
    expect((document.querySelector('[data-bar="blue"]') as HTMLElement).style.width).toBe("0%");
  });
});

describe("match report with v8 off", () => {
  beforeEach(() => document.documentElement.removeAttribute("data-v8"));
  it("is the old one-column report: no v8 layout, the call card on top", () => {
    show(report(played()));
    expect(document.querySelector("[data-report-layout]")).toBeNull();
    expect(screen.queryByTestId("report-hero")).toBeNull();
    expect(screen.getByTestId("report-result").textContent).toMatch(/Called it/);
  });
});
