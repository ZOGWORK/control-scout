// @vitest-environment jsdom
// "Know your match" (v1.6 Task 2) as a user sees it: OPR-only for anyone without a workspace (never empty,
// no scouting links), a member with no entries gets "Scout this team" on every card, a member with entries
// sees consensus and flags on all four; a played match shows the result next to the call; a short-handed
// lineup says so; and the report is one tap from a match row.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../shared/api";
import type { TeamConsensus } from "../shared/consensus";
import type { MatchReport, MatchReportWorkspace, ReportTeam, WatchFlag } from "../shared/matchReport";
import type { WorkspaceAnswer } from "../lib/consensus";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0 }));

const { MatchReportView } = await import("./MatchReport");
const { MatchList } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], total?: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: total == null ? null : { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
function match(o: Partial<MatchView> = {}, red = [11, 12], blue = [13, 14]): MatchView {
  return { season: 2025, code: "RPTQ1", key: "qual:0:12", level: "qual", series: 0, number: 12, label: "Q12", time: null, startsAt: null, played: false,
    red: side(red), blue: side(blue), video: null,
    prediction: { pRed: 0.64, redMean: 120, blueMean: 98, tier: "confident", kind: "now", predictedAt: null, factors: [{ id: "f1", label: "Red's auto is stronger", favors: "A" } as never] }, ...o };
}
const team = (n: number, o: Partial<ReportTeam> = {}): ReportTeam => ({
  team: n, name: `Team ${n}`, city: null, state: null,
  event: { rank: n - 10, wins: 3, losses: 1, ties: 0, qualPlayed: 2, opr: { np: 40, auto: 10, teleop: 20, endgame: 10, pen: 2 } },
  season: { opr: { np: 50 + n, auto: 12, teleop: 30, endgame: 13, pen: 1.5 }, rank: 7, of: 300, matches: 10, wins: 7, losses: 3, ties: 0 },
  trend: [], flags: [], ...o,
});
function report(m = match(), teams = [11, 12, 13, 14].map((n) => team(n))): MatchReport {
  return { event: { season: 2025, code: "RPTQ1", name: "Report Qualifier", remote: false } as MatchReport["event"], live: null, match: m, description: null, bonus: null, teams, prev: null, next: null };
}
const empty = (n: number): TeamConsensus => ({ team: n, entries: 0, matchEntries: 0, pitEntries: 0, scouts: 0, lastUpdated: null, ratings: [], counters: [], strengths: [], weaknesses: [], tags: [] });
const scouted = (n: number): TeamConsensus => ({ ...empty(n), entries: 3, matchEntries: 3, scouts: 2, lastUpdated: Date.now() - 60_000,
  ratings: [{ kind: "match", id: "driver", label: "Driver skill", type: "rating", avg: 4.5, max: 5, n: 3 }],
  strengths: [{ label: "Driver skill", count: 2 }], weaknesses: [{ label: "Consistency", count: 1 }] });
function ws(teams: TeamConsensus[], o: Partial<MatchReportWorkspace> = {}): WorkspaceAnswer<MatchReportWorkspace> {
  const w = { id: "3101", name: "Robo Squad", role: "member" as const };
  return { workspaces: [w], workspace: w, select: () => {}, state: { data: { workspaceId: "3101", season: 2025, teams, picklist: [], assignedToMe: [], ...o }, error: undefined, loading: false } };
}
const show = (r: MatchReport, w: WorkspaceAnswer<MatchReportWorkspace> | null = null, watch = new Map<number, WatchFlag[]>()) =>
  render(<MemoryRouter><TooltipProvider><MatchReportView r={r} ws={w} watch={watch} /></TooltipProvider></MemoryRouter>);
const cards = () => screen.getAllByTestId("report-team");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => cleanup());

describe("MatchReportView", () => {
  it("OPR-only with no workspace: the call with its tier, all four teams by alliance with OPR, split and rank, no scouting links", () => {
    show(report(match(), [team(11, { flags: [{ kind: "penalties", label: "High penalties", detail: "x" }] }), team(12), team(13), team(14)]));
    expect(screen.getByText("64%")).toBeTruthy();
    expect(screen.getByText(/Confident/)).toBeTruthy();
    // Each alliance's chance to win carries the tier too, not only the call card above (audit PUB3-F03 sweep).
    expect(within(screen.getByRole("region", { name: "Red alliance" })).getByText(/to win/).textContent).toBe("64% to win · ~120 pts confident confidence");
    expect(within(screen.getByRole("region", { name: "Blue alliance" })).getByText(/to win/).textContent).toBe("36% to win · ~98 pts confident confidence");
    expect(screen.getByText("Red's auto is stronger")).toBeTruthy();
    expect(screen.getByTestId("opr-only")).toBeTruthy();
    const red = screen.getByRole("region", { name: "Red alliance" }), blue = screen.getByRole("region", { name: "Blue alliance" });
    expect(within(red).getAllByTestId("report-team").map((c) => c.dataset.team)).toEqual(["11", "12"]);
    expect(within(blue).getAllByTestId("report-team").map((c) => c.dataset.team)).toEqual(["13", "14"]);
    const c11 = cards()[0];
    // 2 matches here (under 4): the season OPR leads.
    expect(within(c11).getByText("Season OPR")).toBeTruthy();
    expect(within(c11).getByText("61")).toBeTruthy();
    expect(within(c11).getByText("#1 here", { exact: false })).toBeTruthy();
    expect(within(c11).getByRole("img", { name: /Auto 12, Driver-controlled 30, Endgame 13/ })).toBeTruthy();
    expect(within(c11).getByRole("button", { name: /High penalties/ })).toBeTruthy();
    expect(screen.queryByText(/Scout this team/)).toBeNull();
    expect(screen.queryByTestId("report-result")).toBeNull();
  });

  it("a call with stated ranges reads 120 ±14 and says what the ± means", () => {
    const base = match().prediction!;
    show(report(match({ prediction: { ...base, redRange: [106, 134], blueRange: [86, 112], rangeLevel: 0.8 } })));
    expect(within(screen.getByRole("region", { name: "Red alliance" })).getByText(/to win/).textContent)
      .toBe("64% to win · 120 ±14 (80% range 106–134: about 8 in 10 real scores land inside) pts confident confidence");
    expect(screen.getByText(/± is the 80% range: red 106–134, blue 86–112/)).toBeTruthy();
  });

  it("the event's OPR leads once a team has played a few matches here", () => {
    show(report(match(), [team(11, { event: { rank: 1, wins: 4, losses: 0, ties: 0, qualPlayed: 5, opr: { np: 70, auto: 20, teleop: 30, endgame: 20, pen: 0 } } }), team(12), team(13), team(14)]));
    expect(within(cards()[0]).getByText("OPR at this time")).toBeTruthy();
    expect(within(cards()[0]).getByText("70")).toBeTruthy();
  });

  it("a member with no entries: every card still useful, with a way to scout the team", () => {
    show(report(), ws([11, 12, 13, 14].map(empty)));
    expect(screen.queryByTestId("opr-only")).toBeNull();
    expect(screen.getByText("Robo Squad")).toBeTruthy();
    expect(screen.getAllByTestId("no-scouting")).toHaveLength(4);
    const links = screen.getAllByRole("link", { name: /Scout this team/ });
    expect(links).toHaveLength(4);
    expect(links[0].getAttribute("href")).toMatch(/^\/scout\?space=3101&team=11&season=2025/);
  });

  it("a member with entries: consensus and flags for all four teams", () => {
    const watch = new Map<number, WatchFlag[]>([
      [11, [{ kind: "mine", label: "Your team", detail: "" }]], [12, [{ kind: "assigned", label: "Assigned to you", detail: "" }]],
      [13, [{ kind: "picklist", label: "On your pick list", detail: "" }]], [14, [{ kind: "tracked", label: "Tracked", detail: "" }]],
    ]);
    show(report(), ws([11, 12, 13, 14].map(scouted)), watch);
    expect(screen.getAllByTestId("team-take")).toHaveLength(4);
    for (const [i, label] of ["Your team", "Assigned to you", "On your pick list", "Tracked"].entries()) {
      const c = cards()[i];
      expect(within(c).getByRole("button", { name: new RegExp(label) })).toBeTruthy();
      expect(within(c).getByText(/3 entries by 2 scouts/)).toBeTruthy();
      expect(within(c).getByRole("list", { name: "Strengths" }).textContent).toMatch(/Driver skill/);
      expect(within(c).getByRole("list", { name: "Weaknesses" }).textContent).toMatch(/Consistency/);
      expect(within(c).getByText("4.5")).toBeTruthy();
    }
  });

  it("a refused or failed workspace answer falls back to OPR only, saying so", () => {
    const w = ws([]);
    show(report(), { ...w, state: { data: undefined, error: Object.assign(new Error("no"), { status: 403 }) as never, loading: false } });
    expect(screen.getByText(/OPR only/)).toBeTruthy();
    expect(screen.queryByText(/Scout this team/)).toBeNull();
    expect(cards()).toHaveLength(4);
  });

  it("a played match shows the result next to the call made before it", () => {
    show(report(match({ played: true, red: side([11, 12], 130), blue: side([13, 14], 90), prediction: { pRed: 0.64, redMean: 120, blueMean: 98, tier: "moderate", kind: "live", predictedAt: null } })));
    const res = screen.getByTestId("report-result");
    expect(res.textContent).toMatch(/130–90/);
    expect(res.textContent).toMatch(/Red won/);
    expect(res.textContent).toMatch(/Called it/);
    expect(screen.getByText("Called before the match")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Red alliance" })).getByText("130")).toBeTruthy();
  });

  it("bonus RP odds: before the match the call alone; once played, each bonus earned ✓ or missed ✗ beside it", () => {
    const bonus = { red: [0.7, 0.2, 0.4], blue: [0.5, 0.1, 0.3], rpRed: 3.2, rpBlue: 1.9, tier: "moderate" } as const;
    const pred = { pRed: 0.64, redMean: 120, blueMean: 98, tier: "moderate" as const, kind: "live" as const, predictedAt: null, bonus: { ...bonus, red: [...bonus.red], blue: [...bonus.blue] } as never };
    const earned = { labels: ["Movement", "Goal", "Pattern"] as [string, string, string], red: [true, false, true] as [boolean, boolean, boolean], blue: [false, false, true] as [boolean, boolean, boolean] };
    show({ ...report(match({ prediction: pred })), bonus: null });
    const before = screen.getByTestId("bonus-odds");
    expect(within(before).getByText("Movement")).toBeTruthy();
    expect(within(before).queryByLabelText("earned")).toBeNull();
    cleanup();
    show({ ...report(match({ played: true, red: side([11, 12], 130), blue: side([13, 14], 90), prediction: pred })), bonus: earned });
    const after = screen.getByTestId("bonus-odds");
    expect(within(after).getAllByLabelText("earned")).toHaveLength(3);
    expect(within(after).getAllByLabelText("missed")).toHaveLength(3);
  });

  it("a short-handed lineup (1v1) says so instead of showing an empty slot", () => {
    show(report(match({ prediction: null }, [11], [13]), [team(11), team(13)]));
    expect(cards()).toHaveLength(2);
    expect(screen.getAllByTestId("missing-team").map((x) => x.textContent)).toEqual(["No second robot on this alliance.", "No second robot on this alliance."]);
    expect(screen.getByText(/full 2-against-2 matches only/)).toBeTruthy();
  });

  it("a remote event's solo match", () => {
    const r = report(match({ prediction: null }, [11], []), [team(11)]);
    r.event.remote = true;
    show(r);
    expect(screen.getAllByTestId("missing-team").map((x) => x.textContent)).toEqual(["Remote event: this robot plays on its own.", "No alliance here: remote events score one robot at a time.", "No alliance here: remote events score one robot at a time."]);
  });
});

describe("one tap from the match list", () => {
  it("every match row links to its report", () => {
    render(<MemoryRouter><TooltipProvider><MatchList matches={[match(), match({ key: "qual:0:13", number: 13, label: "Q13" })]} /></TooltipProvider></MemoryRouter>);
    const links = screen.getAllByRole("link", { name: /^Pre-match report for Q1[23]$/ });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/events/2025/RPTQ1/match/qual:0:12", "/events/2025/RPTQ1/match/qual:0:13"]);
  });
});
