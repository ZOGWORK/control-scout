// The How it works pages' gold words in light themes: the bright gold (#eab308) is ~1.9:1 on white, too faint for text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/components/howitworks/howitworks.css", "utf8");

describe("gold text on light", () => {
  it("classic light: .hiw-gold text takes the readable amber, not the bright gold", () => {
    expect(css).toMatch(/html\.light \.hiw \.hiw-gold \{ color: var\(--hiw-gold-text\); \}/);
  });
  it("v8 Light: the gold follows the accent (deep blue), text and decoration alike", () => {
    expect(css).toMatch(/html\[data-v8\]\.light \.hiw \{ --hiw-gold: var\(--color-accent\); \}/);
    expect(css).toMatch(/html\[data-v8\]\.light \.hiw \.hiw-gold \{ color: var\(--hiw-gold\); \}/);
  });
  it("every .hiw-gold use is text (so the text rule covers each)", () => {
    for (const f of ["src/components/howitworks/Hero.tsx", "src/components/howitworks/Pipeline.tsx", "src/pages/SearchDocsPage.tsx"]) {
      expect(readFileSync(f, "utf8")).toMatch(/hiw-gold(?!-)/);
    }
  });
});
