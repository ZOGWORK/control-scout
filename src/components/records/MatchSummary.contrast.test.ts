// The phone match cards' red text (the 12px verdict, the 14px team numbers, "Won") on its own 15% tint:
// WCAG AA 4.5:1 in both themes (audit V3-VIS-001, "Mobile Match summary red labels": #f43f5e on #33181e
// was 4.43:1 on dark). Worked out from the real tokens: src/index.css's card and alliance colours, and the
// card's own red text token in MatchSummary.tsx.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RED_INK_TOKEN } from "./MatchSummary";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
/** A custom property's hex value in the first block that `selector` opens (`@theme {`, `:root {`, `html.light {`). */
function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("\n}", start));
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  expect(m, `${selector} --${name}`).not.toBeNull();
  return m![1];
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** `fg` at `alpha` over `bg`, as `bg-red-alliance/15` paints on the card. */
const over = (fg: string, alpha: number, bg: string) => `#${rgb(fg).map((v, i) => Math.round(v * alpha + rgb(bg)[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;

describe("phone match card red text contrast", () => {
  const darkInk = RED_INK_TOKEN.match(/dark:\[--summary-red-ink:(#[0-9a-f]{6})\]/i)?.[1];

  it("dark: the card's own red text reads at 4.5:1 or more on the red tint (the shared alliance red alone doesn't)", () => {
    const card = token(":root", "sh-card"), red = token("@theme", "color-red-alliance");
    const tint = over(red, 0.15, card);
    expect(darkInk).toBeDefined();
    expect(ratio(red, tint)).toBeLessThan(4.5); // why the card has its own token
    expect(ratio(darkInk!, tint)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(darkInk!, card)).toBeGreaterThanOrEqual(4.5); // a losing alliance's lighter 6% tint is closer to the card
  });

  it("light: the alliance's text red (the -text token's light value) reads at 4.5:1 or more on the bright red's tint", () => {
    expect(RED_INK_TOKEN).toContain("[--summary-red-ink:var(--color-red-alliance-text)]");
    const card = token("html.light", "sh-card"), red = token("html.light", "color-red-alliance"), ink = token("html.light", "color-red-alliance-text");
    expect(ratio(ink, over(red, 0.15, card))).toBeGreaterThanOrEqual(4.5);
  });
});
