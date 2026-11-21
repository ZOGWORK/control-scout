// @vitest-environment jsdom
// The match report in v8 (page plan, PR #1976). Played: "who won and why"; not played: "who's favoured, by how much,
// and why". First screen: the hero (both alliances side by side, the score or the win chance big), then the top
// reasons, then the score breakdown as paired bars. Lower: video, teams as plain rows, the full why in a disclosure.
// v8 off: the report as before.
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
const factors = [
  { id: "f1", label: "Blue's TeleOp scoring is worth about 30 more points", favors: "B" },
  { id: "f2", label: "Blue's autonomous is worth about 13 more points", favors: "B" },
  { id: "f3", label: "Red's endgame is worth about 3 more points", favors: "A" },
  { id: "f4", label: "A fourth, smaller factor", favors: "A" },
] as never;
function match(o: Partial<MatchView> = {}): MatchView {
  return { season: 2025, code: "RPTQ1", key: "qual:0:12", level: "qual", series: 0, number: 12, label: "Q12", time: null, startsAt: null, played: false,
    red: side([11, 12]), blue: side([13, 14]), video: null,
    prediction: { pRed: 0.36, redMean: 98, blueMean: 120, tier: "confident", kind: "now", predictedAt: null, factors }, ...o };
}
const played = (o: Partial<MatchView> = {}) => match({ played: true,
  red: side([11, 12], { total: 130, auto: 30, teleop: 60, endgame: 30, pen: 10 }),
  blue: side([13, 14], { total: 90, auto: 20, teleop: 50, endgame: 20, pen: 0 }),
  prediction: { pRed: 0.64, redMean: 120, blueMean: 98, tier: "moderate", kind: "live", predictedAt: null, factors }, ...o });
const team = (n: number): ReportTeam => ({
  team: n, name: `Team ${n}`, city: null, state: null,
  event: { rank: n - 10, wins: 3, losses: 1, ties: 0, qualPlayed: 2, opr: { np: 40, auto: 10, teleop: 20, endgame: 10, pen: 2 } },
  season: { opr: { np: 50 + n, auto: 12, teleop: 30, endgame: 13, pen: 1.5 }, rank: 7, of: 300, matches: 10, wins: 7, losses: 3, ties: 0 },
  trend: [], flags: [],
});
const report = (m: MatchView): MatchReport => ({ event: { season: 2025, code: "RPTQ1", name: "Report Qualifier", remote: false } as MatchReport["event"], live: null, match: m, description: null, bonus: null, teams: [11, 12, 13, 14].map(team), prev: null, next: null });
const show = (r: MatchReport) => render(<MemoryRouter><TooltipProvider><MatchReportView r={r} ws={null} watch={new Map<number, WatchFlag[]>()} /></TooltipProvider></MemoryRouter>);
const order = (...ids: string[]) => {
  const els = ids.map((id) => screen.getAllByTestId(id)[0]);
  for (let i = 1; i < els.length; i++) expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
};

beforeEach(() => {
  document.documentElement.setAttribute("data-v8", "");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

describe("match report in v8, played", () => {
  it("the hero: both alliances side by side with the score between them, the winner, and the call's verdict", () => {
    show(report(played()));
    const hero = screen.getByTestId("report-hero");
    expect(within(hero).getByTestId("report-result").textContent).toMatch(/130–90\s*Red won by 40/);
    const [red, blue] = Array.from(hero.querySelectorAll("[data-hero-teams]"));
    expect(red.textContent).toMatch(/11.*12/);
    expect(blue.textContent).toMatch(/13.*14/);
    expect(within(hero).getByTestId("report-called").textContent).toBe("Called it");
    expect(screen.getByTestId("report-call-line").textContent).toMatch(/Called before the match: Red 64%/);
  });

  it("an exact 50% call gets no verdict (it favoured no one)", () => {
    const m = played();
    show(report({ ...m, prediction: { ...m.prediction!, pRed: 0.5 } }));
    expect(screen.queryByTestId("report-called")).toBeNull();
  });

  it("first screen in order: hero, the top three reasons, then the breakdown; lower: teams, then the full why", () => {
    show(report(played()));
    order("report-hero", "report-reasons", "report-breakdown", "report-team");
    const reasons = within(screen.getByTestId("report-reasons")).getAllByRole("listitem");
    expect(reasons).toHaveLength(3);
    expect(reasons[0].textContent).toMatch(/TeleOp scoring/);
  });

  it("the breakdown is paired bars on one zero-based scale; the total is numbers only", () => {
    show(report(played()));
    const rows = screen.getByTestId("report-breakdown").querySelectorAll("li[data-label]");
    expect(Array.from(rows).map((r) => r.getAttribute("data-label"))).toEqual(["Auto", "TeleOp", "Endgame", "Fouls given away", "Total"]);
    expect((rows[1].querySelector('[data-bar="red"]') as HTMLElement).style.width).toBe("100%");
    expect(parseFloat((rows[1].querySelector('[data-bar="blue"]') as HTMLElement).style.width)).toBeCloseTo(83.33, 1);
    expect((rows[3].querySelector('[data-bar="blue"]') as HTMLElement).style.width).toBe("0%");
    expect(rows[4].querySelector("[data-paired-bar]")).toBeNull();
  });

  it("teams are plain rows (no boxed cards, no OPR split bar), the video sits above them", () => {
    show(report(played({ clip: { t: 95, youtubeOnly: false } as never })));
    expect(screen.getAllByTestId("report-team")).toHaveLength(4);
    expect(document.querySelector("article")).toBeNull();
    expect(screen.queryByRole("img", { name: /Auto .*DC|auto/i })).toBeNull();
    order("report-video", "report-team");
  });
});

describe("match report in v8, not played", () => {
  it("the favourite's chance is the hero number with the slim bar, then why, then the predicted score as a paired bar", () => {
    show(report(match()));
    expect(screen.getByTestId("report-chance").textContent).toMatch(/64%\s*Blue to win/);
    expect(screen.getByTestId("report-hero").querySelector("[data-winbar]")).toBeTruthy();
    expect(screen.queryByTestId("report-result")).toBeNull();
    expect(screen.queryByTestId("report-breakdown")).toBeNull();
    order("report-hero", "report-reasons", "report-predicted");
    expect(screen.getByTestId("report-predicted").querySelector("[data-paired-bar]")).toBeTruthy();
  });

  it("no prediction: says why, with no reasons to list", () => {
    show(report(match({ prediction: null })));
    expect(screen.getByTestId("report-call-line").textContent).toMatch(/No prediction for this match yet/);
    expect(screen.getByTestId("report-reasons").textContent).toMatch(/No call/);
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
  it("is the old report: the call card on top, team cards, no v8 layout", () => {
    show(report(played()));
    expect(document.querySelector("[data-report-layout]")).toBeNull();
    expect(screen.queryByTestId("report-hero")).toBeNull();
    expect(screen.getByTestId("report-result").textContent).toMatch(/Called it/);
    expect(document.querySelectorAll("article")).toHaveLength(4);
  });
});
