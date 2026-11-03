import { describe, expect, it } from "vitest";
import { renderSearchDocs } from "./searchDocs";
import { SEARCH_FAMILIES } from "../components/howitworks/searchDocs";

// The build prerenders How FTC One Search works with this (scripts/prerender.mjs): one H1, every section, every example.
describe("How FTC One Search works prerender", () => {
  it("renders the full page server-side", () => {
    const html = renderSearchDocs();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    for (const id of ["overview", "steps", "reading", "answers", "results", "nothing", "rules", "limits"]) expect(html, id).toContain(`id="${id}"`);
    for (const f of SEARCH_FAMILIES) expect(html, f.q).toContain(`/search?q=${encodeURIComponent(f.q)}`);
    expect(html.length).toBeGreaterThan(8000);
  });
});
