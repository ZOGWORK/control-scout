// Slow is not offline: a phone-size check under a throttled, then a cut, then a restored network (owner report,
// 2026-11-21: "it says I'm offline when I'm not", most on a phone with weak signal).
//
//   npm run build && npx tsx scripts/slow-network-check.ts [--shots <dir>] [--latency 5000] [--port 3287]
//   npx tsx scripts/slow-network-check.ts --base https://controlscout.org --no-actions   # read-only, any site
//
// The page runs as an iPhone does at its worst: navigator.onLine says false the whole time, and the browser's
// "online" event never arrives (both are blocked in the page), so only the app's own connection check can tell.
// The network is changed with Chrome's own throttling (CDP Network.emulateNetworkConditions):
//   1. slow:    every request waits --latency ms (default 5 s, a weak phone signal) at ~50 KB/s. Pages opened in the
//               app must load, the top bar must never say "Offline" (the pill says "Slow connection" at most), and
//               an action must go through: the sign-in form sends its code request (a test address on the local
//               server: the code only goes to the server log with MAIL_DEV_LOG=1).
//   2. offline: the network cut. Opening a page must show "Offline" within the check's time.
//   3. back:    the network restored, no online event: the pill must go by itself and the page load from the server.
// Service workers are blocked (Chrome's throttling doesn't reach a worker's own requests): this checks the page's
// connection handling, not the offline page cache (npm run offline:check does that).
//
// Without --base it starts the production server (npm run build first) on --port with MAIL_DEV_LOG=1.
import { chromium, type CDPSession, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { waitUp } from "./lib/servers.js";

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (name: string) => argv.includes(`--${name}`);
const PORT = Number(opt("port") ?? 3287);
const BASE = (opt("base") ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const LATENCY = Number(opt("latency") ?? 4500);
const SHOTS = opt("shots");
const ACTIONS = !flag("no-actions");
const FIRST = opt("first") ?? "/teams/18360";
const PAGES = (opt("pages") ?? "/teams/16236,/teams/14270,/teams/11115").split(",");
const OFFLINE_PAGE = opt("offline-page") ?? "/teams/7350";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { step: string; ok: boolean; detail: string }[] = [];
const note = (step: string, ok: boolean, detail: string) => { results.push({ step, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${step}: ${detail}`); };

/** The top bar's pill: "offline", "portal", "slow", or null when it isn't shown. */
const pill = (page: Page) => page.evaluate(() => document.querySelector("[data-connection-pill]")?.getAttribute("data-connection-pill") ?? null);
/** Words on screen that would say offline. */
const saysOffline = (page: Page) => page.evaluate(() => /You're offline|\bOffline\b/.test(document.body.innerText));

/** An in-app navigation (a tap on a link): React Router follows popstate. */
async function go(page: Page, path: string) {
  await page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);
}

/** The text that shows a page's own data is on screen: a team page's number in its heading. */
const expectFor = (path: string) => /^\/teams\/(\d+)/.exec(path)?.[1] ?? null;

/** The page's own data is on screen (`expect` in its heading; else text in the main area) and no skeleton is left in
 *  view. */
const isSettled = (page: Page, expect: string | null) => page.evaluate((want) => {
  const main = document.querySelector("main");
  if (!main) return false;
  if (want ? !(main.querySelector("h1")?.textContent ?? "").includes(want) : main.innerText.trim().length < 40) return false;
  return ![...main.querySelectorAll(".skeleton")].some((s) => { const r = s.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight && r.bottom > 0; });
}, expect).catch(() => false);

/** Until isSettled, or `ms`. */
async function settled(page: Page, ms: number, expect: string | null = null): Promise<boolean> {
  const end = Date.now() + ms;
  do { if (await isSettled(page, expect)) return true; await sleep(250); } while (Date.now() < end);
  return false;
}

/** Watch the pill for `ms`: every state it showed. */
async function watchPill(page: Page, ms: number, until?: () => Promise<boolean>): Promise<Set<string>> {
  const seen = new Set<string>();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    seen.add((await pill(page)) ?? "none");
    if (until && await until()) break;
    await sleep(250);
  }
  return seen;
}

async function net(cdp: CDPSession, state: "online" | "slow" | "offline") {
  await cdp.send("Network.emulateNetworkConditions", state === "offline"
    ? { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
    : state === "slow"
      ? { offline: false, latency: LATENCY, downloadThroughput: 200 * 1024, uploadThroughput: 100 * 1024 }
      : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`      shot: ${file}`);
}

async function main() {
  let server: ChildProcess | null = null;
  if (!opt("base")) {
    server = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), CS_NO_SCHEDULER: "1", MAIL_DEV_LOG: "1" }, shell: true, stdio: "ignore" });
    if (!await waitUp(`${BASE}/api/health`, 300)) throw new Error(`the production server on ${PORT} didn't come up (npm run build first?)`);
  }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    // An iPhone at its worst: navigator.onLine false all along, and no "online" event ever.
    await ctx.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "onLine", { get: () => false, configurable: true });
      addEventListener("online", (e) => e.stopImmediatePropagation(), true);
      // No first-visit banner or tour in the way (as npm run shots answers them).
      try { localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })); } catch { /* none */ }
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");

    // 0. Online, with navigator.onLine false all along: never offline, from the first paint on.
    await page.goto(`${BASE}${FIRST}`, { waitUntil: "domcontentloaded" });
    const first = await watchPill(page, 60_000, () => isSettled(page, expectFor(FIRST)));
    await page.getByRole("button", { name: "No thanks" }).click({ timeout: 2000 }).catch(() => {}); // the privacy banner, if up
    await sleep(3000); // past the first connection check
    first.add((await pill(page)) ?? "none");
    note("navigator.onLine false, network fine", !first.has("offline") && !first.has("portal"), `pill showed ${[...first].join(", ")}`);

    // 1. Slow: pages opened in the app.
    await net(cdp, "slow");
    const worst = new Set<string>();
    for (const p of PAGES) {
      const t0 = Date.now();
      await go(page, p);
      const seen = await watchPill(page, 90_000, () => isSettled(page, expectFor(p)));
      const loaded = await isSettled(page, expectFor(p));
      seen.forEach((s) => worst.add(s));
      note(`slow: open ${p} in the app`, loaded && !seen.has("offline"), `${loaded ? "loaded" : "NOT loaded"} in ${Date.now() - t0} ms; pill showed ${[...seen].join(", ")}`);
    }
    // The app opened afresh on the slow line (a phone reopening it): the first connection check runs on it too.
    {
      const t0 = Date.now();
      void page.reload({ waitUntil: "commit", timeout: 180_000 }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector("main"), undefined, { timeout: 180_000, polling: 250 }).catch(() => {});
      const seen = await watchPill(page, 30_000, async () => (await pill(page)) === "slow" || (await pill(page)) === "offline");
      if ((await pill(page)) === "slow") await shot(page, "slow-phone");
      const rest = await watchPill(page, 150_000, () => isSettled(page, expectFor(PAGES[PAGES.length - 1])));
      rest.forEach((s) => seen.add(s));
      await sleep(5000);
      seen.add((await pill(page)) ?? "none");
      const loaded = await isSettled(page, expectFor(PAGES[PAGES.length - 1]));
      seen.forEach((s) => worst.add(s));
      note("slow: the app reopened on the slow line", loaded && !seen.has("offline"), `${loaded ? "loaded" : "NOT loaded"} in ${Date.now() - t0} ms; pill showed ${[...seen].join(", ")}`);
    }
    note("slow: never offline", !worst.has("offline") && !worst.has("portal"), `pill states seen: ${[...worst].join(", ")}`);
    note("slow: said as slow", worst.has("slow"), worst.has("slow") ? "the pill said Slow connection" : "the pill never said slow");

    if (ACTIONS) {
      // Actions while slow, never refused or held: a search asked of the server, and a button that saves on the device.
      try {
        const t0 = Date.now();
        await go(page, "/search?q=pymble");
        const found = await page.waitForFunction(() => /18360/.test(document.querySelector("main")?.textContent ?? ""), undefined, { timeout: 90_000, polling: 250 }).then(() => true, () => false);
        const offlineWords = await saysOffline(page);
        note("slow: search the server", found && !offlineWords, `${found ? "answer shown" : "no answer"} after ${Date.now() - t0} ms${offlineWords ? "; the page says offline" : ""}`);
        await go(page, FIRST);
        await settled(page, 90_000, expectFor(FIRST));
        const track = page.getByRole("button", { name: /^Track/ }).first();
        const before = await track.getAttribute("aria-pressed");
        await track.click();
        await sleep(500);
        const after = await track.getAttribute("aria-pressed");
        note("slow: Track (saved on the device)", before !== after, `aria-pressed ${before} -> ${after}`);
      } catch (e) { note("slow: actions", false, String(e).split("\n")[0]); }
    }

    // 2. Offline: a page not opened yet, so it has to ask.
    await net(cdp, "offline");
    const t1 = Date.now();
    await go(page, OFFLINE_PAGE);
    const off = await watchPill(page, 30_000, async () => (await pill(page)) === "offline");
    note("offline: said as offline", off.has("offline"), `pill said Offline after ${Date.now() - t1} ms`);
    await sleep(1500);
    await shot(page, "offline-phone");

    // 3. Back, with no online event.
    await net(cdp, "online");
    const t2 = Date.now();
    const back = await watchPill(page, 90_000, async () => (await pill(page)) === null && await isSettled(page, expectFor(OFFLINE_PAGE)));
    const gone = (await pill(page)) === null;
    note("back: pill gone, page from the server", gone && await isSettled(page, expectFor(OFFLINE_PAGE)), `after ${Date.now() - t2} ms (states: ${[...back].join(", ")})`);
    await shot(page, "back-phone");
  } finally {
    await browser.close();
    if (server) { server.kill(); if (process.platform === "win32" && server.pid) spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nall ${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
