// Draws the sign-in code email's three images (server/auth/emailTemplate.ts) into public/email/:
//   code-wash.jpg   the wash across the top of the card (560×220 at 2×): the site's three glows, its grain, a faint
//                   field of FTC tiles in perspective and a ribbon of particle dots, fading into the card's colour
//   code-glow.jpg   the soft page-end glow along the card's foot (560×150 at 2×)
//   mark-white.png  the white mark on transparent (26 px at 2×, PNG: WebP doesn't show in Outlook)
// JPEGs because the card behind them is one solid colour (no transparency needed) and they stay small.
// Re-run after a wash or brand change:
//   npx playwright install chromium   (once per machine)
//   npx tsx scripts/email-art.ts
import { chromium } from "playwright";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { softStops } from "../src/shared/wash";

const out = join(process.cwd(), "public", "email");
mkdirSync(out, { recursive: true });
/** The live wash (Sunset, src/shared/wash.ts WASH_PRESETS) and the v8 card colour. */
const W = { a: "#d0784a", b: "#c2557a", c: "#7c4fa8", ga: "#e08a3c", gb: "#d14f6b", gc: "#8a4fb0" };
const CARD = "#0e0e10";
const mark = `data:image/png;base64,${readFileSync(join(process.cwd(), "brand", "favicon-master-white.png")).toString("base64")}`;

// Repeatable "random" dots, like the site's particle wave (DotWave.tsx): a ribbon that drifts across.
function ribbon(width: number, height: number, centreY: (x: number) => number, spread: number, count: number, seed: number, from = 0): string {
  let s = seed;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const tones = ["212,170,138", "198,171,163", "181,179,195", "165,177,201"];
  let dots = "";
  for (let i = 0; i < count; i++) {
    const x = r() * width;
    const d = (r() + r() + r() - 1.5) / 1.5;
    const y = centreY(x / width) + d * spread;
    if (y < 0 || y > height) continue;
    const size = 1 + r() ** 2 * 1.6;
    // `from`: where across (0–1) the ribbon fades in, so it stays clear of the text on the left.
    const t = Math.min(1, Math.max(0, (x / width - from) / 0.3));
    const alpha = (0.18 + r() * 0.42) * (1 - Math.abs(d)) * t * t * (3 - 2 * t);
    if (alpha < 0.02) continue;
    dots += `<i style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${size.toFixed(2)}px;height:${size.toFixed(2)}px;background:rgba(${tones[Math.floor(r() * tones.length)]},${alpha.toFixed(2)})"></i>`;
  }
  return dots;
}

const grain = `<svg class="grain" xmlns="http://www.w3.org/2000/svg"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
const base = `* { margin: 0; box-sizing: border-box; } html, body { background: ${CARD}; overflow: hidden; }
body { position: relative; } i { position: absolute; border-radius: 50%; display: block; }
.grain { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .12; mix-blend-mode: overlay; }`;

const wash = `<!doctype html><html><head><style>${base}
body { width: 560px; height: 220px; }
.glows { position: absolute; inset: 0; overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom,#000 0%,rgb(0 0 0/.95) 25%,rgb(0 0 0/.78) 45%,rgb(0 0 0/.5) 65%,rgb(0 0 0/.2) 84%,transparent 100%); }
.glows div { position: absolute; left: -10%; right: -10%; top: -32%; bottom: 0; }
.field { position: absolute; right: -70px; top: 18px; width: 300px; height: 300px; transform: perspective(520px) rotateX(58deg) rotateZ(-28deg);
  background-image: linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.16) 1px, transparent 1px);
  background-size: 50px 50px; border: 1px solid rgba(255,255,255,.2);
  -webkit-mask-image: radial-gradient(60% 60% at 40% 40%, #000 0%, rgba(0,0,0,.5) 55%, transparent 100%); opacity: .55; }
.field::after { content: ""; position: absolute; left: 100px; top: 100px; width: 100px; height: 100px; background: rgba(255,255,255,.06); }
</style></head><body>
<div class="glows">
  <div style="background-image:radial-gradient(48% 84% at 90% 0%,${softStops(W.c)})"></div>
  <div style="background-image:radial-gradient(44% 80% at 52% 0%,${softStops(W.b)})"></div>
  <div style="background-image:radial-gradient(48% 84% at 12% 0%,${softStops(W.a)})"></div>
</div>
<div class="field"></div>
${ribbon(560, 220, (t) => 70 + 120 * t * t, 16, 520, 51091, 0.42)}
${grain}
</body></html>`;

const glow = `<!doctype html><html><head><style>${base}
body { width: 560px; height: 150px; }
.glows { position: absolute; inset: 0; -webkit-mask-image: linear-gradient(to top,#000 0%,rgb(0 0 0/.7) 35%,rgb(0 0 0/.25) 70%,transparent 100%); opacity: .55; }
.glows div { position: absolute; left: -10%; right: -10%; top: 0; bottom: -60%; }
</style></head><body>
<div class="glows">
  <div style="background-image:radial-gradient(46% 70% at 88% 100%,${softStops(W.gc)})"></div>
  <div style="background-image:radial-gradient(44% 70% at 52% 100%,${softStops(W.gb)})"></div>
  <div style="background-image:radial-gradient(46% 70% at 12% 100%,${softStops(W.ga)})"></div>
</div>
${ribbon(560, 150, (t) => 122 + 10 * Math.sin(t * Math.PI * 2), 9, 260, 7741)}
${grain}
</body></html>`;

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
async function shoot(html: string, width: number, height: number, file: string, type: "jpeg" | "png") {
  const p = await (await b.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })).newPage();
  await p.setContent(html);
  if (html.includes("dataset.ready")) await p.waitForSelector("body[data-ready]");
  const path = join(out, file);
  await p.screenshot(type === "jpeg" ? { path, type, quality: 82 } : { path, type, omitBackground: true });
  console.log(`${path}: ${(statSync(path).size / 1024).toFixed(1)} KB`);
}
await shoot(wash, 560, 220, "code-wash.jpg", "jpeg");
await shoot(glow, 560, 150, "code-glow.jpg", "jpeg");
await shoot(markPage, 26, 26, "mark-white.png", "png");
await b.close();
