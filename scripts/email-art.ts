// Draws the sign-in code email's one image (server/auth/emailTemplate.ts) into public/email/:
//   mark-white.png  the white mark on transparent (26 px at 2×, PNG: WebP doesn't show in Outlook)
// Re-run after a brand change:
//   npx playwright install chromium   (once per machine)
//   npx tsx scripts/email-art.ts
import { chromium } from "playwright";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "public", "email");
mkdirSync(out, { recursive: true });
const mark = `data:image/png;base64,${readFileSync(join(process.cwd(), "brand", "favicon-master-white.png")).toString("base64")}`;

// The master is white on near-black (#111), not transparent: its brightness becomes the alpha (the dark ground drops
// out completely, the edges stay smooth), drawn 52 px for 26 px at 2×.
const markPage = `<!doctype html><html><head><style>* { margin: 0; } html, body { background: transparent; }</style></head><body>
<canvas id="c" width="52" height="52" style="width:26px;height:26px;display:block"></canvas>
<script>(async () => {
  const img = new Image(); img.src = "${mark}"; await img.decode();
  const c = document.getElementById("c"), x = c.getContext("2d");
  x.drawImage(img, 0, 0, 52, 52);
  const d = x.getImageData(0, 0, 52, 52);
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = (d.data[i] * 0.2126 + d.data[i + 1] * 0.7152 + d.data[i + 2] * 0.0722) / 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
    d.data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (lum - 0.1) / 0.85)));
  }
  x.putImageData(d, 0, 0);
  document.body.dataset.ready = "1";
})();</script></body></html>`;

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 26, height: 26 }, deviceScaleFactor: 2 })).newPage();
await p.setContent(markPage);
await p.waitForSelector("body[data-ready]");
const path = join(out, "mark-white.png");
await p.screenshot({ path, type: "png", omitBackground: true });
console.log(`${path}: ${(statSync(path).size / 1024).toFixed(1)} KB`);
await b.close();
