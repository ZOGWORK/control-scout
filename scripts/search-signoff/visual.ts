// The sign-off's visual pass (scripts/search-signoff/README.md): each query's results page on the live site, signed
// out, headless (the way `npm run shots` takes PRs' shots, never an in-app browser), at desktop 1280 and phone 390,
// read from the page itself:
//   - no sideways scroll
//   - tap targets at least 44px on the phone (inline links in running text are exempt, as in WCAG 2.5.8)
//   - one answer card, no duplicate header, no TEAMS card repeating the answered team
//   - no season picker on a card over every season or a span of them
//   - no yellow/olive-gold band or yellow-bordered answer box, no "read as"/debug text
//   - the desktop results column 640–720px wide
// and a PNG of each, for the report.
//
//   npx tsx scripts/search-signoff/visual.ts --sets C --out C:/tmp/signoff-shots
//   npx tsx scripts/search-signoff/visual.ts --queries "4215 record in 2025-26" "top teams in NJ in 2025-26"
//   npx tsx scripts/search-signoff/visual.ts --sample 10      every set, the first 10 queries of each family
import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (f: string) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };
const BASE = (arg("base") ?? "https://controlscout.org").replace(/\/$/, "");
const OUT = arg("out") ?? join(tmpdir(), "control-scout-signoff", `shots-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
mkdirSync(OUT, { recursive: true });
const load = <T>(f: string): T => JSON.parse(readFileSync(join(import.meta.dirname, "sets", f), "utf8"));

type Item = { id: string; q: string };
const items: Item[] = [];
const qi = argv.indexOf("--queries");
if (qi >= 0) argv.slice(qi + 1).filter((x) => !x.startsWith("--")).forEach((q, i) => items.push({ id: `Q${i + 1}`, q }));
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

type Check = { id: string; q: string; view: string; issues: string[]; png: string };
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
  // season picker on it would offer to narrow what was never one season.
  for (const f of frames) {
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

const browser = await chromium.launch();
const checks: Check[] = [];
for (const v of VIEWS) {
  // A fresh context per viewport: signed out, no stored state, phones as phones.
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 2, isMobile: v.mobile, hasTouch: v.mobile, colorScheme: "dark" });
  // tsx names the audit's inner functions with an __name helper the page doesn't have.
  await ctx.addInitScript("window.__name = (f) => f");
  // The privacy question answered "No thanks" up front, as npm run shots does, so it never covers the answer.
  await ctx.addInitScript(() => localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })));
  const page = await ctx.newPage();
  for (const it of items) {
    const png = join(OUT, `${it.id.replace(/[^\w.-]/g, "_")}-${v.name}.png`);
    let issues: string[];
    try {
      await page.goto(`${BASE}/search?q=${encodeURIComponent(it.q)}`, { waitUntil: "networkidle", timeout: 45_000 });
      await page.waitForSelector("[data-answer-frame], [data-no-results], [data-result]", { timeout: 20_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      issues = await audit(page, v.mobile);
      await page.screenshot({ path: png, fullPage: true });
    } catch (e) { issues = [`page failed: ${String(e).slice(0, 120)}`]; }
    checks.push({ id: it.id, q: it.q, view: v.name, issues, png });
    console.log(`${issues.length ? "FAIL" : "ok  "} ${v.name.padEnd(7)} ${it.id} ${it.q}${issues.length ? `\n       ${issues.join("; ")}` : ""}`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(OUT, "visual.json"), JSON.stringify(checks, null, 1));
const bad = checks.filter((c) => c.issues.length);
const pats = new Map<string, number>();
for (const c of bad) for (const i of c.issues) { const k = i.replace(/\d+(px|×\d+)?|"[^"]*"/g, "#").replace(/\(.*\)/, "").trim(); pats.set(k, (pats.get(k) ?? 0) + 1); }
console.log(`\n${checks.length - bad.length}/${checks.length} page views clean · shots in ${OUT}`);
for (const [k, n] of [...pats].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`);
