// Self-audit click-through (docs/self-audit.md §1): the things a sweep can't
// see — actually using each feature in a real browser on the real servers.
//
//   npm run audit:flows
//   npm run audit:flows -- --only "service worker"   (flows whose name contains it)
//
// Each flow prints ✓/✗ with what it checked; any console error/warning or page
// error during a flow fails it. Exit code 1 if anything failed.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROD_PORT, WEB_PORT, ensureServers, stopServers, waitUp } from "./lib/servers.js";

/** The service worker installed and active — or a clear failure, not a hang (`ready` never settles when install fails). */
async function swReady(page: Page) {
  const ok = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 60_000))]));
  assert(ok, "the service worker never became ready (its install failed: a precached file didn't load)");
}

const BASE = `http://localhost:${WEB_PORT}`;
const PROD = `http://localhost:${PROD_PORT}`;
const SHIM = "globalThis.__name = (f) => f;"; // tsx's __name helper, absent in the browser
/** prod: runs only against its own production server (PROD), so needs no dev servers. */
type Flow = { name: string; prod?: boolean; run: (page: Page, ctx: BrowserContext) => Promise<string> };
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
      // The top-bar field takes focus a frame after it opens: type only once it has it (a person can't beat one frame;
      // typing at once could drop the "1" and search "6").
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
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
      assert(/(Rough guess|Fair|Solid)/i.test(body), "no confidence tier");
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
      assert(/(Rough guess|Fair|Solid)/i.test(body), "no tier on advancement odds");
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
        "Profile": "Sign in", "Appearance": "Display", "My team & tracking": "My team", "Notifications": "What to alert me about",
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
      await page.goto(`${BASE}/scout?tab=data&view=entries`, { waitUntil: "networkidle" }); // entries live under Data since the Scout redesign
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
      await page.goto(`${BASE}/scout?tab=data&view=entries`, { waitUntil: "networkidle" }); // entries live under Data since the Scout redesign
      await page.getByRole("button", { name: /Delete entry/ }).first().click();
      await page.getByText("Audit entry: edited").waitFor({ state: "detached" });
      await page.goto(`${BASE}/settings#scouting`, { waitUntil: "networkidle" });
      // Choosing a file opens a preview and writes nothing; only Import writes (audit E3).
      const scoutKeys = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith("cs-scout")).sort().map((k) => [k, localStorage.getItem(k)])));
      const preview = page.getByRole("dialog", { name: "Review this import" });
      const choose = async () => {
        await page.locator('input[type=file][accept*="json"]').setInputFiles(file);
        await preview.waitFor({ timeout: 10_000 }); // the file is read asynchronously
      };
      const beforeImport = await scoutKeys();
      await choose();
      assert(/Nothing on this device has changed yet/.test(await preview.innerText()), "the preview doesn't say nothing changed yet");
      // Cancel: the dialog closes and the device is exactly as it was.
      await preview.getByRole("button", { name: "Cancel" }).click();
      await preview.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      assert(!(await preview.isVisible()), "Cancel didn't close the import preview");
      assert((await scoutKeys()) === beforeImport, "Cancel changed scouting data on this device");
      // Choose it again and import. The entry was deleted here after the export, so the file's copy is the older
      // one: the preview lists it as already here (deleted here) and "Use the file's copy" brings it back.
      await choose();
      const text = await preview.innerText();
      assert(/deleted here/.test(text) && /Already here/.test(text), `the preview doesn't list the deleted entry as already here: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
      await preview.getByRole("radio", { name: /Use the file's copy/ }).click();
      assert(/Update 1/.test(await preview.getByRole("region", { name: "What Import will do" }).innerText()), "with the file's copy chosen, Import doesn't plan to update 1 entry");
      assert((await scoutKeys()) === beforeImport, "the preview wrote scouting data before Import");
      await preview.getByRole("button", { name: "Import 1 entry", exact: true }).click();
      await page.getByText("Imported 1 entry (0 new, 1 updated).").waitFor();
      await preview.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      assert(!(await preview.isVisible()), "the import preview stayed open after Import");
      await page.goto(`${BASE}/scout?tab=data&view=entries`, { waitUntil: "networkidle" }); // entries live under Data since the Scout redesign
      await page.getByText("Audit entry: edited").waitFor({ timeout: 10_000 });
      return `created offline, edited, exported (${n} entr${n === 1 ? "y" : "ies"} + CSV), deleted; import preview: Cancel wrote nothing, then "Use the file's copy" → Import 1 entry → entry back`;
    },
  },
  {
    name: "Sidebar sign-in: on every page, opens in place, no pop-up",
    async run(page) {
      for (const path of ["/", "/events", "/teams/18360"]) {
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        await page.getByRole("complementary", { name: "Sidebar" }).getByRole("button", { name: "Sign in", exact: true }).waitFor({ timeout: 10_000 });
        assert(!(await page.getByRole("banner").getByRole("button", { name: "Sign in", exact: true }).count()), `the top bar still has Sign in on ${path}`);
      }
      await page.getByRole("complementary", { name: "Sidebar" }).getByRole("button", { name: "Sign in", exact: true }).click();
      const panel = page.getByRole("region", { name: "Sign in" });
      await panel.waitFor();
      assert(!(await page.getByRole("dialog").count()), "sign-in opened a dialog");
      const text = await panel.innerText();
      assert(/Control Point/.test(text), "panel doesn't mention Control Point accounts");
      await page.keyboard.press("Escape");
      // It animates closed: give it a moment, then it must be gone.
      await panel.waitFor({ state: "detached", timeout: 2000 }).catch(() => {});
      assert(!(await panel.count()), "Esc didn't close the panel");
      return "Sign in button in the sidebar footer (not the top bar) on /, /events and a team page; panel opens in place (no dialog), mentions Control Point, Esc closes";
    },
  },
  {
    name: "Match details: open in place, more than the row, no pop-up",
    async run(page) {
      await page.goto(`${BASE}/events/2025/AUBRQ2?match=qual:0:3`, { waitUntil: "networkidle" });
      const d = page.locator("#match-AUBRQ2-qual-0-3");
      await d.getByRole("region", { name: "Red alliance" }).waitFor({ timeout: 15_000 });
      const text = await d.innerText();
      for (const want of [/Blue alliance/i, /OPR at this time/, /Season/, /Auto/, /TeleOp/, /Endgame/, /Fouls given away/, /Predicted|No prediction/]) assert(want.test(text), `details missing ${want}`);
      assert(!(await page.getByRole("dialog").count()), "match details opened a dialog");
      // The rest of the page still works with details open: open another match too.
      await page.getByRole("button", { name: "Q4 details", exact: true }).click();
      await page.locator("#match-AUBRQ2-qual-0-4").getByRole("region", { name: "Blue alliance" }).waitFor({ timeout: 15_000 });
      assert(await d.isVisible(), "opening Q4 closed Q3");
      // Step to the next match from the details.
      await d.getByRole("link", { name: /Next match/ }).click();
      await page.waitForURL(/match=qual(%3A|:)0(%3A|:)4/);
      return "?match= opens Q3 in place with lineups (names, event rank/OPR, season OPR), breakdown and prediction; several open at once; no dialog; next-match link works";
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
      // Video lives in the match's details, opened in place (no dialog).
      await page.goto(`${BASE}/events/2025/AUBRQ2`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Q1 details", exact: true }).click();
      const dialog = page.locator("#match-AUBRQ2-qual-0-1");
      await dialog.getByText("Video for Q1").click();
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
    name: "Methodology example pips: 44px targets on a phone, 24px on a desktop, none overlapping",
    async run(page) {
      const seen: string[] = [];
      for (const [vp, width, height, min] of [["phone", 390, 844, 44], ["desktop", 1440, 900, 24]] as const) {
        await page.setViewportSize({ width, height });
        await page.goto(`${BASE}/methodology`, { waitUntil: "networkidle" });
        const group = page.getByRole("group", { name: "Example matches" });
        const pips = group.getByRole("button", { name: /^(Q|SF)-\d/ });
        await pips.first().waitFor({ timeout: 15_000 });
        const boxes = await pips.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; }));
        assert(boxes.length === 4, `${vp}: ${boxes.length} example buttons, expected 4`);
        for (const [i, b] of boxes.entries()) {
          assert(b.w >= min - 0.5 && b.h >= min - 0.5, `${vp}: example ${i + 1} is ${b.w.toFixed(1)}×${b.h.toFixed(1)} px, under ${min}×${min}`);
          if (i) assert(boxes[i - 1].x + boxes[i - 1].w <= b.x + 0.5, `${vp}: examples ${i} and ${i + 1} overlap`);
        }
        const axe = await new AxeBuilder({ page }).include('[role="group"][aria-label="Example matches"]').withRules(["target-size"]).analyze();
        assert(!axe.violations.length, `${vp}: axe target-size: ${axe.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" "))).join(", ")}`);
        seen.push(`${vp} ${boxes.map((b) => `${Math.round(b.w)}×${Math.round(b.h)}`).join(" ")}`);
      }
      return `example buttons: ${seen.join("; ")}; axe target-size clean at both sizes`;
    },
  },
  {
    // V4-A11Y-003: on light, Compare's best values were #eab308 on their own gold tint, 1.8:1. Measured as rendered:
    // each gold text's colour against its real background (semi-transparent tints blended down to the page).
    // The profile's large "Top 8%" stays the accent itself, the owner's large-text exception (Oct 20 2026).
    name: "Light-mode gold text: small gold text reaches 4.5:1 on its real background; large Top 8% keeps the accent",
    async run(page, ctx) {
      await ctx.addInitScript(() => {
        localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 }));
        localStorage.setItem("cs-personal:settings", JSON.stringify({ value: { theme: "light", density: "comfortable", notify: {} }, updatedAt: 1 }));
      });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      const seen: string[] = [];
      for (const [vp, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]] as const) {
        await page.setViewportSize({ width, height });
        await page.goto(`${BASE}/compare?teams=18360,24089&season=2025`, { waitUntil: "networkidle" });
        await page.locator("td:has(> .sr-only) > span.font-medium").first().waitFor({ timeout: 30_000 });
        await page.waitForFunction(() => !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 30_000 });
        await page.waitForTimeout(500);
        assert(await page.evaluate(() => document.documentElement.classList.contains("light")), `${vp}: the page isn't in the light theme`);
        const texts = await page.evaluate(() => {
          type C = [number, number, number, number];
          // Computed colours come back as rgb()/rgba(), color(srgb …) for Tailwind's alpha tints (bg-accent/[0.08]), or
          // oklch()/oklab() for its palette (text-amber-700): those go through a canvas, opaque, with the alpha read off.
          const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
          const parse = (s: string): C => {
            if (s === "transparent") return [0, 0, 0, 0];
            let m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(s);
            if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
            m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(s);
            if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] == null ? 1 : +m[4]];
            m = /^(\w+\([^/)]*?)\s*(?:\/\s*([\d.]+)(%?))?\)$/.exec(s);
            if (!m) throw new Error(`can't read the colour ${s}`);
            paint.clearRect(0, 0, 1, 1);
            paint.fillStyle = "#000";
            paint.fillStyle = `${m[1]})`;
            paint.fillRect(0, 0, 1, 1);
            const [r, g, b] = paint.getImageData(0, 0, 1, 1).data;
            return [r, g, b, m[2] == null ? 1 : m[3] ? +m[2] / 100 : +m[2]];
          };
          const over = (t: C, u: C): C => [t[0] * t[3] + u[0] * (1 - t[3]), t[1] * t[3] + u[1] * (1 - t[3]), t[2] * t[3] + u[2] * (1 - t[3]), 1];
          const lum = (c: C) => { const f = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
          const ratio = (a: C, b: C) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
          // The background a text sits on: every ancestor's background colour, blended from the page up.
          const backdrop = (el: Element): C => {
            const layers: C[] = [];
            for (let n: Element | null = el; n; n = n.parentElement) {
              const c = parse(getComputedStyle(n).backgroundColor);
              if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
            }
            let bg: C = [255, 255, 255, 1];
            for (const l of layers.reverse()) bg = over(l, bg);
            return bg;
          };
          // Gold: a warm, saturated hue (amber through yellow), whatever shade.
          const gold = (c: C) => { const [r, g, b] = c, max = Math.max(r, g, b), min = Math.min(r, g, b); if (max - min < 60 || max !== r || b > g) return false; const h = 60 * ((g - b) / (max - min)); return h >= 25 && h <= 60; };
          const out: { text: string; kind: string; fg: string; bg: string; px: number; weight: number; ratio: number }[] = [];
          const hex = (c: C) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
          for (const el of document.querySelectorAll<HTMLElement>("main *")) {
            const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim();
            if (!own || el.closest(".recharts-wrapper, .sr-only, [aria-hidden=true]") || !el.getClientRects().length) continue;
            const cs = getComputedStyle(el), fg = parse(cs.color);
            if (!gold(fg)) continue;
            const bg = backdrop(el), shown = over([fg[0], fg[1], fg[2], fg[3] * +cs.opacity], bg);
            const best = el.matches("td:has(> .sr-only) > span.font-medium");
            out.push({ text: own.slice(0, 30), kind: best ? "best value" : el.closest("[role=radio]") ? "season" : "other", fg: hex(shown), bg: hex(bg), px: parseFloat(cs.fontSize), weight: +cs.fontWeight, ratio: ratio(shown, bg) });
          }
          return out;
        });
        const best = texts.filter((t) => t.kind === "best value");
        assert(best.length >= 4, `${vp}: found ${best.length} gold best values on Compare (expected at least 4, e.g. 149.9, 55.1, 11.9, 23-5-0)`);
        assert(texts.some((t) => t.kind === "season"), `${vp}: the chosen season isn't gold`);
        // Small text: under 24px, or under 18.66px when bold (WCAG's large-text line).
        const small = texts.filter((t) => t.px < 24 && !(t.px >= 18.66 && t.weight >= 700));
        const bad = small.filter((t) => t.ratio < 4.5);
        assert(!bad.length, `${vp}: small gold text under 4.5:1: ${bad.map((t) => `"${t.text}" (${t.kind}) ${t.fg} on ${t.bg} ${t.px}px ${t.ratio.toFixed(2)}:1`).join("; ")}`);
        seen.push(`${vp} ${small.length} small gold texts, lowest ${Math.min(...small.map((t) => t.ratio)).toFixed(2)}:1 (best ${best[0].text} ${best[0].fg} on ${best[0].bg} ${best[0].ratio.toFixed(2)}:1)`);
      }
      // The owner's exception: the profile's 48px percentile stays the accent itself.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${BASE}/teams/18360?season=2025`, { waitUntil: "networkidle" });
      const top = page.locator("main p.font-display.text-5xl").first();
      await top.waitFor({ timeout: 30_000 });
      const pct = await top.evaluate((el) => ({ text: el.textContent ?? "", color: getComputedStyle(el).color, px: parseFloat(getComputedStyle(el).fontSize) }));
      assert(/^Top \d+%$/.test(pct.text.trim()), `profile percentile reads "${pct.text}"`);
      assert(pct.color === "rgb(234, 179, 8)", `"${pct.text}" is ${pct.color}, expected the accent #eab308 (owner's large-text exception)`);
      assert(pct.px >= 24, `"${pct.text}" is ${pct.px}px, no longer large text`);
      return `${seen.join("; ")}; "${pct.text}" stays #eab308 at ${pct.px}px`;
    },
  },
  {
    name: "Venue with no signal: the production app opens offline and still predicts",
    prod: true,
    async run(page, ctx) {
      // Needs the production build (the service worker is production-only): `npm run build` first.
      const server = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: String(PROD_PORT), CS_NO_SCHEDULER: "1" }, shell: true, stdio: "ignore" });
      try {
        assert(await waitUp(`${PROD}/api/health`, 120), "production server didn't become ready");
        // A first visit doesn't pay for the lite pack (1.6 MB): the page loads, goes idle and stays quiet, and still no pack.
        const packFetches: string[] = [];
        page.on("request", (r) => { if (/\/packs\/.*lite/.test(r.url())) packFetches.push(r.url()); });
        await page.goto(`${PROD}/`, { waitUntil: "networkidle" });
        await swReady(page);
        await page.waitForTimeout(12_000);
        assert(!packFetches.length && !(await ls(page, "cs-pack-meta")), `the first visit downloaded the lite pack: ${packFetches.join(", ")}`);
        // A returning visitor (a new session on this device) gets it with no clicks once the home page goes idle.
        await page.evaluate(() => sessionStorage.clear());
        await page.reload({ waitUntil: "networkidle" });
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
        assert(/(Rough guess|Fair|Solid)/i.test(body), "offline prediction has no tier");
        await ctx.setOffline(false);
        return "first visit: no lite pack; returning visit: lite pack saved automatically; offline reload opens the app; an unvisited page loads from the precache; a match prediction runs from the lite pack, labelled offline, with a tier";
      } finally {
        await ctx.setOffline(false);
        if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); else server.kill();
      }
    },
  },
  {
    // Audit V4-RUNTIME-001: the animation features are an optional download (src/lib/motionSupport.ts). When that
    // one file fails, pages must still draw, visibly and static, with no unhandled rejection and no reload prompt;
    // a page's own code that fails must still offer "Reload Control Scout" (src/lib/chunkError.ts).
    name: "Animation download fails: pages still show, static, no reload prompt",
    prod: true,
    async run(page) {
      const server = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: String(PROD_PORT), CS_NO_SCHEDULER: "1" }, shell: true, stdio: "ignore" });
      const browser = page.context().browser()!;
      const seen: string[] = [];
      try {
        assert(await waitUp(`${PROD}/api/health`, 120), "production server didn't become ready");
        type Mode = "fail" | "late-fail-then-repaired" | "slow" | "page-chunk-fails";
        const visit = async (mode: Mode, reducedMotion: "reduce" | "no-preference") => {
          // A fresh visitor each time, service workers blocked so every request reaches the routes below.
          const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", reducedMotion });
          await ctx.addInitScript(SHIM);
          await ctx.addInitScript(() => {
            const w = window as unknown as { __rejections: string[]; __loaded: number };
            w.__rejections = []; w.__loaded = Date.now(); // __loaded survives only if the page never reloads
            window.addEventListener("unhandledrejection", (e) => { w.__rejections.push(String((e as PromiseRejectionEvent).reason)); });
          });
          let motionRequests = 0, firstSettled = false;
          await ctx.route(/\/assets\/motionFeatures-[\w-]+\.js$/, async (route) => {
            motionRequests++;
            if (mode === "fail") return route.abort();
            // late-fail-then-repaired: the first download fails after 3.5 s, and the file is fine from then on. slow: 3.5 s, then fine.
            if ((mode === "late-fail-then-repaired" || mode === "slow") && motionRequests === 1) {
              await new Promise((r) => setTimeout(r, 3500));
              await (mode === "slow" ? route.continue() : route.abort());
              firstSettled = true;
              return;
            }
            return route.continue();
          });
          if (mode === "page-chunk-fails") await ctx.route(/\/assets\/EventsPage-[\w-]+\.js$/, (route) => route.abort());
          const p = await ctx.newPage();
          const errors: string[] = [];
          p.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
          // The failed downloads themselves are expected (and logged by the browser): anything else is not.
          p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 160)}`); });
          const label = `${mode}/${reducedMotion}`;
          /** The heading is really on screen: rendered, and every element from it up to the root fully opaque. */
          const shown = async (heading: RegExp, where: string) => {
            const h1 = p.locator("main h1").filter({ hasText: heading }).first();
            await h1.waitFor({ state: "visible", timeout: 20_000 });
            await p.waitForTimeout(1500); // past any fade (0.18 s)
            const o = await h1.evaluate((el) => {
              const chain = (from: Element | null) => { let x = 1; for (let e = from; e; e = e.parentElement) x *= Number(getComputedStyle(e).opacity); return x; };
              return { h1: chain(el), main: chain(document.querySelector("main")) };
            });
            assert(o.main >= 0.99 && o.h1 >= 0.99, `${label} ${where}: page not visible (opacity: main ${o.main.toFixed(2)}, heading ${o.h1.toFixed(2)})`);
          };
          /** Something that appears later inside an AnimatePresence (not a page) is fully opaque too. */
          const opaque = async (what: ReturnType<Page["locator"]>, where: string) => {
            await what.waitFor({ state: "visible", timeout: 10_000 });
            await p.waitForTimeout(800);
            const o = await what.evaluate((el) => { let x = 1; for (let e: Element | null = el; e; e = e.parentElement) x *= Number(getComputedStyle(e).opacity); return x; });
            assert(o >= 0.99, `${label} ${where}: not visible (opacity ${o.toFixed(2)})`);
          };
          try {
            // The delayed modes move on while the first download is still pending.
            const delayed = mode === "late-fail-then-repaired" || mode === "slow";
            await p.goto(`${PROD}/`, { waitUntil: delayed ? "domcontentloaded" : "networkidle" });
            const loaded = await p.evaluate(() => (window as unknown as { __loaded: number }).__loaded);
            await p.getByRole("link", { name: /Find an event/ }).click();
            if (mode === "page-chunk-fails") {
              await p.getByRole("button", { name: /Reload Control Scout/ }).waitFor({ timeout: 20_000 });
              return `${label}: reload offered`;
            }
            await shown(/^Events$/, "Home → Events");
            // A later page change, once the delayed download has settled (failed, or arrived).
            for (let t = 0; delayed && !firstSettled && t < 100; t++) await p.waitForTimeout(100);
            await p.locator("aside").getByRole("link", { name: /^Rankings$/ }).first().click();
            await shown(/rankings/i, "Events → Rankings");
            if (mode === "fail") {
              // Parts that come and go inside an AnimatePresence: a settings section switch (mode="wait") and the sidebar's account panel.
              await p.locator("aside").getByRole("link", { name: /^Settings$/ }).first().click();
              // Profile first (its body: the Sign in group, or the note that sign-in isn't set up here), then Appearance.
              const profileBody = p.getByRole("heading", { name: "Sign in", level: 2, exact: true }).or(p.getByText("Sign-in isn't set up on this server"));
              await opaque(profileBody.first(), "Settings → Profile body");
              await p.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance", exact: true }).click();
              await shown(/^Appearance$/, "Settings → Appearance");
              // The section body switches inside the AnimatePresence (the heading is outside it): the new body shows, the old one is gone.
              await opaque(p.getByRole("heading", { name: "Display", level: 2, exact: true }), "Settings → Appearance body");
              assert(!(await profileBody.count()), `${label}: the Profile body is still there after switching to Appearance`);
              await p.getByRole("complementary", { name: "Sidebar" }).getByRole("button", { name: "Sign in", exact: true }).click();
              await opaque(p.getByRole("region", { name: "Sign in" }), "the sidebar sign-in panel");
            }
            assert(!(await p.getByRole("button", { name: /Reload Control Scout/ }).count()), `${label}: the optional animation download offered a page reload`);
            const state = await p.evaluate(() => { const w = window as unknown as { __rejections: string[]; __loaded: number }; return { rejections: w.__rejections, loaded: w.__loaded }; });
            assert(!state.rejections.length, `${label}: unhandled rejection: ${state.rejections[0]}`);
            assert(state.loaded === loaded, `${label}: the page reloaded (unsaved work would be lost)`);
            assert(!errors.length, `${label}: ${errors[0]}`);
            assert(motionRequests >= 1, `${label}: the animation features were never requested (the route pattern is stale)`);
            return label;
          } finally {
            await ctx.close();
          }
        };
        for (const rm of ["no-preference", "reduce"] as const) {
          seen.push(await visit("fail", rm));
          seen.push(await visit("late-fail-then-repaired", rm));
          seen.push(await visit("slow", rm));
        }
        seen.push(await visit("page-chunk-fails", "no-preference"));
        return `Home → Events → Rankings (and, failing, a settings section switch and the sign-in panel) fully opaque with the animation features failing, failing late (then fine), and slow, in both motion settings; no unhandled rejection, no reload, no reload prompt; a failed page chunk still offers the reload (${seen.join(", ")})`;
      } finally {
        if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); else server.kill();
      }
    },
  },
  {
    name: "Service worker upgrade: a new build reaches existing visitors, old caches kept",
    prod: true,
    async run(page, ctx) {
      const server = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: String(PROD_PORT), CS_NO_SCHEDULER: "1" }, shell: true, stdio: "ignore" });
      const shells = () => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("cs-shell-")).sort());
      try {
        assert(await waitUp(`${PROD}/api/health`, 120), "production server didn't become ready");
        await page.goto(`${PROD}/`, { waitUntil: "networkidle" });
        await swReady(page);
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
      await page.getByText(/Offline predictions are ready on this device/).waitFor({ timeout: 60_000 });
      const body = await page.locator("main").innerText();
      assert(body.includes(m.version) && /SHA-256/.test(body), "Download page doesn't show version + sha256");
      assert(!(await page.getByRole("button", { name: /Save to this device/ }).count()), "lite pack still offered as a manual download");
      const links = await page.locator("main a[download]").count();
      assert(links === m.full.length, `${links} download links, expected ${m.full.length} (full packs only)`);
      return `v${m.version}: lite + ${m.full.length} full packs, sizes and sha256 verified; lite saved automatically, only full packs downloadable on /download`;
    },
  },
];

// --only "<part of a name>": a typo or a missing value must not "pass" by running nothing (or quietly run everything).
const only = process.argv.includes("--only") ? (process.argv[process.argv.indexOf("--only") + 1] ?? "").toLowerCase() : undefined;
const selected = flows.filter((x) => only === undefined || x.name.toLowerCase().includes(only));
if (only !== undefined && (!only || only.startsWith("--") || !selected.length)) {
  console.error(`--only "${only}" matches no flow. Flows:\n${flows.map((x) => `  ${x.name}`).join("\n")}`);
  process.exit(1);
}

let failed = 0;
const browser: Browser = await (async () => {
  if (selected.some((f) => !f.prod)) await ensureServers(BASE);
  return chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
})();
try {
  for (const f of selected) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ["camera", "microphone"] });
    await ctx.addInitScript(SHIM);
    const page = await ctx.newPage();
    const noise: string[] = [];
    // While a flow has put the browser offline on purpose (the venue check), "disconnected" failures are the point,
    // not noise: the app is expected to try the network and fall back. Any other failure still counts.
    let offline = false;
    const setOffline = ctx.setOffline.bind(ctx);
    ctx.setOffline = async (v: boolean) => { offline = v; return setOffline(v); };
    const disconnected = (t: string | undefined) => offline && /ERR_INTERNET_DISCONNECTED/.test(t ?? "");
    page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !m.text().startsWith("You have Reduced Motion") && !disconnected(m.text())) noise.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
    page.on("pageerror", (e) => noise.push(`pageerror: ${e.message.slice(0, 200)}`));
    // blob: = a local video preview the browser stops loading when its tab hides; not a network request.
    // ERR_ABORTED = the flow navigated on before a request finished (not a failure).
    page.on("requestfailed", (r) => { if (!/\.hot-update|__vite|ws:|^blob:/.test(r.url()) && r.failure()?.errorText !== "net::ERR_ABORTED" && !disconnected(r.failure()?.errorText)) noise.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`); });
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
