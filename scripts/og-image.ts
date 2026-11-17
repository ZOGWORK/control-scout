// Renders public/og-image.png (1200×630), the link-preview card every page
// points og:image / twitter:image at (Discord, iMessage, Slack, X). Same look as the site: graphite, gold,
// the brand icon, Space Grotesk + Inter. Re-run after a brand change:
//   npx playwright install chromium   (once per machine; on Linux: --with-deps)
//   npx tsx scripts/og-image.ts
import { chromium } from "playwright";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pub = join(process.cwd(), "public");
const font = (f: string) => `data:font/woff2;base64,${readFileSync(join(pub, "fonts", f)).toString("base64")}`;
// The brand icon (run scripts/favicons.ts first: it writes logo-512.png from brand/favicon-master.png).
const logo = `<img alt="" src="data:image/png;base64,${readFileSync(join(pub, "logo-512.png")).toString("base64")}" />`;

// Drawn for where it's seen: Discord, iMessage and Slack show it about 400px wide, a third of its size, so nothing
// on it is under 30px (checked by downscaling it to 400px) and there's one idea per region (the name, the promise, a prediction as the app shows one).
// The prediction panel is an illustration of the product's look, not a real match: it names no team.
const html = `<!doctype html><html><head><style>
@font-face { font-family: SG; src: url(${font("SpaceGrotesk.woff2")}); font-weight: 700; }
@font-face { font-family: Inter; src: url(${font("Inter.woff2")}); font-weight: 500; }
@font-face { font-family: Inter; src: url(${font("Inter.woff2")}); font-weight: 700; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; background: #0a0a0b; color: #f4f4f5; font-family: Inter, sans-serif; position: relative; }
.glow { position: absolute; inset: 0; background:
  radial-gradient(760px 420px at 100% 0%, rgba(255,199,0,.20), transparent 70%),
  radial-gradient(620px 360px at 0% 100%, rgba(56,189,248,.10), transparent 70%); }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px); background-size: 48px 48px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 30%, #000 70%, transparent); }
.bar { position: absolute; top: 0; left: 0; right: 0; height: 10px; background: #ffc700; }
.left { position: absolute; left: 72px; top: 66px; bottom: 60px; width: 640px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 20px; }
.brand img { width: 76px; height: 76px; }
.name { font-family: SG; font-weight: 700; font-size: 46px; letter-spacing: -.01em; }
h1 { font-family: SG; font-weight: 700; font-size: 78px; line-height: 1.02; letter-spacing: -.03em; margin-top: 44px; white-space: nowrap; }
h1 em { font-style: normal; color: #ffc700; }
.sub { font-size: 32px; font-weight: 500; color: #c4c4cc; margin-top: 26px; line-height: 1.3; }
.url { margin-top: auto; font-family: SG; font-weight: 700; font-size: 34px; color: #ffc700; }
.card { position: absolute; right: 52px; top: 118px; width: 392px; border-radius: 28px; padding: 30px 30px 32px; background: rgba(20,20,23,.92);
  border: 2px solid #2a2a30; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
.tag { display: inline-block; font-weight: 700; font-size: 30px; color: #ffc700; }
.title { font-family: SG; font-weight: 700; font-size: 36px; margin-top: 10px; }
.odds { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 26px; font-family: SG; font-weight: 700; }
.odds div { font-size: 64px; line-height: 1; letter-spacing: -.02em; }
.odds span { display: block; font-family: Inter; font-size: 30px; font-weight: 700; margin-bottom: 6px; }
.red { color: #f87171; } .blue { color: #60a5fa; text-align: right; }
.meter { display: flex; height: 20px; border-radius: 999px; overflow: hidden; margin-top: 18px; }
.meter i:first-child { width: 64%; background: #ef4444; } .meter i:last-child { flex: 1; background: #3b82f6; }
.score { margin-top: 26px; padding-top: 22px; border-top: 2px solid #26262b; display: flex; justify-content: space-between; font-size: 30px; font-weight: 500; color: #a1a1aa; }
.score b { color: #f4f4f5; font-family: SG; font-weight: 700; }
</style></head><body>
<div class="glow"></div><div class="grid"></div><div class="bar"></div>
<div class="left">
  <div class="brand">${logo}<div class="name">Control Scout</div></div>
  <h1>Every FTC match,<br><em>predicted.</em></h1>
  <div class="sub">Free scouting: OPR, win odds,<br>advancement and more.</div>
  <div class="url">controlscout.org</div>
</div>
<div class="card">
  <div class="tag">Match prediction</div>
  <div class="title">Example match</div>
  <div class="odds"><div class="red"><span>Red</span>64%</div><div class="blue"><span>Blue</span>36%</div></div>
  <div class="meter"><i></i><i></i></div>
  <div class="score"><span>Called score</span><b>128 – 104</b></div>
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
