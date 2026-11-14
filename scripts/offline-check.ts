// Offline journeys, measured the same way every time (the offline + Lite brief, journeys 1–4, 6, 11, 12):
//
//   npm run offline:check -- --base https://controlscout.org --event 2026:USMIMIQ1
//   npm run offline:check -- --prod --event 2025:USMIMIQ1          # the local production build (npm run build first)
//   npm run offline:check -- … --season        # also save the season pack
//   npm run offline:check -- … --dead          # a Wi-Fi that connects but carries nothing
//   npm run offline:check -- … --portal        # a Wi-Fi sign-in page instead of no network
//   npm run offline:check -- … --throttle      # a slow connection (~400 kbps, 400 ms round trip) instead
//   npm run offline:check -- … --json out.json --shots <dir>
//
// A 390×844 phone (touch, 3× scale). Online: open Home so the service worker installs and controls the page, then
// download the event's pack from /download (and with --season the season's file). Then the network changes (below) and
// each page opens by a full navigation, as a tap from the home screen would. A page counts as open when its content is
// on screen: no skeleton and no busy region left, and the main area holds text. Each page reports its time in ms and
// what it showed (ok / "needs connection" / blank), and the run prints the sizes the device keeps and what the top
// bar's Offline pill said.
//
// --prod starts the production server on AUDIT_PROD_PORT (scripts/lib/servers.ts, default 3299) like audit:flows'
// venue check, from the build in dist/ and the local data in .data/.
import { chromium, type Page } from "playwright";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { Transform } from "node:stream";
import { PROD_PORT, waitUp } from "./lib/servers.js";

/**
 * The network, as the phone sees it: every request (the page's, and the service worker's own, which Playwright's
 * offline switch doesn't reach) goes through this local proxy, localhost included.
 *   online:   passes everything through.
 *   offline:  drops each connection at once (Wi-Fi and data off).
 *   dead:     accepts each connection and never answers (a Wi-Fi that connects but carries nothing).
 *   portal:   a Wi-Fi that wants a sign-in first. Plain-HTTP API and pack requests get the sign-in page (HTML, 200);
 *             anything else is dropped (an HTTPS site can't be answered by a portal without a certificate, so its
 *             requests fail, and so does a page load here: the service worker then opens the app from its cache).
 *   throttle: passes everything through at ~THROTTLE_KBPS, each request or tunnel waiting THROTTLE_RTT_MS first.
 */
type Mode = "online" | "offline" | "dead" | "portal" | "throttle";
let mode: Mode = "online";
const THROTTLE_KBPS = 400;
const THROTTLE_RTT_MS = 400;
const live = new Set<Socket>();
const PORTAL_PAGE = "<!doctype html><html><head><title>Venue Wi-Fi</title></head><body><h1>Welcome to Venue Wi-Fi</h1><p>Accept the terms to get online.</p></body></html>";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Paces a stream to THROTTLE_KBPS (only while throttling). */
function pace(): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (mode !== "throttle") return done(null, chunk);
      const ms = (chunk.length * 8) / THROTTLE_KBPS; // bits / (kbit/s) = ms
      setTimeout(() => done(null, chunk), ms);
    },
  });
}

function track(s: Socket) { live.add(s); s.on("close", () => live.delete(s)); }

async function onRequest(req: IncomingMessage, res: ServerResponse) {
  track(req.socket);
  const url = new URL(req.url ?? "/", "http://invalid");
  if (mode === "offline") return req.socket.destroy();
  if (mode === "dead") return;
  if (mode === "portal") {
    if (/^\/(api|packs)\//.test(url.pathname)) { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); return res.end(PORTAL_PAGE); }
    return req.socket.destroy();
  }
  if (mode === "throttle") await sleep(THROTTLE_RTT_MS);
  const up = httpRequest({ host: url.hostname, port: url.port || 80, method: req.method, path: url.pathname + url.search, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(pace()).pipe(res);
  });
  up.on("error", () => req.socket.destroy());
  req.pipe(up);
}

function onConnect(req: IncomingMessage, client: Socket, head: Buffer) {
  track(client);
  if (mode === "offline") return client.destroy();
  if (mode === "dead") return;
  if (mode === "portal") { client.end("HTTP/1.1 302 Found\r\nLocation: http://portal.invalid/\r\nContent-Length: 0\r\n\r\n"); return; }
  const [host, port] = (req.url ?? "").split(":");
  const start = async () => {
    if (mode === "throttle") await sleep(THROTTLE_RTT_MS);
    const upstream = netConnect({ host, port: Number(port) || 443 }, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(pace()).pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  };
  void start();
}

function startProxy(): Promise<number> {
  const server = createServer(onRequest);
  server.on("connect", onConnect);
  server.on("clientError", (_e, s) => s.destroy());
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res((server.address() as { port: number }).port)));
}
function setMode(m: Mode) { mode = m; for (const s of live) s.destroy(); live.clear(); }

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (f: string) => args.includes(`--${f}`);
const PROD = flag("prod");
const BASE = (opt("base") ?? (PROD ? `http://localhost:${PROD_PORT}` : "http://localhost:3000")).replace(/\/$/, "");
const [SEASON, CODE] = (opt("event") ?? "2026:USMIMIQ1").split(":");
const OUT = opt("json");
const SHOTS = opt("shots");
const AFTER: Mode = flag("dead") ? "dead" : flag("portal") ? "portal" : flag("throttle") ? "throttle" : "offline";

interface Row { page: string; url: string; ms: number; state: string; note?: string; pill?: string }

async function settle(page: Page, timeout = 15_000): Promise<{ ms: number; state: string; note?: string }> {
  const t0 = Date.now();
  try {
    await page.waitForFunction(() => {
      const main = document.querySelector("main") ?? document.body;
      // A static first paint of another page (the service worker's cached Home, opened in this page's place) isn't
      // this page: wait for the app to draw it.
      const boot = document.getElementById("cs-boot-page");
      if (boot && boot.getAttribute("data-path") !== location.pathname) return false;
      const busy = document.querySelector(".skeleton, [data-slot=skeleton], [aria-busy=true]");
      // The page's own words, not the site footer's (always there).
      const footer = main.querySelector("footer")?.textContent ?? "";
      return !busy && ((main.textContent ?? "").length - footer.length) > 60;
    }, null, { timeout, polling: 16 });
  } catch {
    return { ms: Date.now() - t0, state: "timeout", note: ((await page.locator("main").textContent().catch(() => "")) ?? "").trim().slice(0, 120) };
  }
  const text = ((await page.locator("main").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").replace(/’/g, "'");
  const bad = /needs a connection|can't reach|couldn't load|you're offline|no internet on this wi-fi|something went wrong|not available offline/i.exec(text);
  return { ms: Date.now() - t0, state: bad ? "error" : "ok", ...(bad ? { note: text.slice(Math.max(0, bad.index - 40), bad.index + 100) } : {}) };
}

async function open(page: Page, url: string): Promise<{ ms: number; state: string; note?: string }> {
  const t0 = Date.now();
  try { await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 15_000 }); }
  catch (e) { return { ms: Date.now() - t0, state: "no-page", note: String(e).slice(0, 120) }; }
  const r = await settle(page);
  return { ...r, ms: Date.now() - t0 };
}

/** What the top bar's Offline pill (or the old badge) says, if anything. */
async function pillText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector("[data-connection-pill]") ?? document.querySelector("header [role=status] a");
    return (el?.getAttribute("aria-label") ?? el?.textContent ?? "").trim();
  }).catch(() => "");
}

let server: ChildProcess | null = null;
function stopServer() {
  if (!server) return;
  if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
  server = null;
}

async function main() {
  if (PROD) {
    server = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: String(PROD_PORT), CS_NO_SCHEDULER: "1" }, shell: true, stdio: "ignore" });
    if (!(await waitUp(`${BASE}/api/health`, 420))) throw new Error(`the production server on ${BASE} didn't become ready (npm run build first)`);
  }
  const port = await startProxy();
  // Loopback through the proxy too (Chromium skips the proxy for localhost unless told otherwise).
  const browser = await chromium.launch({ proxy: { server: `http://127.0.0.1:${port}`, bypass: "<-loopback>" } });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "allow" });
  await ctx.addInitScript(() => localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })));
  let page = await ctx.newPage();

  // Online: install the service worker, and learn the event's teams and a match.
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload({ waitUntil: "load" });
  const ev = await page.evaluate(async ([s, c]) => (await fetch(`/api/events/${s}/${c}`)).json(), [SEASON, CODE]) as { field?: { team?: number; number?: number }[]; matches?: { key: string; played: boolean; red: { teams: { number: number }[] }; blue: { teams: { number: number }[] } }[] };
  const teams = (ev.field ?? []).map((t) => (t.team ?? t.number) as number).filter(Boolean);
  const played = (ev.matches ?? []).filter((m) => m.played);
  const match = played[Math.floor(played.length / 2)] ?? ev.matches?.[0];
  const four = match ? [...match.red.teams, ...match.blue.teams].map((t) => t.number).slice(0, 4) : teams.slice(0, 4);
  console.log(`Event ${SEASON}:${CODE}: ${teams.length} teams, ${ev.matches?.length ?? 0} matches; match ${match?.key}; teams ${four.join(", ")}`);

  // Download what the app offers for this event.
  const dl0 = Date.now();
  await page.goto(`${BASE}/download?event=${SEASON}:${CODE}`, { waitUntil: "load" });
  const bundleBtn = page.locator("[data-bundle-download]");
  let bundleNote = "no event bundle offered";
  if (await bundleBtn.waitFor({ timeout: 20_000 }).then(() => true, () => false)) {
    bundleNote = (await bundleBtn.textContent()) ?? "";
    await bundleBtn.click();
    await page.getByText("On this device and current").waitFor({ timeout: 60_000 }).catch(() => { bundleNote += " (did not finish)"; });
  }
  if (flag("season")) {
    const row = page.locator("li").filter({ hasText: "This season" }).first();
    await row.getByRole("button", { name: /Save offline/ }).click({ timeout: 30_000 }).catch(() => console.log("  ! no Save offline button for the season"));
    await row.getByRole("button", { name: /Remove/ }).waitFor({ timeout: 300_000 }).catch(() => console.log("  ! season save did not finish"));
  }
  const getLite = page.getByRole("button", { name: /Get it now/ });
  if (await getLite.isVisible().catch(() => false)) { await getLite.click(); await page.waitForTimeout(8000); }
  const sizes = await page.evaluate(async () => {
    const est = await navigator.storage?.estimate?.();
    return { usage: est?.usage ?? null, bundles: localStorage.getItem("cs-event-bundles"), saved: localStorage.getItem("cs-offline-seasons"), lite: localStorage.getItem("cs-pack-meta") };
  });
  console.log(`Downloads took ${Date.now() - dl0} ms. ${bundleNote.trim()}`);
  console.log(`Storage in use: ${sizes.usage != null ? (sizes.usage / 1048576).toFixed(2) + " MB" : "?"}`);

  setMode(AFTER);
  console.log(`Network: ${AFTER}`);
  const pages: [string, string][] = [
    ["Home", "/"],
    ["Event", `/events/${SEASON}/${CODE}`],
    ["Team", `/teams/${four[0]}`],
    ["Match", match ? `/events/${SEASON}/${CODE}/match/${encodeURIComponent(match.key)}` : `/events/${SEASON}/${CODE}`],
    ["Predict", `/predict?red=${four.slice(0, 2).join(",")}&blue=${four.slice(2, 4).join(",")}&season=${SEASON}`],
    ["Compare", `/compare?teams=${four.join(",")}&season=${SEASON}`],
    ["Search 4215", "/search?q=4215"],
    ["Search team", `/search?q=${four[0]}`],
    ["Search vs", `/search?q=${encodeURIComponent(four.slice(0, 3).join(" vs "))}`],
    ["Rankings", "/rankings"],
    ["Scout", "/scout"],
  ];
  const rows: Row[] = [];
  for (const [name, url] of pages) {
    // A page that never loaded (a dead network) can leave the tab unusable: each journey gets a fresh one if so.
    if (page.isClosed()) page = await ctx.newPage();
    const r = await open(page, url);
    // The pill and the offer get a second to settle (the connection check runs as the page draws): not counted in ms.
    await page.waitForTimeout(1000).catch(() => {});
    const pill = await pillText(page);
    // The slow-connection offer must not show with no internet (Lite can't load either).
    const lite = await page.locator("[data-lite-suggest]").count().catch(() => 0);
    rows.push({ page: name, url, ...r, pill, ...(lite ? { note: `${r.note ?? ""} [Lite offer shown]`.trim() } : {}) });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name.replace(/\W+/g, "-").toLowerCase()}.png`, scale: "css" }).catch(() => {});
    console.log(`${name.padEnd(12)} ${String(r.ms).padStart(6)} ms  ${r.state}${r.note ? `  — ${r.note}` : ""}${lite ? "  [Lite offer shown]" : ""}${pill ? `  pill: ${pill}` : ""}`);
  }

  // Back online: the pages refresh by themselves (journey 11).
  if (AFTER !== "throttle") {
    if (page.isClosed()) page = await ctx.newPage();
    await open(page, `/events/${SEASON}/${CODE}`);
    setMode("online");
    const t0 = Date.now();
    const back = await page.waitForFunction(() => !document.querySelector("[data-connection-pill]"), null, { timeout: 45_000, polling: 100 }).then(() => Date.now() - t0, () => null);
    console.log(back != null ? `Back online: the Offline pill went after ${back} ms, with no reload` : "Back online: the Offline pill was still up after 45 s");
  }
  await browser.close();
  if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, event: `${SEASON}:${CODE}`, network: AFTER, at: new Date().toISOString(), sizes, rows }, null, 2));
}

main().then(() => { stopServer(); process.exit(0); }, (e) => { console.error(e); stopServer(); process.exit(1); });
