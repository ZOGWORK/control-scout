// The document never rubber-bands past its top on a computer (a trackpad pull in Chrome or Safari showed a blank
// band above the top bar and sidebar). Phones keep their browser's own edge: pull-to-refresh and the bounce.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");

describe("page overscroll", () => {
  it("stops the document at its edges for a fine pointer only", () => {
    const rule = css.match(/@media \(hover: hover\) and \(pointer: fine\) \{ html \{ ([^}]*) \} \}/);
    expect(rule?.[1]).toBe("overscroll-behavior-y: none;");
  });
  it("never stops sideways overscroll on the page (the back and forward swipe)", () => {
    expect(css).not.toMatch(/html[^{]*\{[^}]*overscroll-behavior(-x)?:\s*none/);
  });
});
