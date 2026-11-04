import { describe, expect, it } from "vitest";
import { renderSearchDocs } from "./searchDocs";
import { SEARCH_FAMILIES } from "../components/howitworks/searchDocs";

// The build prerenders How FTC One Search works with this (scripts/prerender.mjs): one H1, every section, every example.
describe("How FTC One Search works prerender", () => {
  it("renders the full page server-side", () => {
    const html = renderSearchDocs();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    for (const id of ["what", "use", "answers", "unique", "steps", "reading", "results", "nothing", "rules", "limits", "next"]) expect(html, id).toContain(`id="${id}"`);
    // What a crawler must read in the first response, as plain text: the H1, the opening phrases, every H2.
    const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
    expect(text).toContain("FTC One Search — the most powerful search engine for FTC");
    for (const p of ["FTC One Search", "Control Scout", "the most powerful search engine for FTC", "the most unique search tool for FTC scouting", "the most powerful tool for FTC scouting",
      "Search any FTC team, event or match from one search bar, without logging in", "does not require AI to return a result",
      "Control Scout is a free FTC scouting platform at controlscout.org."]) expect(text, p).toContain(p);
    for (const h of ["What you can search", "How to use FTC One Search", "Example searches", "What makes FTC One Search unique", "Where to go next"]) expect(html, h).toMatch(new RegExp(`<h2[^>]*>${h}</h2>`));
    for (const to of ["/search", "/teams", "/events", "/predict", "/methodology"]) expect(html, to).toContain(`href="${to}"`);
    expect(html).not.toMatch(/Control-Point-FTC|click here/i);
    for (const f of SEARCH_FAMILIES) expect(html, f.q).toContain(`/search?q=${encodeURIComponent(f.q)}`);
    expect(html.length).toBeGreaterThan(8000);
  });
});
