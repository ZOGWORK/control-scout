// The share cards' fonts: the site's own Space Grotesk and Inter (both SIL
// Open Font License), as static TrueType instances of public/fonts' variable
// WOFF2 files (the SVG renderer reads TrueType, not WOFF2). Made once with
// fontTools:
//   from fontTools.ttLib import TTFont; from fontTools.varLib import instancer
//   f = instancer.instantiateVariableFont(TTFont("public/fonts/Inter.woff2"), {"wght": 700}, updateFontNames=False)
//   (name table: family "Inter" / "Space Grotesk", the typographic names 16–17 removed, so the
//   renderer finds them by family and weight)
//   f.flavor = None; f.save("server/share/fonts/Inter-700.ttf")
// (likewise public/fonts/SpaceGrotesk.woff2 at 700 and Inter.woff2 at 500). The fonts carry
// the site's Latin subset, so text is measured here (to fit or cut a line
// before drawing it) and anything they can't draw is dropped (glyphs()).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

export interface Font {
  family: "Space Grotesk" | "Inter";
  weight: 500 | 700;
  data: Uint8Array;
  /** Advance width of a character in em (null: the font has no glyph for it). */
  advance(cp: number): number | null;
}

/** A TrueType font's character map and advance widths (cmap formats 4 and 12, hmtx). */
export function parseFont(data: Uint8Array): (cp: number) => number | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0, n = v.getUint16(4); i < n; i++) {
    const at = 12 + 16 * i;
    tables.set(String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]), v.getUint32(at + 8));
  }
  const head = tables.get("head"), hhea = tables.get("hhea"), hmtx = tables.get("hmtx"), cmap = tables.get("cmap");
  if (head == null || hhea == null || hmtx == null || cmap == null) throw new Error("not a TrueType font");
  const upem = v.getUint16(head + 18);
  const metrics = v.getUint16(hhea + 34);
  const width = (g: number) => v.getUint16(hmtx + 4 * Math.min(g, metrics - 1)) / upem;
  // The Unicode subtable: format 12 (full range) if there is one, else format 4 (the BMP).
  let f4 = -1, f12 = -1;
  for (let i = 0, n = v.getUint16(cmap + 2); i < n; i++) {
    const at = cmap + 4 + 8 * i, platform = v.getUint16(at), encoding = v.getUint16(at + 2), off = cmap + v.getUint32(at + 4);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = v.getUint16(off);
    if (format === 12 && f12 < 0) f12 = off;
    if (format === 4 && f4 < 0) f4 = off;
  }
  const glyph = (cp: number): number => {
    if (f12 >= 0) {
      for (let i = 0, n = v.getUint32(f12 + 12); i < n; i++) {
        const at = f12 + 16 + 12 * i, start = v.getUint32(at), end = v.getUint32(at + 4);
        if (cp >= start && cp <= end) return v.getUint32(at + 8) + (cp - start);
      }
      return 0;
    }
    if (f4 < 0 || cp > 0xffff) return 0;
    const segs = v.getUint16(f4 + 6) / 2;
    const ends = f4 + 14, starts = ends + 2 * segs + 2, deltas = starts + 2 * segs, offsets = deltas + 2 * segs;
    for (let i = 0; i < segs; i++) {
      if (cp > v.getUint16(ends + 2 * i)) continue;
      const start = v.getUint16(starts + 2 * i);
      if (cp < start) return 0;
      const delta = v.getInt16(deltas + 2 * i), ro = v.getUint16(offsets + 2 * i);
      if (!ro) return (cp + delta) & 0xffff;
      const g = v.getUint16(offsets + 2 * i + ro + 2 * (cp - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const memo = new Map<number, number | null>();
  return (cp) => {
    let w = memo.get(cp);
    if (w === undefined) { const g = glyph(cp); w = g ? width(g) : null; memo.set(cp, w); }
    return w;
  };
}

function load(file: string, family: Font["family"], weight: Font["weight"]): Font {
  const data = new Uint8Array(readFileSync(join(DIR, file)));
  return { family, weight, data, advance: parseFont(data) };
}

let fonts: { display: Font; body: Font; bodyBold: Font } | null = null;
/** Space Grotesk 700 (numbers, headline), Inter 500 (labels) and Inter 700 (chips). */
export function cardFonts() {
  fonts ??= { display: load("SpaceGrotesk-700.ttf", "Space Grotesk", 700), body: load("Inter-500.ttf", "Inter", 500), bodyBold: load("Inter-700.ttf", "Inter", 700) };
  return fonts;
}

/** Width of a line of text in px (no kerning, so a touch wider than drawn: safe for fitting). */
export function textWidth(font: Font, size: number, text: string): number {
  let w = 0;
  for (const ch of text) w += font.advance(ch.codePointAt(0)!) ?? 0;
  return w * size;
}

/** Text the font can draw: other characters dropped, spaces tidied. */
export function glyphs(font: Font, text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) if (ch === " " || font.advance(ch.codePointAt(0)!) != null) out += ch;
  return out.replace(/\s+/g, " ").trim();
}

/** The text, cut at a word (or, failing that, a character) with "…" until it fits maxWidth. */
export function fitText(font: Font, size: number, text: string, maxWidth: number): string {
  if (textWidth(font, size, text) <= maxWidth) return text;
  const chars = [...text];
  for (let n = chars.length - 1; n > 0; n--) {
    let s = chars.slice(0, n).join("");
    const word = s.replace(/\s+\S*$/, "");
    if (word.length >= s.length * 0.6 && word.length > 0) s = word;
    s = s.replace(/[\s,·&–-]+$/, "") + "…";
    if (textWidth(font, size, s) <= maxWidth) return s;
  }
  return "…";
}

/** The largest size from max down to min (in steps of 2) at which the text fits, else min. */
export function fitSize(font: Font, text: string, maxWidth: number, max: number, min: number): number {
  for (let s = max; s > min; s -= 2) if (textWidth(font, s, text) <= maxWidth) return s;
  return min;
}
