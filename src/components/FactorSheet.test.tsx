// @vitest-environment jsdom
// The full why breakdown as a user sees it: every factor with its share, reasons at 0%, and once the match is
// played, which factors pointed to the winner. Built from a real engine sheet, so the shares are the engine's.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FITTED_MODEL, PartnershipBook, RatingBook, explainMatch, type MatchRecord } from "@control-scout/predict-engine";

// The owner's factorSheet toggle (src/lib/flags useFlag), switchable per test.
const flag = vi.hoisted(() => ({ on: true }));
vi.mock("../lib/flags", () => ({ useFlag: (name: string) => (name === "factorSheet" ? flag.on : true) }));
const { FactorSheetPanel } = await import("./FactorSheet");
import { compactSheet, parseSheet, pointedRight, sheetReview, sheetWinner } from "../shared/factorSheet";

const al = (teams: number[], auto: number, teleop: number, endgame: number, pen = 0) => ({ teams, auto, teleop, endgame, np: auto + teleop + endgame, penCommitted: pen, total: auto + teleop + endgame });
let n = 0;
const rec = (red: ReturnType<typeof al>, blue: ReturnType<typeof al>): MatchRecord => ({ season: 2025, eventCode: "E", level: "qual", series: 0, number: ++n, time: Date.UTC(2025, 10, 1) + n * 6e4, red, blue });

function sheet() {
  const book = new RatingBook(FITTED_MODEL.rating);
  const pairs = new PartnershipBook(FITTED_MODEL.rating);
  book.startSeason(2025);
  for (let i = 0; i < 6; i++) {
    for (const m of [rec(al([1, 2], 60, 80, 20), al([3, 4], 15, 90, 25, 30)), rec(al([1, 3], 55, 85, 22), al([2, 4], 18, 70, 20, 25)), rec(al([1, 4], 58, 75, 18, 20), al([2, 3], 20, 85, 24))]) {
      book.update(m);
      pairs.observe(m);
    }
  }
  const x = explainMatch(book, [1, 2], [3, 4], { noise: FITTED_MODEL.noise, contextual: FITTED_MODEL.contextual, context: { level: "qual", event: "E" }, partnership: { table: pairs, season: 2025 } });
  return { x, s: compactSheet(x.factorSheet) };
}

afterEach(() => { cleanup(); flag.on = true; });

describe("factor sheet (shared)", () => {
  it("compacts to 4 places, round-trips through the ledger column, and refuses junk", () => {
    const { x, s } = sheet();
    expect(s.phases.map((f) => f.label)).toEqual(x.factorSheet.phases.map((f) => f.label));
    for (const f of [...s.phases, ...s.model]) expect(Math.round(f.weight * 1e4) / 1e4).toBe(f.weight);
    expect(parseSheet(JSON.stringify(s))).toEqual(s);
    expect(parseSheet(null)).toBeNull();
    expect(parseSheet("{")).toBeNull();
    expect(parseSheet("{\"phases\":1}")).toBeNull();
  });

  it("reviews a played match: only factors that leaned one way count, ties review nothing", () => {
    const { s } = sheet();
    expect(pointedRight({ favors: "A" }, "A")).toBe(true);
    expect(pointedRight({ favors: "B" }, "A")).toBe(false);
    expect(pointedRight({ favors: "even" }, "A")).toBeNull();
    expect(sheetReview(s, "tie")).toBeNull();
    const a = sheetReview(s, "A")!, b = sheetReview(s, "B")!;
    expect(a.right + b.right).toBe(a.leaning);
    expect(a.rightWeight + b.rightWeight).toBeLessThanOrEqual(1.0001);
    expect(sheetWinner(100, 90)).toBe("A");
    expect(sheetWinner(90, 90)).toBe("tie");
  });
});

describe("FactorSheetPanel", () => {
  it("lists every factor with its share behind an expander; reasons carry 0%", () => {
    const { s } = sheet();
    render(<FactorSheetPanel sheet={s} />);
    const panel = screen.getByTestId("factor-sheet");
    expect(panel.hasAttribute("open")).toBe(false);
    expect(within(panel).getByText(/Full why breakdown/)).toBeTruthy();
    for (const f of [...s.phases, ...s.model, ...s.reasons]) expect(within(panel).getByText(f.name)).toBeTruthy();
    expect(within(panel).getByText("Head-to-head").closest("li")!.textContent).toContain("0%");
    expect(within(panel).getByText("Schedule strength").closest("li")!.textContent).toContain("0%");
    expect(screen.queryByTestId("sheet-review")).toBeNull();
    expect(screen.queryByText("Pointed right")).toBeNull();
  });

  it("draws what the call leans on as one bar: each side's segments fill exactly its share", () => {
    const { s } = sheet();
    render(<FactorSheetPanel sheet={s} />);
    const bar = within(screen.getByTestId("sheet-tug")).getByRole("img");
    const widths = [...bar.children].map((c) => parseFloat((c as HTMLElement).style.width));
    expect(widths.reduce((a, w) => a + w, 0)).toBeCloseTo(100, 6);
    const lean = (side: string) => [...s.phases, ...s.model].filter((f) => f.favors === side).reduce((a, f) => a + f.weight, 0);
    const blueShare = lean("B") / (lean("A") + lean("B"));
    const blueSegs = [...bar.children].filter((c) => (c as HTMLElement).className.includes("bg-blue-alliance"));
    expect(blueSegs.reduce((a, c) => a + parseFloat((c as HTMLElement).style.width), 0)).toBeCloseTo(blueShare * 100, 6);
  });

  it("is hidden while the owner has the full why breakdown switched off", () => {
    flag.on = false;
    const { container } = render(<FactorSheetPanel sheet={sheet().s} winner="A" defaultOpen />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("factor-sheet")).toBeNull();
  });

  it("after the match: says which factors pointed to the winner and how much of the call they carried", () => {
    const { s } = sheet();
    render(<FactorSheetPanel sheet={s} winner="A" defaultOpen />);
    const review = sheetReview(s, "A")!;
    expect(screen.getByTestId("factor-sheet").hasAttribute("open")).toBe(true);
    expect(screen.getByTestId("sheet-review").textContent).toContain(`${review.right} of ${review.leaning}`);
    expect(screen.queryAllByText("Pointed right")).toHaveLength(review.right);
    expect(screen.queryAllByText("Pointed wrong")).toHaveLength(review.leaning - review.right);
  });
});
