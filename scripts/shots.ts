// The one screenshot tool for PRs (AGENTS.md rule: use this, don't write another).
//
//   npm run shots -- /teams/18360 "/events/2025/AUSYQ1?tab=odds"
//   npm run shots -- --mobile --light /predict
//   npm run shots -- --out C:/tmp/shots /
//
// Handles the fiddly parts once: real servers (starts API + Vite if they
// aren't running), 2x device scale, waiting until data has loaded (network
// idle, no skeletons, fonts ready) plus a settle delay for animations, and
// writing PNGs OUTSIDE the repository (default: OS temp dir). Prints the
// --attach arguments for `gh pr create`.
import { chromium, type Browser } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(`--${f}`);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
// Routes: "/teams/1" or "teams/1". Git Bash rewrites a leading "/" into its
// install path (C:/Program Files/Git/...) — undo that.
const VALUE_FLAGS = new Set(["--out", "--base", "--search", "--video"]);
const routes = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1] ?? ""))
  .map((a) => a.replace(/\\/g, "/").replace(/^[A-Za-z]:\/.*?\/Git(?=\/|$)/, ""))
  .map((a) => (a.startsWith("/") ? a : `/${a}`));
// --video N: a finite, positive number of seconds (at most 120), checked before any server starts.
const VIDEO_SECS = (() => {
  if (!args.includes("--video")) return 0;
  const n = Number(opt("video"));
  if (!Number.isFinite(n) || n <= 0 || n > 120) { console.error(`--video needs a duration in seconds between 0 and 120 (got "${opt("video") ?? ""}")`); process.exit(1); }
  return n;
})();
// Dedicated ports so a capture never hits another app's dev server.
const WEB_PORT = 5199, API_PORT = 3199;
const BASE = opt("base") ?? `http://localhost:${WEB_PORT}`;
const out = resolve(opt("out") ?? join(tmpdir(), "control-scout-shots", new Date().toISOString().replace(/[:.]/g, "-")));
if (out.startsWith(resolve(process.cwd()))) { console.error("Refusing to write screenshots inside the repository — use --out outside it."); process.exit(1); }
// Default desktop; --mobile = phone only; --both = desktop + phone.
const viewports: ("desktop" | "mobile")[] = flag("both") ? ["desktop", "mobile"] : flag("mobile") ? ["mobile"] : ["desktop"];
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;

/** True only when Control Scout's own API answers (not some other app on the port). */
async function up(url: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); const j = await r.json(); return r.ok && j?.ok === true && typeof j.engine === "string"; } catch { return false; }
}

const children: ChildProcess[] = [];
async function ensureServers() {
  if (await up(`${BASE}/api/health`)) return;
  if (opt("base")) throw new Error(`${BASE} isn't reachable`);
  console.log("Starting API + Vite for the capture…");
  const env = { ...process.env, CS_NO_SCHEDULER: "1", PORT: String(API_PORT) };
  children.push(spawn("npx", ["tsx", "server/index.ts"], { env, shell: true, stdio: "ignore" }));
  children.push(spawn("npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], { env, shell: true, stdio: "ignore" }));
  for (let i = 0; i < 90; i++) { if (await up(`${BASE}/api/health`)) return; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error("Servers didn't come up in 90 s");
}

async function capture(browser: Browser, route: string, vp: keyof typeof SIZES, light: boolean): Promise<string> {
  // Still by default (stable shots); --motion / --pointer / --video show animation as users see it.
  const videoSecs = VIDEO_SECS;
  const motion = flag("motion") || flag("pointer") || videoSecs > 0;
  const ctx = await browser.newContext({
    viewport: SIZES[vp], deviceScaleFactor: videoSecs ? 1 : 2, colorScheme: light ? "light" : "dark", isMobile: vp === "mobile", hasTouch: vp === "mobile",
    reducedMotion: motion ? "no-preference" : "reduce",
    ...(videoSecs ? { recordVideo: { dir: out, size: SIZES[vp] } } : {}),
  });
  if (light) await ctx.addInitScript(() => localStorage.setItem("cs-personal:settings", JSON.stringify({ value: { theme: "light", density: "comfortable", notify: {} }, updatedAt: 1 })));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });
  // Data loaded: no skeletons left, fonts ready, then let charts/motion settle.
  await page.waitForFunction(() => !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 45_000 }).catch(() => console.warn(`  ! ${route}: still loading after 45 s`));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  // --search "text": open the ⌘K palette, type, and wait for results.
  const q = opt("search");
  if (q) {
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.type(q, { delay: 60 });
    await page.waitForFunction(() => !document.body.innerText.includes("Searching…"), null, { timeout: 15_000 });
    await page.waitForTimeout(600);
  }
  // --pointer: rest the mouse mid-page (hover effects, the ambient light).
  if (flag("pointer") && vp === "desktop") { await page.mouse.move(SIZES[vp].width * 0.6, SIZES[vp].height * 0.35, { steps: 12 }); await page.waitForTimeout(500); }
  // --video N: record N seconds while the pointer glides across the page.
  if (videoSecs) {
    const { width, height } = SIZES[vp];
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < videoSecs * 1000) {
      const a = (i++ / 60) * Math.PI * 2;
      await page.mouse.move(width * (0.5 + 0.3 * Math.cos(a)), height * (0.45 + 0.25 * Math.sin(a * 2)), { steps: 4 });
      await page.waitForTimeout(40);
    }
    const video = page.video();
    await ctx.close();
    const tmp = await video!.path();
    const file = join(out, `${vp}${light ? "-light" : ""}${q ? `-search-${q.replace(/[^\w]+/g, "_")}` : ""}-video-${route.replace(/^\//, "").replace(/[^\w-]+/g, "_") || "home"}.webm`);
    renameSync(tmp, file);
    if (errors.length) console.warn(`  ! ${route}: page errors: ${errors.join(" | ")}`);
    return file;
  }
  // The shell scrolls inside <main> (h-dvh, absolutely positioned over the
  // ambient layer); unroll it and put <main> back in normal flow so the page
  // content gives the shell its height and a full-page shot shows everything.
  if (!flag("viewport") && !q && !flag("pointer")) await page.addStyleTag({ content: ".h-dvh{height:auto!important;overflow:visible!important} main#main{overflow:visible!important;position:relative!important;inset:auto!important} .h-dvh{position:relative!important} nav.fixed{position:absolute!important;left:0;right:0;bottom:0}" });
  const name = `${vp}${light ? "-light" : ""}${flag("pointer") ? "-pointer" : ""}${q ? `-search-${q.replace(/[^\w]+/g, "_")}` : ""}-${route.replace(/^\//, "").replace(/[^\w-]+/g, "_") || "home"}.png`;
  const file = join(out, name);
  await page.screenshot({ path: file, fullPage: !flag("viewport") && !q && !flag("pointer") });
  if (errors.length) console.warn(`  ! ${route}: page errors: ${errors.join(" | ")}`);
  await ctx.close();
  return file;
}

try {
  if (!routes.length) { console.error("Give at least one route, e.g. npm run shots -- /teams/18360"); process.exit(1); }
  mkdirSync(out, { recursive: true });
  await ensureServers();
  const browser = await chromium.launch();
  const files: string[] = [];
  for (const r of routes) for (const vp of viewports) {
    const f = await capture(browser, r, vp, flag("light"));
    console.log(`  ✓ ${f}`);
    files.push(f);
  }
  await browser.close();
  console.log(`\n${files.length} file(s) in ${out}\nAttach with:\n  ${files.map((f) => `--attach '${f.replace(/\\/g, "/")}#${f.split(/[\\/]/).pop()!.replace(/\.(png|webm)$/, "").replace(/[-_]/g, " ")}'`).join(" \\\n  ")}`);
} finally {
  // shell:true spawns a process tree; on Windows kill the whole tree.
  for (const c of children) {
    if (process.platform === "win32" && c.pid) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill();
  }
}
