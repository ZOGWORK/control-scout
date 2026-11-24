// The Rankings tab's green → red shade (lib/rankShade.ts): its position maths, its endpoints, and that every step of
// the OKLab mix reads at WCAG AA in every theme. Token values are read from index.css itself, cascaded the way the
// browser applies them, so a change there is measured here.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contrast, parseColor, type RGBA } from "./contrast";
import { columnShade, SHADE_COLS, shadeColour, shadeT, WLT_TONE } from "./rankShade";

describe("shadeT", () => {
  const vs = [6, 3.6, 3, 2.8, 0.4];
  it("is 1 for the best value and 0 for the worst", () => {
    expect(shadeT(vs, 6)).toBe(1);
    expect(shadeT(vs, 0.4)).toBe(0);
  });
  it("is linear by value in between", () => {
    expect(shadeT([0, 10], 2.5)).toBeCloseTo(0.25);
    expect(shadeT(vs, 3.2)).toBeCloseTo((3.2 - 0.4) / 5.6);
  });
  it("flips for lower-is-better (rank 1 is the best)", () => {
    const ranks = [1, 2, 3, 4, 5];
    expect(shadeT(ranks, 1, true)).toBe(1);
    expect(shadeT(ranks, 5, true)).toBe(0);
    expect(shadeT(ranks, 3, true)).toBeCloseTo(0.5);
  });
  it("gives nothing for a blank cell or a column with one value", () => {
    expect(shadeT(vs, null)).toBeNull();
    expect(shadeT(vs, Number.NaN)).toBeNull();
    expect(shadeT([2, 2, 2], 2)).toBeNull();
    expect(shadeT([2, null, "x"], 2)).toBeNull();
  });
  it("ignores blanks when finding the ends", () => {
    expect(shadeT([null, 0, 10, undefined], 10)).toBe(1);
  });
});

describe("shadeColour", () => {
  it("is the success text colour at the best end and the danger text colour at the worst", () => {
    expect(shadeColour(1)).toBe("color-mix(in oklab, var(--color-success-text) 100%, var(--color-danger-text))");
    expect(shadeColour(0)).toBe("color-mix(in oklab, var(--color-success-text) 0%, var(--color-danger-text))");
    expect(shadeColour(0.5)).toContain(" 50%,");
  });
  it("gives no colour for a position that isn't a number", () => {
    expect(shadeColour(Number.NaN)).toBeUndefined();
    expect(shadeColour(Infinity)).toBeUndefined();
  });
  it("clamps outside 0–1", () => {
    expect(shadeColour(2)).toBe(shadeColour(1));
    expect(shadeColour(-1)).toBe(shadeColour(0));
  });
  it("columnShade colours by the column's own values", () => {
    const rank = columnShade([1, 2, 3], SHADE_COLS.rank.lowerIsBetter);
    expect(rank(1)).toBe(shadeColour(1));
    expect(rank(3)).toBe(shadeColour(0));
    expect(rank(null)).toBeUndefined();
  });
  it("shades rank, RS and TBP, with only rank lower-is-better", () => {
    expect(Object.entries(SHADE_COLS).filter(([, c]) => c.lowerIsBetter).map(([k]) => k)).toEqual(["rank"]);
    expect(Object.keys(SHADE_COLS)).toEqual(expect.arrayContaining(["rank", "rp", "tb1"]));
  });
  it("tones wins green, losses red, ties neutral", () => {
    expect(WLT_TONE).toEqual({ wins: "text-success", losses: "text-danger", ties: "text-text-muted" });
  });
});

// --- contrast of every step, in every theme ---------------------------------------------------------------------
const css = readFileSync("src/index.css", "utf8");
const block = (head: string): Record<string, string> => {
  const at = css.indexOf(`${head} {\n`);
  if (at < 0) throw new Error(`index.css has no ${head} block`);
  return Object.fromEntries([...css.slice(at, css.indexOf("\n}", at)).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const base = ["@theme", ":root"];
const THEMES: Record<string, string[]> = {
  "classic Dark": base,
  "classic Light": [...base, "html.light"],
  "classic Dim": [...base, "html.dim"],
  "v8 Dark": [...base, "html[data-v8]"],
  "v8 Light": [...base, "html.light", "html[data-v8]", "html[data-v8].light"],
  "v8 Dim": [...base, "html.dim", "html[data-v8]", "html[data-v8].dim"],
};
function tokens(heads: string[]) {
  const all: Record<string, string> = Object.assign({}, ...heads.map(block));
  const get = (name: string, depth = 0): RGBA => {
    const v = all[name];
    if (!v || depth > 8) throw new Error(`no ${name}`);
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    return ref ? get(ref[1], depth + 1) : parseColor(v)!;
  };
  return get;
}
const lin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const unlin = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)));
function toOklab([r, g, b]: RGBA): [number, number, number] {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: [number, number, number]): RGBA {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), 1];
}
const mix = (good: RGBA, bad: RGBA, t: number): RGBA => {
  const [x, y] = [toOklab(good), toOklab(bad)];
  return fromOklab([0, 1, 2].map((i) => t * x[i] + (1 - t) * y[i]) as [number, number, number]);
};

describe("the shade reads at AA in every theme", () => {
  it.each(Object.entries(THEMES))("%s: every step from red to green on the page and the cards", (_, heads) => {
    const get = tokens(heads);
    const [good, bad] = [get("--color-success-text"), get("--color-danger-text")];
    for (const bg of ["--sh-background", "--sh-card"]) for (let i = 0; i <= 20; i++) {
      const fg = mix(good, bad, i / 20);
      const r = contrast(fg, get(bg));
      expect(r, `${(i * 5)}% green on ${bg}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("the mix's ends are the tokens themselves", () => {
    const get = tokens(THEMES["v8 Light"]);
    expect(mix(get("--color-success-text"), get("--color-danger-text"), 1).slice(0, 3)).toEqual(get("--color-success-text").slice(0, 3));
    expect(mix(get("--color-success-text"), get("--color-danger-text"), 0).slice(0, 3)).toEqual(get("--color-danger-text").slice(0, 3));
  });
});
