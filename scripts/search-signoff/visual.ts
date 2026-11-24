// The sign-off's visual pass (scripts/search-signoff/README.md): each query's results page, signed out, headless (the way `npm run shots` takes PRs' shots, never an in-app browser), at desktop 1280 and phone 390,
// read from the page itself:
//   - no sideways scroll
//   - tap targets at least 44px on the phone (inline links in running text are exempt, as in WCAG 2.5.8)
//   - one answer card, no duplicate header, no TEAMS card repeating the answered team
//   - no season picker on a card over every season or a span of them
//   - no yellow/olive-gold band or yellow-bordered answer box, no "read as"/debug text
//   - the desktop results column 640–720px wide
//   - layout shift (CLS as Chrome scores it: the worst burst of shifts no tap caused) at most --max-cls, or the page's
//     own ceiling in the --cls file (the pages over it today, each to be lowered as its layout is fixed)
// and a PNG of each, for the report. With --max-cls it exits 1 when a page shifts more than it may or fails to load;
// the other findings are reported, never failed. CI runs it that way, on the --cls file's pages.
//
// The site is a local production server it starts itself (npm run build first) on its own port, with an empty data
// directory that restores the shipped snapshot: never the live site unless --base names it. Every request it makes to
// the site carries X-CS-Test: 1, so the server can leave it out of what visitors did (the failed-search log).
//
//   npx tsx scripts/search-signoff/visual.ts --cls scripts/search-signoff/cls.json --max-cls 0.1     what CI runs
//   npx tsx scripts/search-signoff/visual.ts --sets C --out C:/tmp/signoff-shots
//   npx tsx scripts/search-signoff/visual.ts --base http://localhost:3199 --sets C     a server already running
//   npx tsx scripts/search-signoff/visual.ts --queries "4215 record in 2025-26" "top teams in NJ in 2025-26"
//   npx tsx scripts/search-signoff/visual.ts --sample 10      every set, the first 10 queries of each family
import { chromium, type Page } from "playwright";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { up, waitUp } from "../lib/servers.js";
import { CLS_OBSERVER, clsCeiling, clsOf, type ClsBudget, type Shift } from "./cls.js";

const argv = process.argv.slice(2);
const arg = (f: string) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };
/** The port of the server this starts (perf.ts takes 3385 and 3386). */
const LOCAL_PORT = 3387;
const BASE = (arg("base") ?? `http://localhost:${LOCAL_PORT}`).replace(/\/$/, "");
const MAX_CLS = arg("max-cls") != null ? Number(arg("max-cls")) : null;
const BUDGET: ClsBudget | null = arg("cls") ? JSON.parse(readFileSync(arg("cls")!, "utf8")) : null;
const started = performance.now();
const OUT = arg("out") ?? join(tmpdir(), "control-scout-signoff", `shots-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
/** --no-shots: no PNGs (CI reads the numbers only; a full-page shot at 2x is about a second a page). */
const SHOTS = !argv.includes("--no-shots");
mkdirSync(OUT, { recursive: true });
const load = <T>(f: string): T => JSON.parse(readFileSync(join(import.meta.dirname, "sets", f), "utf8"));

type Item = { id: string; q: string };
const items: Item[] = [];
const qi = argv.indexOf("--queries");
// The --cls file's pages, unless queries or sets are named.
if (BUDGET && qi < 0 && !arg("sets") && !arg("sample")) BUDGET.pages.forEach((p, i) => items.push({ id: `P${i + 1}`, q: p.q }));
else if (qi >= 0) argv.slice(qi + 1).filter((x) => !x.startsWith("--")).forEach((q, i) => items.push({ id: `Q${i + 1}`, q }));
else {
  const sets = (arg("sets") ?? "C").split(","), sample = arg("sample") ? +arg("sample")! : Infinity;
  type Row = { n: number | string; q: string; expect?: string };
  const take = (prefix: string, xs: Row[], fam: (x: Row) => string) => {
    const seen = new Map<string, number>();
    for (const x of xs) { const f = fam(x), k = seen.get(f) ?? 0; if (k < sample) { items.push({ id: `${prefix}${x.n}`, q: x.q }); seen.set(f, k + 1); } }
  };
  if (sets.includes("A")) take("A", load<{ n: number; q: string; expect: string }[]>("A.json"), (x) => x.expect!.split("|")[0]);
  if (sets.includes("B")) take("B", load<{ n: string; q: string }[]>("B.json"), (x) => String(x.n).startsWith("P") ? "P" : String(Math.min(3, Math.floor(+x.n / 22))));
  if (sets.includes("C")) take("C", load<{ n: number; q: string }[]>("C.json"), (x) => String(Math.floor((+x.n - 1) / 10)));
  if (sets.includes("D")) load<{ family: string; phrasings: string[] }[]>("D.json").forEach((f, i) => take(`D${i + 1}.`, f.phrasings.map((q, j) => ({ n: j + 1, q })), () => f.family));
}

type Check = { id: string; q: string; view: string; issues: string[]; png: string; cls: number | null; ceiling: number | null };
const VIEWS = [{ name: "desktop", width: 1280, height: 900, mobile: false }, { name: "390", width: 390, height: 844, mobile: true }];

/** Everything the page shows that the rules are about, read in the page. */
const audit = (page: Page, mobile: boolean) => page.evaluate((mobile) => {
  const issues: string[] = [];
  const vis = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[aria-hidden=true], .sr-only"); };
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1) issues.push(`sideways scroll (${doc.scrollWidth}px > ${window.innerWidth}px)`);
  const main = document.querySelector("main") ?? document.body;
  const frames = [...main.querySelectorAll("[data-answer-frame]")].filter(vis);
  if (frames.length > 1) issues.push(`${frames.length} answer cards`);
  const noResults = !!main.querySelector("[data-no-results]");
  if (!frames.length && !noResults) issues.push("no answer card and no no-results card");
  const heads = [...main.querySelectorAll("h1, h2, h3")].filter(vis).map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
  // The same words twice, give or take a "Results:" lead-in and a "· 2025–26" tail, is one header said twice.
  const core = (h: string) => h.replace(/^results:\s*/, "").replace(/\s*·.*$/, "").trim();
  const dup = heads.find((h, i) => heads.some((g, j) => j !== i && core(g).length > 12 && (core(g) === core(h) || (j < i && core(h).startsWith(core(g))))));
  if (dup) issues.push(`duplicate header "${dup.slice(0, 60)}"`);
  // A card over every season, or a span of them ("2007–08 to 2025–26", "2025–26 or 2026–27"), is no one season's: a
  // season picker on it would offer to narrow what was never one season. A team's card is the exception, as the card
  // itself makes it (OneCard): "4215 opr change from 2024-25 to 2025-26" keeps its picker.
  for (const f of frames) {
    if (f.querySelector("[data-answer-team], [data-answer-teams]")) continue;
    const said = `${f.querySelector("[data-answer-title]")?.textContent ?? ""} ${f.querySelector("[data-scope]")?.textContent ?? ""}`;
    const seasons = new Set([...said.matchAll(/\b(20\d\d)[–-]\d\d\b/g)].map((m) => m[1]));
    const picker = [...f.querySelectorAll("[data-season-picker]")].some(vis);
    if (picker && (seasons.size > 1 || /\b(?:every|all) seasons?\b/i.test(said))) issues.push(`season picker on a card over many seasons ("${said.trim().slice(0, 60)}")`);
  }
  const answered = frames.map((f) => f.querySelector("[data-answer-team]")?.getAttribute("data-answer-team")).filter(Boolean);
  const teamCards = [...main.querySelectorAll("[data-result=team] a[href^='/teams/']")].filter(vis).map((a) => a.getAttribute("href")!.split("/")[2]);
  const repeated = teamCards.filter((t) => answered.includes(t));
  if (repeated.length) issues.push(`TEAMS card repeats the answered team ${repeated[0]}`);
  const text = (main as HTMLElement).innerText;
  const debug = text.match(/read as [“"']|isn['’]t answered directly|\bsay which\b/i);
  if (debug) issues.push(`debug text "${debug[0]}"`);
  // Yellow/olive-gold: hue 40–70°, saturated, as a band (a wide filled box) or an answer card's border.
  const yellow = (c: string) => {
    const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/); if (!m || (m[4] != null && +m[4] < 0.3)) return false;
    const [r, g, b] = [+m[1] / 255, +m[2] / 255, +m[3] / 255], mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 0.15) return false;
    const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
    return h >= 40 && h <= 70 && s > 0.45 && l > 0.25 && l < 0.8;
  };
  for (const e of [...main.querySelectorAll("*")].filter(vis)) {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    if (r.width > 300 && r.height > 40 && yellow(s.backgroundColor)) { issues.push(`yellow band ${Math.round(r.width)}×${Math.round(r.height)}`); break; }
  }
  for (const f of frames) if (yellow(getComputedStyle(f).borderTopColor)) issues.push("yellow-bordered answer box");
  if (mobile) {
    // The results column only: the site's own header and footer are checked by the site-wide audit (npm run a11y).
    const col = document.querySelector("[data-results-column]") ?? main;
    // A stretched link (an absolute ::after over its card, the result cards' pattern) is as big as that card.
    const area = (e: Element) => {
      const after = getComputedStyle(e, "::after");
      const box = after.content !== "none" && after.position === "absolute" ? (e as HTMLElement).offsetParent ?? e : e;
      return box.getBoundingClientRect();
    };
    const small = [...col.querySelectorAll("a, button, [role=button], input, select, summary")].filter(vis).filter((e) => {
      if (getComputedStyle(e).display === "inline" && e.closest("p, li, td, figcaption, footer, dd")) return false;
      const r = area(e); return r.height < 43.5 || r.width < 43.5;
    });
    const name = (e: Element) => `"${(e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 30)}" ${Math.round(area(e).width)}×${Math.round(area(e).height)}`;
    if (small.length) issues.push(`${small.length} tap targets under 44px (${small.slice(0, 4).map(name).join(", ")})`);
  } else {
    const col = document.querySelector("[data-results-column]")?.getBoundingClientRect().width;
    if (col && (col < 630 || col > 730) && !document.querySelector("[data-results-column=with-panel]")) issues.push(`results column ${Math.round(col)}px (want 640–720)`);
  }
  return issues;
}, mobile);

/** A production server on LOCAL_PORT from the build, with an empty data directory (it restores the shipped snapshot),
 *  unless one already answers there. */
let server: ChildProcess | null = null, serverDir: string | null = null;
if (!arg("base") && !(await up(`${BASE}/api/health`))) {
  serverDir = mkdtempSync(join(tmpdir(), "cs-visual-"));
  // detached: its own process group, so stopServer ends npx → tsx → node together.
  server = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, NODE_ENV: "production", PORT: String(LOCAL_PORT), CS_NO_SCHEDULER: "1", CS_SKIP_DOTENV: "1", DATABASE_URL: `file:${serverDir}/scout.db`.replace(/\\/g, "/"), DATA_DIR: serverDir, CS_PACKS: "off" }, shell: true, stdio: "ignore", detached: process.platform !== "win32" });
  console.log(`starting a production server on ${BASE}…`);
}
/** End the server's whole tree, synchronously (so an exit on an error still ends it). */
function killServer() {
  if (!server?.pid || server.exitCode != null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else try { process.kill(-server.pid, "SIGKILL"); } catch { /* already gone */ }
}
process.once("exit", killServer);
async function stopServer() {
  if (server?.pid && server.exitCode == null) {
    const exited = new Promise((r) => server!.once("exit", r));
    killServer();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  }
  // Windows can hold the database file for a moment after the process ends.
  if (serverDir) for (let i = 0; i < 10; i++) { try { rmSync(serverDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
}
if (!(await waitUp(`${BASE}/api/health`, 300))) { await stopServer(); throw new Error(`${BASE} didn't become ready`); }
console.log(`${BASE} ready after ${((performance.now() - started) / 1000).toFixed(0)} s`);

const browser = await chromium.launch();
const checks: Check[] = [];
for (const v of VIEWS) {
  // A fresh context per viewport: signed out, no stored state, phones as phones.
  // No service worker: every request is the page's own, so each carries the test header below and none is answered
  // from a worker's cache.
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 2, isMobile: v.mobile, hasTouch: v.mobile, colorScheme: "dark", serviceWorkers: "block" });
  // Test traffic, said so (X-CS-Test: 1), on the site's own requests only: a custom header would turn a request to
  // another origin into a preflighted one.
  const origin = new URL(BASE).origin;
  await ctx.route((u) => u.origin === origin, (route) => route.continue({ headers: { ...route.request().headers(), "x-cs-test": "1" } }));
  await ctx.addInitScript(CLS_OBSERVER);
  // tsx names the audit's inner functions with an __name helper the page doesn't have.
  await ctx.addInitScript("window.__name = (f) => f");
  // The privacy question answered "No thanks" up front, as npm run shots does, so it never covers the answer.
  await ctx.addInitScript(() => localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })));
  const page = await ctx.newPage();
  /** One load of `it`'s results page: the audit's findings and its layout shift (null when not measured). */
  const look = async (it: Item, png: string): Promise<{ issues: string[]; cls: number | null }> => {
    try {
      await page.goto(`${BASE}/search?q=${encodeURIComponent(it.q)}`, { waitUntil: "networkidle", timeout: 45_000 });
      await page.waitForSelector("[data-answer-frame], [data-no-results], [data-result]", { timeout: 20_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const issues = await audit(page, v.mobile);
      // The follow-ups (People also ask, Related searches) and the video come after the answer: let them land, then
      // read every shift so far. Before the full-page shot, which resizes the page.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const shifts = (await page.evaluate("window.__shifts ?? null")) as Shift[] | null;
      if (SHOTS) await page.screenshot({ path: png, fullPage: true });
      return { issues, cls: shifts ? Math.round(clsOf(shifts) * 1000) / 1000 : null };
    } catch (e) { return { issues: [`page failed: ${String(e).slice(0, 120)}`], cls: null }; }
  };
  for (const it of items) {
    const png = join(OUT, `${it.id.replace(/[^\w.-]/g, "_")}-${v.name}.png`);
    const t0 = performance.now();
    const ceiling = MAX_CLS == null ? null : clsCeiling(BUDGET, it.q, v.name, MAX_CLS);
    const over = (r: { issues: string[]; cls: number | null }) => ceiling != null && (r.cls == null || r.cls > ceiling);
    let seen = await look(it, png);
    // Gated, a page over its ceiling is loaded once more and the lower reading kept: when a late part lands moves its
    // shifts in or out of one burst, so one load can read high by chance. A page over it twice is over it.
    if (over(seen)) { const again = await look(it, png); if (!over(again) || (again.cls ?? Infinity) < (seen.cls ?? Infinity)) seen = again; }
    const { cls } = seen, issues = [...seen.issues];
    if (over(seen) && !issues.some((i) => i.startsWith("page failed"))) issues.push(cls == null ? "layout shift not measured" : `layout shift ${cls.toFixed(3)} > ${ceiling}`);
    checks.push({ id: it.id, q: it.q, view: v.name, issues, png, cls, ceiling });
    const shift = `${cls == null ? "cls  –   " : `cls ${cls.toFixed(3)}`} ${((performance.now() - t0) / 1000).toFixed(1).padStart(4)} s`;
    console.log(`${issues.length ? "FAIL" : "ok  "} ${v.name.padEnd(7)} ${shift} ${it.id} ${it.q}${issues.length ? `\n       ${issues.join("; ")}` : ""}`);
  }
  await ctx.close();
}
await browser.close();
await stopServer();
writeFileSync(join(OUT, "visual.json"), JSON.stringify(checks, null, 1));
const bad = checks.filter((c) => c.issues.length);
const pats = new Map<string, number>();
for (const c of bad) for (const i of c.issues) { const k = i.replace(/\d+(px|×\d+)?|"[^"]*"/g, "#").replace(/\(.*\)/, "").trim(); pats.set(k, (pats.get(k) ?? 0) + 1); }
console.log(`\n${checks.length - bad.length}/${checks.length} page views clean · shots in ${OUT}`);
for (const [k, n] of [...pats].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`);
console.log(`${((performance.now() - started) / 1000).toFixed(0)} s in all`);
if (MAX_CLS != null) {
  // The gate: a page view that shifted more than it may, or never loaded (so nothing was measured).
  const gated = (i: string) => /^layout shift|^page failed/.test(i);
  const over = checks.filter((c) => c.issues.some(gated));
  for (const c of over) console.log(`FAIL ${c.view} "${c.q}": ${c.issues.filter(gated).join("; ")}`);
  console.log(over.length ? `${over.length} page views over their layout shift ceiling` : `every page view within its layout shift ceiling (${MAX_CLS}, or its own in the --cls file)`);
  process.exit(over.length ? 1 : 0);
}
