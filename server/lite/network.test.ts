// @vitest-environment jsdom
// Lite's network screen (server/lite/network.ts): its one small script, run on the page as a phone would. It reads the
// connection the way the full app does (src/lib/connection.ts classify: our JSON is internet, a page that isn't ours
// or a redirect is a sign-in page, no answer is nothing), and shows only sentences the server drew with the full
// screen's own functions, so the two screens say the same thing about the same connection and the same downloads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_SEASON } from "../data/seasons";
import { fmtBytes, sizeLines, statusSentence } from "../../src/shared/networkStatus";
import { seasonLabel } from "../../src/shared/format";
import { NET_SCRIPT, networkPage, type PackList } from "./network";
import { DEFAULT_VIEW } from "./render";

const S = CURRENT_SEASON;
const SIZES = { full: [{ seasons: [S], bytes: 23_400_000 }], lite: { bytes: 640_000 } };
const PACKS: PackList = { m: SIZES };
const $ = (id: string) => document.getElementById(id)!;
const text = (id: string) => $(id).textContent;

function setConnection(type: string | undefined, online = true) {
  Object.defineProperty(navigator, "connection", { value: type ? { type } : undefined, configurable: true });
  Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
}
/** The page as the server sends it, then its script, as the browser runs it. */
async function load(health: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { if (url !== "/api/health") throw new Error(url); return health(); }));
  document.body.innerHTML = networkPage(DEFAULT_VIEW, S, PACKS).body;
  new Function(NET_SCRIPT)();
  await vi.waitFor(() => expect($("n-check").textContent).toBe("Check again"));
}
const json = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const html = async () => new Response("<!doctype html><title>Venue Wi-Fi</title><h1>Accept the terms</h1>", { status: 200, headers: { "Content-Type": "text/html" } });

beforeEach(() => { localStorage.clear(); setConnection(undefined); });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("the status, from a real check", () => {
  it("our server's answer: online, and the internet works", async () => {
    setConnection("wifi");
    await load(json({ ok: true }));
    expect(text("n-title")).toBe("You're online");
    expect($("n-detail").hidden).toBe(true);
    expect(text("n-type")).toBe("Wi-Fi");
    expect(text("n-net")).toBe("Working");
    expect(text("n-when")).toMatch(/^Checked at /);
    expect($("n-status").getAttribute("data-internet")).toBe("yes");
  });

  it("a hotel Wi-Fi's sign-in page: connected to Wi-Fi, no internet, sign in", async () => {
    setConnection("wifi");
    await load(html);
    const want = statusSentence({ internet: "portal", online: true, type: "wifi" });
    expect(text("n-title")).toBe(want.title);
    expect(text("n-title")).toBe("Connected to Wi-Fi, but no internet");
    expect(text("n-detail")).toBe(want.detail);
    expect($("n-detail").hidden).toBe(false);
    expect(text("n-net")).toBe("Not yet: likely a sign-in page");
  });

  it("a redirect, or a sign-in page on a cable: connected to a network", async () => {
    setConnection("ethernet");
    await load(async () => new Response(null, { status: 302, headers: { Location: "http://portal.example/" } }));
    expect(text("n-title")).toBe("Connected to a network, but no internet");
    expect(text("n-type")).toBe("Cable");
    await load(async () => new Response("", { status: 511 }));
    expect(text("n-title")).toBe("Connected to a network, but no internet");
  });

  it("JSON that isn't ours is a sign-in page too; our server erroring is still internet", async () => {
    await load(json({ ok: false }));
    expect($("n-status").getAttribute("data-internet")).toBe("portal");
    await load(async () => new Response("", { status: 503 }));
    expect(text("n-title")).toBe("You're online");
  });

  it("nothing answers while the device says it's on a network; and offline", async () => {
    setConnection("cellular");
    await load(async () => { throw new TypeError("Failed to fetch"); });
    expect(text("n-title")).toBe("Connected, but nothing is getting through");
    expect(text("n-type")).toBe("Mobile data");
    expect(text("n-net")).toBe("Nothing is getting through");
    setConnection(undefined, false);
    await load(async () => { throw new TypeError("Failed to fetch"); });
    expect(text("n-title")).toBe("You're offline");
    expect(text("n-type")).toBe("None");
    expect(text("n-net")).toBe("None");
  });

  it("a browser that doesn't say Wi-Fi or mobile data: says so, and why", async () => {
    await load(json({ ok: true }));
    expect(text("n-type")).toBe("Your browser doesn't say");
    expect($("n-type-note").hidden).toBe(false);
    setConnection("wifi");
    await load(json({ ok: true }));
    expect($("n-type-note").hidden).toBe(true);
  });

  it("Check again asks once more, and the words follow the answer", async () => {
    setConnection("wifi");
    await load(html);
    expect(text("n-title")).toBe("Connected to Wi-Fi, but no internet");
    vi.stubGlobal("fetch", vi.fn(json({ ok: true })));
    $("n-check").click();
    expect(text("n-check")).toBe("Checking");
    await vi.waitFor(() => expect(text("n-title")).toBe("You're online"));
  });
});

describe("what's downloaded on this device", () => {
  it("each pack, its size and its data time, the total, and what each event's download used", async () => {
    localStorage.setItem("cs-personal-owner", "7");
    localStorage.setItem("cs-event-bundles", JSON.stringify([
      { season: S, code: "NJQ1", name: "Edison Qualifier", bytes: 31_000, builtAt: "2026-11-13T20:09:00Z", dataAsOf: "2026-11-13T20:00:00Z" },
      { season: S, code: "NJQ2", name: "Another team's workspace pack", bytes: 9_000, builtAt: "2026-11-13T20:09:00Z", workspace: "w1", accountId: 8 },
    ]));
    localStorage.setItem("cs-offline-seasons", JSON.stringify([{ season: S, bytes: 23_400_000, savedAt: Date.parse("2026-11-12T10:00:00Z"), dataAsOf: "2026-11-12T09:00:00Z", builtAt: "x", version: "v", sha256: "s" }]));
    localStorage.setItem("cs-pack-meta", JSON.stringify({ version: "v", bytes: 640_000, savedAt: 1, builtAt: "2026-11-10T00:00:00Z", engineVersion: "e" }));
    await load(json({ ok: true }));
    const rows = [...document.querySelectorAll("#n-dl .row")].map((r) => [r.querySelector("b")!.textContent, r.querySelector(".res")!.textContent]);
    // In the full screen's order: events, seasons, then the predictions; another account's workspace pack never shows.
    expect(rows).toEqual([["Edison Qualifier", fmtBytes(31_000)], [`${seasonLabel(S)} season`, fmtBytes(23_400_000)], ["Offline predictions", fmtBytes(640_000)]]);
    expect([...document.querySelectorAll("#n-dl .row small")].every((s) => /^Data from \S/.test(s.textContent!))).toBe(true);
    expect(document.querySelector("#n-dl .note")!.textContent).toBe(`All together: ${fmtBytes(31_000 + 23_400_000 + 640_000)}.`);
    // The sizes list, as the full screen words it (sizeLines), the event downloaded here first.
    const lines = [...document.querySelectorAll("#n-sizes li")].map((l) => l.textContent);
    expect(lines.slice(0, 3)).toEqual(sizeLines(SIZES, S, [{ name: "Edison Qualifier", bytes: 31_000 }]).slice(0, 3));
    expect(lines).toContain("Each event's size shows before you download it.");
  });

  it("nothing downloaded: says how to get something", async () => {
    await load(json({ ok: true }));
    expect(text("n-dl")).toBe("Nothing downloaded yet. Download an event before you go, while you have a connection.");
    expect(document.querySelectorAll("#n-sizes li.ev")).toHaveLength(0);
  });

  it("names a name as text, never markup", async () => {
    localStorage.setItem("cs-event-bundles", JSON.stringify([{ season: S, code: "X", name: "<img src=x onerror=alert(1)>", bytes: 1000, builtAt: "2026-11-13T00:00:00Z" }]));
    await load(json({ ok: true }));
    expect(document.querySelector("#n-dl img")).toBeNull();
    expect(document.querySelector("#n-dl b")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("sizes read as the app's own formatting does", async () => {
    // The script carries its own copy of fmtBytes (it can't import): held to the shared one here.
    for (const b of [999, 12_345, 999_999, 1_000_000, 23_456_789, 999_999_999, 1_234_567_890]) {
      localStorage.setItem("cs-pack-meta", JSON.stringify({ bytes: b, builtAt: "2026-11-10T00:00:00Z" }));
      await load(json({ ok: true }));
      expect(document.querySelector("#n-dl .res")!.textContent, String(b)).toBe(fmtBytes(b));
    }
  });
});

describe("the download choices saved with the account", () => {
  it("shows the saved choice and its one line", async () => {
    setConnection("wifi");
    localStorage.setItem("cs-personal:settings", JSON.stringify({ value: { offlineNetwork: "any", offlineUpdates: "ask" }, updatedAt: 1 }));
    await load(json({ ok: true }));
    expect(text("n-dn")).toBe("Wi-Fi and mobile data");
    expect(text("n-dn-line")).toBe(`Mobile data counts against your plan: the whole ${seasonLabel(S)} season is 23.4 MB, offline predictions 640 KB.`);
    expect(text("n-up")).toBe("Never update automatically (I'll tap Update)");
    expect(text("n-up-line")).toBe("You get a note when an update is out; nothing downloads until you tap Update.");
  });
  it("a browser that can't tell Wi-Fi from mobile data: the lines say so", async () => {
    await load(json({ ok: true }));
    expect(text("n-dn")).toBe("Wi-Fi only");
    expect(text("n-dn-line")).toMatch(/^This browser can't tell Wi-Fi from mobile data/);
    expect(text("n-up")).toBe("Update packs automatically");
  });
});
