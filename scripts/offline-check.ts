// Offline journeys, measured the same way every time (the offline + Lite brief, journeys 1–4, 6, 12):
//
//   npm run offline:check -- --base https://controlscout.org --event 2026:USMIMIQ1
//   npm run offline:check -- --base https://controlscout.org --event 2026:USMIMIQ1 --season   # also save the season pack
//   npm run offline:check -- … --json out.json
//
// A 390×844 phone (touch, 3× scale). Online: open Home so the service worker installs and controls the page,
// then download the event's pack from /download (and with --season the season's file). Then the network goes
// off (Playwright's offline switch: every request fails, as on a phone with Wi-Fi and data off) and each page
// opens by a full navigation, as a tap from the home screen would. A page counts as open when its content is on
// screen: no skeleton and no busy region left, and the main area holds text. Each page reports its time in ms
// and what it showed (ok / "needs connection" / blank), and the run prints the sizes the device keeps.
import { chromium, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";

/**
 * The network, as the phone sees it: every request (the page's, and the service worker's own, which Playwright's
 * offline switch doesn't reach) goes through this local proxy. "online" tunnels to the site; "offline" drops each
 * connection at once (Wi-Fi and data off); (A captive portal mode comes with the detection work.)
 */
let mode: "online" | "offline" = "online";
const live = new Set<Socket>();
function startProxy(): Promise<number> {
  const server = createServer((client) => {
    live.add(client);
    client.on("close", () => live.delete(client));
    client.once("data", (head) => {
      if (mode === "offline") return client.destroy();
      const m = /^CONNECT ([^:\s]+):(\d+)/.exec(head.toString("latin1"));
      if (!m) return client.destroy();
      const upstream = createConnection({ host: m[1], port: Number(m[2]) }, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(client); client.pipe(upstream);
      });
      live.add(upstream);
      upstream.on("close", () => live.delete(upstream));
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    });
  });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res((server.address() as { port: number }).port)));
}
function goOffline() { mode = "offline"; for (const s of live) s.destroy(); live.clear(); }

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (f: string) => args.includes(`--${f}`);
const BASE = (opt("base") ?? "http://localhost:3000").replace(/\/$/, "");
const [SEASON, CODE] = (opt("event") ?? "2026:USMIMIQ1").split(":");
const OUT = opt("json");
const SHOTS = opt("shots");

interface Row { page: string; url: string; ms: number; state: string; note?: string }

async function settle(page: Page, timeout = 15_000): Promise<{ ms: number; state: string; note?: string }> {
  const t0 = Date.now();
  try {
    await page.waitForFunction(() => {
      const main = document.querySelector("main") ?? document.body;
      const busy = document.querySelector(".skeleton, [data-slot=skeleton], [aria-busy=true]");
      return !busy && (main.textContent ?? "").trim().length > 60;
    }, null, { timeout, polling: 16 });
  } catch {
    return { ms: Date.now() - t0, state: "timeout", note: ((await page.locator("main").textContent().catch(() => "")) ?? "").trim().slice(0, 120) };
  }
  const text = ((await page.locator("main").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
  const bad = /needs a connection|can't reach|couldn't load|you're offline\.|something went wrong|not available offline/i.exec(text);
  return { ms: Date.now() - t0, state: bad ? "error" : "ok", ...(bad ? { note: text.slice(Math.max(0, bad.index - 40), bad.index + 100) } : {}) };
}

async function open(page: Page, url: string): Promise<{ ms: number; state: string; note?: string }> {
  const t0 = Date.now();
  try { await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 15_000 }); }
  catch (e) { return { ms: Date.now() - t0, state: "no-page", note: String(e).slice(0, 120) }; }
  const r = await settle(page);
  return { ...r, ms: Date.now() - t0 };
}

async function main() {
  const port = await startProxy();
  const browser = await chromium.launch({ proxy: { server: `http://127.0.0.1:${port}` } });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "allow" });
  await ctx.addInitScript(() => localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })));
  const page = await ctx.newPage();

  // Online: install the service worker, and learn the event's teams and a match.
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload({ waitUntil: "load" });
  const ev = await page.evaluate(async ([s, c]) => (await fetch(`/api/events/${s}/${c}`)).json(), [SEASON, CODE]) as { field?: { number: number }[]; matches?: { key: string; played: boolean; red: { teams: { number: number }[] }; blue: { teams: { number: number }[] } }[] };
  const teams = (ev.field ?? []).map((t) => t.number);
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

  // Offline.
  goOffline();
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
    const r = await open(page, url);
    rows.push({ page: name, url, ...r });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name.replace(/\W+/g, "-").toLowerCase()}.png`, scale: "css" }).catch(() => {});
    console.log(`${name.padEnd(12)} ${String(r.ms).padStart(6)} ms  ${r.state}${r.note ? `  — ${r.note}` : ""}`);
  }
  await browser.close();
  if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, event: `${SEASON}:${CODE}`, at: new Date().toISOString(), sizes, rows }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
