// @vitest-environment jsdom
// Web vitals leave the browser only with consent, when the tab hides, as one beacon with a route pattern.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAnalyticsConsent } from "./consent";

type Cb = (r: { name: string; value: number }) => void;
let beacons: { url: string; body: Blob }[] = [];
let cbs: Record<string, Cb> = {};
const fakeLoad = () => Promise.resolve({
  onLCP: (cb: Cb) => { cbs.LCP = cb; }, onINP: (cb: Cb) => { cbs.INP = cb; },
  onCLS: (cb: Cb) => { cbs.CLS = cb; }, onTTFB: (cb: Cb) => { cbs.TTFB = cb; },
}) as never;
const hide = () => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};
const sent = () => Promise.all(beacons.map(async (b) => ({ url: b.url, ...JSON.parse(await b.body.text()) })));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear(); beacons = []; cbs = {};
  window.history.replaceState(null, "", "/teams/18360?q=secret");
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "sendBeacon", { value: vi.fn((url: string, body: Blob) => { beacons.push({ url, body }); return true; }), configurable: true });
  vi.stubGlobal("PerformanceObserver", class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("startVitals", () => {
  it("sends what's known when the tab hides: one beacon, route pattern and screen bucket only", async () => {
    setAnalyticsConsent(true);
    const { startVitals } = await import("./vitals");
    startVitals(fakeLoad);
    await Promise.resolve(); await Promise.resolve();
    cbs.TTFB({ name: "TTFB", value: 320 });
    cbs.LCP({ name: "LCP", value: 1800 });
    hide();
    // Reported from web-vitals' own hidden listener, after ours: a second beacon in the same moment.
    cbs.CLS({ name: "CLS", value: 0.04 });
    cbs.INP({ name: "INP", value: 120 });
    await Promise.resolve();
    const out = await sent();
    expect(out).toEqual([
      { url: "/api/collect/vitals", path: "/teams/:number", screen: "desktop", m: { TTFB: 320, LCP: 1800 } },
      { url: "/api/collect/vitals", path: "/teams/:number", screen: "desktop", m: { CLS: 0.04, INP: 120 } },
    ]);
    expect(JSON.stringify(out)).not.toContain("18360");
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("sends nothing once consent is withdrawn", async () => {
    setAnalyticsConsent(true);
    const { startVitals } = await import("./vitals");
    startVitals(fakeLoad);
    await Promise.resolve(); await Promise.resolve();
    cbs.LCP({ name: "LCP", value: 1800 });
    setAnalyticsConsent(false);
    hide();
    expect(beacons).toEqual([]);
  });

  it("starts once per page", async () => {
    setAnalyticsConsent(true);
    const { startVitals } = await import("./vitals");
    const load = vi.fn(fakeLoad);
    startVitals(load); startVitals(load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
