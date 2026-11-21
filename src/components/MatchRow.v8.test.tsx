// @vitest-environment jsdom
// The shared match row in v8, compact: the alliance boxes (faint tint and a coloured edge) with each team as its own
// tile (number over name), the playoff lives hearts, the details chevron, and the call on one line (Picked % with its
// bar, Right/Upset, the tier, the ledger icon). The report button is hidden (the open details link to it). v8 only
// changes classes; with v8 off the row is drawn as before.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchPredictionView, MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0, useVideoCount: () => 0 }));

const { MatchRow } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], total?: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true, name: `Team ${number}` })), score: total == null ? null : { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
const pred = (o: Partial<MatchPredictionView> = {}): MatchPredictionView =>
  ({ pRed: 0.62, redMean: 110, blueMean: 96, tier: "confident", kind: "live", predictedAt: null, factors: [], ...o }) as MatchPredictionView;
function match(o: Partial<MatchView> = {}, red?: number, blue?: number): MatchView {
  return { season: 2025, code: "V8Q1", key: "qual:0:3", level: "qual", series: 0, number: 3, label: "Q3", time: "2026-11-07T14:12:00", startsAt: null,
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

describe("match row in v8: every classic feature, restyled", () => {
  it("alliance boxes with a faint tint and coloured edge, each team its own tile with number over name", () => {
    show(match({}, 130, 90));
    const red = q('[data-alliance-box="red"]');
    expect(red.className).toMatch(/v8:bg-red-alliance\/\[0\.09\]/); // the winner's box, a little stronger
    expect(red.className).toMatch(/border-red-alliance/);
    expect(q('[data-alliance-box="blue"]').className).toMatch(/v8:bg-blue-alliance\/\[0\.05\]/);
    const tile = within(red).getByRole("link", { name: /31065/ });
    expect(tile.className).toMatch(/flex-col/);
    expect(within(tile).getByText("Team 31065").className).toMatch(/v8:not-italic/);
  });

  it("the details chevron, the time, the call with Picked %, bar, tier, ledger and Right", () => {
    show(match({}, 130, 90));
    expect(screen.getByRole("button", { name: "Q3 details" })).toBeTruthy();
    expect(q("[data-when]")).toBeTruthy();
    const call = q("[data-call]");
    expect(within(call).getByRole("button", { name: "Picked Red 62%" })).toBeTruthy();
    expect(call.querySelector("[data-winbar]")).toBeTruthy();
    expect(within(call).getByRole("button", { name: /Confidence/ })).toBeTruthy();
    expect(q('[data-kind="live"]')).toBeTruthy();
    expect(q('[data-outcome="right"]')).toBeTruthy();
  });

  it("compact in v8: no report button in the row (the open details link to it), half the padding, the call on one line", () => {
    show(match());
    expect(q("[data-report-link]").className).toMatch(/v8:hidden/);
    const row = q("[data-row]");
    expect(row.className).toMatch(/v8:py-1\.5/);
    expect(row.className).toMatch(/v8:@3xl:grid-cols-\[6\.5rem_minmax\(0,1fr\)_minmax\(0,1fr\)_20rem]/); // no report track
    expect(q("[data-call]").className).toMatch(/v8:flex-row/);
  });

  it("your result chip says only won or lost in v8 (the number stays for screen readers)", () => {
    show(match({}, 130, 90), 31065);
    const chip = q("[data-mine]");
    expect(chip.textContent).toBe("31065 won");
    expect(within(chip).getByText("31065").className).toMatch(/v8:sr-only/);
  });

  it("your team's tile takes the slate-blue accent ring and tint, on either side; other numbers are accent, names white", () => {
    show(match({}, 130, 90), 19612);
    const mine = within(q('[data-alliance-box="blue"]')).getByRole("link", { name: /19612/ });
    expect(mine.className).toMatch(/v8:ring-accent\/70/);
    expect(mine.className).toMatch(/v8:bg-accent\/\[0\.14\]/);
    expect(within(mine).getByText("19612").className).not.toMatch(/v8:text-accent/); // yours stays white
    const other = within(q('[data-alliance-box="red"]')).getByRole("link", { name: /31065/ });
    expect(within(other).getByText("31065").className).toMatch(/v8:text-accent/);
    expect(within(other).getByText("Team 31065").className).toMatch(/v8:text-text-base/);
  });

  it("your result in the row is a soft chip: green when won, red when lost", () => {
    show(match({}, 130, 90), 31065);
    expect(q("[data-mine]").className).toMatch(/v8:text-emerald-400/);
    cleanup();
    show(match({}, 130, 90), 19612);
    expect(q("[data-mine]").className).toMatch(/text-destructive/);
  });

  it("a double-elimination playoff keeps its lives hearts", () => {
    show(match({ level: "playoff", key: "playoff:3:1", label: "M3", lives: { red: { before: 2, after: 1 }, blue: { before: 2, after: 2 } } } as never, 40, 90));
    expect(document.querySelectorAll("[data-heart]").length).toBe(4);
    expect(q('[data-heart="broken"]')).toBeTruthy();
  });

  it("the hover and open fills are plain white, never an accent tint; the details still open", () => {
    const toggle = vi.fn();
    render(<MemoryRouter><TooltipProvider><MatchRow m={match()} onToggle={toggle} /></TooltipProvider></MemoryRouter>);
    expect(q("[data-row]").className).toMatch(/v8:still-hover:bg-ink\/\[0\.03\]/);
    fireEvent.click(screen.getByRole("button", { name: "Q3 details" }));
    expect(toggle).toHaveBeenCalled();
  });

  it("both scores keep their alliance colour in v8; the loser is only lighter in weight", () => {
    show(match({}, 130, 90));
    const blueScore = within(q('[data-alliance-box="blue"]')).getByText("90");
    expect(blueScore.className).toMatch(/v8:font-medium/);
    expect(blueScore.className).toMatch(/v8:text-blue-alliance/);
    expect(blueScore.className).not.toMatch(/opacity/);
    expect(within(q('[data-alliance-box="red"]')).getByText("130").className).toMatch(/v8:text-red-alliance/);
  });
});
