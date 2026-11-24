// Renders public/og-image.png (1200×630), the link-preview card every page
// points og:image / twitter:image at (Discord, iMessage, Slack, X). v8 look: near-black, the wash,
// the mark cropped large on the right, "Scouting, Reimagined." in Space Grotesk + Inter. Re-run after a brand change:
//   npx playwright install chromium   (once per machine; on Linux: --with-deps)
//   npx tsx scripts/og-image.ts
import { chromium } from "playwright";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pub = join(process.cwd(), "public");
const font = (f: string) => `data:font/woff2;base64,${readFileSync(join(pub, "fonts", f)).toString("base64")}`;
// The brand icon (run scripts/favicons.ts first: it writes logo-512.png from brand/favicon-master.png).
const logo = `<img alt="" src="data:image/png;base64,${readFileSync(join(pub, "logo-512.png")).toString("base64")}" />`;

// The bare mark (white on black) as a luminance mask, so the big cropped mark can be filled with the wash.
const mark = `data:image/png;base64,${readFileSync(join(process.cwd(), "brand", "favicon-master-white.png")).toString("base64")}`;

// "Scouting, Reimagined": one idea, set big. Discord, iMessage and Slack show it about 400px wide (a third of its size),
// so the headline is huge and nothing that has to be read is under 30px. No sample data on it: the mark carries the picture.
const html = `<!doctype html><html><head><style>
@font-face { font-family: SG; src: url(${font("SpaceGrotesk.woff2")}); font-weight: 700; }
@font-face { font-family: Inter; src: url(${font("Inter.woff2")}); font-weight: 500; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; background: #0a0a0b; color: #f4f4f5; font-family: Inter, sans-serif; position: relative; }
.wash { position: absolute; right: -260px; top: -220px; width: 1000px; height: 1000px; filter: blur(60px); opacity: .75; background:
  radial-gradient(40% 40% at 35% 40%, #44587f, transparent 70%), radial-gradient(40% 40% at 65% 55%, #6e5076, transparent 70%); }
.mark { position: absolute; right: -150px; top: -95px; width: 820px; height: 820px; opacity: .95;
  background: linear-gradient(140deg, #f4f4f5 0%, #c9d4ee 38%, #8fa3d4 70%, #6e5076 100%);
  -webkit-mask: url(${mark}) center / contain no-repeat; mask: url(${mark}) center / contain no-repeat; mask-mode: luminance; }
.fade { position: absolute; inset: 0; background: linear-gradient(90deg, #0a0a0b 0%, #0a0a0b 34%, rgba(10,10,11,.55) 58%, transparent 80%); }
.copy { position: absolute; left: 76px; top: 70px; bottom: 66px; width: 760px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 16px; font-family: SG; font-weight: 700; font-size: 36px; color: #d4d4d8; }
.brand img { width: 56px; height: 56px; }
h1 { margin-top: auto; font-family: SG; font-weight: 700; font-size: 132px; line-height: .92; letter-spacing: -.045em; }
h1 em { font-style: normal; display: block; background: linear-gradient(90deg, #c9d4ee, #8fa3d4); -webkit-background-clip: text; color: transparent; padding-bottom: 8px; }
.sub { margin-top: 30px; font-size: 32px; line-height: 1.3; font-weight: 500; color: #a1a1aa; }
.sub b { color: #e4e4e7; font-weight: 500; }
</style></head><body>
<div class="wash"></div>
<div class="mark"></div>
<div class="fade"></div>
<div class="copy">
  <div class="brand">${logo}Control Scout</div>
  <h1>Scouting,<em>Reimagined.</em></h1>
  <div class="sub">Free FTC scouting and predictions<br><b>controlscout.org</b></div>
</div>
</body></html>`;

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
const out = join(pub, "og-image.png");
await p.screenshot({ path: out, type: "png" });
await b.close();
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
