// Journey 5 of the offline + Lite brief, end to end on a production build: with the network fully off (after the
// app was opened once online and the event's bundle downloaded), open Scout, pick the event, scout a match for
// several teams, add teams to the shortlist, use the pick helper; close and reopen the app (still offline) and
// check nothing is lost; turn the network back on and check everything syncs once.
//
//   npm run build && npx tsx scripts/scout-offline-journey.ts --base http://localhost:3304 --event 2026:AUBRQ1 [--shots <dir>] [--cookie-file <file>]
//
// The network goes through a local proxy that can be switched off (scripts/lib/netSwitch.ts), so the service
// worker's requests fail too. Signed in (--cookie-file: a local test account's `cs_session=…`), the entries' sync
// is checked on the server after reconnecting: each entry there exactly once.
import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { startNetSwitch } from "./lib/netSwitch";

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = (opt("base") ?? "http://localhost:3304").replace(/\/$/, "");
const [SEASON, CODE] = (opt("event") ?? "2026:AUBRQ1").split(":");
const SHOTS = opt("shots");
const COOKIE = opt("cookie-file") ? readFileSync(opt("cookie-file")!, "utf8").trim() : null;

const results: { step: string; ok: boolean; ms?: number; note?: string }[] = [];
function check(step: string, ok: boolean, note?: string, ms?: number) {
  results.push({ step, ok, note, ms });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${ms != null ? ` (${ms} ms)` : ""}${note ? `  — ${note}` : ""}`);
}
async function shot(page: Page, name: string) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}); }
const text = async (page: Page) => ((await page.locator("main").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
const BAD = /needs a connection|can't reach the server|couldn't load|something went wrong/i;

async function main() {
  const net = await startNetSwitch();
  const browser = await chromium.launch({ proxy: { server: `http://127.0.0.1:${net.port}`, bypass: "<-loopback>" } });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "allow" });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem("cs-consent")) localStorage.setItem("cs-consent", JSON.stringify({ analytics: false, at: "2026-01-01T00:00:00.000Z", v: 1 })); } catch { /* */ } });
  if (COOKIE) {
    const [name, ...v] = COOKIE.split("=");
    await ctx.addCookies([{ name, value: v.join("="), url: BASE }]);
  }
  let page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  page error:", e.message));

  // --- Online, once: the app opens (the service worker installs), then the event's bundle downloads.
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload({ waitUntil: "load" });
  await page.goto(`${BASE}/download?event=${SEASON}:${CODE}`, { waitUntil: "load" });
  const dl = page.locator("[data-bundle-download]");
  await dl.waitFor({ timeout: 30_000 });
  await dl.click();
  await page.getByText("On this device and current").waitFor({ timeout: 60_000 });
  // The scouting reads are kept in the background once the bundle is saved (src/lib/offline/warm.ts).
  await page.waitForFunction(() => (localStorage.getItem("cs-kept-answers") ?? "").includes("pick-ratings"), null, { timeout: 30_000 }).catch(() => {});
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("cs-kept-answers") ?? "[]").map((x: [string, number]) => x[0].split("|")[1]));
  check("online: bundle downloaded, scouting reads kept", kept.length >= 3, kept.join(" "));

  // --- Network off.
  net.offline();
  let t0 = Date.now();
  await page.goto(`${BASE}/scout`, { waitUntil: "domcontentloaded" });
  const saved = page.locator("[data-saved-events] button").first();
  const pickerOk = await saved.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("offline: /scout opens with the event picker and the saved event", pickerOk && !BAD.test(await text(page)), (await text(page)).slice(0, 160), Date.now() - t0);
  await shot(page, "1-scout-offline-picker");
  if (!pickerOk) return finish();
  await page.waitForTimeout(1500);
  const dialog = page.locator("[role=dialog]");
  // A new test account is asked to finish signing up first: "Browse first" puts it off.
  const later = page.getByRole("button", { name: "Browse first" });
  if (await later.isVisible().catch(() => false)) await later.click();
  console.log("  kept note on the picker:", await page.locator("[data-offline-kept]").count());
  await saved.click();
  await page.waitForTimeout(1500);
  await shot(page, "2-scout-offline-event");
  await page.getByRole("radio", { name: "All 4 teams" }).or(page.getByRole("button", { name: "All 4 teams" })).first().click();
  await page.getByRole("button", { name: /^Scout Q1/ }).first().click();
  await page.waitForTimeout(800);
  // Each of the four teams: left the start zone; then Save, which saves on the device at once.
  const leaves = page.getByRole("button", { name: /Left start zone$/ });
  const nTeams = await leaves.count();
  for (let i = 0; i < nTeams; i++) await leaves.nth(i).click();
  t0 = Date.now();
  await page.getByRole("button", { name: /^Save Q1/ }).click();
  const entries = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("cs-scout:") || k.startsWith("cs-scout-ws:")).length);
  await page.waitForFunction((n) => Object.keys(localStorage).filter((k) => k.startsWith("cs-scout:") || k.startsWith("cs-scout-ws:")).length >= n, nTeams, { timeout: 5000 }).catch(() => {});
  const afterSave = await entries();
  check(`offline: scout Q1 for ${nTeams} teams, saved on the device`, nTeams >= 2 && afterSave === nTeams, `${afterSave} entries on the device`, Date.now() - t0);
  const chip = await page.locator("[data-sync-state]").first().textContent().catch(() => "");
  check("offline: the page says it's saved on this device", /Saved on this device/.test(chip ?? ""), chip ?? "");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "4-scout-saved");

  // Shortlist: two of the match's teams added with no signal.
  const teams = await page.evaluate(() => JSON.parse(localStorage.getItem("cs-event-bundles") ?? "[]")[0]?.teams ?? []) as number[];
  const addTeams = teams.slice(0, 3);
  t0 = Date.now();
  await page.goto(`${BASE}/shortlist`, { waitUntil: "domcontentloaded" });
  const addBox = () => page.getByRole("combobox", { name: "Add a team to your shortlist" }).first();
  await addBox().waitFor({ timeout: 15_000 });
  const shortlistOpen = Date.now() - t0;
  for (const t of addTeams) {
    // The first pick swaps the empty page's box for the list's own: found again each time.
    const box = addBox();
    await box.fill(String(t));
    await box.press("Enter");
    // Added: the box empties (with no signal the typed number is taken once search says it can't answer).
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>("input[aria-label='Add a team to your shortlist']")].every((i) => i.value === ""), null, { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  const sl = await text(page);
  const listed = addTeams.filter((t) => sl.includes(String(t)));
  check(`offline: shortlist opens and adds ${addTeams.length} teams`, listed.length === addTeams.length && !BAD.test(sl), `${listed.length} listed; ${sl.slice(0, 200)}`, shortlistOpen);
  await shot(page, "5-shortlist-offline");

  // Pick helper: the event's pick ratings, with no signal.
  t0 = Date.now();
  await page.goto(`${BASE}/scout?tab=picks&pteam=${addTeams[0]}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const helperTab = page.getByRole("tab", { name: /Pick helper/ }).or(page.getByRole("button", { name: /Pick helper/ })).first();
  if (await helperTab.isVisible().catch(() => false)) await helperTab.click();
  await page.getByText(/Couldn't load the ratings|offline: last loaded/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
  const ph = await text(page);
  check("offline: pick helper shows the event's ratings", /last loaded on this device/i.test(ph) && !/Couldn't load the ratings/.test(ph), ph.slice(0, 240), Date.now() - t0);
  await shot(page, "6-pick-helper-offline");

  // Close the app and open it again, still offline: nothing lost.
  await page.close();
  page = await ctx.newPage();
  t0 = Date.now();
  await page.goto(`${BASE}/scout?tab=entries`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const reopenEntries = await entries();
  const reopenList = await page.evaluate(() => JSON.parse(localStorage.getItem("cs-personal:bookmarks") ?? "null"));
  check("reopened offline: every entry still on the device", reopenEntries === nTeams, `${reopenEntries} entries`, Date.now() - t0);
  await page.goto(`${BASE}/shortlist`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const sl2 = await text(page);
  check("reopened offline: the shortlist still has the teams", addTeams.every((t) => sl2.includes(String(t))), JSON.stringify(reopenList)?.slice(0, 120));
  await shot(page, "7-shortlist-reopened");

  // Back online: the pages refresh from the server; nothing is doubled.
  net.online();
  await page.goto(`${BASE}/scout?tab=entries`, { waitUntil: "load" });
  await page.waitForTimeout(COOKIE ? 6000 : 2500);
  const onlineEntries = await entries();
  check("online again: the same entries, none doubled", onlineEntries === nTeams, `${onlineEntries} entries`);
  if (COOKIE) {
    const mine = await page.evaluate(async () => (await (await fetch("/api/me/scout")).json()).entries as { uuid: string; eventCode: string | null }[]);
    const here = mine.filter((e) => e.eventCode?.toUpperCase() === "AUBRQ1");
    const uuids = new Set(here.map((e) => e.uuid));
    check("online again: the server holds each entry exactly once", here.length === nTeams && uuids.size === here.length, `${here.length} on the server, ${uuids.size} distinct`);
    const state = await page.evaluate(async () => (await (await fetch("/api/me/state")).json()).state as { bookmarks?: { value: number[] } });
    const marks = state.bookmarks?.value ?? [];
    check("online again: the shortlist synced, each team once", addTeams.every((t) => marks.filter((x) => x === t).length === 1), JSON.stringify(marks));
  }
  await shot(page, "8-online-again");
  await finish();

  async function finish() {
    await browser.close();
    await net.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} steps passed`);
    process.exit(failed ? 1 : 0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
