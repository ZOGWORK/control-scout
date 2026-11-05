// Theme tokens for tests: a Tailwind class resolved against the real tokens (src/index.css, Tailwind's palette) in each
// theme, tints blended over the surface, and its text measured (WCAG contrast). Used by textTones.test.ts and the
// answer-card audit (src/components/search/page/answerAudit.ts).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { contrast, over, parseColor, toHex, type RGBA } from "./contrast";

export type Theme = "dark" | "light" | "dim" | "midnight";
/** The dark family: Tailwind's `dark:` variant applies (index.css's `html:not(.light)`) and they share dark's status colours. */
export const DARK_FAMILY = new Set<Theme>(["dim", "dark", "midnight"]);

// From the repo root, not import.meta.url: under jsdom a module's URL isn't a file: URL.
export const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const twTheme = readFileSync(createRequire(resolve(process.cwd(), "package.json")).resolve("tailwindcss/theme.css"), "utf8");

/** Custom properties declared in the first block after `selector` (e.g. "@theme {", ":root {", "html.light {"). */
function block(src: string, selector: string) {
  const i = src.indexOf(selector);
  if (i < 0) throw new Error(`no ${selector} block`);
  const body = src.slice(i + selector.length, src.indexOf("\n}", i));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const palette = block(twTheme, "@theme default {");
const dark = { ...palette, ...block(css, "@theme {"), ...block(css.slice(css.indexOf(":root {\n  --sh-background")), ":root {") };
const vars: Record<Theme, Record<string, string>> = {
  dark,
  light: { ...dark, ...block(css, "html.light {") },
  dim: { ...dark, ...block(css, "html.dim {") },
  midnight: { ...dark, ...block(css, "html.midnight {") },
};

export function value(theme: Theme, name: string, depth = 0): RGBA {
  const raw = vars[theme][name];
  if (raw == null || depth > 8) throw new Error(`unknown colour ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  if (ref) return value(theme, ref[1], depth + 1);
  const c = parseColor(raw);
  if (!c) throw new Error(`can't read ${name}: ${raw}`);
  return c;
}

/** Status colours whose small text swaps to a deeper shade on light, read from index.css's `:where(html.light) .text-*` rules. */
export const TEXT_SWAPPED = new Set([...css.matchAll(/:where\(html\.light\) \.text-([\w-]+) \{ color: var\(--color-\1-text\); \}/g)].map((m) => m[1]));

/** The colour a utility like `text-sky-700`, `bg-green-500/12`, `bg-info/[0.08]` or `!text-foreground` paints in this theme. */
export function utility(theme: Theme, classes: string, prop: "text" | "bg"): RGBA | null {
  let found: RGBA | null = null;
  for (const cls of classes.split(/\s+/)) {
    const [variant, util] = cls.includes(":") ? [cls.slice(0, cls.lastIndexOf(":")), cls.slice(cls.lastIndexOf(":") + 1)] : ["", cls];
    // Only the resting, theme-matching state: `dark:` applies on every dark-family theme, hover/focus never.
    if (variant && variant !== "dark" && !variant.startsWith("[&")) continue;
    if (variant === "dark" && !DARK_FAMILY.has(theme)) continue;
    // Alpha as a step (`/12`) or arbitrary (`/[0.08]`, `/[8%]`).
    const m = new RegExp(`^!?${prop}-([a-z]+(?:-[a-z]+)*(?:-\\d{2,3})?)(?:/(\\d+)|/\\[([\\d.]+)(%?)\\])?$`).exec(util);
    const known = m && vars[theme][`--color-${m[1]}`];
    // A colour class with an alpha this can't read would be measured against the wrong background: fail loudly.
    if (!known && new RegExp(`^!?${prop}-.*/`).test(util)) throw new Error(`can't read the alpha in ${cls}`);
    if (!m || !known) continue;
    // Status text on light takes its deeper -text shade (the .text-* rules at the end of index.css).
    // Only the plain class: the CSS swaps `.text-info`, never `text-info/80` or `!text-info`.
    const textToken = prop === "text" && theme === "light" && !m[2] && !m[3] && !util.startsWith("!") && vars.light[`--color-${m[1]}-text`] && TEXT_SWAPPED.has(m[1]);
    const c = value(theme, textToken ? `--color-${m[1]}-text` : `--color-${m[1]}`);
    const alpha = m[2] ? +m[2] / 100 : m[3] ? (m[4] ? +m[3] / 100 : +m[3]) : c[3];
    // A plain class sets the colour unless a `dark:` one already did for a dark-family theme.
    if (variant === "dark" || !found || !DARK_FAMILY.has(theme)) found = [c[0], c[1], c[2], alpha];
    if (variant === "dark") break;
  }
  return found;
}

/** Text colour of `classes` (inheriting `inherit` when it sets none) on its own tint over `surface`. */
export function measure(theme: Theme, classes: string, { surface = "--color-card", inherit = "--color-foreground" } = {}) {
  const base = value(theme, surface);
  const tint = utility(theme, classes, "bg");
  const bg = tint ? over(tint, base) : base;
  let fg = utility(theme, classes, "text") ?? value(theme, inherit);
  const fade = /(?:^|\s)opacity-(\d+)(?:\s|$)/.exec(classes);
  if (fade) fg = [fg[0], fg[1], fg[2], fg[3] * (+fade[1] / 100)];
  const ratio = contrast(over(fg, bg), bg);
  const pair = `${toHex(over(fg, bg))} on ${toHex(bg)} = ${ratio.toFixed(2)}`;
  // Known exception, the owner's call (Oct 20 2026): LARGE display gold on light (text-accent-display, the profile's
  // "Top 8%", Home's headline) is the accent itself, #eab308, knowingly under 3:1. Only that class, at full opacity,
  // only on light; small gold text (text-accent-text, or text-accent used as text) is measured like any colour.
  if (theme === "light" && !fade && fg[3] === 1 && /(?:^|\s)text-accent-display(?:\s|$)/.test(classes)) return { ratio: Infinity, pair: `${pair} (owner's large-text gold exception)` };
  return { ratio, pair };
}
