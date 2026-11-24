// v8's soft search colours (./v8tone.ts V8_SOFT) reach WCAG AA in every v8 theme: a chip's words on its light tint
// of the colour, and the colour as text on the card. v8 Dark, Dim and Light are read from
// src/index.css (html[data-v8], .dim, .light) over Tailwind's palette, so a token change there is measured here.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { contrast, over, parseColor, toHex, type RGBA } from "../../../lib/contrast";
import { MEANING_SOFT, TONE, V8_SOFT, calm, softOfFill, v8Stat, type SoftColour } from "./v8tone";

const css = readFileSync("src/index.css", "utf8");
const tw = readFileSync(createRequire(resolve("package.json")).resolve("tailwindcss/theme.css"), "utf8");
function block(src: string, selector: string) {
  const i = src.indexOf(selector);
  if (i < 0) throw new Error(`no ${selector} block`);
  return Object.fromEntries([...src.slice(i + selector.length, src.indexOf("\n}", i)).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const base = { ...block(tw, "@theme default {"), ...block(css, "@theme {"), ...block(css, "html[data-v8] {\n") };
type Theme = "dark" | "dim" | "light";
const VARS: Record<Theme, Record<string, string>> = {
  dark: base,
  dim: { ...base, ...block(css, "html[data-v8].dim {\n") },
  light: { ...base, ...block(css, "html[data-v8].light {\n") },
};
function value(t: Theme, name: string, depth = 0): RGBA {
  const raw = VARS[t][name];
  if (raw == null || depth > 8) throw new Error(`unknown ${name} (${t})`);
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  if (ref) return value(t, ref[1], depth + 1);
  const c = parseColor(raw);
  if (!c) throw new Error(`can't read ${name}: ${raw}`);
  return c;
}
/** The colour a `v8:` (or, on Light, `v8light:`) utility paints, the later class winning, as index.css registers them. */
function paint(t: Theme, classes: string, prop: "bg" | "text"): RGBA | null {
  let found: RGBA | null = null;
  for (const cls of classes.split(/\s+/)) {
    const m = new RegExp(`^(v8|v8light):${prop}-([a-z]+(?:-[a-z]+)*?(?:-\\d{2,3})?)(?:/(?:\\[([\\d.]+)\\]|(\\d+)))?$`).exec(cls);
    if (!m || (m[1] === "v8light" && t !== "light")) continue;
    const c = value(t, `--color-${m[2]}`);
    found = [c[0], c[1], c[2], m[3] ? +m[3] : m[4] ? +m[4] / 100 : c[3]];
  }
  return found;
}

const COLOURS = (Object.keys(V8_SOFT) as SoftColour[]).filter((k) => k !== "neutral");
const AA = 4.5;

describe("v8's soft search colours reach AA", () => {
  for (const t of ["dark", "dim", "light"] as Theme[]) {
    const card = value(t, "--color-card");
    it(`a chip's words on its tint, and the colour as text on the card (${t})`, () => {
      const low: string[] = [];
      for (const k of COLOURS) {
        const chip = over(paint(t, V8_SOFT[k].fill, "bg")!, card), words = paint(t, V8_SOFT[k].fill, "text")!, fg = paint(t, V8_SOFT[k].text, "text")!;
        for (const [where, f, bg] of [["chip", words, chip], ["card", fg, card]] as const) {
          const r = contrast(f, bg);
          if (r < AA) low.push(`${k} on its ${where}: ${toHex(f)} on ${toHex(bg)} = ${r.toFixed(2)}`);
        }
      }
      expect(low).toEqual([]);
    });
    it(`never a solid block: every chip is a light tint (${t})`, () => {
      for (const k of COLOURS) expect(paint(t, V8_SOFT[k].fill, "bg")![3], k).toBeLessThanOrEqual(0.12);
    });
  }
});

describe("v8's meanings", () => {
  it("the phases follow the team page: Auto blue, TeleOp orange, Endgame green, penalties red, RP yellow", () => {
    expect([MEANING_SOFT.auto, MEANING_SOFT.teleop, MEANING_SOFT.endgame, MEANING_SOFT.pen, MEANING_SOFT.rp]).toEqual(["blue", "orange", "green", "red", "yellow"]);
  });
  it("a count, a record and a reference are the slate-blue accent (never a warning-like orange); a No stays quiet", () => {
    expect([MEANING_SOFT.count, MEANING_SOFT.record, MEANING_SOFT.reference, MEANING_SOFT.no]).toEqual(["accent", "accent", "accent", "neutral"]);
  });
  it("each award kind has its own hue, never a phase's", () => {
    const awards = [MEANING_SOFT.inspire, MEANING_SOFT.winning, MEANING_SOFT.finalist, MEANING_SOFT.judged, MEANING_SOFT.performance];
    expect(new Set(awards).size).toBe(5);
    const phases = [MEANING_SOFT.auto, MEANING_SOFT.teleop, MEANING_SOFT.endgame, MEANING_SOFT.pen, MEANING_SOFT.rp];
    for (const c of awards) expect(phases).not.toContain(c);
  });
});

describe("v8Stat: the colour a one-team number's label names", () => {
  it("ranking points are RP's yellow, never a rank's accent ('ranking' starts with 'rank')", () => {
    expect(["Ranking points at NJ Championship", "Ranking points, event by event", "Avg RP", "OPR rank", "Ranked #3", "World OPR rank", "Global standing"].map(v8Stat))
      .toEqual(["yellow", "yellow", "yellow", "accent", "accent", "accent", "accent"]);
  });
  it("phases, OPR and a record in their own colours", () => {
    expect(["Auto OPR", "TeleOp points", "Endgame", "Penalties given", "OPR by event", "2025–26 record", "Win rate", "Events"].map(v8Stat))
      .toEqual(["blue", "orange", "green", "red", "purple", "win", "win", "accent"]);
  });
});

describe("softOfFill: the colour a swatch is filled in", () => {
  it("reads every meaning's swatch as its colour, two-class words included (TeleOp, penalties, RP, yes, no, live)", () => {
    for (const [m, c] of Object.entries(MEANING_SOFT)) expect(softOfFill(TONE[m as keyof typeof TONE].fill), m).toBe(c === "neutral" ? null : c);
  });
  it("tells live from rose (the same words, different fills), and takes the colour written last on a recoloured swatch", () => {
    expect(softOfFill(V8_SOFT.live.fill)).toBe("live");
    expect(softOfFill(V8_SOFT.rose.fill)).toBe("rose");
    expect(softOfFill(calm(TONE.auto, undefined, "purple").fill)).toBe("purple");
    expect(softOfFill("bg-muted text-foreground")).toBeNull();
  });
});
