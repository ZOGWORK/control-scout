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
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(`--${f}`);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
// Routes: "/teams/1" or "teams/1". Git Bash rewrites a leading "/" into its
// install path (C:/Program Files/Git/...) — undo that.
const VALUE_FLAGS = new Set(["--out", "--base"]);
const routes = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1] ?? ""))
  .map((a) => a.replace(/\\/g, "/").replace(/^[A-Za-z]:\/.*?\/Git(?=\/|$)/, ""))
  .map((a) => (a.startsWith("/") ? a : `/${a}`));
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
  const ctx = await browser.newContext({ viewport: SIZES[vp], deviceScaleFactor: 2, colorScheme: light ? "light" : "dark", isMobile: vp === "mobile", hasTouch: vp === "mobile", reducedMotion: "reduce" });
  if (light) await ctx.addInitScript(() => localStorage.setItem("cs-personal:settings", JSON.stringify({ value: { theme: "light", density: "comfortable", notify: {} }, updatedAt: 1 })));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });
  // Data loaded: no skeletons left, fonts ready, then let charts/motion settle.
  await page.waitForFunction(() => !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 45_000 }).catch(() => console.warn(`  ! ${route}: still loading after 45 s`));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  // The shell scrolls inside <main> (h-dvh); unroll it so a full-page shot shows everything.
  if (!flag("viewport")) await page.addStyleTag({ content: ".h-dvh{height:auto!important;overflow:visible!important} main{overflow:visible!important} nav.fixed{position:static!important}" });
  const name = `${vp}${light ? "-light" : ""}-${route.replace(/^\//, "").replace(/[^\w-]+/g, "_") || "home"}.png`;
  const file = join(out, name);
  await page.screenshot({ path: file, fullPage: !flag("viewport") });
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
  console.log(`\n${files.length} screenshot(s) in ${out}\nAttach with:\n  ${files.map((f) => `--attach '${f.replace(/\\/g, "/")}#${f.split(/[\\/]/).pop()!.replace(/\.png$/, "").replace(/[-_]/g, " ")}'`).join(" \\\n  ")}`);
} finally {
  // shell:true spawns a process tree; on Windows kill the whole tree.
  for (const c of children) {
    if (process.platform === "win32" && c.pid) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill();
  }
}
