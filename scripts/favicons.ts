// Favicons from the brand icon (brand/favicon-master.png, Sushil's 1254×1254
// artwork: the yellow mark on the dark square), for every place an icon shows:
// Google Search (ICO/PNG, a multiple of 48 px), browsers and iOS home screens.
//   public/favicon.ico          16, 32 and 48 px (PNG images inside an ICO)
//   public/favicon-48.png       48×48
//   public/apple-touch-icon.png 180×180
//   public/icon-192.png, icon-512.png  the installed app's icons (manifest.webmanifest)
//   public/logo.png             96×96 (sharp at 48 px on 2x screens), rounded corners: the logo in the app (sidebar, header, home, notifications)
//   public/logo-512.png         512×512, rounded: the logo in structured data and the share image
// No SVG favicon: the artwork is a bitmap, and an SVG link would win over these in modern browsers.
// Re-run after replacing the master:
//   npx playwright install chromium   (once per machine; on Linux: --with-deps)
//   npx tsx scripts/favicons.ts
import { chromium, type Page } from "playwright";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pub = join(process.cwd(), "public");
const master = `data:image/png;base64,${readFileSync(join(process.cwd(), "brand", "favicon-master.png")).toString("base64")}`;

/** The master at `size` px: halved step by step (sharp small sizes), then drawn at the target. */
async function render(page: Page, size: number, opts: { round?: boolean } = {}): Promise<Buffer> {
  const round = !!opts.round;
  const dataUrl = await page.evaluate(async ({ src, size, round }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    let canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    let ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    while (canvas.width / 2 >= size) {
      const next = document.createElement("canvas");
      next.width = Math.round(canvas.width / 2); next.height = Math.round(canvas.height / 2);
      const c = next.getContext("2d")!;
      c.imageSmoothingQuality = "high";
      c.drawImage(canvas, 0, 0, next.width, next.height);
      canvas = next; ctx = c;
    }
    const out = document.createElement("canvas");
    out.width = size; out.height = size;
    const o = out.getContext("2d")!;
    o.imageSmoothingQuality = "high";
    // The app's logo: app-icon corners (22% radius), transparent outside.
    if (round) { o.beginPath(); o.roundRect(0, 0, size, size, size * 0.22); o.clip(); }
    o.drawImage(canvas, 0, 0, size, size);
    return out.toDataURL("image/png");
  }, { src: master, size, round });
  return Buffer.from(dataUrl.split(",")[1], "base64");
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
const page = await (await b.newContext()).newPage();
await page.setContent("<html><body></body></html>");
const pngs = [];
for (const size of [16, 32, 48]) pngs.push({ size, png: await render(page, size) });
writeFileSync(join(pub, "favicon.ico"), ico(pngs));
writeFileSync(join(pub, "favicon-48.png"), pngs[2].png);
writeFileSync(join(pub, "apple-touch-icon.png"), await render(page, 180));
writeFileSync(join(pub, "icon-192.png"), await render(page, 192));
writeFileSync(join(pub, "icon-512.png"), await render(page, 512));
writeFileSync(join(pub, "logo.png"), await render(page, 96, { round: true }));
writeFileSync(join(pub, "logo-512.png"), await render(page, 512, { round: true }));
await b.close();
for (const f of ["favicon.ico", "favicon-48.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "logo.png", "logo-512.png"]) console.log(`${f}: ${statSync(join(pub, f)).size} bytes`);
