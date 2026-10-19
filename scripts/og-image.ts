// Renders public/og-image.png (1200×630), the link-preview card every page
// points og:image / twitter:image at. Same look as the site: graphite, gold,
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

const html = `<!doctype html><html><head><style>
@font-face { font-family: SG; src: url(${font("SpaceGrotesk.woff2")}); font-weight: 700; }
@font-face { font-family: Inter; src: url(${font("Inter.woff2")}); font-weight: 500; }
@font-face { font-family: Inter; src: url(${font("Inter.woff2")}); font-weight: 700; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; background: #0a0a0b; color: #f4f4f5; font-family: Inter, sans-serif; position: relative; }
.glow { position: absolute; inset: 0; background:
  radial-gradient(700px 360px at 85% -10%, rgba(255,199,0,.22), transparent 70%),
  radial-gradient(500px 300px at 0% 110%, rgba(56,189,248,.10), transparent 70%); }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 48px 48px; }
.bar { position: absolute; top: 0; left: 0; right: 0; height: 8px; background: #ffc700; }
.wrap { position: absolute; inset: 72px 80px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 22px; }
.brand img { width: 84px; height: 84px; }
.name { font-family: SG; font-weight: 700; font-size: 44px; letter-spacing: -.01em; }
.name small { display: block; font-family: Inter; font-weight: 500; font-size: 20px; color: #a1a1aa; letter-spacing: .14em; text-transform: uppercase; margin-top: 4px; }
h1 { font-family: SG; font-weight: 700; font-size: 76px; line-height: 1.02; letter-spacing: -.02em; margin-top: 56px; max-width: 980px; }
h1 em { font-style: normal; color: #ffc700; }
.chips { display: flex; gap: 14px; margin-top: auto; }
.chip { font-weight: 700; font-size: 24px; padding: 12px 22px; border-radius: 999px; border: 2px solid #2a2a30; background: #141416; }
.chip b { color: #ffc700; }
.url { position: absolute; right: 80px; bottom: 82px; font-weight: 500; font-size: 24px; color: #a1a1aa; }
</style></head><body>
<div class="glow"></div><div class="grid"></div><div class="bar"></div>
<div class="wrap">
  <div class="brand">${logo}<div class="name">Control Scout<small>FTC scouting &amp; predictions</small></div></div>
  <h1>Every FTC team, event and match, <em>predicted.</em></h1>
  <div class="chips"><span class="chip"><b>OPR</b> breakdowns</span><span class="chip"><b>Win odds</b> &amp; scores</span><span class="chip"><b>Advancement</b> odds</span></div>
</div>
<div class="url">controlscout.org</div>
</body></html>`;

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
const out = join(pub, "og-image.png");
await p.screenshot({ path: out, type: "png" });
await b.close();
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
