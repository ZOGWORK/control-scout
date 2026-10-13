// Performance measurements, always taken the same way (Sushil's task list 2–6):
//
//   npm run perf                              # local production build (npm run build first)
//   npm run perf -- --base https://control-scout.onrender.com
//   npm run perf -- --json out.json            # also write the raw numbers
//   npm run perf -- --budgets                  # exit 1 if any budget is blown
//
// Measures
//   · home: every request (count, bytes, API waterfall depth), JS bytes, and
//     time to interactive (data on screen, no skeletons) on throttled 4G, warm
//   · JS per page: which chunks each route downloads (is vendor-charts lazy?)
//   · API p50/p95 (warm, 15 runs each) for the hot routes
//   · cold start (local only): server launch → first paint of the home page
import { chromium, type Page } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitUp } from "./lib/servers.js";

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
const LOCAL_PORT = 3385;
const external = opt("base");
const BASE = external ?? `http://localhost:${LOCAL_PORT}`;
const SHIM = "globalThis.__name = (f) => f;";

/** Lighthouse's mobile "slow 4G": 150 ms RTT, 1.6 Mbps down, 750 kbps up. */
const FOUR_G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

export const BUDGETS = {
  homeInteractiveMs: 3000, // warm, throttled 4G
  homeDataBytes: 100 * 1024, // all /api responses on the home page, decoded
  apiP95Ms: 300, // warm
  coldStartMs: 20_000, // launch → first paint (local measurement)
};

const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

async function interactive(page: Page) {
  await page.waitForFunction(() => (document.querySelector("main")?.textContent ?? "").trim().length > 80 && !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 60_000 });
}

/** One page load: requests (with decoded sizes and start/end), JS bytes, time to interactive. */
async function loadPage(page: Page, path: string, throttle: boolean) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  if (throttle) await cdp.send("Network.emulateNetworkConditions", FOUR_G);
  const reqs = new Map<string, { url: string; type: string; start: number; end?: number; bytes: number; encoded: number; status?: number }>();
  cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type ?? "", start: e.timestamp, bytes: 0, encoded: 0 }));
  cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) r.status = e.response.status; });
  cdp.on("Network.dataReceived", (e) => { const r = reqs.get(e.requestId); if (r) r.bytes += e.dataLength; });
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.encoded = e.encodedDataLength; } });
  const t0 = Date.now();
  await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await interactive(page);
  const ms = Date.now() - t0;
  await page.waitForTimeout(500);
  await cdp.detach().catch(() => {});
  const all = [...reqs.values()].filter((r) => r.end);
  const api = all.filter((r) => new URL(r.url).pathname.startsWith("/api/"));
  // A page whose data failed is not "interactive": never let a broken API pass as fast.
  const failed = api.filter((r) => (r.status ?? 0) >= 400);
  if (failed.length) throw new Error(`${path}: API failed: ${failed.map((r) => `${new URL(r.url).pathname} → ${r.status}`).join(", ")}`);
  const js = all.filter((r) => /\.js(\?|$)/.test(r.url));
  // Waterfall depth: how many API "rounds" — a call that starts after another finished is a new round.
  let depth = 0, lastEnd = -Infinity;
  for (const r of [...api].sort((a, b) => a.start - b.start)) { if (r.start >= lastEnd) { depth++; lastEnd = r.end!; } else lastEnd = Math.max(lastEnd, r.end!); }
  return {
    ms,
    requests: all.length,
    api: api.map((r) => ({ path: new URL(r.url).pathname + new URL(r.url).search, bytes: r.bytes, encoded: r.encoded })),
    apiBytes: api.reduce((n, r) => n + r.bytes, 0),
    apiEncoded: api.reduce((n, r) => n + r.encoded, 0),
    apiRounds: depth,
    jsBytes: js.reduce((n, r) => n + r.bytes, 0),
    jsFiles: js.map((r) => new URL(r.url).pathname.split("/").pop()!),
  };
}

async function apiTimings(paths: string[], runs = 15) {
  const out: Record<string, { p50: number; p95: number; bytes: number }> = {};
  for (const p of paths) {
    const ts: number[] = []; let bytes = 0;
    await fetch(BASE + p).then((r) => r.arrayBuffer()).catch(() => {}); // warm it
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const r = await fetch(BASE + p);
      const b = await r.arrayBuffer();
      if (!r.ok) throw new Error(`${p} → HTTP ${r.status}; fix the route (or sync the data) before measuring it`);
      ts.push(performance.now() - t0); bytes = b.byteLength;
    }
    out[p] = { p50: Math.round(pct(ts, 50)), p95: Math.round(pct(ts, 95)), bytes };
  }
  return out;
}

type Server = ReturnType<typeof spawn>;

/** A fresh production server on `port` with an empty data dir (it restores the shipped snapshot). Refuses a port that's already serving. */
async function startServer(port: number): Promise<Server> {
  if (await fetch(`http://localhost:${port}/api/health`).then(() => true, () => false)) throw new Error(`port ${port} is already serving (a leftover server?); stop it first`);
  const dir = mkdtempSync(join(tmpdir(), "cs-perf-"));
  // detached: its own process group, so stopServer can end npx → tsx → node together.
  return spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: String(port), CS_NO_SCHEDULER: "1", CS_SKIP_DOTENV: "1", DATABASE_URL: `file:${dir}/scout.db`.replace(/\\/g, "/"), DATA_DIR: dir, CS_PACKS: "off" }, shell: true, stdio: "ignore", detached: process.platform !== "win32" });
}

/** Stop the whole server tree and wait until it has exited. */
async function stopServer(s: Server) {
  if (!s.pid || s.exitCode != null) return;
  const exited = new Promise((r) => s.once("exit", r));
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(s.pid), "/T", "/F"], { stdio: "ignore" });
  else try { process.kill(-s.pid, "SIGKILL"); } catch { /* already gone */ }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
}

async function coldStart(): Promise<number | null> {
  if (external) return null; // can't restart a remote host from here
  const port = LOCAL_PORT + 1;
  const t0 = Date.now();
  const srv = await startServer(port);
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.addInitScript(SHIM);
    const deadline = t0 + 120_000;
    for (;;) {
      if (srv.exitCode != null) throw new Error(`cold-start server exited with code ${srv.exitCode} before serving`);
      if (Date.now() > deadline) throw new Error("cold-start server didn't serve the home page within 120 s");
      try { await page.goto(`http://localhost:${port}/`, { waitUntil: "domcontentloaded", timeout: 5000 }); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    await interactive(page);
    const ms = Date.now() - t0;
    await browser.close();
    return ms;
  } finally {
    await stopServer(srv);
  }
}

let srv: Server | null = null;
try {
  if (!external) srv = await startServer(LOCAL_PORT);
  if (!(await waitUp(`${BASE}/api/health`, 300))) throw new Error(`${BASE} didn't become ready`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(SHIM);
  const page = await ctx.newPage();
  await loadPage(page, "/", false); // warm the server and the HTTP cache
  const home = await loadPage(page, "/", true); // warm, throttled 4G
  // First visit: empty cache, throttled 4G — the honest number for a new visitor.
  const firstCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await firstCtx.addInitScript(SHIM);
  const first = await loadPage(await firstCtx.newPage(), "/", true);
  await firstCtx.close();
  const pages: Record<string, { jsBytes: number; charts: boolean }> = {};
  for (const p of ["/", "/teams/18360", "/events/2025/AUBRQ2", "/predict/accuracy"]) {
    const fresh = await (await browser.newContext()).newPage();
    await fresh.addInitScript(SHIM);
    const r = await loadPage(fresh, p, false);
    pages[p] = { jsBytes: r.jsBytes, charts: r.jsFiles.some((f) => /^(vendor-)?charts?-/.test(f)) };
    await fresh.context().close();
  }
  const api = await apiTimings(["/api/meta", "/api/teams/4215", "/api/teams/18360", "/api/search?q=4215&limit=15", "/api/search?q=X%20Drvie&limit=15", "/api/events?season=2026", "/api/events/2025/AUBRQ2", "/api/teams/18360/matches?season=2025", "/api/predict/accuracy"]);
  await browser.close();
  const cold = await coldStart();

  const result = { base: BASE, at: new Date().toISOString(), home, homeFirstVisit: first, pages, api, coldStartMs: cold };
  console.log(`\n${BASE}`);
  console.log(`home (warm, throttled 4G, 390px): interactive ${home.ms} ms · ${home.requests} requests · API ${home.api.length} calls, ${kb(home.apiBytes)} decoded (${kb(home.apiEncoded)} on the wire), ${home.apiRounds} round(s) · JS ${kb(home.jsBytes)}`);
  for (const a of home.api) console.log(`    ${a.path}  ${kb(a.bytes)}`);
  console.log(`home (first visit, empty cache, throttled 4G): interactive ${first.ms} ms · JS ${kb(first.jsBytes)}`);
  console.log("JS per page (cold cache):");
  for (const [p, v] of Object.entries(pages)) console.log(`    ${p.padEnd(24)} ${kb(v.jsBytes).padStart(9)}  charts chunk: ${v.charts ? "yes" : "no"}`);
  console.log("API, warm (15 runs): p50 / p95 / size");
  for (const [p, v] of Object.entries(api)) console.log(`    ${p.padEnd(40)} ${String(v.p50).padStart(5)} / ${String(v.p95).padStart(5)} ms  ${kb(v.bytes)}`);
  console.log(`cold start (launch → home interactive, local): ${cold == null ? "n/a (remote)" : `${cold} ms`}`);
  const json = opt("json");
  if (json) writeFileSync(json, JSON.stringify(result, null, 2));

  if (args.includes("--budgets")) {
    const fails: string[] = [];
    if (home.ms > BUDGETS.homeInteractiveMs) fails.push(`home interactive ${home.ms} ms > ${BUDGETS.homeInteractiveMs}`);
    if (home.apiBytes > BUDGETS.homeDataBytes) fails.push(`home data ${kb(home.apiBytes)} > ${kb(BUDGETS.homeDataBytes)}`);
    for (const [p, v] of Object.entries(api)) if (v.p95 > BUDGETS.apiP95Ms) fails.push(`${p} p95 ${v.p95} ms > ${BUDGETS.apiP95Ms}`);
    if (cold != null && cold > BUDGETS.coldStartMs) fails.push(`cold start ${cold} ms > ${BUDGETS.coldStartMs}`);
    if (pages["/"]?.charts) fails.push("home downloads the charts chunk");
    console.log(fails.length ? `\nBUDGETS BLOWN:\n  ${fails.join("\n  ")}` : "\nAll budgets met.");
    process.exitCode = fails.length ? 1 : 0;
  }
} finally {
  if (srv) await stopServer(srv);
}
