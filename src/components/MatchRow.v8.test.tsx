// @vitest-environment jsdom
// The shared match row in v8 (page plan, PR #1976): one line per match, "who's playing, who won or who's favoured"
// at a glance: the label, red's teams, red's score (or chance), blue's score (or chance), blue's teams, and nothing
// else. The whole row opens the match report; the visitor's teams are marked in mint. v8 off: today's row.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchPredictionView, MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0, useVideoCount: () => 0 }));

const { MatchRow, MatchList, WinBar } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], total?: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true, name: `Team ${number}` })), score: total == null ? null : { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
const pred = (o: Partial<MatchPredictionView> = {}): MatchPredictionView =>
  ({ pRed: 0.62, redMean: 110, blueMean: 96, tier: "confident", kind: "live", predictedAt: null, factors: [], ...o }) as MatchPredictionView;
function match(o: Partial<MatchView> = {}, red?: number, blue?: number): MatchView {
  return { season: 2025, code: "V8Q1", key: "qual:0:3", level: "qual", series: 0, number: 3, label: "Q3", time: null, startsAt: null,
    played: red != null, red: side([31065, 14343], red), blue: side([19612, 27573], blue), video: null, prediction: pred(),
    clip: { t: 120 } as never, ...o };
}
const show = (m: MatchView, highlight?: number) => render(<MemoryRouter><TooltipProvider><MatchRow m={m} highlight={highlight} onToggle={() => {}} /></TooltipProvider></MemoryRouter>);
const q = (sel: string) => document.querySelector<HTMLElement>(sel)!;

beforeEach(() => {
  document.documentElement.setAttribute("data-v8", "");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

describe("match row in v8", () => {
  it("one line in order: label, red teams, red score, blue score, blue teams", () => {
    show(match({}, 130, 90));
    const row = q("[data-v8-row]");
    const cells = Array.from(row.children).map((c) => c.textContent?.replace(/:.*$/, ""));
    expect(cells).toEqual(["Q3", "3106514343", "130", "90", "1961227573"]);
  });

  it("nothing else in the row: no call button, status chips, video chips, report button or details", () => {
    show(match({}, 130, 90));
    expect(q("[data-call]")).toBeNull();
    expect(q("[data-call-status]")).toBeNull();
    expect(screen.queryByRole("button", { name: /details/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Watch/ })).toBeNull();
    expect(screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.includes("/match/"))).toHaveLength(1);
  });

  it("the label opens the report, stretched over the whole row, and says the result", () => {
    show(match({}, 130, 90));
    const link = screen.getByRole("link", { name: /^Q3: red 130, blue 90, red won/ });
    expect(link.getAttribute("href")).toBe("/events/2025/V8Q1/match/qual:0:3");
    expect(link.className).toMatch(/after:absolute after:inset-0/);
  });

  it("the winner's score is bold, the loser's lighter", () => {
    show(match({}, 130, 90));
    expect(q('[data-side="red"] [data-score]').className).toMatch(/font-bold/);
    expect(q('[data-side="blue"] [data-score]').className).toMatch(/font-medium/);
  });

  it("unplayed: each side's chance in the score's place, the favourite stronger", () => {
    show(match());
    expect(q('[data-side="red"]').textContent).toBe("62%");
    expect(q('[data-side="blue"]').textContent).toBe("38%");
    expect(q('[data-side="red"] [data-chance]').className).toMatch(/font-semibold/);
    expect(screen.getByRole("link", { name: /red 62% to win, blue 38%/ })).toBeTruthy();
  });

  it("the visitor's team is marked in mint; each team is its own tap above the row's link", () => {
    show(match({}, 130, 90), 19612);
    const mine = within(q('[data-teams="blue"]')).getByRole("link", { name: /19612/ });
    expect(mine.className).toMatch(/text-accent-text/);
    expect(mine.className).toMatch(/z-\[1\]/);
    expect(mine.getAttribute("data-mine")).toBe("true");
  });

  it("in a list the level heading is sentence case, and a team tap opens its card", () => {
    const ms = [match(), match({ key: "playoff:1:1", level: "playoff", series: 1, number: 1, label: "SF1" })];
    render(<MemoryRouter><TooltipProvider><MatchList matches={ms} /></TooltipProvider></MemoryRouter>);
    expect(q("[data-group-head]").className).toMatch(/v8:normal-case/);
    expect(screen.getAllByRole("button", { name: /31065 Team 31065: show team card/ }).length).toBeGreaterThan(0);
  });
});

describe("match row with v8 off", () => {
  beforeEach(() => document.documentElement.removeAttribute("data-v8"));
  it("is today's row: alliance boxes, the call column and the report button", () => {
    show(match({}, 130, 90));
    expect(q("[data-v8-row]")).toBeNull();
    expect(q("[data-call]")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pre-match report for Q3" })).toBeTruthy();
    cleanup();
    render(<WinBar pRed={0.6} />);
    expect((q("[data-winbar]").firstElementChild as HTMLElement).className).toMatch(/transition-\[width\]/);
  });
});
