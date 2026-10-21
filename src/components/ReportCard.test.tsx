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

  it("event rows show their basis: scored count, raw values, a small-sample mark, and no miss numbers without a scored call", () => {
    show(data(card({ calls: 40, decided: 40, hits: 30, scored: 40 }), [
      card({ code: "NOSCORE", name: "Early meet", final: true, calls: 3, decided: 3, hits: 2, scored: 0, raw: { hitRate: 2 / 3, errMean: null, errAbs: null, errSd: null }, shrunk: { hitRate: 0.7, errMean: -0.9, errAbs: 14, errSd: 19.8 } }),
      card({ code: "FULL", name: "Big qualifier", final: true, calls: 12, decided: 12, hits: 9, scored: 12, raw: { hitRate: 0.75, errMean: 4.2, errAbs: 10, errSd: 8 } }),
    ]));
    const rows = screen.getAllByRole("row").slice(1);
    const early = rows.find((r) => r.textContent?.includes("Early meet"))!;
    // No scored call: the field average would be all it shows, so no miss numbers at all.
    expect(early.textContent).toContain("0 scored");
    expect(early.textContent).not.toContain("−0.9");
    expect(early.textContent).not.toContain("±19.8");
    expect(early.querySelector("[data-testid=thin]")).toBeTruthy();
    const full = rows.find((r) => r.textContent?.includes("Big qualifier"))!;
    expect(full.textContent).toContain("raw +4.2");
    expect(full.textContent).toContain("raw ±8");
    expect(full.querySelector("[data-testid=thin]")).toBeNull();
  });

  it("says when there are no live calls yet", () => {
    show(null);
    expect(screen.getByText(/No scored live calls/)).toBeTruthy();
    expect(screen.queryByTestId("report-card")).toBeNull();
  });
});
