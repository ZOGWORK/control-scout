// The favicons Google Search and browsers can use: raster files present with the right
// format and size, and linked in index.html with the ICO first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pub = (f: string) => readFileSync(join(process.cwd(), "public", f));
const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];
const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

describe("favicons", () => {
  it("favicon.ico holds 16, 32 and 48 px images; the PNGs are square at 48 and 180", () => {
    const ico = pub("favicon.ico");
    expect(ico.readUInt16LE(2)).toBe(1); // an icon
    const n = ico.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32, 48]);
    for (let i = 0; i < n; i++) expect(isPng(ico.subarray(ico.readUInt32LE(6 + 16 * i + 12)))).toBe(true);
    expect(isPng(pub("favicon-48.png")) && pngSize(pub("favicon-48.png"))).toEqual([48, 48]);
    expect(isPng(pub("apple-touch-icon.png")) && pngSize(pub("apple-touch-icon.png"))).toEqual([180, 180]);
    // The in-app logo and the structured-data logo come from the same icon.
    expect(pngSize(pub("logo.png"))).toEqual([96, 96]);
    expect(pngSize(pub("logo-512.png"))).toEqual([512, 512]);
    // The installed app uses the same icon.
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "public", "manifest.webmanifest"), "utf8"));
    for (const { src, sizes } of manifest.icons) {
      const n = Number(sizes.split("x")[0]);
      expect(pngSize(pub(src.slice(1)))).toEqual([n, n]);
    }
  });

  it("index.html links the ICO first, then the PNG, plus the touch icon; no SVG favicon (it would win over the brand icon)", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    const at = (s: string) => html.indexOf(s);
    expect(at('<link rel="icon" href="/favicon.ico" sizes="any" />')).toBeGreaterThan(-1);
    expect(at("/favicon.ico")).toBeLessThan(at("/favicon-48.png"));
    expect(at("/favicon-48.png")).toBeGreaterThan(at("/favicon.ico"));
    expect(html).not.toMatch(/rel="icon"[^>]*svg/);
    expect(at('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />')).toBeGreaterThan(-1);
  });

  it("robots.txt doesn't block them", () => {
    const robots = readFileSync(join(process.cwd(), "public", "robots.txt"), "utf8");
    expect(robots).not.toMatch(/Disallow:\s*\/(favicon|apple-touch|\s*$)/m);
  });
});
