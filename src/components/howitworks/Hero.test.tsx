// @vitest-environment jsdom
// The example-match dots are 44px targets on a phone. Phones use a 14px text base (index.css), so a rem size
// (size-11 = 2.75rem) came out at 38.5px there; the phone size has to be in px.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

describe("methodology hero example dots", () => {
  it("are 44px (not rem) targets on a phone and 24px from md up", async () => {
    class FakeIO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { Hero } = await import("./Hero");
    const { getByRole } = render(<Hero />);
    const buttons = [...getByRole("group", { name: "Example matches" }).querySelectorAll("button[aria-pressed]")].filter((b) => !/cycling/.test(b.getAttribute("aria-label") ?? ""));
    expect(buttons.length).toBe(4);
    for (const b of buttons) {
      const classes = b.className.split(/\s+/);
      expect(classes).toContain("size-[44px]");
      expect(classes).toContain("md:size-6");
      expect(classes).not.toContain("size-11");
    }
  });
});
