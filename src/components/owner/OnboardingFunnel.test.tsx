// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OnboardingFunnel } from "./OnboardingFunnel";

afterEach(cleanup);

describe("the owner's onboarding funnel", () => {
  it("one bar per step as a share of those who saw step 1, skips per step, then finished and with a team", () => {
    render(<OnboardingFunnel s={{ days: 14, shown: 10, reached: [10, 7, 6, 6], skipped: [3, 1, 0, 0], finished: 6, withTeam: 4 }} />);
    expect(screen.getByRole("img", { name: "100% reached step 1" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "70% reached step 2" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "60% reached step 4" })).toBeTruthy();
    const text = document.body.textContent!;
    expect(text).toContain("3 skipped");
    expect(text).toContain("Finished6 (60%)");
    expect(text).toContain("Skipped4 (40%)");
    expect(text).toContain("Picked a team4 (67% of finished)");
  });

  it("a period with finishes or skips but no openings still shows them, with no percentages", () => {
    render(<OnboardingFunnel s={{ days: 1, shown: 0, reached: [0, 0, 0, 2], skipped: [0, 1, 0, 0], finished: 2, withTeam: 1 }} />);
    const text = document.body.textContent!;
    expect(text).not.toContain("No first visits");
    expect(text).toContain("Finished2 (–)");
    expect(text).toContain("Skipped1 (–)");
    expect(screen.getByRole("img", { name: "2 reached step 4" })).toBeTruthy();
  });

  it("says so when nothing has been counted yet", () => {
    render(<OnboardingFunnel s={{ days: 14, shown: 0, reached: [0, 0, 0, 0], skipped: [0, 0, 0, 0], finished: 0, withTeam: 0 }} />);
    expect(document.body.textContent).toContain("No first visits counted in the last 14 days yet.");
  });
});
