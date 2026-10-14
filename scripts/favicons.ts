// Raster favicons from the brand mark (public/favicon.svg), for the places
// SVG isn't used: Google Search's favicon (BMP/GIF/ICO/PNG/JPEG…, multiple of
// 48 px), older browsers, and iOS home screens.
//   public/favicon.ico          16, 32 and 48 px (PNG images inside an ICO)
//   public/favicon-48.png       48×48
//   public/apple-touch-icon.png 180×180 on the site's dark background (iOS fills transparency with black)
// Re-run after a logo change:
//   npx playwright install chromium   (once per machine; on Linux: --with-deps)
//   npx tsx scripts/favicons.ts
import { chromium, type Page } from "playwright";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pub = join(process.cwd(), "public");
const svg = readFileSync(join(pub, "favicon.svg"), "utf8");

async function render(page: Page, size: number, opts: { background?: string; pad?: number } = {}): Promise<Buffer> {
  const pad = Math.round(size * (opts.pad ?? 0));
  const inner = size - 2 * pad;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;background:${opts.background ?? "transparent"};display:flex;align-items:center;justify-content:center">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</body></html>`);
  return page.screenshot({ omitBackground: !opts.background, clip: { x: 0, y: 0, width: size, height: size } });
}

/** An ICO file holding PNG images (supported by every browser and by Google). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const b = await chromium.launch();
const page = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();
const sizes = [16, 32, 48];
const pngs = [];
for (const size of sizes) pngs.push({ size, png: await render(page, size) });
writeFileSync(join(pub, "favicon.ico"), ico(pngs));
writeFileSync(join(pub, "favicon-48.png"), pngs[2].png);
writeFileSync(join(pub, "apple-touch-icon.png"), await render(page, 180, { background: "#0a0a0b", pad: 0.12 }));
await b.close();
for (const f of ["favicon.ico", "favicon-48.png", "apple-touch-icon.png"]) console.log(`${f}: ${statSync(join(pub, f)).size} bytes`);
