// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PredictedPair, ScoreRange } from "./ScoreRange";

afterEach(() => cleanup());

describe("ScoreRange", () => {
  it("reads 118 ±14, with the range's meaning for hover and screen readers", () => {
    const { container } = render(<ScoreRange mean={118.2} range={[104, 132]} />);
    expect(container.textContent).toBe("118 ±14 (80% range 104–132: about 8 in 10 real scores land inside)");
    expect(container.querySelector("[title]")!.getAttribute("title")).toBe("80% range 104–132: about 8 in 10 real scores land inside");
  });

  it("a call with no stated range shows the score alone (~ when asked)", () => {
    expect(render(<ScoreRange mean={120} />).container.textContent).toBe("120");
    cleanup();
    expect(render(<ScoreRange mean={120} approx />).container.textContent).toBe("~120");
  });
});

describe("PredictedPair", () => {
  it("labels the ± visibly, and screen readers hear both scores with their ranges", () => {
    const { container } = render(<PredictedPair p={{ redMean: 118, blueMean: 96, redRange: [104, 132], blueRange: [84, 108] }} />);
    expect(container.querySelector("[aria-hidden]")!.textContent).toBe("118 ±14 – 96 ±12 (80% range)");
    expect(container.querySelector(".sr-only")!.textContent).toBe(
      "Predicted red 118, 80% range 104–132: about 8 in 10 real scores land inside; blue 96, 80% range 84–108: about 8 in 10 real scores land inside");
  });

  it("without ranges it's the plain pair", () => {
    expect(render(<PredictedPair p={{ redMean: 118, blueMean: 96 }} />).container.textContent).toBe("118–96");
  });
});
