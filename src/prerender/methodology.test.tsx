import { describe, expect, it } from "vitest";
import { renderMethodology } from "./methodology";

// The build prerenders How it works with this function (scripts/prerender.mjs): it must keep rendering the whole
// page on the server, with every section other pages link to and a single H1.
describe("How it works prerender", () => {
  it("renders the full page server-side: one H1, every linked section, the words", () => {
    const html = renderMethodology();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    for (const id of ["overview", "rating", "opr", "factors", "ranges", "confidence", "bonus", "advancement", "projections", "accuracy", "lab", "limits", "versions", "settings"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    for (const text of ["expected contribution", "Where a team plays", "A final calibration touch", "Live projections", "Every engine version, in one line"]) {
      expect(html, text).toContain(text);
    }
  });
});
