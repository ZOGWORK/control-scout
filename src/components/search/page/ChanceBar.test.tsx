// @vitest-environment jsdom
// A chance as the search results guide draws it (§8): the number, a 0–100% bar filled from 0 to it, the call's score
// with its range, and one primary action.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ChanceBar } from "./ChanceBar";

afterEach(cleanup);

describe("ChanceBar", () => {
  it("prints the chance once, fills the bar to it on a 0–100% scale, and has one action", () => {
    const { container, getAllByRole } = render(<MemoryRouter><ChanceBar b={{ kind: "chance", p: 0.556, who: "12345", label: "to win the next match (Q12), before it's played", note: "Predicted 138 ±14 – 92 ±12", action: { label: "Open in Predict", href: "/predict" } }} /></MemoryRouter>);
    expect(container.querySelector("[data-chance-value]")?.textContent).toBe("56%");
    expect((container.querySelector("[data-chance-fill]") as HTMLElement).style.width).toBe("56%");
    expect(container.textContent).toContain("100%");
    expect(container.textContent).toContain("Predicted 138 ±14 – 92 ±12");
    expect(getAllByRole("link").map((l) => l.textContent)).toEqual(["Open in Predict"]);
    // Sign-off visual pass, 390 px: the action was 35px tall. A touch target is 44px each way (answerCells TAP).
    expect(container.querySelector("[data-primary-cta]")!.className).toMatch(/max-md:min-h-\[44px\].*max-md:min-w-\[44px\]/);
    // The bar is the team hue (--color-chance is team A) on a neutral track, never volt (the accent): volt is the primary button's alone.
    const bar = container.querySelector("[role=img]")!;
    expect(bar.querySelector("[data-chance-fill]")?.className).toContain("bg-team-a");
    expect(bar.outerHTML).not.toMatch(/accent/);
  });
  it("prints a long shot as Predict does, never a false 0%, and a settled chance as is", () => {
    const at = (p: number) => render(<MemoryRouter><ChanceBar b={{ kind: "chance", p, who: "1", label: "x" }} /></MemoryRouter>).container.querySelector("[data-chance-value]")?.textContent;
    expect(at(0.002)).toBe("1%");
    expect(at(0.999)).toBe("99%");
    expect(at(0)).toBe("0%");
    expect(at(1)).toBe("100%");
  });
  it("keeps a chance outside 0–1 on the scale", () => {
    const { container } = render(<MemoryRouter><ChanceBar b={{ kind: "chance", p: 1.2, who: "1", label: "x" }} /></MemoryRouter>);
    expect((container.querySelector("[data-chance-fill]") as HTMLElement).style.width).toBe("100%");
  });
});
