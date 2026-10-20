// Self-audit sweep (docs/self-audit.md §1, §2, §4, §5): every route at desktop
// 1440×900 and mobile 390×844, against the real servers, recording
//
//   console errors/warnings and uncaught page errors (any = finding)
//   failed requests (HTTP ≥ 400 or network errors) not expected by the route
//   horizontal overflow at either viewport
//   form controls and buttons with no accessible name
//   forced states: loading (API delayed 4 s), API down (every /api call fails)
//
// and saving a full-page screenshot of each (outside the repo) for the visual
// review. Prints a summary and writes audit.json next to the screenshots.
//
//   npm run audit                    # everything
//   npm run audit -- --only /predict  # routes containing "/predict"
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WEB_PORT, ensureServers, stopServers } from "./lib/servers.js";
import { findUnnamed } from "./lib/unnamed.js";

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = opt("base") ?? `http://localhost:${WEB_PORT}`;
const out = resolve(opt("out") ?? join(tmpdir(), "control-scout-audit", new Date().toISOString().replace(/[:.]/g, "-")));
if (out.startsWith(resolve(process.cwd()))) { console.error("Refusing to write inside the repository — use --out outside it."); process.exit(1); }

/** Every route, with real data. `expect404`: API 404s that are the point of the
 *  page. `noApi`: the page works without the API (content, local data, a form),
 *  so it's exempt from the loading/error-state checks, but must still render. */
const ROUTES: { path: string; note: string; expect404?: RegExp; noApi?: boolean }[] = [
  { path: "/", note: "home" },
  { path: "/teams/18360", note: "team with a full season" },
  { path: "/teams/1", note: "team with no current-season matches (empty)" },
  { path: "/teams/99999999", note: "impossible team number (no request)" , noApi: true },
  { path: "/teams/999997", note: "valid number, no such team", expect404: /\/api\/teams\/999997/ },
  { path: "/events", note: "events list" },
  { path: "/events/2025/AUBRQ2", note: "finished event" },
  { path: "/events/2025/AUBRQ2?tab=rankings", note: "event rankings" },
  { path: "/events/2025/AUBRQ2?tab=playoffs", note: "event bracket" },
  { path: "/events/2025/AUBRQ2?tab=odds", note: "advancement odds" },
  { path: "/events/2026/USALATQ", note: "upcoming event, no data yet (empty)" },
  { path: "/predict", note: "prediction lab (empty builder)" , noApi: true },
  { path: "/predict?red=18360,24089&blue=14380,23636&season=2025", note: "a prediction" },
  { path: "/predict?mode=advancement", note: "advancement simulator" },
  { path: "/predict?mode=upcoming", note: "upcoming matches" },
  { path: "/methodology#accuracy", note: "track record (How it works · accuracy)" },
  { path: "/compare", note: "compare (empty)" , noApi: true },
  { path: "/compare?teams=18360,24089", note: "compare two teams" },
  { path: "/my-team", note: "my team (fresh visitor)" , noApi: true },
  { path: "/shortlist", note: "shortlist (fresh visitor, empty)" , noApi: true },
  { path: "/scout", note: "scouting" , noApi: true },
  { path: "/download", note: "offline packs" },
  { path: "/settings", note: "settings" , noApi: true },
  { path: "/methodology", note: "how it works" , noApi: true },
  { path: "/no-such-page", note: "404" , noApi: true },
];
// Git Bash rewrites a leading "/" into its install path (C:/Program Files/Git/...); undo that.
const only = opt("only")?.replace(/\\/g, "/").replace(/^[A-Za-z]:\/.*?\/Git(?=\/|$)/, "");
const routes = only ? ROUTES.filter((r) => r.path.includes(only)) : ROUTES;
if (!routes.length) { console.error(`No route matches --only ${only}`); process.exit(1); }
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
type Viewport = keyof typeof SIZES;

interface Finding { route: string; viewport: Viewport | "-"; mode: "normal" | "loading" | "api-down"; kind: string; detail: string }
const findings: Finding[] = [];
const add = (f: Finding) => findings.push(f);
// tsx keeps function names via an injected __name() helper; functions sent to
// page.evaluate() run in the browser, where that helper doesn't exist.
const SHIM = "globalThis.__name = (f) => f;";
const name = (route: string) => route.replace(/^\//, "").replace(/[^\w-]+/g, "_") || "home";

async function settle(page: Page) {
  await page.waitForFunction(() => !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

async function normal(browser: Browser, r: (typeof ROUTES)[number], vp: Viewport) {
  const ctx = await browser.newContext({ viewport: SIZES[vp], deviceScaleFactor: 1, colorScheme: "dark", isMobile: vp === "mobile", hasTouch: vp === "mobile", reducedMotion: "reduce" });
  await ctx.addInitScript(SHIM);
  const page = await ctx.newPage();
  const f = (kind: string, detail: string) => add({ route: r.path, viewport: vp, mode: "normal", kind, detail });
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    // Motion's development-only notice that it IS reducing motion (the sweep
    // emulates prefers-reduced-motion); stripped from production builds.
    if (m.text().startsWith("You have Reduced Motion enabled on your device")) return;
    // The browser itself logs every 4xx; an expected 404 isn't a finding.
    if (r.expect404 && /Failed to load resource: .*404/.test(m.text()) && r.expect404.test(m.location().url ?? "")) return;
    f(`console-${m.type()}`, m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => f("page-error", e.message.slice(0, 300)));
  page.on("requestfailed", (q) => { if (!/favicon|\.hot-update|__vite/.test(q.url())) f("request-failed", `${q.url()} ${q.failure()?.errorText ?? ""}`); });
  page.on("response", (res) => { if (res.status() >= 400 && !(r.expect404?.test(res.url()))) f("http-error", `${res.status()} ${res.url()}`); });
  const t0 = Date.now();
  await page.goto(BASE + r.path, { waitUntil: "networkidle", timeout: 60_000 });
  await settle(page);
  const ms = Date.now() - t0;
  if (ms > 6000) f("slow", `ready after ${(ms / 1000).toFixed(1)} s`);
  const checks = await page.evaluate(() => {
    const overflow: string[] = [];
    const vw = window.innerWidth;
    for (const el of [document.documentElement, document.body, document.querySelector("main")].filter(Boolean) as HTMLElement[]) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "hidden") overflow.push(`${el.tagName.toLowerCase()} scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
    }
    // Elements sticking out past the viewport (the classic phone side-scroll).
    const wide = [...document.querySelectorAll<HTMLElement>("main *")].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.right > vw + 1 && getComputedStyle(e).position !== "fixed" && !e.closest("[data-scroll-x], .overflow-x-auto, .overflow-auto, .overflow-x-scroll, .overflow-hidden");
    }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").slice(0, 3).join(".")} right=${Math.round(e.getBoundingClientRect().right)}`);
    const text = (document.querySelector("main")?.textContent ?? "").trim().length;
    const mock = /lorem ipsum|placeholder data|sample data|mock|dummy/i.test(document.body.innerText) ? document.body.innerText.match(/.{0,40}(lorem ipsum|placeholder data|sample data|mock|dummy).{0,40}/i)?.[0] ?? "" : "";
    return { overflow, wide, text, mock };
  });
  // Controls with no accessible name: rendered ones, then those inside closed <details>, checked opened (scripts/lib/unnamed.ts).
  const unnamed = await page.evaluate(findUnnamed);
  for (const o of checks.overflow) f("h-overflow", o);
  for (const w of checks.wide) f("wider-than-viewport", w);
  for (const u of unnamed) f("unnamed-control", u);
  if (checks.text < 40) f("blank", `main has ${checks.text} chars of text`);
  if (checks.mock) f("mock-text", checks.mock);
  await page.screenshot({ path: join(out, `${vp}-${name(r.path)}.png`), fullPage: false });
  await ctx.close();
}

/** Loading: API answers after 4 s; at 1.5 s the page must show a skeleton/spinner, not nothing. */
async function loading(browser: Browser, r: (typeof ROUTES)[number]) {
  const ctx = await browser.newContext({ viewport: SIZES.desktop, reducedMotion: "reduce" });
  await ctx.addInitScript(SHIM);
  const page = await ctx.newPage();
  // The server's data comes from /api and /packs (offline packs): slow both.
  for (const pattern of ["**/api/**", "**/packs/**"]) await page.route(pattern, async (route) => { await new Promise((res) => setTimeout(res, 4000)); await route.continue().catch(() => {}); });
  await page.goto(BASE + r.path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => ({
    busy: !!document.querySelector(".skeleton, [aria-busy=true], .animate-spin, .animate-pulse"),
    text: (document.querySelector("main")?.textContent ?? "").trim().length,
  }));
  // A data page must say it's loading; static text alone doesn't count.
  if (!r.noApi && !s.busy) add({ route: r.path, viewport: "desktop", mode: "loading", kind: "no-loading-state", detail: `no skeleton/spinner 1.5 s into a slow load (text ${s.text})` });
  if (r.noApi && s.text < 40) add({ route: r.path, viewport: "desktop", mode: "loading", kind: "blank", detail: `nothing shown (text ${s.text})` });
  await page.screenshot({ path: join(out, `loading-${name(r.path)}.png`) });
  await ctx.close();
}

/** API down: every /api request fails. Within 20 s the page must say so (and offer a way out), never blank or spinning. */
async function apiDown(browser: Browser, r: (typeof ROUTES)[number]) {
  const ctx = await browser.newContext({ viewport: SIZES.desktop, reducedMotion: "reduce" });
  await ctx.addInitScript(SHIM);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const pattern of ["**/api/**", "**/packs/**"]) await page.route(pattern, (route) => route.abort("connectionrefused"));
  await page.goto(BASE + r.path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(20_000);
  const s = await page.evaluate(() => ({
    spinning: !!document.querySelector(".skeleton, [aria-busy=true], .animate-spin"),
    said: /offline|couldn.t|can.t reach|unavailable|try again|retry|no connection|not available|error/i.test(document.querySelector("main")?.textContent ?? ""),
    text: (document.querySelector("main")?.textContent ?? "").trim().length,
  }));
  const f = (kind: string, detail: string) => add({ route: r.path, viewport: "desktop", mode: "api-down", kind, detail });
  if (s.text < 40) f("blank", "main is empty with the API down");
  // A data page must say the data couldn't load; never just static text or a spinner.
  else if (!r.noApi && !s.said) f(s.spinning ? "spins-forever" : "no-error-state", s.spinning ? "still loading after 20 s with the API down" : "no error message with the API down");
  for (const e of errors) f("page-error", e.slice(0, 300));
  await page.screenshot({ path: join(out, `apidown-${name(r.path)}.png`) });
  await ctx.close();
}

/** The search bar, used like a visitor would (found missing on the live site):
 *  open it, type, and expect the right team as a result, at both sizes. */
const SEARCHES: [query: string, expect: RegExp][] = [["4215", /4215 Hypnotic Robotics/], ["X Drvie", /16321 X Drive/], ["18360", /18360 Pymble/]];
async function searchBar(browser: Browser, vp: Viewport) {
  const ctx = await browser.newContext({ viewport: SIZES[vp], isMobile: vp === "mobile", hasTouch: vp === "mobile", reducedMotion: "reduce" });
  await ctx.addInitScript(SHIM);
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90_000 });
  for (const [q, want] of SEARCHES) {
    // The page's one search field: Home's hero field (elsewhere the top-bar field; on phones behind the header button).
    const input = page.getByRole("combobox", { name: "Search teams, events and matches" });
    if (!(await input.isVisible())) await page.getByRole("button", { name: /^Search$/ }).first().click();
    await input.waitFor({ state: "visible" });
    await input.fill("");
    await input.type(q, { delay: 40 });
    const ok = await page.getByRole("option", { name: want }).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
    if (!ok) {
      const shown = (await page.getByRole("listbox").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
      add({ route: "/ (search bar)", viewport: vp, mode: "normal", kind: "search-broken", detail: `"${q}" didn't find ${want.source}; results showed: ${shown}` });
    }
    await page.keyboard.press("Escape");
  }
  await ctx.close();
}

try {
  mkdirSync(out, { recursive: true });
  await ensureServers(BASE, !!opt("base"));
  const browser = await chromium.launch();
  if (!only) {
    for (const vp of ["desktop", "mobile"] as const) await searchBar(browser, vp);
    const n = findings.filter((x) => x.kind === "search-broken").length;
    console.log(`${n ? "✗" : "✓"} search bar: ${SEARCHES.map(([q]) => `"${q}"`).join(", ")} at desktop + mobile${n ? `  ${n} finding(s)` : ""}`);
  }
  for (const r of routes) {
    for (const vp of ["desktop", "mobile"] as const) await normal(browser, r, vp);
    if (!args.includes("--no-states")) { await loading(browser, r); await apiDown(browser, r); }
    const n = findings.filter((x) => x.route === r.path).length;
    console.log(`${n ? "✗" : "✓"} ${r.path}  (${r.note})${n ? `  ${n} finding(s)` : ""}`);
  }
  await browser.close();
  writeFileSync(join(out, "audit.json"), JSON.stringify(findings, null, 2));
  console.log(`\n${findings.length} finding(s). Screenshots + audit.json in ${out}`);
  const byKind = new Map<string, number>();
  for (const x of findings) byKind.set(x.kind, (byKind.get(x.kind) ?? 0) + 1);
  for (const [k, n] of byKind) console.log(`  ${k}: ${n}`);
} finally {
  stopServers();
}
// A sweep with findings fails, so chained checks stop (like audit:flows).
if (findings.length) process.exitCode = 1;
