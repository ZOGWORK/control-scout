// Renders public/logo-512.png from public/logo.svg: the raster logo that
// structured data (Organization.logo) points at. Re-run after a logo change:
//   npx tsx scripts/logo-png.ts
import { chromium } from "playwright";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pub = join(process.cwd(), "public");
const svg = readFileSync(join(pub, "logo.svg"), "utf8");
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })).newPage();
await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", '<svg width="512" height="512" ')}</body></html>`);
const out = join(pub, "logo-512.png");
await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } });
await b.close();
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
