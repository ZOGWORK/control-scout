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
  it("one full-width line in order: label and time, red teams, scores, blue teams, the call, your result", () => {
    show(match({ time: "2026-11-07T14:12:00" }, 130, 90), 31065);
    const row = q("[data-v8-row]");
    expect(row.className).toContain("@3xl:grid-cols-[5.5rem_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(10rem,13rem)_4.5rem]");
    const kids = Array.from(row.children);
    expect(kids[0].textContent).toMatch(/^Q3/);
    expect(kids[1].getAttribute("data-teams")).toBe("red");
    expect(kids[2].textContent).toBe("130–90");
    expect(kids[3].getAttribute("data-teams")).toBe("blue");
    // The last cell's parts (time on a phone, the call, your result) become the row's own columns on a desktop.
    expect(kids[4].className).toMatch(/@3xl:contents/);
    expect(q("[data-row-meta] [data-call]").textContent).toMatch(/Picked Red 62%/);
    expect(q("[data-row-meta] [data-mine]").textContent).toBe("31065 won");
    expect(document.querySelectorAll("[data-when]").length).toBe(2); // one per layout, one hidden by width
  });

  it("wide rows name the teams; the number stays in mono", () => {
    show(match({}, 130, 90));
    const name = q('[data-teams="red"] [data-team-name]');
    expect(name.textContent).toBe("Team 31065");
    expect(name.className).toMatch(/hidden/);
    expect(name.className).toMatch(/@4xl:inline/);
  });

  it("the call: picked side and %, a thin bar, its tier, and Right in white or Upset in warning", () => {
    show(match({}, 130, 90));
    const call = q("[data-call]");
    expect(call.querySelector("[data-winbar]")).toBeTruthy();
    expect(within(call).getByRole("button", { name: /Confidence/ })).toBeTruthy();
    expect(q('[data-outcome="right"]').className).toMatch(/text-text-base/);
    cleanup();
    show(match({ prediction: pred({ pRed: 0.3 }) }, 130, 90));
    expect(q('[data-outcome="upset"]').className).toMatch(/text-warning/);
  });

  it("the label opens the report, stretched over the whole row, and says the result", () => {
    show(match({}, 130, 90));
    const link = screen.getByRole("link", { name: /^Q3: red 130, blue 90, red won/ });
    expect(link.getAttribute("href")).toBe("/events/2025/V8Q1/match/qual:0:3");
    expect(link.className).toMatch(/after:absolute after:inset-0/);
  });

  it("the winner's score is bold in full colour, the loser's muted", () => {
    show(match({}, 130, 90));
    expect(q('[data-side="red"] [data-score]').className).toMatch(/font-bold/);
    expect(q('[data-side="blue"] [data-score]').className).toMatch(/font-medium/);
  });

  it("unplayed: the predicted scores, muted, in the scores' place; the call says who's picked", () => {
    show(match());
    expect(q('[data-side="red"]').textContent).toBe("~110");
    expect(q('[data-side="blue"]').textContent).toBe("~96");
    expect(q("[data-call]").textContent).toMatch(/Picked Red 62%/);
    expect(q("[data-outcome]")).toBeNull();
    expect(screen.getByRole("link", { name: /red 62% to win, blue 38%/ })).toBeTruthy();
  });

  it("your team's result is white text when it won, and your side gets the slate-blue edge", () => {
    show(match({}, 130, 90), 31065);
    expect(q("[data-row-meta] [data-mine] span").className).toMatch(/text-text-base/);
    expect(q("[data-match]").className).toMatch(/before:bg-accent/);
    cleanup();
    show(match({}, 130, 90), 19612);
    expect(q("[data-row-meta] [data-mine]").textContent).toBe("19612 lost");
    expect(q("[data-row-meta] [data-mine] span").className).toMatch(/text-text-muted/);
  });

  it("the visitor's team is marked (white); each team is its own tap above the row's link", () => {
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
