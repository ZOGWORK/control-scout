// WCAG 2 contrast maths for colours as the browser computes them: hex, rgb(), or Tailwind 4's oklch()
// palette values, with alpha tints (bg-sky-400/15) blended over the surface underneath. Used by the
// contrast tests (textTones.test.ts) and nothing at runtime.

export type RGBA = [r: number, g: number, b: number, a: number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** OKLCH (L 0–1, C, H degrees) to sRGB 0–255, clipped to the gamut the way browsers clip. */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((v) => {
    const x = clamp01(v);
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  }) as [number, number, number];
}

/** Parse #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() or oklch(); null for anything else (var(), color-mix()). */
export function parseColor(css: string): RGBA | null {
  const s = css.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4]];
  m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const [r, g, b] = oklchToRgb(m[2] ? +m[1] / 100 : +m[1], +m[3], +m[4]);
    return [r, g, b, m[5] == null ? 1 : m[5].endsWith("%") ? parseFloat(m[5]) / 100 : +m[5]];
  }
  return null;
}

/** `top` (with its alpha) composited over an opaque `under`. */
export function over(top: RGBA, under: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round(top[i] * a + under[i] * (1 - a))).concat(1) as RGBA;
}

const channel = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]: RGBA) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG contrast ratio of two opaque colours, 1–21. */
export function contrast(a: RGBA, b: RGBA) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const toHex = ([r, g, b]: RGBA) => `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
