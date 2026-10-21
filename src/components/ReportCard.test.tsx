// @vitest-environment jsdom
// The report card says what it rests on: sample size, the raw numbers, and that
// small samples lean on the field average. With no live calls it says so.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReportCard, TeamReportCards } from "../shared/api";
import { ReportCardSection } from "./ReportCard";

afterEach(cleanup);

const card = (o: Partial<ReportCard>): ReportCard => ({
  code: null, name: null, start: null, final: false, calls: 4, decided: 4, hits: 4, scored: 4,
  raw: { hitRate: 1, errMean: 12, errAbs: 12, errSd: 3 },
  shrunk: { hitRate: 0.76, errMean: 3.4, errAbs: 8, errSd: 9.5 },
  ...o,
});
const data = (season: ReportCard, events: ReportCard[] = []): TeamReportCards => ({
  season, events, prior: 10, field: { calls: 4000, decided: 3900, scored: 3800, hitRate: 0.69, errMean: 0, errAbs: 7, errSd: 10 },
});
const show = (d: TeamReportCards | null) => render(<MemoryRouter><ReportCardSection team={4215} season={2026} data={d} /></MemoryRouter>);

describe("report card", () => {
  it("shows the shrunk numbers, the sample size and the raw ones, flagging a small sample", () => {
    show(data(card({})));
    expect(screen.getByText("76%")).toBeTruthy();
    const note = screen.getByText(/Estimate from 4 live calls/);
    expect(note.textContent).toMatch(/small sample/i);
    expect(note.textContent).toMatch(/Raw: 100% called right, \+12 vs prediction/);
    expect(screen.getByText(/field 69%/)).toBeTruthy();
  });

  it("lists finished events", () => {
    show(data(card({ calls: 40, decided: 40, hits: 30, scored: 40 }), [card({ code: "USNJQ1", name: "NJ Qualifier", final: true, calls: 10, decided: 10, hits: 7 })]));
    expect(screen.getByRole("link", { name: "NJ Qualifier" }).getAttribute("href")).toBe("/events/2026/USNJQ1");
    expect(screen.getByText(/Estimate from 40 live calls/).textContent).not.toMatch(/small sample/i);
  });

  it("says when there are no live calls yet", () => {
    show(null);
    expect(screen.getByText(/No scored live calls/)).toBeTruthy();
    expect(screen.queryByTestId("report-card")).toBeNull();
  });
});
