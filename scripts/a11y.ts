// Accessibility sweep: axe-core (WCAG 2.2 A/AA rules) on the public pages, at
// desktop and phone size, in dark and light. Not part of CI (Actions budget);
// run it by hand before and after UI work and paste the summary into the PR.
//
//   npm run a11y                       # every route, 4 variants each
//   npm run a11y -- --only /predict    # routes containing "/predict" (a state too: --only "[scout]")
//   npm run a11y -- --json C:/tmp/a11y.json   # also write every violation (outside the repo)
//   npm run a11y -- --best-practice           # also axe's best-practice rules (heading order, landmarks)
//   npm run a11y -- --rules color-contrast    # only these axe rules (comma-separated)
//
// Chart legends get a contrast check of their own (legend-contrast below): axe skips text it can't place
// over a single background, and Recharts writes each legend label in its series' colour.
//
// Reuses the API + Vite servers on the tool ports (scripts/lib/servers.ts) or
// starts them (AUDIT_WEB_PORT / AUDIT_API_PORT move them when taken).
import { chromium, type Browser, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WEB_PORT, ensureServers, stopServers } from "./lib/servers.js";
import { contrast, over, parseColor, toHex } from "../src/lib/contrast.js";

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
// Git Bash rewrites a leading "/" into its install path; undo that.
const only = opt("only")?.replace(/\\/g, "/").replace(/^[A-Za-z]:\/.*?\/Git(?=\/|$)/, "");
const BASE = `http://localhost:${WEB_PORT}`;

/** A page, optionally in a state reached by `open` (a dialog, a sheet). */
type Route = {
  path: string; name?: string;
  /** Must be visible for the scan to count (beyond the default checks). `phoneReady` replaces it at phone size, for pages laid out differently there. */
  ready?: string; phoneReady?: string;
  storage?: Record<string, unknown>; open?: (page: Page) => Promise<void> };
/** A returning scout: a team of their own, tracked teams and a coloured shortlist (personal keys, as synced). */
const SCOUT: Record<string, unknown> = {
  "cs-personal:myTeam": { value: 18360, updatedAt: 1 },
  "cs-personal:tracked": { value: { teams: [24089, 14380], events: [] }, updatedAt: 1 },
  "cs-personal:bookmarks": { value: [18360, 24089, 14380], updatedAt: 1 },
  "cs-personal:teamColors": { value: { "18360": "gold", "24089": "sky" }, updatedAt: 1 },
};
const ROUTES: Route[] = [
  { path: "/" },
  { path: "/", name: "whats-new", open: async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("cs-open-whats-new"))); await p.getByRole("dialog").first().waitFor({ timeout: 5000 }); await p.waitForFunction(() => !document.querySelector("[role=dialog] [aria-busy=true]"), null, { timeout: 10_000 }); await p.waitForTimeout(400); } },
  { path: "/predict" },
  { path: "/predict?red=18360,24089&blue=14380,23636&season=2025" },
  { path: "/compare" },
  { path: "/compare?teams=18360,24089" },
  { path: "/", name: "scout", storage: SCOUT },
  { path: "/my-team" },
  { path: "/my-team", name: "scout", storage: SCOUT },
  { path: "/my-teams" },
  { path: "/my-teams", name: "scout", storage: SCOUT },
  { path: "/shortlist" },
  { path: "/shortlist", name: "scout", storage: SCOUT },
  { path: "/shortlist", name: "colours", storage: SCOUT, open: async (p) => { await p.getByRole("button", { name: /18360's colour/ }).first().click(); await p.getByRole("radio").first().waitFor({ timeout: 5000 }); } },
  { path: "/download" },
  { path: "/scout" },
  // A past season, so the scan has rows however early the current season is (a fresh local database needs `npm run stats` first).
  { path: "/teams?season=2025", ready: "tbody tr" },
  // Phones show a summary card per match by default (the detailed table is opt-in there); wider screens the table.
  { path: "/matches?season=2025", ready: "tbody tr", phoneReady: "[data-records-summary] > li article" },
  { path: "/faq" },
  { path: "/methodology" },
  { path: "/events/2025/AUBRQ2", ready: "[data-glance-card]" },
  // The pages behind the V3 contrast finding: profile hero, event cards and filter chips, roster record chips, Compare's legend.
  { path: "/teams/18360?season=2025" },
  { path: "/events", ready: "a[href^='/events/']" },
  { path: "/events?season=2025&status=finished&q=Brisbane", ready: "a[href^='/events/2025/']" },
  // A deep-linked tab opens under the slim bar (the glance summary is behind Event details): wait for the roster itself.
  { path: "/events/2025/AUBRQ2?tab=teams", ready: "[role=tabpanel] a[href^='/teams/']" },
  // V4-A11Y-001: the bracket's and Advancement's h3 under the tab's own h2 (run with --best-practice for heading-order).
  { path: "/events/2025/AUBRQ2?tab=playoffs", ready: "[role=tabpanel] h3" },
  { path: "/events/2025/AUBRQ2?tab=awards", ready: "[role=tabpanel] li" },
  { path: "/compare?teams=18360,24089&season=2025", ready: ".recharts-legend-item-text" },
  // The brief open: its sentences and source links.
  { path: "/compare?teams=18360,24089&season=2025&brief=1", ready: "[data-kind]" },
  { path: "/rankings", ready: "tbody tr" },
  { path: "/power-rankings" },
];
const VIEWPORTS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;
const SCHEMES = ["dark", "light"] as const;
// --best-practice adds axe's best-practice rules (heading order, landmarks, regions): advice, not WCAG failures.
const RULES = opt("rules")?.split(",").map((r) => r.trim()).filter(Boolean);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", ...(args.includes("--best-practice") ? ["best-practice"] : [])];

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string; summary: string }[] };
type Result = { route: string; viewport: string; scheme: string; violations: Violation[]; incomplete: string | null };

async function sweep(browser: Browser, r: Route, vp: keyof typeof VIEWPORTS, scheme: (typeof SCHEMES)[number]): Promise<Result> {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], colorScheme: scheme, reducedMotion: "reduce", isMobile: vp === "phone", hasTouch: vp === "phone" });
  // Answer the privacy banner (it would sit on every page) and pick the theme explicitly.
  await ctx.addInitScript((theme) => {
    localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 }));
    localStorage.setItem("cs-personal:settings", JSON.stringify({ value: { theme, density: "comfortable", notify: {} }, updatedAt: 1 }));
  }, scheme);
  if (r.storage) await ctx.addInitScript((entries) => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); },
    Object.fromEntries(Object.entries(r.storage).map(([k, v]) => [k, JSON.stringify(v)])));
  const page = await ctx.newPage();
  await page.goto(BASE + r.path, { waitUntil: "load", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  // A scan only counts once the page has its content: still loading, a not-found page, an error state or a
  // missing `ready` element makes it incomplete (reported as such, never as zero violations).
  const loaded = await page.waitForFunction(() => !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 30_000 }).then(() => true, () => false);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const incomplete = !loaded ? "still loading after 30 s"
    : await page.evaluate(() => {
      const h1 = document.querySelector("main h1")?.textContent?.trim() ?? "";
      if (!h1) return "no page heading";
      if (/off the field|not found/i.test(h1)) return `not-found page ("${h1}")`;
      if (/couldn.t load|something went wrong/i.test(document.querySelector("main")?.textContent ?? "")) return "an error state on the page";
      return null;
    }) ?? await (async () => {
      const ready = vp === "phone" ? r.phoneReady ?? r.ready : r.ready;
      return ready && !(await page.locator(ready).first().isVisible()) ? `${ready} never appeared` : null;
    })();
  if (r.open) await r.open(page);
  // A page that settles its URL after loading (a redirect, a ?param written back) can navigate mid-scan: scan again.
  let res;
  for (let tries = 0; ; tries++) {
    try { const axe = new AxeBuilder({ page }); res = await (RULES ? axe.withRules(RULES) : axe.withTags(TAGS)).analyze(); break; } catch (e) {
      if (tries >= 2 || !/context was destroyed|navigation/i.test(String(e))) throw e;
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
  const legend = !RULES || RULES.includes("color-contrast") ? await legendContrast(page) : [];
  await ctx.close();
  const violations: Violation[] = res.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(" "), summary: (n.failureSummary ?? "").split("\n").slice(1, 2).join(" ").trim() })) }));
  if (legend.length) violations.push({ id: "legend-contrast", impact: "serious", help: "Chart legend text must reach 4.5:1 against the card", nodes: legend });
  return { route: r.path + (r.name ? ` [${r.name}]` : ""), viewport: vp, scheme, incomplete, violations };
}

/** Recharts legend labels under 4.5:1: the text's computed colour against the first opaque background behind it. */
async function legendContrast(page: Page): Promise<Violation["nodes"]> {
  const pairs = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".recharts-legend-item-text")].map((el) => {
    let bg = "rgb(255, 255, 255)";
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) { bg = c; break; }
    }
    return { text: el.textContent ?? "", fg: getComputedStyle(el).color, bg };
  }));
  const out: Violation["nodes"] = [];
  for (const p of pairs) {
    const fg = parseColor(p.fg), bg = parseColor(p.bg);
    if (!fg || !bg) continue;
    const ratio = contrast(over(fg, bg), bg);
    if (ratio < 4.5) out.push({ target: `.recharts-legend-item-text "${p.text}"`, summary: `${ratio.toFixed(2)}:1 (foreground ${toHex(fg)}, background ${toHex(bg)})` });
  }
  return out;
}

try {
  const routes = only ? ROUTES.filter((r) => `${r.path} [${r.name ?? ""}]`.includes(only)) : ROUTES;
  if (!routes.length) { console.error(`No route matches --only ${only}`); process.exit(1); }
  await ensureServers(BASE);
  const browser = await chromium.launch();
  const results: Result[] = [];
  for (const r of routes) for (const vp of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) for (const s of SCHEMES) {
    const res = await sweep(browser, r, vp, s);
    results.push(res);
    const n = res.violations.reduce((a, v) => a + v.nodes.length, 0);
    if (res.incomplete) { console.log(`? ${res.route} ${vp}/${s}: INCOMPLETE, ${res.incomplete}`); continue; }
    console.log(`${n ? "✗" : "✓"} ${res.route} ${vp}/${s}: ${res.violations.length} rules, ${n} nodes${n ? "  " + res.violations.map((v) => `${v.id}(${v.impact}) ×${v.nodes.length}`).join(", ") : ""}`);
  }
  await browser.close();
  // Summary: per route, the distinct rules (with impact) and the node count summed over its variants.
  console.log("\nRoute | rules | nodes (sum over variants)");
  const byRoute = new Map<string, Result[]>();
  for (const r of results) byRoute.set(r.route, [...(byRoute.get(r.route) ?? []), r]);
  let total = 0;
  for (const [route, rs] of byRoute) {
    const rules = new Map<string, string>();
    let nodes = 0;
    for (const r of rs) if (!r.incomplete) for (const v of r.violations) { rules.set(v.id, v.impact ?? "?"); nodes += v.nodes.length; }
    total += nodes;
    const missed = rs.filter((r) => r.incomplete).length;
    console.log(`${route} | ${[...rules].map(([id, imp]) => `${id} (${imp})`).join(", ") || "none"} | ${nodes}${missed ? ` | INCOMPLETE in ${missed} of ${rs.length} variants` : ""}`);
  }
  const incomplete = results.filter((r) => r.incomplete).length;
  console.log(`Total violating nodes: ${total}${incomplete ? ` (INCOMPLETE: ${incomplete} scans didn't reach their content, so this total doesn't cover them)` : ""}`);
  if (incomplete) process.exitCode = 1;
  const json = opt("json");
  if (json) {
    if (resolve(json).startsWith(resolve(process.cwd()))) console.error("Not writing --json inside the repository.");
    else { writeFileSync(json, JSON.stringify(results, null, 2)); console.log(`Wrote ${json}`); }
  }
} finally {
  stopServers();
}
