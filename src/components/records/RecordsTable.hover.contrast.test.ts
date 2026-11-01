// The Teams tables' hovered row is tinted in the accent, and the sorted column adds its own 4% accent on top.
// The heat colours' strongest bands (success and destructive text) must still read at WCAG AA 4.5:1 there,
// in both themes. Worked out from the real tokens in src/index.css and the tint in RecordsTable.tsx.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8").split(/\r?\n/);
const table = readFileSync(new URL("./RecordsTable.tsx", import.meta.url), "utf8");
/** A custom property's hex value in the first block that `selector` opens (`@theme {`, `:root {`, `html.light {`). */
function token(selector: string, name: string): string {
  const start = css.findIndex((l) => l.startsWith(`${selector} {`));
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  const line = css.slice(start, end).find((l) => l.trim().startsWith(`--${name}:`));
  const m = line?.match(/#[0-9a-f]{6}/i);
  expect(m, `${selector} --${name}`).toBeTruthy();
  return m![0];
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = (fg: number[], alpha: number, bg: number[]) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

const tint = Number(table.match(/const rowHover = "still-hover:bg-accent\/\[([0-9.]+)\]"/)?.[1]);
const SORTED = 0.04; // the sorted column's bg-accent/[0.04]

describe("Teams table hovered row contrast", () => {
  it("the row hover is an accent tint", () => {
    expect(tint).toBeGreaterThan(0.1);
  });

  it.each([
    ["dark", ":root", "@theme", ["sh-destructive", "color-success"]],
    ["light", "html.light", "html.light", ["color-destructive-text", "color-success-text"]],
  ] as const)("%s: heat text reads at 4.5:1 or more on a hovered sorted cell", (_, cardBlock, accentBlock, inks) => {
    const card = rgb(token(cardBlock, "sh-card")), accent = rgb(token(accentBlock, "color-accent"));
    const bg = over(accent, SORTED, over(accent, tint, card));
    for (const ink of inks) {
      const block = ink.startsWith("sh-") ? ":root" : cardBlock === ":root" ? "@theme" : cardBlock;
      expect(ratio(rgb(token(block, ink)), bg), ink).toBeGreaterThanOrEqual(4.5);
    }
  });
});
