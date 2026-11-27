// @vitest-environment jsdom
// A search's beacon: once per search, only sampled and with consent, never from automation, never with the words;
// its time to the drawn answer, a re-search within 30 s, and a follow-up tap told apart from a typed search.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, useNavigate, useSearchParams } from "react-router-dom";
import { setAnalyticsConsent } from "./consent";
import type { SearchShown } from "./searchScore";

let beacons: { url: string; body: Blob }[] = [];
const sent = () => Promise.all(beacons.map(async (b) => ({ url: b.url, ...JSON.parse(await b.body.text()) })));
// Each rAF stub is a 1 ms timer and the drawn answer waits for two of them: four sequential 10 ms waits always run
// after both, however late the timers fire (timers run in the order they fall due).
const frames = async () => { for (let i = 0; i < 4; i++) await act(() => new Promise((r) => setTimeout(r, 10))); };

let mod: typeof import("./searchScore");
let go: (to: string) => void = () => {};
/** The results page's part: its words from the address, as SearchPage reads them. */
function Probe({ s }: { s: SearchShown }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  go = navigate;
  mod.useSearchScore(params.get("q") ?? "", s);
  return null;
}
const LOADING: SearchShown = { drawn: false, settled: false, leaving: false, outcome: "results" };
const DONE: SearchShown = { drawn: true, settled: true, leaving: false, outcome: "direct" };

/** A results page; show() navigates to new words (a PUSH, as a submitted search is), then draws `s` for them. */
function page(first = "/search") {
  let cur = new URL(first, "http://x").searchParams.get("q") ?? "";
  const wrap = (s: SearchShown) => <MemoryRouter initialEntries={[first]}><Probe s={s} /></MemoryRouter>;
  const v = render(wrap(LOADING));
  return {
    show: (q: string, s: SearchShown) => {
      if (q !== cur) { cur = q; act(() => go(`/search?q=${encodeURIComponent(q)}`)); }
      v.rerender(wrap(s));
    },
    unmount: v.unmount,
  };
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear(); beacons = [];
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "sendBeacon", { value: vi.fn((url: string, body: Blob) => { beacons.push({ url, body }); return true; }), configurable: true });
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 1) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  setAnalyticsConsent(true);
  mod = await import("./searchScore");
  // Not opened on a search: a test of the page-load search names the words the page was opened with.
  mod.resetSearchScore({ sampled: true });
});
// Each test's page unmounts before the next starts (it would otherwise keep counting into the next test's beacons).
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("useSearchScore", () => {
  it("sends one beacon when the answer is drawn and settled: choices and a time only, never the words", async () => {
    mod.resetSearchScore({ sampled: true, landed: "4215 vs 6980" });
    const p = page();
    p.show("4215 vs 6980", LOADING);
    await frames();
    expect(beacons).toHaveLength(0);
    p.show("4215 vs 6980", DONE);
    await frames();
    p.show("4215 vs 6980", DONE);
    await frames();
    const [b, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect(b).toMatchObject({ url: "/api/collect/search", entry: "load", outcome: "direct", via: "typed", re: false });
    expect(typeof b.ms).toBe("number");
    // Everything but the duration, which is a number and can end in 4215 by chance (a run's 817.774215 did): the
    // question's own words and team numbers never leave the page.
    expect(Object.entries(b).filter(([k]) => k !== "ms").map(([, v]) => String(v)).join(" ")).not.toMatch(/4215|6980/);
    expect(Object.keys(b).sort()).toEqual(["entry", "ms", "outcome", "re", "screen", "url", "via"]);
    expect(performance.getEntriesByName("search:answer").length).toBeGreaterThan(0);
  });

  it("sends nothing without consent, outside the sample, or from an automated browser", async () => {
    for (const setup of [() => setAnalyticsConsent(false), () => mod.resetSearchScore({ sampled: false }),
      () => Object.defineProperty(navigator, "webdriver", { value: true, configurable: true })]) {
      setAnalyticsConsent(true);
      mod.resetSearchScore({ sampled: true });
      Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
      setup();
      const p = page();
      p.show("rules", DONE);
      await frames();
      p.unmount();
    }
    expect(beacons).toHaveLength(0);
  });

  it("flags a typed search with other words within 30 s of an answer as a re-search", async () => {
    mod.resetSearchScore({ sampled: true, landed: "teams in houston" });
    const p = page();
    p.show("teams in houston", DONE);
    await frames();
    p.show("teams in houston tx", DONE);
    await frames();
    const b = await sent();
    expect(b.map((x) => [x.entry, x.re])).toEqual([["load", false], ["app", true]]);
  });

  it("counts a tap on People also ask or Related searches as that, not a re-search", async () => {
    const p = page();
    p.show("4215", DONE);
    await frames();
    document.body.innerHTML = '<section data-block="people-also-ask"><a id="ask" href="/search?q=Who%20is%204215">See</a></section><nav data-follow-chips><a id="rel" href="/search?q=4215+awards">x</a></nav>';
    // The router would take the tap: jsdom can't follow a link.
    document.body.addEventListener("click", (e) => e.preventDefault());
    const click = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    click("ask");
    p.show("who is 4215", DONE);
    await frames();
    click("rel");
    p.show("4215 awards", DONE);
    await frames();
    const b = await sent();
    expect(b.map((x) => [x.via, x.re])).toEqual([["typed", false], ["ask", false], ["related", false]]);
  });

  it("sends a search that goes straight on to its page as page, with no time", async () => {
    const p = page();
    p.show("18360", LOADING);
    p.show("18360", { ...LOADING, leaving: true });
    await frames();
    const [b] = await sent();
    expect(b).toMatchObject({ outcome: "page" });
    expect(b.ms).toBeUndefined();
  });

  it("keeps the search but not its time when the tab was hidden while waiting", async () => {
    const p = page();
    p.show("rules", LOADING);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    p.show("rules", { ...DONE, outcome: "sorry" });
    await frames();
    const [b] = await sent();
    expect(b).toMatchObject({ outcome: "sorry" });
    expect(b.ms).toBeUndefined();
  });

  it("keeps the time when the tab is hidden only after the answer was drawn, before it settled", async () => {
    const p = page();
    p.show("rules", { ...DONE, settled: false });
    await frames();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    p.show("rules", DONE);
    await frames();
    const [b] = await sent();
    expect(typeof b.ms).toBe("number");
  });

  it("counts the same words again after a bare /search as a new search", async () => {
    const p = page();
    p.show("rules", DONE);
    await frames();
    p.show("", LOADING);
    p.show("rules", DONE);
    await frames();
    expect(await sent()).toHaveLength(2);
  });

  it("is a page-load search only for the words the page was opened with, and only the first time", async () => {
    // Opened on /search?q=rules; the module loaded late, after an in-app search for other words.
    mod.resetSearchScore({ sampled: true, landed: "rules" });
    const p = page();
    p.show("worlds", DONE);
    await frames();
    p.show("rules", DONE);
    await frames();
    expect((await sent()).map((b) => b.entry)).toEqual(["app", "app"]);
  });

  it("doesn't count Back or Forward to words already searched", async () => {
    mod.resetSearchScore({ sampled: true });
    const p = page("/search?q=rules"); // MemoryRouter's first entry is a POP: as Back to it is
    p.show("rules", DONE);
    await frames();
    expect(beacons).toHaveLength(0);
  });
});
