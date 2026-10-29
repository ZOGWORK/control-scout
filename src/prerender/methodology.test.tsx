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

  it("folded lab notes render closed as aria-hidden + inert, in the form scripts/prerender.mjs opens for the first paint", () => {
    const html = renderMethodology();
    const panels = html.match(/<div[^>]*class="hiw-expand"[^>]*>/g)!.filter((d) => !d.includes("hiw-pipe-detail"));
    expect(panels.length).toBeGreaterThan(5);
    for (const d of panels) expect(d).toMatch(/ aria-hidden="true" inert=""/);
    // The build's own replacements leave every panel open and focusable.
    const opened = html.replace(/(<div[^>]*class="hiw-expand"[^>]*?) aria-hidden="true"/g, "$1").replace(/(<div[^>]*class="hiw-expand"[^>]*?) inert=""/g, "$1");
    expect(opened).not.toMatch(/class="hiw-expand"[^>]*(aria-hidden|inert)/);
  });
});
