// Accessibility sweep: axe-core (WCAG 2.2 A/AA rules) on the public pages, at
// desktop and phone size, in dark and light. Not part of CI (Actions budget);
// run it by hand before and after UI work and paste the summary into the PR.
//
//   npm run a11y                       # every route, 4 variants each
//   npm run a11y -- --only /predict    # routes containing "/predict" (a state too: --only "[scout]")
//   npm run a11y -- --json C:/tmp/a11y.json   # also write every violation (outside the repo)
//   npm run a11y -- --best-practice           # also axe's best-practice rules (heading order, landmarks)
//
// Reuses the API + Vite servers on the tool ports (scripts/lib/servers.ts) or
// starts them (AUDIT_WEB_PORT / AUDIT_API_PORT move them when taken).
import { chromium, type Browser, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WEB_PORT, ensureServers, stopServers } from "./lib/servers.js";

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
// Git Bash rewrites a leading "/" into its install path; undo that.
const only = opt("only")?.replace(/\\/g, "/").replace(/^[A-Za-z]:\/.*?\/Git(?=\/|$)/, "");
const BASE = `http://localhost:${WEB_PORT}`;

/** A page, optionally in a state reached by `open` (a dialog, a sheet). */
type Route = { path: string; name?: string; storage?: Record<string, unknown>; open?: (page: Page) => Promise<void> };
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
  { path: "/teams" },
  { path: "/matches" },
  { path: "/faq" },
  { path: "/events/2025/AUBRQ2" },
];
const VIEWPORTS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;
const SCHEMES = ["dark", "light"] as const;
// --best-practice adds axe's best-practice rules (heading order, landmarks, regions): advice, not WCAG failures.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", ...(args.includes("--best-practice") ? ["best-practice"] : [])];

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string; summary: string }[] };
type Result = { route: string; viewport: string; scheme: string; violations: Violation[] };

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
  await page.waitForFunction(() => !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  if (r.open) await r.open(page);
  // A page that settles its URL after loading (a redirect, a ?param written back) can navigate mid-scan: scan again.
  let res;
  for (let tries = 0; ; tries++) {
    try { res = await new AxeBuilder({ page }).withTags(TAGS).analyze(); break; } catch (e) {
      if (tries >= 2 || !/context was destroyed|navigation/i.test(String(e))) throw e;
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
  await ctx.close();
  return {
    route: r.path + (r.name ? ` [${r.name}]` : ""), viewport: vp, scheme,
    violations: res.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(" "), summary: (n.failureSummary ?? "").split("\n").slice(1, 2).join(" ").trim() })) })),
  };
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
    console.log(`${n ? "✗" : "✓"} ${res.route} ${vp}/${s}: ${res.violations.length} rules, ${n} nodes${n ? "  " + res.violations.map((v) => `${v.id}(${v.impact}) ×${v.nodes.length}`).join(", ") : ""}`);
  }
  await browser.close();
  // Summary: per route, the distinct rules (with impact) and the worst node count over the 4 variants.
  console.log("\nRoute | rules | nodes (sum over variants)");
  const byRoute = new Map<string, Result[]>();
  for (const r of results) byRoute.set(r.route, [...(byRoute.get(r.route) ?? []), r]);
  let total = 0;
  for (const [route, rs] of byRoute) {
    const rules = new Map<string, string>();
    let nodes = 0;
    for (const r of rs) for (const v of r.violations) { rules.set(v.id, v.impact ?? "?"); nodes += v.nodes.length; }
    total += nodes;
    console.log(`${route} | ${[...rules].map(([id, imp]) => `${id} (${imp})`).join(", ") || "none"} | ${nodes}`);
  }
  console.log(`Total violating nodes: ${total}`);
  const json = opt("json");
  if (json) {
    if (resolve(json).startsWith(resolve(process.cwd()))) console.error("Not writing --json inside the repository.");
    else { writeFileSync(json, JSON.stringify(results, null, 2)); console.log(`Wrote ${json}`); }
  }
} finally {
  stopServers();
}
