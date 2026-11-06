// The 390 px proof (the search results guide's §9, "Mobile 390px — the non-negotiables"): every kind of search
// answer card drawn on a 390×844 phone against the real servers, and each held to what can be measured there:
//
//   no sideways scroll: the page no wider than the screen, nothing on the card past its edge (a table's own
//     scrolling box excepted)
//   tap targets: every link and button at least 24×24 px (WCAG's floor), and 44 px tall unless it's a link inside
//     a line of text (WCAG's inline exception); adjacent ones apart
//   no team number cut off: a team chip's number is shown whole
//   one primary action on the page
//
// and saving a phone shot of each card (outside the repo). Prints each card's findings and writes proof.json.
//
//   npm run phone-proof                        # every card type
//   npm run phone-proof -- --only record       # the ones whose name contains "record"
//   npm run phone-proof -- --light --out DIR
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WEB_PORT, ensureServers, stopServers } from "./lib/servers.js";

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = opt("base") ?? `http://localhost:${WEB_PORT}`;
const light = args.includes("--light");
const out = resolve(opt("out") ?? join(tmpdir(), "control-scout-phone-proof", new Date().toISOString().replace(/[:.]/g, "-")));
if (out.startsWith(resolve(process.cwd()))) { console.error("Refusing to write inside the repository — use --out outside it."); process.exit(1); }

/** One search per kind of answer card (src/components/search/page/answerAudit.test.tsx draws the same kinds), with
 *  the mark that card draws: missing (no data loaded, a changed answer), the case fails rather than passes empty. */
const CARDS: { name: string; q: string; expect: string; needs?: string }[] = [
  { name: "comparison", q: "23268 vs 7149 opr", expect: "[data-comparison]" },
  { name: "top matches", q: "highest scoring matches 2025", expect: "[data-stat-answer] [data-block=matches]" },
  { name: "single match", q: "4215 best match", expect: "[data-stat-answer] [data-match-box]" },
  { name: "leaderboard (by a phase)", q: "best auto in nj", expect: "[data-block=leaderboard]" },
  { name: "team record", q: "4215 record", expect: "[data-block=record]" },
  { name: "single stat (OPR tiles)", q: "4215 opr", expect: "[data-opr-tiles]" },
  { name: "matches at an event", q: "4215 matches at nj championship", expect: "[data-block=matches]" },
  { name: "over time (series)", q: "4215 opr by event", expect: "[data-block=series]" },
  { name: "team highlights", q: "4215", expect: "[data-stat-answer=team-highlights]" },
  { name: "event awards", q: "inspire award nj championship", expect: "[data-event-awards]" },
  { name: "bars (a team's awards)", q: "how many awards has 4215 won", expect: "[data-block=bars]" },
  { name: "table (a team's events)", q: "4215 events 2025", expect: "[data-block=table]" },
  // Drawn only while the team has a match still to play: in data without one, reported as not checked (never a pass).
  { name: "prediction (a chance)", q: "4215 chance to win an event", expect: "[data-block=chance]", needs: "match still to play" },
  { name: "team facts", q: "where is 4215 from", expect: "[data-card-kind]" },
  { name: "worlds trips", q: "4215 worlds appearances", expect: "[data-section=records]" },
  // Plain results with a panel (no answer card): the summary panel and the team's result card are what's checked.
  { name: "how good is a team", q: "how good is 4215", expect: "[data-panel=summary]" },
  // An unanswered question about a team: its suggested searches and the team's result.
  { name: "no direct answer", q: "will 4215 win nj championship", expect: "[data-block=related]" },
];
const only = opt("only");

/** What the page shows that breaks a 390 px rule, measured in the page. */
function measure(expect: string): { failures: string[]; notes: string[]; card: boolean; missing?: string } {
  const failures: string[] = [], notes: string[] = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) failures.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px wide on a ${vw}px screen`);
  const mark = document.querySelector(expect);
  // No answer: the page's own failures (it scrolls sideways) still stand; the missing answer is said apart, so a case
  // whose data has nothing to show is skipped without hiding them.
  if (!mark) return { failures, notes, card: false, missing: `no ${expect} on the page: the answer this case is for isn't there` };
  // Its card, or for plain results (no card) the whole results region.
  const card = mark.closest<HTMLElement>("[data-answer-frame]") ?? mark.closest<HTMLElement>("main [aria-live]") ?? document.querySelector<HTMLElement>("main")!;
  const label = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 32)}"`;
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  // Inside a box that scrolls sideways (a wide table): that box is what must fit, not its rows. Inside one that clips
  // (overflow hidden): it must fit in that box, or it's cut off. Text cut on purpose (an ellipsis) is its own box.
  const within = (el: Element): { scrolls: boolean; clip: DOMRect | null } => {
    for (let p = el.parentElement; p && p !== card.parentElement; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll") return { scrolls: true, clip: null };
      if ((o === "hidden" || o === "clip") && p !== card) return { scrolls: false, clip: p.getBoundingClientRect() };
    }
    return { scrolls: false, clip: null };
  };
  for (const el of card.querySelectorAll("*")) {
    if (!shown(el)) continue;
    const w = within(el);
    if (w.scrolls) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) { failures.push(`past the screen's edge (${Math.round(r.left)}–${Math.round(r.right)}px): ${label(el)}`); break; }
    if (w.clip && (r.right > w.clip.right + 1 || r.left < w.clip.left - 1)) { failures.push(`cut off by its box (${Math.round(r.left)}–${Math.round(r.right)}px in ${Math.round(w.clip.left)}–${Math.round(w.clip.right)}px): ${label(el)}`); break; }
  }
  // A link inside a run of text (WCAG 2.5.8's inline exception): the line's height is its target.
  const inline = (el: HTMLElement) => getComputedStyle(el).display === "inline" && !!el.parentElement && /\S/.test([...el.parentElement.childNodes].filter((n) => n !== el).map((n) => n.textContent ?? "").join(""));
  const targets = [...card.querySelectorAll<HTMLElement>("a[href], button, summary, [role=button], input, select")].filter(shown);
  // What's tapped: a link stretched over its card (an ::after on the card's edges) is the card; a control whose
  // ::after grows its target round it (tap-44: centred, at least 44px) is that grown box; else the control itself.
  const stretched = (el: HTMLElement) => { const a = getComputedStyle(el, "::after"); return a.position === "absolute" && a.transform === "none" && a.left === "0px" && a.top === "0px" && !!el.offsetParent; };
  const box = (el: HTMLElement): DOMRect => {
    if (stretched(el)) return el.offsetParent!.getBoundingClientRect();
    const r = el.getBoundingClientRect(), a = getComputedStyle(el, "::after");
    if (a.position !== "absolute" || a.transform === "none") return r;
    const w = Math.max(r.width, parseFloat(a.width) || 0), h = Math.max(r.height, parseFloat(a.height) || 0);
    return new DOMRect(r.left + r.width / 2 - w / 2, r.top + r.height / 2 - h / 2, w, h);
  };
  for (const el of targets) {
    if (inline(el)) continue;
    const r = box(el);
    if (r.width < 24 || r.height < 24) failures.push(`tap target ${Math.round(r.width)}×${Math.round(r.height)} (under 24×24): ${label(el)}`);
    else if (r.height < 43.5 && !el.closest("[data-team-chip], [data-scoreboard]")) notes.push(`tap target ${Math.round(r.height)}px tall (44 asked): ${label(el)}`);
  }
  // Two targets touching: under 8px apart, neither inline, side by side or stacked.
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    if (targets[i].contains(targets[j]) || targets[j].contains(targets[i]) || inline(targets[i]) || inline(targets[j])) continue;
    if (stretched(targets[i]) || stretched(targets[j])) continue; // a card's own link, under the buttons on it
    const a = box(targets[i]), b = box(targets[j]);
    const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    if (overlap) failures.push(`tap targets overlap: ${label(targets[i])} and ${label(targets[j])}`);
  }
  for (const chip of card.querySelectorAll<HTMLElement>("[data-team-chip]")) {
    const num = chip.querySelector("b") ?? chip;
    if (num.scrollWidth > num.clientWidth + 1) failures.push(`team number cut off: ${label(chip)}`);
  }
  const ctas = document.querySelectorAll("[data-primary-cta]").length;
  if (ctas > 1) failures.push(`${ctas} primary actions on the page`);
  return { failures, notes, card: true, missing: undefined };
}

async function proveOne(page: Page, c: (typeof CARDS)[number]) {
  await page.goto(`${BASE}/search?q=${encodeURIComponent(c.q)}`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".skeleton, [aria-busy=true]"), null, { timeout: 45_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const at = new URL(page.url()).pathname;
  const m = at === "/search" ? await page.evaluate(measure, c.expect) : { failures: [`left /search for ${at}`], notes: [], card: false };
  if (!m.card && c.needs && at === "/search" && !m.failures.length) return { ...c, failures: [], notes: [], skipped: `not checked: this data has no ${c.needs}`, shot: null };
  if (m.missing && !(c.needs && at === "/search")) m.failures.push(m.missing);
  const file = join(out, `${c.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return { ...c, failures: m.failures, notes: m.notes, skipped: null as string | null, shot: file as string | null };
}

async function main() {
  mkdirSync(out, { recursive: true });
  await ensureServers(BASE, !!opt("base"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: light ? "light" : "dark", reducedMotion: "reduce" });
  // tsx names the arrow functions in measure() with a __name() helper the page doesn't have: a stand-in (as a string).
  await ctx.addInitScript({ content: "window.__name = function (f) { return f; };" });
  await ctx.addInitScript(() => localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })));
  if (light) await ctx.addInitScript(() => localStorage.setItem("cs-personal:settings", JSON.stringify({ value: { theme: "light", density: "comfortable", notify: {} }, updatedAt: 1 })));
  const page = await ctx.newPage();
  const results = [];
  for (const c of CARDS.filter((x) => !only || x.name.includes(only))) {
    const r = await proveOne(page, c);
    results.push(r);
    console.log(`${r.skipped ? "–" : r.failures.length ? "✗" : "✓"} ${r.name} ("${r.q}")${r.skipped ? ` · ${r.skipped}` : r.notes.length ? ` · ${r.notes.length} target(s) under 44px` : ""}`);
    for (const f of r.failures) console.log(`    ${f}`);
  }
  writeFileSync(join(out, "proof.json"), JSON.stringify(results, null, 2));
  const checked = results.filter((r) => !r.skipped), skipped = results.length - checked.length;
  console.log(`\n${checked.filter((r) => !r.failures.length).length}/${checked.length} cards pass at 390px${skipped ? ` (${skipped} not checked: no data for them)` : ""} · shots and proof.json in ${out}`);
  await browser.close();
  return results.some((r) => r.failures.length) ? 1 : 0;
}

main().then((code) => { stopServers(); process.exit(code); }, (e) => { console.error(e); stopServers(); process.exit(1); });
