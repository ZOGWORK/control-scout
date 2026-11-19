// @vitest-environment jsdom
// The shared match row in v8 (docs/design/v8-revamp-brief.md §5 Match row): red side and blue side as 2px edges with
// no tinted box, big tabular scores with the winner bolder, the call as a slim two-colour bar that never animates
// its width, and a hover that's a plain fill (no lift, no mint). With v8 off the row keeps today's classes.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchPredictionView, MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0, useVideoCount: () => 0 }));

const { MatchRow, MatchList, WinBar } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], total?: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: total == null ? null : { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
const pred = (o: Partial<MatchPredictionView> = {}): MatchPredictionView =>
  ({ pRed: 0.62, redMean: 110, blueMean: 96, tier: "confident", kind: "live", predictedAt: null, factors: [], ...o }) as MatchPredictionView;
function match(o: Partial<MatchView> = {}, red?: number, blue?: number): MatchView {
  return { season: 2025, code: "V8Q1", key: "qual:0:3", level: "qual", series: 0, number: 3, label: "Q3", time: null, startsAt: null,
    played: red != null, red: side([31065, 14343], red), blue: side([19612, 27573], blue), video: null, prediction: pred(), ...o };
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
  it("each side is a 2px edge in its colour with no tinted box", () => {
    show(match({}, 130, 90));
    const red = q('[data-side="red"]'), blue = q('[data-side="blue"]');
    expect(red.className).toMatch(/v8:bg-transparent/);
    expect(red.className).toMatch(/v8:border-l-2/);
    expect(red.className).toMatch(/border-red-alliance/);
    expect(blue.className).toMatch(/v8:@min-\[330px\]:border-r-2/);
    expect(red.getAttribute("data-result")).toBe("win");
    expect(blue.getAttribute("data-result")).toBe("loss");
  });

  it("scores are big tabular numbers, the winner bolder than the loser", () => {
    show(match({}, 130, 90));
    const [red, blue] = Array.from(document.querySelectorAll<HTMLElement>("[data-score]"));
    expect(red.textContent).toMatch(/^130/);
    for (const s of [red, blue]) { expect(s.className).toMatch(/tabular-nums/); expect(s.className).toMatch(/v8:text-\[1\.625rem\]/); }
    expect(red.className).toMatch(/v8:font-bold/);
    expect(blue.className).toMatch(/v8:font-medium/);
  });

  it("the call is a slim two-colour bar that doesn't animate its width", () => {
    show(match());
    const bar = q("[data-call] [data-winbar]");
    expect(bar.className).toMatch(/v8:h-1/);
    expect((bar.firstElementChild as HTMLElement).className).toMatch(/v8:transition-none/);
  });

  it("the hover is a plain fill, never mint, and the report button is outlined, not mint-bordered", () => {
    show(match());
    const row = q("[data-row]");
    expect(row.className).toMatch(/v8:still-hover:bg-white\/\[0\.03\]/);
    expect(q("[data-report-link]").className).toMatch(/v8:border-white\/\[0\.12\]/);
  });

  it("your team's number is mint text, never a mint fill", () => {
    show(match(), 31065);
    const mine = Array.from(document.querySelectorAll<HTMLElement>("[data-alliances] a, [data-alliances] button, [data-alliances] span")).find((e) => e.className.includes("bg-accent/15"))!;
    expect(mine.className).toMatch(/v8:bg-transparent/);
    expect(mine.className).toMatch(/v8:ring-0/);
  });

  it("the match list's level heading is sentence case in v8, not tracked caps", () => {
    const ms = [match(), match({ key: "playoff:1:1", level: "playoff", series: 1, number: 1, label: "SF1" })];
    render(<MemoryRouter><TooltipProvider><MatchList matches={ms} /></TooltipProvider></MemoryRouter>);
    const head = q("[data-group-head]");
    expect(head.className).toMatch(/v8:normal-case/);
    expect(head.className).toMatch(/v8:tracking-normal/);
  });
});

describe("match row with v8 off", () => {
  beforeEach(() => document.documentElement.removeAttribute("data-v8"));
  it("keeps today's tinted boxes, mint hover and the WinBar's width transition", () => {
    show(match({}, 130, 90));
    expect(q('[data-side="red"]').className).toMatch(/bg-red-alliance\/\[0\.14\]/);
    expect(q("[data-row]").className).toMatch(/still-hover:bg-accent\/\[0\.07\]/);
    cleanup();
    render(<WinBar pRed={0.6} />);
    expect((q("[data-winbar]").firstElementChild as HTMLElement).className).toMatch(/transition-\[width\]/);
  });
});
