// The first-visit onboarding's acceptance journeys, against any running copy of the app:
//
//   npx tsx scripts/onboarding-journeys.ts                       (https://controlscout.org)
//   npx tsx scripts/onboarding-journeys.ts --base http://localhost:5173
//
// Every journey starts from a fresh browser context (a clean profile: no storage, no cookies). In Chromium the
// automation fingerprint is switched off (navigator.webdriver false, an ordinary user agent), so the site treats it
// as a person and nothing is seeded. WebKit (the iPhone engine) can't hide that it's automated, so there the
// automation opt-in `cs-onboarding-demo` is set, and nothing else.
//
// Desktop is 1440×900; phone is 390×844 with touch and a mobile user agent. It checks, it doesn't take pictures:
// screenshots come from `npm run shots -- --onboarding` (AGENTS.md).
// Prints PASS/FAIL per check and exits 1 on any failure.
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = (opt("base") ?? "https://controlscout.org").replace(/\/+$/, "");
const ENGINES = (opt("engines") ?? "chromium,webkit").split(",");

const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UA_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const DIALOG = "[data-onboarding]";
const STEPS = 4;
/** Long enough for anything that was going to open to have opened. */
const QUIET_MS = 5000;

type Size = "desktop" | "390";
let failures = 0;
const results: string[] = [];
function check(ok: boolean, label: string): boolean {
  if (!ok) failures++;
  const line = `${ok ? "PASS" : "FAIL"} ${label}`;
  results.push(line);
  console.log(line);
  return ok;
}

async function context(browser: Browser, engine: string, size: Size, storage?: Record<string, string>): Promise<BrowserContext> {
  const phone = size === "390";
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: phone && engine === "chromium", hasTouch: phone,
    userAgent: engine === "webkit" ? (phone ? UA_IPHONE : undefined) : phone ? UA_PHONE : UA_DESKTOP,
  });
  const seed = { ...(engine === "webkit" ? { "cs-onboarding-demo": "1" } : {}), ...(storage ?? {}) };
  if (Object.keys(seed).length) await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, seed);
  return ctx;
}

/** The privacy banner comes first on a clean profile: answer it the way a person would. */
async function answerPrivacy(page: Page) {
  const no = page.getByRole("button", { name: /no thanks/i });
  try { await no.first().waitFor({ state: "visible", timeout: 8000 }); await no.first().click(); } catch { /* none (GPC) or already answered */ }
}

const open = (page: Page) => page.locator(DIALOG).isVisible();
const stepNow = async (page: Page) => Number(await page.locator(DIALOG).getAttribute("data-onboarding-step").catch(() => "0"));
async function waitOpen(page: Page, ms = 15000) { await page.locator(DIALOG).waitFor({ state: "visible", timeout: ms }); }

/** Everything that must NOT close it, tried on the step it's on. Returns the ways that did. */
async function tryToEscape(page: Page, size: Size): Promise<string[]> {
  const step = await stepNow(page);
  const leaks: string[] = [];
  const still = async (how: string) => { await page.waitForTimeout(250); if (!(await open(page)) || (await stepNow(page)) !== step) leaks.push(how); };
  const vp = page.viewportSize()!;
  const panel = await page.locator(DIALOG).boundingBox();
  await page.keyboard.press("Escape"); await still("Escape");
  // Escape while typing in the team box (step 2).
  const input = page.locator(`${DIALOG} input`);
  if (await input.count()) { await input.first().focus(); await page.keyboard.press("Escape"); await still("Escape in the team box"); }
  // The backdrop and the page around the panel: corners, and beside the panel where there's room.
  // On a phone the sheet covers the whole screen, so there's no page left to tap: a tap on its own top corner and on its
  // text stands in. On desktop: the backdrop's corners, beside and above the panel, and where the sidebar sits.
  const spots: [number, number, string][] = [[4, 4, "top-left corner"]];
  if (size === "desktop") {
    spots.push([vp.width - 4, vp.height - 4, "bottom-right corner"], [60, 120, "the sidebar's place"]);
    if (panel && panel.x > 40) spots.push([Math.round(panel.x / 2), Math.round(vp.height / 2), "backdrop beside the panel"]);
    if (panel && panel.y > 40) spots.push([Math.round(vp.width / 2), Math.round(panel.y / 2), "backdrop above the panel"]);
  } else {
    const t = await page.locator(`${DIALOG} h2`).boundingBox();
    if (t) spots.push([Math.round(t.x + t.width / 2), Math.round(t.y + t.height / 2), "the step's title"]);
  }
  for (const [x, y, label] of spots) {
    if (size === "390") await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    await still(`${size === "390" ? "tap" : "click"} on ${label}`);
  }
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K"); await still("Ctrl/⌘ K");
  await page.locator(`${DIALOG} [data-onboarding-next]`).focus();
  await page.keyboard.press("/"); await still('"/"');
  return leaks;
}

async function runEngine(engine: string) {
  const browser = await (engine === "webkit" ? webkit : chromium).launch(engine === "chromium" ? { args: ["--disable-blink-features=AutomationControlled"] } : {});
  const tag = (size: Size) => `${engine} ${size}`;

  for (const size of ["desktop", "390"] as Size[]) {
    // Journey 1 + 2: a first-time visitor opens Home; the new onboarding appears; nothing but Skip closes it on any step.
    {
      const ctx = await context(browser, engine, size);
      const page = await ctx.newPage();
      if (engine === "chromium") check((await page.evaluate(() => navigator.webdriver)) === false, `${tag(size)} · clean profile reads as a person`);
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await answerPrivacy(page);
      let appeared = true;
      try { await waitOpen(page); } catch { appeared = false; }
      check(appeared, `${tag(size)} · J1 first visit to Home: the onboarding appears`);
      if (appeared) {
        const title = (await page.locator(`${DIALOG} h2`).innerText()).replace(/^Step \d of \d:\s*/, "");
        check(/Welcome to Control Scout/.test(title) && (await page.locator("[data-welcome], [data-tour-card], [data-tour]").count()) === 0, `${tag(size)} · J1 it's the new design (step 1 "${title.trim()}"), nothing from the old one`);
        const skipBoxes: string[] = [];
        for (let s = 1; s <= STEPS; s++) {
          check((await stepNow(page)) === s, `${tag(size)} · on step ${s}`);
          const leaks = await tryToEscape(page, size);
          check(leaks.length === 0, `${tag(size)} · J2 step ${s}: Escape, backdrop, outside ${size === "390" ? "taps" : "clicks"}, Ctrl K and "/" leave it open${leaks.length ? ` (closed by: ${leaks.join(", ")})` : ""}`);
          // Journey 6 (and desktop alike): readable and reachable, Skip in the same place on every step.
          const skip = await page.locator(`${DIALOG} [data-onboarding-skip]`).boundingBox();
          const next = await page.locator(`${DIALOG} [data-onboarding-next]`).boundingBox();
          const back = s > 1 ? await page.locator(`${DIALOG} [data-onboarding-back]`).boundingBox() : null;
          const vp = page.viewportSize()!;
          const inView = (b: { x: number; y: number; width: number; height: number } | null) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;
          check(inView(skip) && skip!.width >= 44 && skip!.height >= 44, `${tag(size)} · J6 step ${s}: Skip on screen and at least 44×44 (${skip ? `${Math.round(skip.width)}×${Math.round(skip.height)} at ${Math.round(skip.x)},${Math.round(skip.y)}` : "missing"})`);
          skipBoxes.push(skip ? `${Math.round(skip.x)},${Math.round(skip.y)},${Math.round(skip.width)}x${Math.round(skip.height)}` : "none");
          check(inView(next) && (s === 1 || inView(back)), `${tag(size)} · J6 step ${s}: every button on screen`);
          const fits = await page.locator(DIALOG).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll<HTMLElement>("*")].every((c) => { const b = c.getBoundingClientRect(); return !b.width || (b.left >= r.left - 1 && b.right <= r.right + 1); });
          });
          check(fits, `${tag(size)} · J6 step ${s}: nothing spills sideways`);
          const small = await page.locator(DIALOG).evaluate((el) => [...el.querySelectorAll<HTMLElement>("p, span, li, h2, button")].filter((c) => c.innerText.trim() && c.getClientRects().length && parseFloat(getComputedStyle(c).fontSize) < 11.5).length);
          check(small === 0, `${tag(size)} · J6 step ${s}: no text smaller than 12px (${small} found)`);
          if (s < STEPS) await page.locator(`${DIALOG} [data-onboarding-next]`).click();
        }
        check(new Set(skipBoxes).size === 1, `${tag(size)} · J6 Skip sits in the same place on all ${STEPS} steps (${[...new Set(skipBoxes)].join(" | ")})`);
        // Browser Back must not close it either.
        const backAgain = async () => { try { await waitOpen(page, 15000); return true; } catch { return false; } };
        await page.goto(BASE + "/teams/4215", { waitUntil: "domcontentloaded" });
        check(await backAgain(), `${tag(size)} · J2 going to another page keeps it open (a reload or a route change can't end it)`);
        await page.goBack();
        check(await backAgain() && (await stepNow(page)) === STEPS, `${tag(size)} · J2 browser Back keeps it open on the same step`);
      }
      await ctx.close();
    }

    // Journey 3: Skip on step 1 ends it; it doesn't come back on reload.
    {
      const ctx = await context(browser, engine, size);
      const page = await ctx.newPage();
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await answerPrivacy(page);
      try {
        await waitOpen(page);
        const skip = page.locator(`${DIALOG} [data-onboarding-skip]`);
        if (size === "390") { const b = (await skip.boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } else await skip.click();
        await page.waitForTimeout(400);
        check(!(await open(page)), `${tag(size)} · J3 ${size === "390" ? "tapping" : "clicking"} Skip on step 1 closes it`);
        await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(QUIET_MS);
        check(!(await open(page)), `${tag(size)} · J3 not back after a reload`);
        const rec = await page.evaluate(() => localStorage.getItem("cs-onboarding"));
        check(!!rec && rec.includes('"skipped"'), `${tag(size)} · J3 recorded as skipped`);
        // Journey 5: returning (skipped) visitor, new tab, other landing pages: never again.
        for (const p of ["/", "/events", "/teams/4215"]) { await page.goto(BASE + p, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(p === "/" ? QUIET_MS : 2000); check(!(await open(page)), `${tag(size)} · J5 skipped visitor, ${p}: not shown`); }
      } catch (e) { check(false, `${tag(size)} · J3 couldn't run: ${(e as Error).message.split("\n")[0]}`); }
      await ctx.close();
    }

    // Journey 4: the whole way through, picking a team; it ends cleanly and doesn't come back.
    {
      const ctx = await context(browser, engine, size);
      const page = await ctx.newPage();
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await answerPrivacy(page);
      try {
        await waitOpen(page);
        await page.locator(`${DIALOG} [data-onboarding-next]`).click();
        await page.locator(`${DIALOG} input`).fill("4215");
        await page.locator(`${DIALOG} [data-onboarding-team-option="4215"]`).click({ timeout: 10000 });
        await page.locator(`${DIALOG} [data-onboarding-next]`).click();
        check((await page.locator(DIALOG).innerText()).includes("4215 next match"), `${tag(size)} · J4 step 3 uses the team just picked`);
        await page.locator(`${DIALOG} [data-onboarding-next]`).click();
        const label = await page.locator(`${DIALOG} [data-onboarding-next]`).innerText();
        await page.locator(`${DIALOG} [data-onboarding-next]`).click();
        await page.waitForTimeout(600);
        check(!(await open(page)), `${tag(size)} · J4 the last step ("${label.trim()}") ends it`);
        const mine = await page.evaluate(() => localStorage.getItem("cs-personal:myTeam"));
        check(!!mine && mine.includes("4215"), `${tag(size)} · J4 the picked team is now My team`);
        check(new URL(page.url()).pathname === "/my-team", `${tag(size)} · J4 with a team, it ends on My team (${new URL(page.url()).pathname})`);
        await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(QUIET_MS);
        check(!(await open(page)), `${tag(size)} · J4 not back after a reload`);
        const rec = await page.evaluate(() => localStorage.getItem("cs-onboarding"));
        check(!!rec && rec.includes('"finished"'), `${tag(size)} · J4 recorded as finished`);
        // Journey 5: someone who already uses the app (a team saved), on a device with no onboarding record.
        const state = await ctx.storageState();
        const kept = Object.fromEntries((state.origins.find((o) => o.origin === new URL(BASE).origin)?.localStorage ?? []).filter((e) => e.name !== "cs-onboarding").map((e) => [e.name, e.value]));
        const ctx2 = await context(browser, engine, size, kept);
        const p2 = await ctx2.newPage();
        await p2.goto(BASE + "/", { waitUntil: "domcontentloaded" }); await p2.waitForTimeout(QUIET_MS);
        check(!(await open(p2)), `${tag(size)} · J5 someone with a team saved never gets it`);
        await ctx2.close();
      } catch (e) { check(false, `${tag(size)} · J4 couldn't run: ${(e as Error).message.split("\n")[0]}`); }
      await ctx.close();
    }

    // A first visit that lands on a team page gets that page, not the onboarding.
    {
      const ctx = await context(browser, engine, size);
      const page = await ctx.newPage();
      await page.goto(BASE + "/teams/4215", { waitUntil: "domcontentloaded" });
      await answerPrivacy(page);
      await page.waitForTimeout(QUIET_MS);
      check(!(await open(page)), `${tag(size)} · a first visit landing on a team page isn't interrupted`);
      await ctx.close();
    }
  }
  await browser.close();
}

for (const engine of ENGINES) await runEngine(engine);
console.log(`\n${failures ? `NOT COMPLETE: ${failures} failed` : "ALL PASS"} (${results.length} checks, ${BASE})`);
process.exit(failures ? 1 : 0);
