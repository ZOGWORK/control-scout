// The search completion tests that need a real browser (docs/search.md), headless, against the real API and
// app on the tool ports (scripts/lib/servers.ts) and the local data. No screenshots here (npm run shots takes
// those): each check reads the page and prints PASS/FAIL with what it saw.
//
//   AUDIT_WEB_PORT=5289 AUDIT_API_PORT=3289 npx tsx scripts/search-experiment/browser.ts [--out <dir>]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { WEB_PORT, ensureServers, stopServers } from "../lib/servers.js";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", ".");
const BASE = `http://localhost:${WEB_PORT}`;
const results: { id: string; name: string; pass: boolean; evidence: string[] }[] = [];

async function test(id: string, name: string, fn: (ev: string[]) => Promise<boolean>) {
  const ev: string[] = [];
  let pass = false;
  try { pass = await fn(ev); } catch (e) { ev.push(`threw: ${(e as Error).message.split("\n")[0]}`); }
  results.push({ id, name, pass, evidence: ev });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${name}\n${ev.map((e) => `       ${e}`).join("\n")}`);
}

await ensureServers(BASE);
const browser = await chromium.launch();
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } } as const;
async function open(size: keyof typeof SIZES, path = "/teams", slow = 0): Promise<Page> {
  const ctx = await browser.newContext({ viewport: SIZES[size], isMobile: size === "phone", hasTouch: size === "phone" });
  await ctx.addInitScript(() => localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })));
  const page = await ctx.newPage();
  if (slow) await page.route(/\/api\/search\?/, async (r) => { await new Promise((x) => setTimeout(x, slow)); await r.continue(); });
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  return page;
}
const field = (p: Page) => p.getByRole("combobox", { name: "Search teams, events and matches" });
async function search(p: Page, size: keyof typeof SIZES, q: string) {
  if (size === "phone") await p.getByRole("button", { name: "Search", exact: true }).first().click();
  else await field(p).click();
  await field(p).pressSequentially(q, { delay: 40 });
  await p.getByRole("listbox").waitFor();
  await p.waitForFunction(() => !document.querySelector("[role=listbox]")?.textContent?.includes("Searching…"), null, { timeout: 15_000 });
}
const options = (p: Page) => p.getByRole("option").allInnerTexts();

try {
  for (const size of ["phone", "desktop"] as const) {
    await test(size === "phone" ? "T17a" : "T17b", `signed out at ${SIZES[size].width}px: usable, the list under the field, no focus trap`, async (ev) => {
      const p = await open(size);
      await search(p, size, "hypnotic");
      const f = (await field(p).boundingBox())!, l = (await p.getByRole("listbox").boundingBox())!;
      const opts = await options(p);
      ev.push(`field ${Math.round(f.y)}–${Math.round(f.y + f.height)}px, list from ${Math.round(l.y)}px, width ${Math.round(l.width)}px of ${SIZES[size].width}; first option "${opts[0]?.split("\n")[0]}"`);
      const scrollX = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      for (let i = 0; i < 3; i++) await p.keyboard.press("Tab");
      const out = await p.evaluate(() => !document.activeElement?.closest("[data-search-box]"));
      ev.push(`horizontal overflow ${scrollX}px; after 3 Tabs focus is outside the search: ${out}`);
      await p.context().close();
      return l.y >= f.y + f.height - 1 && opts[0]?.includes("4215") && scrollX <= 0 && out;
    });
  }
  await test("T36", "a phone visitor's typo still finds the team", async (ev) => {
    const p = await open("phone");
    await search(p, "phone", "hipnotic");
    const opts = await options(p);
    ev.push(`"hipnotic" → "${opts[0]?.split("\n")[0]}"; note "${(await p.getByRole("listbox").innerText()).split("\n")[0]}"`);
    await p.context().close();
    return opts[0]?.includes("4215 Hypnotic Robotics");
  });
  await test("T37", "typing errors at speed: the last query's results win", async (ev) => {
    const p = await open("desktop");
    await field(p).click();
    await field(p).pressSequentially("bad wulf", { delay: 15 });
    await p.waitForTimeout(1500);
    const opts = await options(p);
    ev.push(`"bad wulf" typed at 15 ms a key → "${opts[0]?.split("\n")[0]}"`);
    await p.context().close();
    return opts[0]?.includes("6980 Bad Wolf");
  });
  await test("T40", "slow network (1.5 s a search): typing never waits, a loading state shows, results arrive", async (ev) => {
    const p = await open("desktop", "/teams", 1500);
    await field(p).click();
    const t0 = Date.now();
    await field(p).pressSequentially("hypnotic", { delay: 30 });
    const typedMs = Date.now() - t0;
    const loading = await p.getByRole("listbox").innerText();
    await p.getByRole("option", { name: /4215/ }).first().waitFor({ timeout: 10_000 });
    ev.push(`8 keys typed in ${typedMs} ms; while waiting the list said "${loading.trim()}"; then ${(await options(p))[0]?.split("\n")[0]}`);
    const url = p.url();
    await p.context().close();
    return loading.includes("Searching…") && typedMs < 1500 && url.endsWith("/teams");
  });
  await test("T21", "no auto-navigation: results never open on their own", async (ev) => {
    const p = await open("desktop");
    await search(p, "desktop", "4215");
    await p.waitForTimeout(1500);
    ev.push(`still on ${new URL(p.url()).pathname} with ${(await options(p)).length} option(s)`);
    const ok = new URL(p.url()).pathname === "/teams";
    await p.keyboard.press("Enter");
    await p.waitForURL(/\/teams\/4215/);
    ev.push(`Enter → ${new URL(p.url()).pathname}`);
    await p.context().close();
    return ok;
  });
  await test("T58b", "keyboard only: Ctrl K, type, Down, Enter opens the second result; Escape keeps focus", async (ev) => {
    const p = await open("desktop");
    await p.keyboard.press("Control+k");
    await p.keyboard.type("hypnotic vs bad wolf", { delay: 30 });
    await p.getByRole("option").first().waitFor();
    await p.waitForTimeout(600);
    await p.keyboard.press("Escape");
    const kept = await p.evaluate(() => document.activeElement?.getAttribute("role"));
    await p.keyboard.press("ArrowDown");
    await p.getByRole("listbox").waitFor();
    await p.keyboard.press("Enter");
    await p.waitForURL(/\/compare\?teams=4215,6980/);
    ev.push(`after Escape focus is on the ${kept}; Down reopens, Enter → ${new URL(p.url()).pathname}${new URL(p.url()).search}`);
    await p.context().close();
    return kept === "combobox";
  });
  await test("T60", "Back from a result restores the /search query and its results", async (ev) => {
    const p = await open("desktop", "/search?q=hypnotic%20ranking%20points");
    await p.getByRole("link", { name: /4215 Hypnotic Robotics/ }).first().click();
    await p.waitForURL(/\/teams\/4215/);
    await p.goBack();
    await p.getByRole("link", { name: /4215 Hypnotic Robotics/ }).first().waitFor();
    const value = await p.getByRole("searchbox").inputValue();
    ev.push(`back on ${new URL(p.url()).pathname}${new URL(p.url()).search}, field "${value}", result there`);
    await p.context().close();
    return value === "hypnotic ranking points";
  });
  await test("T19", "the address bar's search lands: /search?q= opens with the answer (what Tab-to-search sends)", async (ev) => {
    const p = await open("desktop", "/search?q=hypnotic%20OPR");
    const text = await p.locator("main").innerText();
    ev.push(`page shows "OPR 101.6": ${text.includes("101.6")}; events to pick listed: ${text.includes("USNJ") || text.includes("Northern League")}`);
    const link = await p.evaluate(() => document.querySelector('link[rel="search"]')?.getAttribute("href"));
    ev.push(`<link rel="search"> → ${link}; the browser's own Tab-to-search prompt itself can't be driven headless (manual check after deploy)`);
    await p.context().close();
    return text.includes("101.6") && link === "/opensearch.xml";
  });
  await test("T72b", "Compare from \"hypnotic versus bad wolf reputation\": histories and awards, no reputation score", async (ev) => {
    const p = await open("desktop");
    await search(p, "desktop", "hypnotic versus bad wolf reputation");
    const list = await p.getByRole("listbox").innerText();
    ev.push(`list notes: ${list.split("\n").slice(0, 2).join(" / ")}`);
    await p.keyboard.press("Enter");
    await p.waitForURL(/\/compare\?teams=4215,6980/);
    await p.getByRole("region", { name: "Events and awards" }).or(p.getByText("Events and awards")).first().waitFor({ timeout: 20_000 });
    const page = await p.locator("main").innerText();
    ev.push(`Compare shows "Events and awards": ${page.includes("Events and awards")}; an award listed: ${/Inspire|Winner|Think|Connect|Motivate|Design|Innovate|Control/.test(page)}; "reputation" anywhere on the page: ${/reputation/i.test(page)}`);
    await p.context().close();
    return list.includes("no reputation score") && page.includes("Events and awards") && !/reputation/i.test(page);
  });
} finally {
  await browser.close();
  stopServers();
}
writeFileSync(join(OUT, "browser.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((f) => f.id).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
