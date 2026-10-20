// The audit sweep's unnamed-control check (scripts/lib/unnamed.ts) in a real browser: a named link hidden in a
// closed <details> isn't a finding (the V3 audit's false positive), but an unnamed one still is, found by opening it.
// Needs Playwright's Chromium (`npx playwright install chromium`); without it the suite is skipped, saying why.
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { findUnnamed } from "./unnamed.js";

const haveBrowser = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();

describe.skipIf(!haveBrowser)("audit sweep: controls with no accessible name (needs Playwright's Chromium)", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => { browser = await chromium.launch(); page = await browser.newPage(); }, 60_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  const check = async (html: string) => {
    await page.setContent(`<!doctype html><body><main>${html}</main></body>`);
    await page.evaluate("globalThis.__name = (f) => f"); // a transpiler's helper the browser lacks
    return page.evaluate(findUnnamed);
  };

  it("a named link inside a closed <details> isn't flagged (it's read once opened)", async () => {
    expect(await check(`<details><summary>Show more</summary><p>See the <a href="/teams?view=listed">directory of every listed team</a>.</p></details>`)).toEqual([]);
  });

  it("an unnamed link inside a closed <details> is still flagged, found by opening it", async () => {
    const out = await check(`<details><summary>More</summary><a href="/x"><svg width="10" height="10"></svg></a></details>`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^a \(inside a <details>, checked opened\) <a href="\/x">/);
  });

  it("nested closed <details> are opened too, and every <details> is left as it was", async () => {
    const out = await check(`
      <details id="outer"><summary>Outer</summary><details id="inner"><summary>Inner</summary><button></button></details></details>
      <details id="already" open><summary>Open</summary><a href="/y">Named</a></details>`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^button \(inside a <details>/);
    expect(await page.evaluate(() => [...document.querySelectorAll("details")].map((d) => `${d.id}:${d.open}`))).toEqual(["outer:false", "inner:false", "already:true"]);
  });

  it("rendered unnamed controls are flagged; named, hidden and summary-only ones aren't", async () => {
    const out = await check(`
      <a href="/a"></a>
      <button aria-label="Close"><svg width="10" height="10"></svg></button>
      <button style="display:none"></button>
      <div style="visibility:hidden"><button></button></div>
      <label for="q">Search</label><input id="q">
      <input placeholder="Team number">
      <details><summary><a href="/s">Summary link</a></summary><p>Body</p></details>
      <button style="position:fixed;bottom:0;left:0;width:20px;height:20px"></button>`);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^a <a href="\/a">/);
    expect(out[1]).toMatch(/^button <button style="position:fixed/); // fixed controls (bottom bars, toasts) count too
  });
});
