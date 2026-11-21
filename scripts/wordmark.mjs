// The v8 wordmark and bare mark (docs/design/v8-revamp-brief.md): white letters, pure white through the middle, with
// only a whisper of the v8 wash's hues at the two ends (pale slate blue on the left, pale mauve on the right). Sushil
// (11-19): white leads; two stronger gradients read as too deep,
// on a transparent background. The shapes are the masters' own alpha, untouched.
//   brand/wordmark-master.png (2000×667)  ->  brand/wordmark-master.png, public/wordmark.webp (1000 wide)
//   public/mark.png                        ->  public/mark.png, public/mark.webp
// The yellow originals are in git history. Run: node scripts/wordmark.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const fill = async (page, file, width, type) => {
  const src = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  const url = await page.evaluate(async ({ src, width, type }) => {
    const img = new Image(); img.src = src; await img.decode();
    const w = width ?? img.naturalWidth, h = Math.round(img.naturalHeight * w / img.naturalWidth);
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h);
    x.globalCompositeOperation = "source-in";
    const g = x.createLinearGradient(0, 0, w, h * 0.35);
    g.addColorStop(0, "#eaeefb"); g.addColorStop(0.35, "#ffffff"); g.addColorStop(0.65, "#ffffff"); g.addColorStop(1, "#f6ecf4");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = "source-atop";
    const lift = x.createLinearGradient(0, 0, 0, h);
    lift.addColorStop(0, "rgba(255,255,255,0.4)"); lift.addColorStop(0.6, "rgba(255,255,255,0)");
    x.fillStyle = lift; x.fillRect(0, 0, w, h);
    return c.toDataURL(type, 0.92);
  }, { src, width, type });
  return Buffer.from(url.split(",")[1], "base64");
};

const b = await chromium.launch(); const p = await b.newPage(); await p.setContent("<html><body></body></html>");
const word = await fill(p, "brand/wordmark-master.png", null, "image/png");
writeFileSync("brand/wordmark-master.png", word);
writeFileSync("public/wordmark.webp", await fill(p, "brand/wordmark-master.png", 1000, "image/webp"));
const mark = await fill(p, "public/mark.png", null, "image/png");
writeFileSync("public/mark.png", mark);
writeFileSync("public/mark.webp", await fill(p, "public/mark.png", null, "image/webp"));
await b.close(); console.log("ok");
