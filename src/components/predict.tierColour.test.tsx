// @vitest-environment jsdom
// The confidence tier keeps its meaning colour in v8: v8's success token is white, so "Solid" carries its own green
// (a `v8:` twin) both as a bare mark and on the chip.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ConfidenceBadge, TierMark } from "./predict";
import { TooltipProvider } from "./ui/overlay";

afterEach(cleanup);
/** The class of the coloured element: the mark itself, or the badge inside its tooltip button. */
const cls = (ui: React.ReactElement) => {
  const root = render(<MemoryRouter><TooltipProvider>{ui}</TooltipProvider></MemoryRouter>).container;
  return (root.querySelector("button > span") ?? root.firstElementChild as HTMLElement).className;
};

describe("confidence tier colour", () => {
  it("draws Solid green in both looks, as a bare mark and as a badge", () => {
    for (const c of [cls(<TierMark tier="confident" />), cls(<ConfidenceBadge tier="confident" />)]) {
      expect(c).toContain("text-success");
      expect(c).toContain("v8:text-emerald-400");
    }
  });
});
