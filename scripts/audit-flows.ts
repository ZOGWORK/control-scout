// Self-audit click-through (docs/self-audit.md §1): the things a sweep can't
// see — actually using each feature in a real browser on the real servers.
//
//   npm run audit:flows
//
// Each flow prints ✓/✗ with what it checked; any console error/warning or page
// error during a flow fails it. Exit code 1 if anything failed.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WEB_PORT, ensureServers, stopServers, waitUp } from "./lib/servers.js";

const BASE = `http://localhost:${WEB_PORT}`;
const SHIM = "globalThis.__name = (f) => f;"; // tsx's __name helper, absent in the browser
type Flow = { name: string; run: (page: Page, ctx: BrowserContext) => Promise<string> };
const results: { name: string; ok: boolean; detail: string }[] = [];

const ls = (page: Page, key: string) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } }, key);
const valueOf = async (page: Page, key: string) => (await ls(page, `cs-personal:${key}`))?.value;
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

const flows: Flow[] = [
  {
    name: "Search: typo, keyboard navigation, tracked teams rank first",
    async run(page) {
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: "Search teams, events and matches" }).waitFor({ state: "visible" });
      await page.keyboard.type("X Drvie", { delay: 40 });
      await page.getByRole("option", { name: /16321 X Drive/ }).waitFor({ timeout: 10_000 });
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/teams\/16321/);
      // Track 16321, then "16" should put it first (number-prefix matches otherwise sort by number).
      await page.getByRole("button", { name: /^Track$/ }).click();
      assert((await valueOf(page, "tracked"))?.teams?.includes(16321), "Track didn't add 16321");
      const searched: string[] = [];
      page.on("request", (r) => { if (r.url().includes("/api/search")) searched.push(decodeURIComponent(r.url())); });
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: "Search teams, events and matches" }).waitFor({ state: "visible" });
      await page.keyboard.type("16", { delay: 40 });
      await page.waitForTimeout(600);
      assert(searched.some((u) => u.includes("prefer=team:16321")), `search didn't send the tracked team: ${searched.at(-1) ?? "no request"}`);
      await page.getByRole("option").first().waitFor();
      await page.waitForTimeout(800);
      const hits = (await page.getByRole("option").allInnerTexts()).map((t) => t.split("\n")[0]);
      // An exact number match (team 16 exists) rightly comes first; the tracked team leads everything else.
      const rest = hits.filter((h) => !/^16\b/.test(h));
      assert(/16321/.test(rest[0] ?? ""), `after tracking 16321, "16" gave: ${hits.slice(0, 4).join(" | ")}`);
      await page.keyboard.press("Escape");
      return `"X Drvie" → 16321 X Drive via Enter; for "16": exact team 16, then tracked 16321 ahead of other prefix matches`;
    },
  },
  {
    name: "Team page buttons do what they say",
    async run(page) {
      await page.goto(`${BASE}/teams/18360`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Mark as my team/ }).click();
      assert((await valueOf(page, "myTeam")) === 18360, "Mark as my team didn't set myTeam");
      await page.getByRole("button", { name: /^Track$/ }).click();
      assert((await valueOf(page, "tracked"))?.teams?.includes(18360), "Track didn't add 18360");
      await page.getByRole("button", { name: /^Shortlist$/ }).click();
      assert((await valueOf(page, "bookmarks"))?.includes(18360), "Shortlist didn't add 18360");
      assert(await page.getByRole("link", { name: /Manage this team in Control Point/ }).count(), "no Control Point link");
      await page.locator("main").getByRole("link", { name: /Compare/ }).first().click(); // not the sidebar's Compare
      await page.waitForURL(/\/compare\?.*18360/);
      await page.goto(`${BASE}/shortlist`, { waitUntil: "networkidle" });
      await page.getByText("18360").first().waitFor();
      return "my team / track / shortlist stored; Compare opens /compare with 18360; shortlist lists it; Control Point link present";
    },
  },
  {
    name: "Prediction lab: win %, scores, 3 factors, tier",
    async run(page) {
      await page.goto(`${BASE}/predict?red=18360,24089&blue=14380,23636&season=2025`, { waitUntil: "networkidle" });
      await page.getByText(/to win/).first().waitFor();
      const body = await page.locator("main").innerText();
      assert(/\d+%/.test(body) && /Predicted score/.test(body), "no win % / predicted score");
      assert(/(Provisional|Moderate|Confident)/.test(body), "no confidence tier");
      const factors = await page.locator("main ol li").count();
      assert(factors >= 3, `only ${factors} factors`);
      return "win %, predicted scores with ranges, ≥3 factors and a tier shown";
    },
  },
  {
    name: "Advancement simulator: any team + any event",
    async run(page) {
      await page.goto(`${BASE}/events/2025/AUBRQ2?tab=odds&team=19450`, { waitUntil: "networkidle" });
      await page.getByText(/simulated events/).first().waitFor({ timeout: 60_000 });
      const body = await page.locator("main").innerText();
      assert(/(Provisional|Moderate|Confident)/.test(body), "no tier on advancement odds");
      assert(/advance/i.test(body) && /captain/i.test(body), "missing advance/captain odds");
      return "odds for 19450 at AUBRQ2 with advance/captain and a tier";
    },
  },
  {
    name: "Settings: theme, density and background apply immediately",
    async run(page) {
      await page.goto(`${BASE}/settings?section=appearance`, { waitUntil: "networkidle" });
      await page.getByRole("radio", { name: /Light/ }).or(page.getByRole("button", { name: /^Light$/ })).first().click();
      assert(await page.evaluate(() => !document.documentElement.classList.contains("dark")), "still dark after Light");
      await page.getByRole("radio", { name: /Compact/ }).or(page.getByRole("button", { name: /^Compact$/ })).first().click();
      assert(await page.evaluate(() => /compact/.test(document.documentElement.className + " " + (document.documentElement.dataset.density ?? ""))), "density not applied to <html>");
      await page.getByRole("switch", { name: /Animated background/ }).or(page.locator("#ambient")).first().click();
      assert(await page.evaluate(() => document.documentElement.classList.contains("ambient-off")), "ambient-off not applied");
      const sections = await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button").allInnerTexts();
      assert(sections.length === 8, `expected 8 sections, got ${sections.length}: ${sections.join(", ")}`);
      // Every section opens from the list and shows its own body (a group heading inside the section).
      const body: Record<string, string> = {
        "Profile": "Sign in", "Appearance": "Display", "My team & tracking": "My team", "Notifications": "Delivery",
        "Offline data": "Offline pack", "Scouting data": "Your notes", "Account & privacy": "What lives where", "About": "This app",
      };
      const nav = page.getByRole("navigation", { name: "Settings sections" });
      for (const [section, group] of Object.entries(body)) {
        await nav.getByRole("button", { name: section, exact: true }).click();
        await page.getByRole("heading", { name: section, level: 1 }).waitFor({ timeout: 5000 });
        // Profile on a server without sign-in says so instead of showing the Sign in group.
        const own = page.getByRole("heading", { name: group, level: 2, exact: true });
        await (section === "Profile" ? own.or(page.getByText("Sign-in isn't set up on this server")) : own).first().waitFor({ timeout: 5000 });
      }
      return `light theme, compact density and background-off apply instantly; sections: ${sections.join(", ")}`;
    },
  },
  {
    name: "Scouting: create, edit, delete; offline-first; export/import round-trip",
    async run(page, ctx) {
      await page.goto(`${BASE}/scout`, { waitUntil: "networkidle" });
      // In production the service worker precaches every font (see the venue flow);
      // this dev server has no worker, so load them first like a real first visit would.
      await page.evaluate(() => Promise.all(["400", "500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 16px Inter`))));
      await ctx.setOffline(true); // offline-first: saving must not need the network
      await page.getByRole("button", { name: /New entry/ }).click();
      await page.getByLabel("Team", { exact: true }).fill("18360"); // exact: the top-bar search label also says "teams"
      await page.getByLabel("Event code").fill("AUBRQ2");
      await page.getByLabel("Match", { exact: true }).fill("Q1");
      const plus = page.getByRole("button", { name: /plus one/ }).first();
      if (await plus.count()) await plus.click();
      await page.locator("#notes").fill("Audit entry: fast intake");
      await page.getByRole("button", { name: /^Save$/ }).click();
      await page.getByText("Audit entry: fast intake").waitFor();
      await page.getByRole("button", { name: /^Edit$/ }).first().click();
      await page.locator("#notes").fill("Audit entry: edited");
      await page.getByRole("button", { name: /^Save$/ }).click();
      await page.getByText("Audit entry: edited").waitFor();
      await ctx.setOffline(false);
      // Export JSON, delete the entry, import the file back.
      await page.goto(`${BASE}/settings#scouting`, { waitUntil: "networkidle" });
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export JSON/ }).click()]);
      const file = join(mkdtempSync(join(tmpdir(), "cs-scout-")), "scouting.json");
      await download.saveAs(file);
      const exported = JSON.parse(readFileSync(file, "utf8"));
      const n = (Array.isArray(exported) ? exported : exported.entries ?? []).length;
      assert(n >= 1, "export had no entries");
      const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export CSV/ }).click()]);
      assert((await csv.suggestedFilename()).endsWith(".csv"), "CSV export isn't a .csv");
      await page.goto(`${BASE}/scout`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Delete entry/ }).first().click();
      await page.getByText("Audit entry: edited").waitFor({ state: "detached" });
      await page.goto(`${BASE}/settings#scouting`, { waitUntil: "networkidle" });
      await page.locator('input[type=file][accept*="json"]').setInputFiles(file);
      await page.getByText(/Imported 1 entr/).waitFor(); // the file is read asynchronously
      await page.goto(`${BASE}/scout`, { waitUntil: "networkidle" });
      await page.getByText("Audit entry: edited").waitFor({ timeout: 10_000 });
      return `created offline, edited, exported (${n} entr${n === 1 ? "y" : "ies"} + CSV), deleted, re-imported → entry back`;
    },
  },
  {
    name: "Video: in-app recording stays on the device; YouTube links embed",
    async run(page) {
      const uploads: string[] = [];
      page.on("request", (r) => {
        const big = (r.postDataBuffer()?.length ?? 0) > 50_000;
        const external = !r.url().startsWith(BASE) && !/youtube|ytimg|googlevideo|gstatic|fonts\./.test(r.url());
        if ((r.method() !== "GET" && big) || (external && r.method() !== "GET")) uploads.push(`${r.method()} ${r.url()}`);
      });
      await page.goto(`${BASE}/events/2025/AUBRQ2`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Video for AUBRQ2 Q1$/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Record" }).click();
      await dialog.getByRole("button", { name: /Start camera/ }).click();
      await dialog.getByRole("button", { name: /^Record$/ }).click();
      await page.waitForTimeout(2500);
      await dialog.getByRole("button", { name: /Stop & save/ }).click();
      await page.waitForTimeout(1000);
      await dialog.getByRole("tab", { name: "On this device" }).click();
      await dialog.getByRole("button", { name: /^Delete$/ }).first().waitFor({ timeout: 15_000 });
      const stored = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
      await dialog.getByRole("tab", { name: "YouTube" }).click();
      await page.getByLabel("YouTube link").fill("https://youtu.be/dQw4w9WgXcQ");
      await page.getByRole("button", { name: /^Add$/ }).click();
      await page.locator('iframe[src*="youtube"]').first().waitFor({ timeout: 10_000 });
      assert(!uploads.length, `requests that could carry video: ${uploads.join(", ")}`);
      return `recorded 2.5 s with a fake camera → saved locally (IndexedDB: ${stored.join(", ")}); zero uploads; YouTube link embedded`;
    },
  },
  {
    name: "Venue with no signal: the production app opens offline and still predicts",
    async run(page, ctx) {
      // Needs the production build (the service worker is production-only): `npm run build` first.
      const PROD = "http://localhost:3299";
      const server = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: "3299", CS_NO_SCHEDULER: "1" }, shell: true, stdio: "ignore" });
      try {
        assert(await waitUp(`${PROD}/api/health`, 120), "production server didn't become ready");
        await page.goto(`${PROD}/download`, { waitUntil: "networkidle" });
        await page.evaluate(async () => { await navigator.serviceWorker.ready; });
        await page.getByRole("button", { name: /Save to this device/ }).click();
        await page.waitForFunction(() => !!localStorage.getItem("cs-pack-meta"), null, { timeout: 60_000 }); // download + sha256 check done
        await page.reload({ waitUntil: "networkidle" }); // controlled by the worker from here
        await ctx.setOffline(true);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByText("Control Scout").first().waitFor({ timeout: 15_000 });
        // A page never opened online: its code chunk must come from the precache.
        await page.goto(`${PROD}/methodology`, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: /How Control Scout predictions work/ }).waitFor({ timeout: 15_000 });
        // A prediction with no server: from the lite pack.
        await page.goto(`${PROD}/predict?red=18360,24089&blue=14380,23636&season=2025`, { waitUntil: "domcontentloaded" });
        await page.getByText(/to win/).first().waitFor({ timeout: 20_000 });
        const body = await page.locator("main").innerText();
        assert(/offline|lite pack|on this device/i.test(body), "prediction shown but not labelled as offline");
        assert(/(Provisional|Moderate|Confident)/.test(body), "offline prediction has no tier");
        await ctx.setOffline(false);
        return "offline reload opens the app; an unvisited page loads from the precache; a match prediction runs from the lite pack, labelled offline, with a tier";
      } finally {
        await ctx.setOffline(false);
        if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); else server.kill();
      }
    },
  },
  {
    name: "Service worker upgrade: a new build reaches existing visitors, old caches kept",
    async run(page, ctx) {
      const PROD = "http://localhost:3299";
      const server = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: "3299", CS_NO_SCHEDULER: "1" }, shell: true, stdio: "ignore" });
      const shells = () => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("cs-shell-")).sort());
      try {
        assert(await waitUp(`${PROD}/api/health`, 120), "production server didn't become ready");
        await page.goto(`${PROD}/`, { waitUntil: "networkidle" });
        await page.evaluate(async () => { await navigator.serviceWorker.ready; });
        const before = await shells();
        assert(before.length >= 1, "build A's cache missing");
        // Build B (a new release: the worker's embedded version changes).
        const b = spawnSync("npm", ["run", "build"], { shell: true, stdio: "ignore" });
        assert(b.status === 0, "second build failed");
        // Build B's version, as served in its sw.js.
        const swB = await (await fetch(`${PROD}/sw.js`, { cache: "no-store" })).text();
        const versionB = /const VERSION = "([^"]+)"/.exec(swB)?.[1];
        const filesB = JSON.parse(/const FILES = (\[[^\n]*\]);/.exec(swB)?.[1] ?? "[]") as string[];
        assert(versionB && filesB.length, "couldn't read build B's version/files from sw.js");
        // Follow build B's worker through its real state changes. (Not
        // page.waitForFunction with an async predicate: it gets a Promise back,
        // which is always truthy, so it "passes" without waiting at all.)
        const states = await page.evaluate(async () => {
          const r = await navigator.serviceWorker.getRegistration();
          await r?.update();
          const w = r?.installing ?? r?.waiting;
          if (!w) return ["none"];
          const seen = [w.state as string];
          await new Promise<void>((res) => {
            const t = setTimeout(res, 90_000);
            w.addEventListener("statechange", () => { seen.push(w.state); if (w.state === "activated" || w.state === "redundant") { clearTimeout(t); res(); } });
          });
          return seen;
        });
        assert(states.at(-1) === "activated", `build B's worker didn't activate: ${states.join(" → ")} (redundant = its install failed)`);
        // Every file build B lists is really in B's cache.
        const missing = await page.evaluate(async ({ v, files }) => {
          if (!(await caches.keys()).includes(`cs-shell-${v}`)) return ["(no cache)"];
          const cache = await caches.open(`cs-shell-${v}`);
          const out: string[] = [];
          for (const f of files) if (!(await cache.match(f, { ignoreSearch: true }))) out.push(f);
          return out;
        }, { v: versionB, files: filesB });
        assert(!missing.length, `build B's cache is missing ${missing.length} file(s): ${missing.slice(0, 3).join(", ")}`);
        const after = await shells();
        const newest = `cs-shell-${versionB}`;
        assert(!before.includes(newest), `no new cache after the rebuild: ${after.join(", ")}`);
        assert(after.includes(before[before.length - 1]), "the previous release's cache was deleted while its tab was open");
        // The upgraded app still opens offline.
        await ctx.setOffline(true);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByText("Control Scout").first().waitFor({ timeout: 15_000 });
        await ctx.setOffline(false);
        return `build A → build B: B's worker ${states.join(" → ")}, all ${filesB.length} files in ${newest}; previous cache kept for open tabs; opens offline after the upgrade`;
      } finally {
        await ctx.setOffline(false);
        if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); else server.kill();
      }
    },
  },
  {
    name: "Offline packs: manifest valid, checksums match",
    async run(page) {
      const m = await (await fetch(`${BASE}/packs/latest.json`)).json() as any;
      assert(m.version && m.lite && Array.isArray(m.full), "manifest missing version/lite/full");
      for (const f of [m.lite, ...m.full]) {
        const buf = Buffer.from(await (await fetch(`${BASE}${f.url.startsWith("/") ? "" : "/packs/"}${f.url}`)).arrayBuffer());
        assert(buf.length === f.bytes, `${f.name}: ${buf.length} bytes, manifest says ${f.bytes}`);
        const sha = createHash("sha256").update(buf).digest("hex");
        assert(sha === f.sha256, `${f.name}: sha256 mismatch`);
      }
      await page.goto(`${BASE}/download`, { waitUntil: "networkidle" });
      const body = await page.locator("main").innerText();
      assert(body.includes(m.version) && /SHA-256/.test(body), "Download page doesn't show version + sha256");
      return `v${m.version}: lite + ${m.full.length} full packs, sizes and sha256 verified; listed on /download`;
    },
  },
];

let failed = 0;
const browser: Browser = await (async () => {
  await ensureServers(BASE);
  return chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
})();
try {
  for (const f of flows) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ["camera", "microphone"] });
    await ctx.addInitScript(SHIM);
    const page = await ctx.newPage();
    const noise: string[] = [];
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !m.text().startsWith("You have Reduced Motion")) noise.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
    page.on("pageerror", (e) => noise.push(`pageerror: ${e.message.slice(0, 200)}`));
    // blob: = a local video preview the browser stops loading when its tab hides; not a network request.
    // ERR_ABORTED = the flow navigated on before a request finished (not a failure).
    page.on("requestfailed", (r) => { if (!/\.hot-update|__vite|ws:|^blob:/.test(r.url()) && r.failure()?.errorText !== "net::ERR_ABORTED") noise.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`); });
    try {
      const detail = await f.run(page, ctx);
      if (noise.length) throw new Error(`console: ${noise.join(" | ")}`);
      results.push({ name: f.name, ok: true, detail });
      console.log(`✓ ${f.name}\n    ${detail}`);
    } catch (e) {
      failed++;
      results.push({ name: f.name, ok: false, detail: (e as Error).message });
      console.log(`✗ ${f.name}\n    ${(e as Error).message.split("\n")[0]}`);
      await page.screenshot({ path: join(tmpdir(), `audit-flow-fail-${results.length}.png`) }).catch(() => {});
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  stopServers();
}
writeFileSync(join(tmpdir(), "audit-flows.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed}/${results.length} flows passed`);
process.exit(failed ? 1 : 0);
