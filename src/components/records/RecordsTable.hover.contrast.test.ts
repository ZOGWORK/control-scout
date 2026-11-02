// The Teams tables' hovered row is tinted in the accent, and the sorted column adds its own 4% accent on top.
// The heat colours' strongest bands (success and destructive text) must still read at WCAG AA 4.5:1 there,
// in every theme. Worked out from the real tokens in src/index.css and the tint in RecordsTable.tsx.
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

/** Where each theme's tokens come from, own block first: Dim and Midnight are dark (`:root`, `@theme`) with their own surfaces. */
const THEMES = { light: ["html.light", ":root", "@theme"], dim: ["html.dim", ":root", "@theme"], dark: [":root", "@theme"], midnight: ["html.midnight", ":root", "@theme"] } as const;
type Theme = keyof typeof THEMES;
const declares = (selector: string, name: string) => {
  const start = css.findIndex((l) => l.startsWith(`${selector} {`));
  return start >= 0 && css.slice(start, css.indexOf("}", start)).some((l) => l.trim().startsWith(`--${name}:`));
};
/** A token's hex value as `theme` resolves it. */
const tok = (theme: Theme, name: string) => rgb(token(THEMES[theme].find((b) => declares(b, name)) ?? THEMES[theme][0], name));
/** The heat colours' strongest text: dark's bright shades on the dark family, light's deeper -text shades. */
const HEAT_INKS = (theme: Theme) => (theme === "light" ? ["color-destructive-text", "color-success-text"] : ["sh-destructive", "color-success"]);

const tint = Number(table.match(/const rowHover = "still-hover:bg-accent\/\[([0-9.]+)\]"/)?.[1]);
const SORTED = 0.04; // the sorted column's bg-accent/[0.04]

describe("Teams table hovered row contrast", () => {
  it("the row hover is an accent tint", () => {
    expect(tint).toBeGreaterThan(0.1);
  });

  it.each(Object.keys(THEMES) as Theme[])("%s: heat text reads at 4.5:1 or more on a hovered sorted cell", (theme) => {
    const card = tok(theme, "sh-card"), accent = tok(theme, "color-accent");
    const bg = over(accent, SORTED, over(accent, tint, card));
    for (const ink of HEAT_INKS(theme)) expect(ratio(tok(theme, ink), bg), ink).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.keys(THEMES) as Theme[])("%s: red alliance scores (the alliance ink) read at 4.5:1 or more on a hovered sorted cell", (theme) => {
    expect(table).toContain('tone === "redAlliance" ? "text-red-alliance-ink"');
    const card = tok(theme, "sh-card"), accent = tok(theme, "color-accent");
    const bg = over(accent, SORTED, over(accent, tint, card));
    expect(ratio(tok(theme, "color-red-alliance-ink"), bg)).toBeGreaterThanOrEqual(4.5);
    // The plain alliance red is why: it doesn't make it on dark.
    if (theme === "dark") expect(ratio(tok(theme, "color-red-alliance"), bg)).toBeLessThan(4.5);
  });

  it.each(Object.keys(THEMES) as Theme[])("%s: red team badges (ink on the 12 percent red chip) read at 4.5:1 or more on a hovered row", (theme) => {
    expect(table).toContain('"bg-red-alliance/12 text-red-alliance-ink"');
    const card = tok(theme, "sh-card"), accent = tok(theme, "color-accent");
    const chip = over(tok(theme, "color-red-alliance"), 0.12, over(accent, tint, card));
    expect(ratio(tok(theme, "color-red-alliance-ink"), chip)).toBeGreaterThanOrEqual(4.5);
  });
});
