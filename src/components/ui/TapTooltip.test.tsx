// @vitest-environment jsdom
// A tip-only button shows its tip on a tap (a click), which a plain Radix tooltip never does on a touch screen.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TapTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./overlay";

afterEach(cleanup);

describe("TapTooltip", () => {
  it("opens on a tap", async () => {
    render(<TooltipProvider><TapTooltip trigger={<button type="button">Picked Red 58%</button>}>Predicted 120–90</TapTooltip></TooltipProvider>);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Picked Red 58%" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("Predicted 120–90");
  });

  it("a plain tooltip stays shut on a tap (why tip-only buttons use TapTooltip)", () => {
    render(<TooltipProvider><Tooltip><TooltipTrigger asChild><button type="button">Picked</button></TooltipTrigger><TooltipContent>tip</TooltipContent></Tooltip></TooltipProvider>);
    fireEvent.pointerDown(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
