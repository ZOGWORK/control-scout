// @vitest-environment jsdom
// The reliability section is labelled an estimate with its parts and sample size; the blended number appears
// only when a workspace's notes are given, marked as including them.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Reliability } from "../shared/reliability";
import { plural, ReliabilitySection } from "./Reliability";

afterEach(cleanup);

const r: Reliability = {
  index: 63, matches: 15, noShows: 1, dqs: 0, nearZero: 6, recent: { matches: 10, noShows: 1, nearZero: 6 },
  parts: { noShowRate: 0.04, dqRate: 0.001, nearZeroRate: 0.2, swing: 0.4, penaltyRatio: 0.77, predictabilityRatio: 1 }, fieldIndex: 75,
};
const show = (notes?: { matchEntries: number; flagged: number }) => render(<MemoryRouter><ReliabilitySection r={r} notes={notes} workspaceName="Pyro" /></MemoryRouter>);

describe("reliability section", () => {
  it("is an estimate with its parts, sample size and the near-zero caveat", () => {
    show();
    expect(screen.getByText("Reliability (estimate)")).toBeTruthy();
    expect(screen.getByText(/15 qual matches · field 75 · less steady than most/)).toBeTruthy();
    expect(screen.getByText("1 of 15")).toBeTruthy();
    expect(screen.getByText(/not proof of a dead robot/)).toBeTruthy();
    expect(screen.getByText(/Last 10: 1 no-show, 6 near-zero matches/)).toBeTruthy();
    expect(screen.queryByTestId("reliability-blended")).toBeNull();
  });

  it("adds the workspace blend, marked as such, only with that workspace's notes", () => {
    show({ matchEntries: 4, flagged: 2 });
    const b = screen.getByTestId("reliability-blended");
    expect(b.textContent).toMatch(/With Pyro's notes/);
    expect(b.textContent).toMatch(/2 of 4 match entries marked broken/);
    expect(b.textContent).toMatch(/Only your workspace's members see this/);
  });

  it("pluralises", () => {
    expect([plural(1, "match"), plural(2, "match"), plural(2, "match entry"), plural(3, "no-show")]).toEqual(["1 match", "2 matches", "2 match entries", "3 no-shows"]);
  });
});
