// @vitest-environment jsdom
// A match row's layout: the call (pick + bar, then status chips) lives in its own column, never inside an
// alliance box; chips never wrap mid-word; the pre-match report is an icon button with a full accessible name.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchPredictionView, MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0 }));

const { MatchRow } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], total?: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: total == null ? null : { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
const pred = (o: Partial<MatchPredictionView> = {}): MatchPredictionView =>
  ({ pRed: 0.47, redMean: 100, blueMean: 104, tier: "provisional", kind: "live", predictedAt: null, factors: [], ...o }) as MatchPredictionView;
function match(o: Partial<MatchView> = {}, red?: number, blue?: number): MatchView {
  return { season: 2025, code: "LAYQ1", key: "qual:0:7", level: "qual", series: 0, number: 7, label: "Q7", time: null, startsAt: null,
    played: red != null, red: side([31065, 14343], red), blue: side([19612, 27573], blue), video: null, prediction: pred(), ...o };
}
const show = (m: MatchView, highlight?: number, showEvent?: string) => render(<MemoryRouter><TooltipProvider><MatchRow m={m} highlight={highlight} showEvent={showEvent} /></TooltipProvider></MemoryRouter>);
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const call = () => q("[data-call]")!;
const alliances = () => q("[data-alliances]")!;

/** Every status badge is in the call column, none in the alliance area, and none can wrap. */
function chipsInCallColumn() {
  const status = q("[data-call-status]");
  if (!status) return;
  expect(call().contains(status)).toBe(true);
  for (const chip of Array.from(status.children) as HTMLElement[]) {
    expect(alliances().contains(chip)).toBe(false);
    expect(chip.className).toMatch(/whitespace-nowrap/);
  }
}
const reportLink = () => screen.getByRole("link", { name: "Pre-match report for Q7" });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => cleanup());

describe("match row layout", () => {
  it("the row is its own container, so it lays out by its width, not the window's", () => {
    show(match());
    expect(q("[data-match]")!.className).toMatch(/@container/);
  });

  it("unplayed: the call only (pick + tier), no outcome or ledger chip", () => {
    show(match({ prediction: pred({ kind: "now" }) }));
    expect(within(call()).getByRole("button", { name: "Picked Blue 53%" }).className).toMatch(/whitespace-nowrap/);
    expect(q("[data-outcome]")).toBeNull();
    expect(q("[data-kind]")).toBeNull();
    expect(within(call()).getByRole("button", { name: "Provisional confidence" })).toBeTruthy();
    chipsInCallColumn();
    expect(reportLink().getAttribute("href")).toBe("/events/2025/LAYQ1/match/qual:0:7");
  });

  it("played and right: a Right chip, the tier and the pre-match mark, all in the call column", () => {
    show(match({}, 90, 120));
    const right = q("[data-outcome=right]")!;
    expect(right.textContent).toMatch(/Right/);
    expect(call().contains(right)).toBe(true);
    expect(alliances().contains(right)).toBe(false);
    expect(alliances().textContent).not.toMatch(/Right|Upset|provisional|pre-match/);
    chipsInCallColumn();
    reportLink();
  });

  it("played and upset: an Upset chip in the call column", () => {
    show(match({}, 130, 98));
    const upset = q("[data-outcome=upset]")!;
    expect(upset.textContent).toMatch(/Upset/);
    expect(call().contains(upset)).toBe(true);
    expect(alliances().contains(upset)).toBe(false);
    chipsInCallColumn();
  });

  it("the tier is an icon chip that never wraps, named for screen readers; a tap says what it means", () => {
    for (const [tier, label] of [["provisional", "Provisional"], ["moderate", "Moderate"], ["confident", "Confident"]] as const) {
      show(match({ prediction: pred({ tier }) }, 90, 120));
      const chip = within(call()).getByRole("button", { name: `${label} confidence` });
      expect(chip.className).toMatch(/whitespace-nowrap/);
      expect(chip.textContent).toBe(`${label} confidence`); // the sr-only name only: no visible word
      fireEvent.click(chip);
      expect(screen.getByText(`${label} confidence`, { selector: "p" })).toBeTruthy();
      cleanup();
    }
  });

  it("pre-match vs replayed: a played match names which ledger its call came from, never as a breakable word", () => {
    show(match({}, 90, 120));
    const live = q("[data-kind=live]")!;
    expect(live.getAttribute("title")).toMatch(/^Pre-match: Called before the match/);
    expect(live.className).toMatch(/whitespace-nowrap/);
    expect(within(live).getByText(/pre-match/)).toBeTruthy();
    expect(call().contains(live)).toBe(true);
    cleanup();
    show(match({ prediction: pred({ kind: "backtest" }) }, 90, 120));
    const replay = q("[data-kind=backtest]")!;
    expect(replay.getAttribute("title")).toMatch(/^Replayed: /);
    expect(q("[data-kind=live]")).toBeNull();
    expect(call().contains(replay)).toBe(true);
  });

  it("no prediction: 'No call' in the call column, no chips, the report still one tap away", () => {
    show(match({ prediction: null }, 90, 120));
    expect(within(call()).getByText("No call").className).toMatch(/whitespace-nowrap/);
    expect(q("[data-call-status]")).toBeNull();
    reportLink();
  });

  it("a tie: no Right/Upset (neither side won), the tier and ledger chips stay", () => {
    show(match({}, 100, 100));
    expect(q("[data-outcome]")).toBeNull();
    expect(within(call()).getByRole("button", { name: "Provisional confidence" })).toBeTruthy();
    expect(q("[data-kind=live]")).toBeTruthy();
    chipsInCallColumn();
  });

  it("the highlighted team's result sits with the match label, not in the call column", () => {
    show(match({}, 90, 120), 31065);
    const mine = q("[data-mine]")!;
    expect(mine.textContent).toBe("31065 lost");
    expect(q("[data-match-label]")!.contains(mine)).toBe(true);
    expect(call().contains(mine)).toBe(false);
  });

  it("a long event name truncates on its own line and adds no intrinsic width to the label column", () => {
    show(match({}, 90, 120), 31065, "FIRST Tech Challenge World Championship - Edison Division");
    const when = q("[data-when]")!;
    expect(when.className).toMatch(/truncate/);
    expect(when.className).toMatch(/\[contain:inline-size\]/);
    expect(when.className).toMatch(/basis-full/);
    expect(q("[data-match-label]")!.contains(when)).toBe(true);
  });

  it("the report is an icon button outside the call column, with a 40px tap area", () => {
    show(match({}, 90, 120));
    const link = reportLink();
    expect(link.textContent).toBe("");
    expect(call().contains(link)).toBe(false);
    expect(alliances().contains(link)).toBe(false);
    // 32px box + the ::after's 4px on each side = 40px to tap.
    expect(link.className).toMatch(/size-8/);
    expect(link.className).toMatch(/after:-inset-1/);
  });
});
