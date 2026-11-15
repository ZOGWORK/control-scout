// @vitest-environment jsdom
// The event page names a non-FIRST results source plainly and links the event's page there.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultsSource } from "./ResultsSource";

const ev = (source: string) => ({ source } as any);

describe("ResultsSource", () => {
  afterEach(cleanup);

  it("names and links CRI's results site", () => {
    render(<ResultsSource d={{ event: ev("cri"), resultsSource: { site: "chicagoroboticsinvitational.com", url: "https://results.chicagoroboticsinvitational.com/2025-2026-cri/events/cri/quals" } }} />);
    const a = screen.getByRole("link", { name: /chicagoroboticsinvitational\.com/ });
    expect(a.getAttribute("href")).toBe("https://results.chicagoroboticsinvitational.com/2025-2026-cri/events/cri/quals");
    expect(document.querySelector("[data-results-source]")?.textContent).toMatch(/^Results from\s*chicagoroboticsinvitational\.com/);
  });

  it("says nothing for FIRST's results", () => {
    const { container } = render(<ResultsSource d={{ event: ev("first"), resultsSource: undefined }} />);
    expect(container.textContent).toBe("");
  });
});
