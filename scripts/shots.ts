// The one screenshot tool for PRs (AGENTS.md rule: use this, don't write another).
//
//   npm run shots -- /teams/18360 "/events/2025/AUSYQ1?tab=odds"
//   npm run shots -- --mobile --light /predict
//   npm run shots -- --out C:/tmp/shots /
//   npm run shots -- --steps flow.json --name builder /teams
//
// --steps <file.json> runs interactions after the page loads (open a dialog,
// build a filter…) before the shot, or while a --video records. The file is
// an array of { click | hold(+ms) | fill+value | type | press | wait | waitFor | reload } steps
// (hold: press the pointer on an element for ms, default 1600, e.g. a hold-to-confirm button);
// selectors are Playwright's (role=button[name="Filters"], text=Apply, css).
// --name <label> goes in the file name, to tell several states of one route apart.
//
// Handles the fiddly parts once: real servers (starts API + Vite if they
// aren't running), 2x device scale, waiting until data has loaded (network
// idle, no skeletons, fonts ready) plus a settle delay for animations, and
// writing PNGs OUTSIDE the repository (default: OS temp dir). Prints the
// --attach arguments for `gh pr create`.
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WEB_PORT, ensureServers, stopServers } from "./lib/servers.js";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(`--${f}`);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
// Routes: "/teams/1" or "teams/1". Git Bash rewrites a leading "/" into its
// install path (C:/Program Files/Git/...) — undo that.
const VALUE_FLAGS = new Set(["--out", "--base", "--search", "--video", "--storage", "--steps", "--name", "--cookie-file"]);
// --cookie-file <file>: a "name=value" cookie (e.g. cs_session=<a local test account's session>) for pages
// that need a signed-in account, such as /owner. Read from a file so the value never lands in shell history
// or the output; only sent to a localhost base.
const COOKIE = (() => {
  const f = opt("cookie-file");
  if (!f) return null;
  const [name, ...rest] = readFileSync(f, "utf8").trim().split("=");
  if (!name || !rest.length) { console.error("--cookie-file: the file must hold name=value"); process.exit(1); }
  return { name, value: rest.join("=") };
})();
type Step = { click?: string; hold?: string; ms?: number; fill?: string; value?: string; type?: string; press?: string; wait?: number; waitFor?: string; reload?: boolean };
const STEPS: Step[] = (() => {
  const f = opt("steps");
  if (!f) return [];
  const s = JSON.parse(readFileSync(f, "utf8"));
  if (!Array.isArray(s)) { console.error("--steps: the file must hold a JSON array of steps"); process.exit(1); }
  return s;
})();
/** A route as a file-name part (long filter URLs cut to a readable length). */
const slug = (route: string) => (route.replace(/^\//, "").replace(/[^\w-]+/g, "_") || "home").slice(0, 80);
const LABEL = opt("name") ? `-${opt("name")!.replace(/[^\w-]+/g, "_")}` : "";
/** Run --steps in order (a pause after each, so a video shows what happened). */
async function runSteps(page: Page, slow: boolean) {
  for (const s of STEPS) {
    if (s.click) await page.locator(s.click).first().click();
    else if (s.hold) { await page.locator(s.hold).first().hover(); await page.mouse.down(); await page.waitForTimeout(s.ms ?? 1600); await page.mouse.up(); }
    else if (s.fill) await page.locator(s.fill).first().fill(s.value ?? "");
    else if (s.type != null) await page.keyboard.type(s.type, { delay: slow ? 90 : 20 });
    else if (s.press) await page.keyboard.press(s.press);
    else if (s.waitFor) await page.locator(s.waitFor).first().waitFor({ state: "visible", timeout: 20_000 });
    else if (s.reload) { await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(800); }
    if (s.wait) await page.waitForTimeout(s.wait);
    await page.waitForTimeout(slow ? 450 : 150);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}
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
const BASE = opt("base") ?? `http://localhost:${WEB_PORT}`;
const out = resolve(opt("out") ?? join(tmpdir(), "control-scout-shots", new Date().toISOString().replace(/[:.]/g, "-")));
if (out.startsWith(resolve(process.cwd()))) { console.error("Refusing to write screenshots inside the repository — use --out outside it."); process.exit(1); }
// Default desktop; --mobile = phone only; --both = desktop + phone.
const viewports: ("desktop" | "mobile" | "wide")[] = flag("wide") ? ["wide"] : flag("both") ? ["desktop", "mobile"] : flag("mobile") ? ["mobile"] : ["desktop"];
// --storage file.json: localStorage to seed before the page loads ({ key: value }; non-string values are
// JSON-encoded), e.g. a populated shortlist: { "cs-personal:bookmarks": { "value": [18360], "updatedAt": 1 } }.
const STORAGE: Record<string, string> = (() => {
  const f = opt("storage");
  if (!f) return {};
  const raw = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
})();
const SIZES = { desktop: { width: 1440, height: 900 }, wide: { width: 2200, height: 1240 }, mobile: { width: 390, height: 844 } } as const;


async function capture(browser: Browser, route: string, vp: keyof typeof SIZES, light: boolean): Promise<string> {
  // Still by default (stable shots); --motion / --pointer / --video show animation as users see it.
  const videoSecs = VIDEO_SECS;
  const motion = flag("motion") || flag("pointer") || videoSecs > 0;
  const ctx = await browser.newContext({
    viewport: SIZES[vp], deviceScaleFactor: videoSecs ? 1 : 2, colorScheme: light ? "light" : "dark", isMobile: vp === "mobile", hasTouch: vp === "mobile",
    reducedMotion: motion ? "no-preference" : "reduce",
    ...(videoSecs ? { recordVideo: { dir: out, size: SIZES[vp] } } : {}),
  });
  if (COOKIE) {
    const host = new URL(BASE).hostname;
    if (!["localhost", "127.0.0.1"].includes(host)) { console.error("--cookie-file only works against a localhost base"); process.exit(1); }
    await ctx.addCookies([{ name: COOKIE.name, value: COOKIE.value, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
  }
  if (Object.keys(STORAGE).length) await ctx.addInitScript((entries) => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, STORAGE);
  // The first-visit privacy banner would sit on every shot: answer it ("No thanks") unless --banner asks to see it.
  if (!flag("banner") && !("cs-consent" in STORAGE)) await ctx.addInitScript(() => localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })));
  if (light) await ctx.addInitScript(() => localStorage.setItem("cs-personal:settings", JSON.stringify({ value: { theme: "light", density: "comfortable", notify: {} }, updatedAt: 1 })));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });
  // Data loaded: no skeletons left, fonts ready, then let charts/motion settle.
  await page.waitForFunction(() => !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 45_000 }).catch(() => console.warn(`  ! ${route}: still loading after 45 s`));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  // --search "text": focus the top-bar search (⌘K), type, and wait for results.
  const q = opt("search");
  if (q) {
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search teams, events and matches" }).waitFor({ state: "visible" });
    await page.keyboard.type(q, { delay: 60 });
    await page.waitForFunction(() => !document.body.innerText.includes("Searching…"), null, { timeout: 15_000 });
    await page.waitForTimeout(600);
  }
  // --steps: interactions (a dialog open, a filter built…); a video records them as they happen.
  if (STEPS.length) await runSteps(page, videoSecs > 0);
  // --pointer: rest the mouse mid-page (hover effects, the ambient light).
  if (flag("pointer") && vp !== "mobile") { await page.mouse.move(SIZES[vp].width * 0.6, SIZES[vp].height * 0.35, { steps: 12 }); await page.waitForTimeout(500); }
  // --video N: record N seconds while the pointer glides across the page.
  if (videoSecs) {
    const { width, height } = SIZES[vp];
    const t0 = Date.now();
    let i = 0;
    while (!STEPS.length && Date.now() - t0 < videoSecs * 1000) {
      const a = (i++ / 60) * Math.PI * 2;
      await page.mouse.move(width * (0.5 + 0.3 * Math.cos(a)), height * (0.45 + 0.25 * Math.sin(a * 2)), { steps: 4 });
      await page.waitForTimeout(40);
    }
    const video = page.video();
    await ctx.close();
    const tmp = await video!.path();
    const file = join(out, `${vp}${light ? "-light" : ""}${q ? `-search-${q.replace(/[^\w]+/g, "_")}` : ""}${LABEL}-video-${slug(route)}.webm`);
    renameSync(tmp, file);
    if (errors.length) console.warn(`  ! ${route}: page errors: ${errors.join(" | ")}`);
    return file;
  }
  // The shell scrolls inside <main> (h-dvh, absolutely positioned over the
  // ambient layer); unroll it and put <main> back in normal flow so the page
  // content gives the shell its height and a full-page shot shows everything.
  const full = !flag("viewport") && !q && !flag("pointer") && !STEPS.length;
  if (full) await page.addStyleTag({ content: ".h-dvh{height:auto!important;overflow:visible!important} main#main{overflow:visible!important;position:relative!important;inset:auto!important} .h-dvh{position:relative!important} nav.fixed{position:absolute!important;left:0;right:0;bottom:0}" });
  const name = `${vp}${light ? "-light" : ""}${flag("pointer") ? "-pointer" : ""}${q ? `-search-${q.replace(/[^\w]+/g, "_")}` : ""}${LABEL}-${slug(route)}.png`;
  const file = join(out, name);
  await page.screenshot({ path: file, fullPage: full });
  if (errors.length) console.warn(`  ! ${route}: page errors: ${errors.join(" | ")}`);
  await ctx.close();
  return file;
}

try {
  if (!routes.length) { console.error("Give at least one route, e.g. npm run shots -- /teams/18360"); process.exit(1); }
  mkdirSync(out, { recursive: true });
  await ensureServers(BASE, !!opt("base"));
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
  stopServers();
}
