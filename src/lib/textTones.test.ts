// Coloured text reaches WCAG AA in both themes: each tone's Tailwind classes are resolved against the real
// tokens (src/index.css, Tailwind's palette), tints blended over the card, then measured. Catches a raw
// decorative colour (#eab308 gold, sky 600) used as small text on light, the V3 contrast finding.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { contrast, over, parseColor, toHex, type RGBA } from "./contrast";
import { CHART_LEGEND_TEXT, EVENT_FILTER_COUNT, EVENT_STATUS_TONE, EVENT_TYPE_TONE, PROFILE_PERCENTILE_TEXT, RECORDS_CAP_NOTE_TONE, ROSTER_CHIP_TONE } from "./textTones";
import { TONE_CLASS } from "./records/describe";
import { badgeVariants } from "../components/ui/basic";
import { buttonVariants } from "../components/ui/button";

type Theme = "dark" | "light";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const twTheme = readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8");

/** Custom properties declared in the first block after `selector` (e.g. "@theme {", ":root {", "html.light {"). */
function block(src: string, selector: string) {
  const i = src.indexOf(selector);
  if (i < 0) throw new Error(`no ${selector} block`);
  const body = src.slice(i + selector.length, src.indexOf("\n}", i));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const palette = block(twTheme, "@theme default {");
const dark = { ...palette, ...block(css, "@theme {"), ...block(css, ":root {\n  --sh-background") };
const vars: Record<Theme, Record<string, string>> = { dark, light: { ...dark, ...block(css, "html.light {") } };

function value(theme: Theme, name: string, depth = 0): RGBA {
  const raw = vars[theme][name];
  if (raw == null || depth > 8) throw new Error(`unknown colour ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  if (ref) return value(theme, ref[1], depth + 1);
  const c = parseColor(raw);
  if (!c) throw new Error(`can't read ${name}: ${raw}`);
  return c;
}

/** Status colours whose small text swaps to a deeper shade on light, read from index.css's `:where(html.light) .text-*` rules. */
const TEXT_SWAPPED = new Set([...css.matchAll(/:where\(html\.light\) \.text-([\w-]+) \{ color: var\(--color-\1-text\); \}/g)].map((m) => m[1]));

/** The colour a utility like `text-sky-700`, `bg-green-500/12`, `bg-info/[0.08]` or `!text-foreground` paints in this theme. */
function utility(theme: Theme, classes: string, prop: "text" | "bg"): RGBA | null {
  let found: RGBA | null = null;
  for (const cls of classes.split(/\s+/)) {
    const [variant, util] = cls.includes(":") ? [cls.slice(0, cls.lastIndexOf(":")), cls.slice(cls.lastIndexOf(":") + 1)] : ["", cls];
    // Only the resting, theme-matching state: `dark:` applies on dark, hover/focus never.
    if (variant && variant !== "dark" && !variant.startsWith("[&")) continue;
    if (variant === "dark" && theme !== "dark") continue;
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
    // A plain class sets the colour unless a `dark:` one already did for dark.
    if (variant === "dark" || !found || theme === "light") found = [c[0], c[1], c[2], alpha];
    if (variant === "dark") break;
  }
  return found;
}

/** Text colour of `classes` (inheriting `inherit` when it sets none) on its own tint over `surface`. */
function measure(theme: Theme, classes: string, { surface = "--color-card", inherit = "--color-foreground" } = {}) {
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

const THEMES: Theme[] = ["light", "dark"];
const AA = 4.5, LARGE = 3;

describe("text tones reach WCAG AA in both themes", () => {
  for (const theme of THEMES) {
    it(`event status chips (${theme})`, () => {
      for (const [k, cls] of Object.entries(EVENT_STATUS_TONE)) expect(measure(theme, cls).ratio, `${k}: ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`event type labels on the card (${theme})`, () => {
      for (const [k, t] of Object.entries(EVENT_TYPE_TONE)) expect(measure(theme, t.text).ratio, `${k}: ${measure(theme, t.text).pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`roster chips on an event's Teams tab (${theme})`, () => {
      for (const [k, cls] of Object.entries(ROSTER_CHIP_TONE)) expect(measure(theme, cls).ratio, `${k}: ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`every Badge variant, e.g. an event's Live / Upcoming / Finished badge (${theme})`, () => {
      for (const variant of ["default", "soft", "secondary", "outline", "beta", "info", "new", "destructive", "success"] as const) {
        const m = measure(theme, badgeVariants({ variant }));
        expect(m.ratio, `${variant}: ${m.pair}`).toBeGreaterThanOrEqual(AA);
      }
    });
    it(`semantic chips on their own tints, e.g. "Upset", "Called it", status pills (${theme})`, () => {
      for (const tone of ["success", "warning", "danger", "info", "destructive"]) for (const a of [12, 15]) {
        const m = measure(theme, `bg-${tone}/${a} text-${tone}`);
        expect(m.ratio, `${tone}/${a}: ${m.pair}`).toBeGreaterThanOrEqual(AA);
      }
    });
    it(`link buttons (${theme})`, () => {
      const m = measure(theme, buttonVariants({ variant: "link" }));
      expect(m.ratio, m.pair).toBeGreaterThanOrEqual(AA);
    });
    it(`Records Compare-cap note (${theme})`, () => {
      const m = measure(theme, RECORDS_CAP_NOTE_TONE);
      expect(m.ratio, m.pair).toBeGreaterThanOrEqual(AA);
    });
    it(`Events filter counts in the chip's muted text (${theme})`, () => {
      const m = measure(theme, EVENT_FILTER_COUNT, { inherit: "--color-muted-foreground" });
      expect(m.ratio, m.pair).toBeGreaterThanOrEqual(AA);
    });
    it(`profile hero percentile, large text on the secondary panel (${theme})`, () => {
      const m = measure(theme, PROFILE_PERCENTILE_TEXT, { surface: "--color-secondary" });
      expect(m.ratio, m.pair).toBeGreaterThanOrEqual(LARGE);
      expect(m.ratio, `small-text margin too: ${m.pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`chart legend labels, whatever the series colour (${theme})`, () => {
      // Recharts writes the label in the series colour (chart-1 is the accent gold); the legend class overrides it.
      const m = measure(theme, CHART_LEGEND_TEXT, { inherit: "--color-chart-1" });
      expect(m.ratio, m.pair).toBeGreaterThanOrEqual(AA);
    });
    it(`records column tones, header text and chips (${theme})`, () => {
      for (const [k, t] of Object.entries(TONE_CLASS)) {
        // The alliance tones belong to the match cards' own contrast work (red/blue alliance tokens).
        if (k === "redAlliance" || k === "blueAlliance") continue;
        for (const cls of [t.text, t.chip]) expect(measure(theme, cls).ratio, `${k} "${cls}": ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  it("the light gold exception covers only large display gold, the accent yellow itself, and dark gold still reaches AA", () => {
    expect(toHex(value("light", "--color-accent-display"))).toBe(toHex(value("light", "--color-accent")));
    expect(toHex(value("light", "--color-accent"))).toBe("#eab308");
    // Faded gold is not the exception: it is measured like any other colour.
    expect(measure("light", "text-accent-display/25").ratio).toBeLessThan(AA);
    expect(measure("light", "text-accent-text/25").ratio).toBeLessThan(AA);
    expect(contrast(value("dark", "--color-accent-text"), value("dark", "--color-card"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(value("dark", "--color-accent-display"), value("dark", "--color-secondary"))).toBeGreaterThanOrEqual(AA);
  });

  for (const theme of THEMES) it(`small gold text on the accent's own tints, e.g. Compare's best values, the chosen season (${theme}) [V4-A11Y-003]`, () => {
    for (const surface of ["--color-card", "--color-secondary", "--color-muted"]) for (const tint of ["", "bg-accent/[0.08] ", "bg-accent/15 ", "bg-accent/20 ", "bg-accent/25 ", "bg-amber-500/15 ", "bg-yellow-500/15 "]) {
      const m = measure(theme, `${tint}text-accent-text`, { surface });
      expect(m.ratio, `${tint}on ${surface}: ${m.pair}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("reads tints with arbitrary alpha, so a chip is measured on its real background", () => {
    // bg-info/[0.08] over the light card is a pale sky, not the card's white.
    expect(toHex(over(utility("light", "bg-info/[0.08]", "bg")!, value("light", "--color-card")))).not.toBe("#ffffff");
    expect(utility("light", "bg-info/[0.08]", "bg")![3]).toBeCloseTo(0.08);
    expect(utility("dark", "bg-text-base/[6%]", "bg")![3]).toBeCloseTo(0.06);
    expect(() => utility("light", "bg-info/[calc(1/2)]", "bg")).toThrow(/alpha/);
  });

  it("swaps only the plain status class to its light text shade, as the CSS does, hover included", () => {
    const deep = value("light", "--color-info-text"), bright = value("light", "--color-info");
    expect(toHex(utility("light", "text-info", "text")!)).toBe(toHex(deep));
    expect(toHex(utility("light", "text-info/80", "text")!)).toBe(toHex(bright)); // .text-info doesn't match it
    expect(toHex(utility("light", "!text-info", "text")!)).toBe(toHex(bright));
    expect(toHex(utility("dark", "text-info", "text")!)).toBe(toHex(value("dark", "--color-info")));
    // Every swapped colour swaps its hover variant too, so hovering never brings back the bright shade.
    expect(TEXT_SWAPPED.size).toBeGreaterThanOrEqual(7);
    for (const name of TEXT_SWAPPED) expect(css, name).toContain(`:where(html.light) .hover\\:text-${name}:hover { color: var(--color-${name}-text); }`);
  });

  it("the old classes fail, so this test would catch them coming back", () => {
    expect(measure("light", "bg-sky-400/15 text-sky-600 dark:text-sky-400").ratio).toBeLessThan(AA); // 3.53
    expect(measure("light", "bg-emerald-400/15 text-emerald-600 dark:text-emerald-400").ratio).toBeLessThan(AA); // 3.26
    expect(measure("light", "bg-green-500/12 text-green-600 dark:text-green-400").ratio).toBeLessThan(AA); // 2.87
    // Gold as small text on light: the accent (#eab308) itself, 1.9 on the secondary panel, 1.8 on Compare's best-value tint.
    expect(measure("light", "text-accent", { surface: "--color-secondary" }).ratio).toBeLessThan(LARGE);
    expect(measure("light", "bg-accent/[0.08] text-accent").ratio).toBeLessThan(LARGE);
    expect(measure("dark", "tabular-nums opacity-70", { inherit: "--color-muted-foreground" }).ratio).toBeLessThan(AA); // 4.18
    expect(measure("light", "tabular-nums opacity-70", { inherit: "--color-muted-foreground" }).ratio).toBeLessThan(AA); // 3.61
  });
});
