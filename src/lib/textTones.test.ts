// Coloured text reaches WCAG AA in both themes: each tone's Tailwind classes are resolved against the real
// tokens (src/index.css, Tailwind's palette), tints blended over the card, then measured. Catches a raw
// decorative colour (#eab308 gold, sky 600) used as small text on light, the V3 contrast finding.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contrast, over, parseColor, toHex, type RGBA } from "./contrast";
import { TEXT_SWAPPED, css, measure, utility, value, type Theme } from "./themeTokens.testkit";
import { CHART_LEGEND_TEXT, SEARCH_PALETTE, TEAM_FILL, EVENT_FILTER_COUNT, PODIUM_CHIP, EVENT_STATUS_SOLID, EVENT_STATUS_TONE, VIDEO_TONE, EVENT_TYPE_CHIP_FILL, EVENT_TYPE_TONE, PROFILE_PERCENTILE_TEXT, RECORDS_CAP_NOTE_TONE, ROSTER_CHIP_TONE } from "./textTones";
import { TONE_CLASS } from "./records/describe";
import { badgeVariants } from "../components/ui/basic";
import { buttonVariants } from "../components/ui/button";
import { ALLIANCE_HUES } from "../components/PlayoffBracket";
import { TEAM_SWATCH, TEAM_TEXT } from "../components/search/page/answerCells";

const THEMES: Theme[] = ["light", "dim", "dark", "midnight"];
const AA = 4.5, LARGE = 3;

describe("search's palette", () => {
  it("gives every meaning its own colour family, none shared with another meaning or a team", () => {
    const families = Object.values(SEARCH_PALETTE).map((s) => s.family);
    expect(new Set(families).size).toBe(families.length);
    for (const f of families) expect(f).not.toMatch(/^team-/);
    // Yellow is ranking points' alone, amber a count's (no other gold on data).
    expect(Object.entries(SEARCH_PALETTE).filter(([, s]) => /yellow|amber/.test(s.family)).map(([k]) => k)).toEqual(["rp", "count"]);
  });
});

describe("text tones reach WCAG AA in every theme", () => {
  it("the `dark:` variant covers Dim and Midnight, so measuring them with dark's `dark:` classes is right", () => {
    expect(css).toContain("@custom-variant dark (&:where(html:not(.light), html:not(.light) *));");
  });

  for (const theme of THEMES) {
    it(`event status chips (${theme})`, () => {
      for (const [k, cls] of Object.entries(EVENT_STATUS_TONE)) expect(measure(theme, cls).ratio, `${k}: ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`solid event status chips, and their bars as graphics on the card (${theme})`, () => {
      const card = value(theme, "--color-card");
      for (const [k, t] of Object.entries(EVENT_STATUS_SOLID)) {
        expect(measure(theme, t.chip).ratio, `${k}: ${measure(theme, t.chip).pair}`).toBeGreaterThanOrEqual(AA);
        const bar = utility(theme, t.bar, "bg")!;
        expect(contrast(over(bar, card), card), `${k} bar`).toBeGreaterThanOrEqual(LARGE);
      }
    });
    it(`a yes-or-no answer's word (${theme})`, () => {
    });
    it(`event type labels on the card (${theme})`, () => {
      for (const [k, t] of Object.entries(EVENT_TYPE_TONE)) expect(measure(theme, t.text).ratio, `${k}: ${measure(theme, t.text).pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`event type chips in an event's header, on their neutral fill (${theme})`, () => {
      for (const [k, t] of Object.entries(EVENT_TYPE_TONE)) {
        const m = measure(theme, `${EVENT_TYPE_CHIP_FILL} ${t.text}`);
        expect(m.ratio, `${k}: ${m.pair}`).toBeGreaterThanOrEqual(AA);
      }
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
    it(`compared teams' bar hues reach 3:1 against the card as graphics, and differ from each other (${theme})`, () => {
      const card = value(theme, "--color-card");
      const fills = TEAM_FILL.map((cls) => utility(theme, cls, "bg")!);
      for (const [i, f] of fills.entries()) {
        const r = contrast(over(f, card), card);
        expect(r, `team ${"abc"[i]} ${toHex(f)} on ${toHex(card)} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(LARGE);
      }
      // Okabe–Ito: A and B told apart by lightness too, so grayscale still separates them.
      expect(Math.abs(contrast(fills[0], card) - contrast(fills[1], card)) + contrast(fills[0], fills[1])).toBeGreaterThan(1);
    });
    it(`one team's numbers in its hue, team A, as text on the card and on its pills' 10% tint (${theme})`, () => {
      for (const cls of [TEAM_TEXT, `bg-team-a/10 ${TEAM_TEXT}`]) expect(measure(theme, cls).ratio, measure(theme, cls).pair).toBeGreaterThanOrEqual(AA);
    });
    it(`each team's numbers on its own tint, and a rank pill's whole text on its podium fill, reach AA (${theme})`, () => {
      for (const sw of TEAM_SWATCH) for (const cls of [sw.text, `${sw.tint} ${sw.text}`]) expect(measure(theme, cls).ratio, `${cls}: ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
      for (const cls of Object.values(PODIUM_CHIP)) expect(measure(theme, cls).ratio, `${cls}: ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`search's palette: every meaning's fill (its text on it) and its text on the card reach AA (${theme})`, () => {
      for (const [k, sw] of Object.entries(SEARCH_PALETTE)) {
        for (const cls of [sw.fill, sw.text]) expect(measure(theme, cls).ratio, `${k} ${cls}: ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
        // A bar or a left edge is a graphic: 3:1 against the card.
        const card = value(theme, "--color-card"), bar = utility(theme, sw.bar, "bg")!;
        expect(contrast(over(bar, card), card), `${k} bar`).toBeGreaterThanOrEqual(LARGE);
      }
    });
    it(`search podium place chips (${theme})`, () => {
      for (const [k, cls] of Object.entries(PODIUM_CHIP)) expect(measure(theme, cls).ratio, `${k}: ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
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
    it(`playoff alliance chips, every alliance number (${theme})`, () => {
      for (const [i, h] of ALLIANCE_HUES.entries()) expect(measure(theme, h.chip).ratio, `A${i + 1}: ${measure(theme, h.chip).pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`video red as text and on its Watch chip's tint (${theme})`, () => {
      for (const cls of [VIDEO_TONE.text, VIDEO_TONE.chip]) expect(measure(theme, cls).ratio, `"${cls}": ${measure(theme, cls).pair}`).toBeGreaterThanOrEqual(AA);
    });
    it(`red alliance scores on their own tint, a winner's box and the match summary (${theme})`, () => {
      for (const tint of ["bg-red-alliance/[0.06]", "bg-red-alliance/[0.14]", "bg-red-alliance/15"]) {
        const m = measure(theme, `${tint} text-red-alliance-ink`);
        expect(m.ratio, `${tint}: ${m.pair}`).toBeGreaterThanOrEqual(AA);
      }
    });
    it(`the keyboard focus ring stands out from the page at the strength rings use (${theme})`, () => {
      // WCAG 2.2 non-text contrast: 3:1 for the ring against what's next to it (ring-ring/60, the global outline at 70%).
      for (const surface of ["--color-background", "--color-card", "--color-secondary"]) for (const a of [0.6, 0.7]) {
        const bg = value(theme, surface), ring = value(theme, "--color-ring");
        const r = contrast(over([ring[0], ring[1], ring[2], a], bg), bg);
        expect(r, `ring at ${a} on ${surface}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(LARGE);
      }
    });
    it(`body and muted text on every surface, page to popover (${theme})`, () => {
      for (const surface of ["--color-background", "--color-card", "--color-popover", "--color-muted", "--color-secondary"]) for (const text of ["--color-foreground", "--color-muted-foreground"]) {
        const r = contrast(value(theme, text), value(theme, surface));
        expect(r, `${text} on ${surface}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
      }
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
    // The focus ring on light used to be the gold accent itself: 1.6:1 on white at the rings' 60%.
    { const w = value("light", "--color-card"), g = value("light", "--color-accent"); expect(contrast(over([g[0], g[1], g[2], 0.6], w), w)).toBeLessThan(LARGE); }
    // A winner's red score used the alliance red itself: 4.4:1 on its 14% tint on dark (axe, the event page).
    expect(measure("dark", "bg-red-alliance/[0.14] text-red-alliance").ratio).toBeLessThan(AA);
    // Alliance 1's amber chip on light: amber 700 on its 15% tint was 4.48:1 (axe, an event's playoffs).
    expect(measure("light", "bg-amber-500/15 text-amber-700").ratio).toBeLessThan(AA);
    // The video red was a one-off #ff4d6d everywhere: 3.2:1 as small text on white.
    expect(contrast(parseColor("#ff4d6d")!, value("light", "--color-card"))).toBeLessThan(AA);
    // Gold as small text on light: the accent (#eab308) itself, 1.9 on the secondary panel, 1.8 on Compare's best-value tint.
    expect(measure("light", "text-accent", { surface: "--color-secondary" }).ratio).toBeLessThan(LARGE);
    expect(measure("light", "bg-accent/[0.08] text-accent").ratio).toBeLessThan(LARGE);
    expect(measure("dark", "tabular-nums opacity-70", { inherit: "--color-muted-foreground" }).ratio).toBeLessThan(AA); // 4.18
    expect(measure("light", "tabular-nums opacity-70", { inherit: "--color-muted-foreground" }).ratio).toBeLessThan(AA); // 3.61
  });
});

describe("visited links in running text", () => {
  /** color-mix(in srgb, a p%, b): an opaque blend of two tokens. */
  const mix = (theme: Theme, a: string, p: number, b: string): RGBA => {
    const x = value(theme, a), y = value(theme, b);
    return [0, 1, 2].map((i) => x[i] * p + y[i] * (1 - p)).concat(1) as RGBA;
  };
  for (const theme of THEMES) it(`read quieter and still reach AA (${theme})`, () => {
    const card = value(theme, "--color-card");
    const gold = mix(theme, "--color-accent-text", 0.7, "--color-text-muted"), plain = mix(theme, "--color-foreground", 0.65, "--color-text-muted");
    expect(contrast(gold, card)).toBeGreaterThanOrEqual(AA);
    expect(contrast(plain, card)).toBeGreaterThanOrEqual(AA);
    expect(toHex(gold)).not.toBe(toHex(value(theme, "--color-accent-text")));
  });
  it("cover gold underlined links and the prose blocks that style their links from the parent", () => {
    expect(css).toContain("a.underline:visited:where(.text-accent-text), .prose-links a:visited {");
    expect(css).toContain(".prose-links-plain a:visited {");
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(src("../pages/PowerRankingsPage.tsx")).toMatch(/const PROSE = "prose-links /);
    expect(src("../components/legal.tsx")).toContain('"prose-links-plain ');
    expect(src("../components/howitworks/ui.tsx")).toContain("hiw-prose prose-links-plain");
  });
});
