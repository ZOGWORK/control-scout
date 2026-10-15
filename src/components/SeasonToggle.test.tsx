// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "./ui/overlay";
import { SeasonToggle } from "./SeasonToggle";

afterEach(cleanup);

describe("SeasonToggle", () => {
  it("shows a short label for phones and the full one from sm up, and keeps the full name for screen readers", () => {
    render(<TooltipProvider><SeasonToggle value={2025} onChange={() => {}} /></TooltipProvider>);
    const item = screen.getByRole("radio", { name: /^2025–26/ });
    const [short, full] = Array.from(item.querySelectorAll("span"));
    expect(short.textContent).toBe("25–26");
    expect(short.className).toContain("sm:hidden");
    expect(full.textContent).toBe("2025–26");
    expect(full.className).toContain("max-sm:hidden");
  });
});
