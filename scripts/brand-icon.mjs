// The v8 brand icon's masters (docs/design/v8-revamp-brief.md): the near-black square with the v8 wash (slate blue to
// mauve) across the top under a fine grain, and the mark in soft white (white at the top to a faint lavender grey) with a
// soft shadow. The mark's shape comes from brand/favicon-master-white.png (its brightness becomes the mark's alpha).
// Writes brand/favicon-master.png (full) and brand/favicon-master-maskable.png (the mark inside Android's 80% safe zone).
// Then run scripts/favicons.ts and scripts/og-image.ts. The grain is random, so a re-run differs only in the noise.
//   node scripts/brand-icon.mjs . brand
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [repo, out] = process.argv.slice(2);
const white = `data:image/png;base64,${readFileSync(join(repo, "brand", "favicon-master-white.png")).toString("base64")}`;
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent("<html><body></body></html>");
async function master(variant) {
  const [shape, ink] = variant.split(":");
  const url = await p.evaluate(async ({ src, shape, ink }) => {
    const N = 1254;
    const img = new Image(); img.src = src; await img.decode();
    // The mark: luminance of the white-on-dark master becomes alpha (pure white, crisp edges).
    const m = document.createElement("canvas"); m.width = m.height = N; const mc = m.getContext("2d");
    mc.drawImage(img, 0, 0, N, N);
    const d = mc.getImageData(0, 0, N, N);
    for (let i = 0; i < d.data.length; i += 4) {
      const l = (d.data[i] * 0.2126 + d.data[i + 1] * 0.7152 + d.data[i + 2] * 0.0722);
      const a = Math.max(0, Math.min(255, (l - 40) * 255 / (235 - 40)));
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = a;
    }
    mc.putImageData(d, 0, 0);
    const c = document.createElement("canvas"); c.width = c.height = N; const x = c.getContext("2d");
    x.fillStyle = "#0a0a0b"; x.fillRect(0, 0, N, N);
    // The wash: three glows along the top edge, blurred, then faded towards the bottom.
    const w = document.createElement("canvas"); w.width = w.height = N; const wx = w.getContext("2d");
    for (const [cx, col, rx] of [[0.12, "#44587f", 0.62], [0.52, "#4a4462", 0.58], [0.9, "#6e5076", 0.62]]) {
      const g = wx.createRadialGradient(cx * N, -0.05 * N, 0, cx * N, -0.05 * N, rx * N * 1.5);
      for (let k = 0; k <= 10; k++) { const t = k / 10; const a = Math.round(255 * Math.pow(1 - t, 2.2)).toString(16).padStart(2, "0"); g.addColorStop(t, col + a); }
      wx.fillStyle = g; wx.fillRect(0, 0, N, N);
    }
    const blurred = document.createElement("canvas"); blurred.width = blurred.height = N; const bx = blurred.getContext("2d");
    bx.filter = `blur(${N * 0.04}px)`; bx.drawImage(w, 0, 0); bx.filter = "none";
    bx.globalCompositeOperation = "destination-in";
    const fade = bx.createLinearGradient(0, 0, 0, N);
    for (let k = 0; k <= 12; k++) { const t = k / 12; fade.addColorStop(t, `rgba(0,0,0,${Math.max(0, 1 - Math.pow(t / 0.92, 1.6)).toFixed(3)})`); }
    bx.fillStyle = fade; bx.fillRect(0, 0, N, N);
    x.drawImage(blurred, 0, 0); x.globalAlpha = 0.6; x.drawImage(blurred, 0, 0); x.globalAlpha = 1; // a touch brighter, like the sample home
    // Fine grain (soft-light noise), as on the page wash.
    const n = document.createElement("canvas"); n.width = n.height = N; const nx = n.getContext("2d"); const nd = nx.createImageData(N, N);
    for (let i = 0; i < nd.data.length; i += 4) { const v = Math.random() * 255; nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v; nd.data[i + 3] = 255; }
    nx.putImageData(nd, 0, 0);
    x.globalAlpha = 0.07; x.globalCompositeOperation = "overlay"; x.drawImage(n, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
    // The mark: as drawn in the master (full), or inside the 80% safe zone (maskable).
    const s = shape === "maskable" ? 0.78 : 1;
    // Ink: pure white, a soft white that picks up the wash (white at the top to a faint lavender grey), or mint.
    if (ink !== "white") {
      const tint = mc.createLinearGradient(0, N * 0.18, 0, N * 0.82);
      if (ink === "soft") { tint.addColorStop(0, "#ffffff"); tint.addColorStop(1, "#dcd9e8"); }
      else { tint.addColorStop(0, "#8fdcbb"); tint.addColorStop(1, "#6cc49f"); }
      mc.globalCompositeOperation = "source-in"; mc.fillStyle = tint; mc.fillRect(0, 0, N, N); mc.globalCompositeOperation = "source-over";
    }
    const o = (N - N * s) / 2;
    x.shadowColor = "rgba(0,0,0,0.35)"; x.shadowBlur = N * 0.03; x.shadowOffsetY = N * 0.01;
    x.drawImage(m, o, o, N * s, N * s);
    return c.toDataURL("image/png");
  }, { src: white, shape, ink });
  return Buffer.from(url.split(",")[1], "base64");
}
writeFileSync(join(out, "favicon-master.png"), await master("full:soft"));
writeFileSync(join(out, "favicon-master-maskable.png"), await master("maskable:soft"));
await b.close(); console.log("ok");
