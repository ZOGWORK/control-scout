// Sections that fade in from script (.hiw-reveal, howitworks.css: opacity 0 until an observer marks them) must still
// show with JavaScript off: the prerendered page's links (How FTC One Search works' examples) are read and used there.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("with JavaScript off", () => {
  it("every reveal is shown as it is (index.html's noscript style)", () => {
    const html = readFileSync("index.html", "utf8");
    const ns = /<noscript>\s*<style>([^<]*)<\/style>\s*<\/noscript>/.exec(html.slice(0, html.indexOf("</head>")));
    expect(ns?.[1]).toMatch(/\.hiw-reveal\s*\{[^}]*opacity:\s*1\s*!important/);
    expect(ns?.[1]).toMatch(/transform:\s*none\s*!important/);
    expect(ns?.[1]).toMatch(/filter:\s*none\s*!important/);
  });
});
