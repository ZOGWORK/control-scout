// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { createElement, forwardRef, type ReactNode } from "react";
import { EMPTY_STATE, type PersonalState } from "../../shared/personal";
import { resetConsent, setAnalyticsConsent } from "../../lib/consent";
import { claimFirstRun, firstRunHolder, releaseFirstRun, resetFirstRunForTests } from "../../lib/firstRun";
import { endTour, resetTour } from "../../lib/tour";
import { captureInstallPrompt, dayKey, INSTALL_DEMO_KEY, installOffer, isIosSafari, readInstall, resetInstallForTests } from "../../lib/installNudge";
import { InstallNudge } from "./InstallNudge";

// No animations in jsdom: the card comes and goes at once.
vi.mock("motion/react", () => {
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown>) => rest;
  const section = forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => createElement("section", { ...strip(props), ref }));
  return { AnimatePresence: ({ children }: { children: ReactNode }) => children, m: { section } };
});

const personal = vi.hoisted(() => ({ current: { state: null as unknown as PersonalState, user: null as unknown } }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => personal.current }));

const realUA = navigator.userAgent;
const setUA = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
const setWebdriver = (on: boolean) => Object.defineProperty(navigator, "webdriver", { value: on, configurable: true });
const setStandalone = (on: boolean | undefined) => Object.defineProperty(navigator, "standalone", { value: on, configurable: true });
const setMatchMedia = (standalone: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: standalone && q.includes("standalone"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";

let go: (to: string) => void = () => {};
function Nav() { go = useNavigate(); return null; }

/** One "page load": the app mounted on `path`. */
function mount(path = "/settings") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Nav />
      <InstallNudge />
    </MemoryRouter>,
  );
}

/** The browser offers an install (as Chrome does a moment after load). */
function offerInstall(outcome: "accepted" | "dismissed" = "dismissed") {
  const e = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome, platform: "web" }) });
  act(() => { window.dispatchEvent(e); });
  return { event: e, prompt };
}

const nudge = () => document.querySelector<HTMLElement>("[data-install-nudge]");
/** Long enough for a nudge that was going to show to have shown. */
const settle = (ms = 4000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** A reload: the page goes away, the module state of a fresh load comes back (the stored record stays). */
function reload() {
  cleanup();
  resetFirstRunForTests();
}
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => captureInstallPrompt());
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 16, 10, 0, 0) });
  localStorage.clear();
  resetInstallForTests();
  resetFirstRunForTests();
  resetTour();
  endTour("done", 4); // the tour is behind this device unless a test says otherwise
  setAnalyticsConsent(false);
  setWebdriver(false);
  setUA(realUA);
  setStandalone(undefined);
  setMatchMedia(false);
  personal.current = { state: EMPTY_STATE, user: null };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setWebdriver(false);
  setUA(realUA);
  setStandalone(undefined);
});

describe("Add-to-home-screen nudge: when it shows", () => {
  it("shows on the first app open once the browser offers an install, and stops the browser's own banner", async () => {
    mount();
    const { event } = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    await settle();
    expect(nudge()?.getAttribute("data-install-nudge")).toBe("prompt");
    expect(screen.getByRole("heading", { name: /home screen/i })).toBeTruthy();
    expect(readInstall().lastShown).toBe("2026-10-16");
    expect(firstRunHolder()).toBe("install");
  });

  it("doesn't show again the same day, across reloads, even when it was ignored", async () => {
    mount();
    offerInstall();
    await settle();
    expect(nudge()).not.toBeNull();
    reload();
    vi.setSystemTime(new Date(2026, 9, 16, 23, 59));
    mount();
    offerInstall();
    await settle(10_000);
    expect(nudge()).toBeNull();
  });

  it("shows again the next day when it was only ignored", async () => {
    mount();
    offerInstall();
    await settle();
    act(() => go("/teams")); // moved on: ignored, not dismissed
    expect(nudge()).toBeNull();
    expect(readInstall().dismissed).toBeUndefined();
    expect(firstRunHolder()).toBeNull();
    reload();
    vi.setSystemTime(Date.now() + DAY);
    mount();
    offerInstall();
    await settle();
    expect(nudge()).not.toBeNull();
    expect(readInstall().lastShown).toBe("2026-10-17");
  });

  it("waits for the privacy choice", async () => {
    resetConsent();
    mount();
    offerInstall();
    await settle();
    expect(nudge()).toBeNull();
    act(() => setAnalyticsConsent(true));
    await settle();
    expect(nudge()).not.toBeNull();
  });

  it("waits while a dialog is open or a field has focus", async () => {
    const { container } = mount();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    container.appendChild(dialog);
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const r = this === dialog ? { width: 100, height: 100 } : { width: 0, height: 0 };
      return { ...r, top: 0, left: 0, x: 0, y: 0, right: r.width, bottom: r.height, toJSON: () => r } as DOMRect;
    };
    try {
      offerInstall();
      await settle(8000);
      expect(nudge()).toBeNull();
      dialog.remove();
      await settle(1000);
      expect(nudge()).not.toBeNull();
    } finally { Element.prototype.getBoundingClientRect = realRect; }
  });

  it("uses the person's team in the copy when they have one", async () => {
    personal.current = { state: { ...EMPTY_STATE, myTeam: 18360 }, user: null };
    mount();
    offerInstall();
    await settle();
    // Signed out, the installed app opens on Home, which leads with the team's next match.
    expect(nudge()?.textContent).toContain("One tap from the stands to team 18360 and its next match.");
    expect(nudge()?.textContent).not.toMatch(/offline|FTC Scout/i);
  });

  it("signed in with a team, promises what Home does: straight to the team", async () => {
    personal.current = { state: { ...EMPTY_STATE, myTeam: 18360 }, user: { id: 1 } };
    mount();
    offerInstall();
    await settle();
    expect(nudge()?.textContent).toContain("One tap from the stands, and it opens straight to team 18360.");
  });

  it("leaving the page while waiting for the cross-tab lock leaves today's showing unused", async () => {
    let grant: () => void = () => {};
    const locks = { request: (_name: string, cb: () => unknown) => new Promise((resolve) => { grant = () => resolve(cb()); }) };
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    try {
      mount();
      offerInstall();
      await settle(); // the delay has run; the claim is waiting on the lock (another tab holds it)
      act(() => go("/teams"));
      await act(async () => { grant(); await Promise.resolve(); });
      expect(nudge()).toBeNull();
      expect(readInstall().lastShown).toBeUndefined();
      expect(firstRunHolder()).toBeNull();
    } finally { delete (navigator as { locks?: unknown }).locks; }
  });

  it("another tab that showed it first (no storage event yet) keeps this one quiet", async () => {
    mount();
    offerInstall();
    // The other tab writes today's showing while this one waits out its delay.
    localStorage.setItem("cs-install", JSON.stringify({ v: 1, lastShown: dayKey() }));
    await settle();
    expect(nudge()).toBeNull();
    expect(firstRunHolder()).toBeNull(); // the slot went back
  });

  it("sits above the tab bar, and above a page's sticky action bar on phones", async () => {
    mount();
    offerInstall();
    await settle();
    const cls = nudge()!.className;
    expect(cls).toContain("bottom-[calc(61px+env(safe-area-inset-bottom)+0.75rem)]");
    expect(cls).toContain("max-md:[[data-sticky-actions]_&]:bottom-[calc(61px+4rem+env(safe-area-inset-bottom)+0.75rem)]");
    expect(cls).toContain("z-[45]"); // over the tab bar (z-40) and sticky bar (z-30), under dialogs
  });
});

describe("Add-to-home-screen nudge: dismissed", () => {
  it("never shows again after No thanks", async () => {
    mount();
    offerInstall();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(nudge()).toBeNull();
    expect(readInstall().dismissed).toBeTruthy();
    expect(firstRunHolder()).toBeNull();
    for (let d = 1; d <= 3; d++) {
      reload();
      vi.setSystemTime(Date.now() + DAY);
      mount();
      offerInstall();
      await settle();
      expect(nudge()).toBeNull();
    }
  });

  it("the × and Esc count as No thanks", async () => {
    mount();
    offerInstall();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(readInstall().dismissed).toBeTruthy();

    localStorage.clear();
    endTour("done", 4);
    setAnalyticsConsent(false);
    reload();
    mount();
    offerInstall();
    await settle();
    fireEvent.keyDown(nudge()!, { key: "Escape" });
    expect(nudge()).toBeNull();
    expect(readInstall().dismissed).toBeTruthy();
  });

  it("Add opens the browser's install dialog; Cancel there counts as dismissed", async () => {
    mount();
    const { prompt } = offerInstall("dismissed");
    await settle();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add to home screen" })); });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(nudge()).toBeNull();
    expect(readInstall().dismissed).toBeTruthy();
    expect(installOffer()).toBeNull(); // an offer works once
  });

  it("Add then Install in the browser's dialog: installed, never shown again", async () => {
    mount();
    offerInstall("accepted");
    await settle();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add to home screen" })); });
    expect(readInstall().installed).toBeTruthy();
    reload();
    vi.setSystemTime(Date.now() + 2 * DAY);
    mount();
    offerInstall();
    await settle();
    expect(nudge()).toBeNull();
  });

  it("a No thanks in another tab closes it here", async () => {
    mount();
    offerInstall();
    await settle();
    localStorage.setItem("cs-install", JSON.stringify({ v: 1, lastShown: dayKey(), dismissed: new Date().toISOString() }));
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "cs-install" })); });
    expect(nudge()).toBeNull();
  });
});

describe("Add-to-home-screen nudge: installed", () => {
  it("never shows when running from the home screen (display-mode: standalone)", async () => {
    setMatchMedia(true);
    mount();
    offerInstall();
    await settle();
    expect(nudge()).toBeNull();
  });

  it("never shows in iOS's home-screen app (navigator.standalone)", async () => {
    setUA(IPHONE_SAFARI);
    setStandalone(true);
    mount();
    await settle();
    expect(nudge()).toBeNull();
  });

  it("never shows after appinstalled, however the install happened", async () => {
    mount();
    offerInstall();
    await settle();
    expect(nudge()).not.toBeNull();
    act(() => { window.dispatchEvent(new Event("appinstalled")); });
    expect(nudge()).toBeNull();
    expect(readInstall().installed).toBeTruthy();
    reload();
    vi.setSystemTime(Date.now() + 5 * DAY);
    mount();
    offerInstall();
    await settle();
    expect(nudge()).toBeNull();
  });

  it("never shows when getInstalledRelatedApps finds the app", async () => {
    Object.defineProperty(navigator, "getInstalledRelatedApps", { value: () => Promise.resolve([{ platform: "webapp" }]), configurable: true });
    try {
      mount();
      offerInstall();
      await settle();
      expect(nudge()).toBeNull();
    } finally { delete (navigator as { getInstalledRelatedApps?: unknown }).getInstalledRelatedApps; }
  });
});

describe("Add-to-home-screen nudge: the tour goes first", () => {
  it("doesn't show while the tour holds the first-run slot, nor on the page where it did", async () => {
    mount("/teams/18360");
    act(() => { claimFirstRun("tour"); });
    offerInstall();
    await settle(10_000);
    expect(nudge()).toBeNull();
    act(() => releaseFirstRun("tour"));
    await settle(10_000);
    expect(nudge()).toBeNull(); // same page: the tour had it
    act(() => go("/teams/1234"));
    await settle();
    expect(nudge()).not.toBeNull(); // a later page
  });

  it("only that page view waits: coming back to the same page later can show it", async () => {
    mount("/settings");
    act(() => { claimFirstRun("other"); });
    offerInstall();
    await settle();
    act(() => releaseFirstRun("other"));
    await settle(10_000);
    expect(nudge()).toBeNull();
    act(() => go("/teams"));
    act(() => go("/settings")); // a new visit to the same page
    await settle();
    expect(nudge()).not.toBeNull();
  });

  it("stays off pages where the tour may still open, and shows elsewhere", async () => {
    resetTour();
    mount("/teams/18360");
    offerInstall();
    await settle(10_000);
    expect(nudge()).toBeNull();
    act(() => go("/settings")); // not a tour page
    await settle();
    expect(nudge()).not.toBeNull();
  });

  it("shows on tour pages to someone who knows the app (the tour never comes)", async () => {
    resetTour();
    personal.current = { state: { ...EMPTY_STATE, tracked: { teams: [18360], events: [] } } as PersonalState, user: null };
    mount("/teams/18360");
    offerInstall();
    await settle();
    expect(nudge()).not.toBeNull();
  });

  it("holds the slot while shown, so the tour waits", async () => {
    mount();
    offerInstall();
    await settle();
    expect(claimFirstRun("tour")).toBe(false);
  });
});

describe("Add-to-home-screen nudge: bots and browsers without an install offer", () => {
  it("never shows to a browser driven by automation", async () => {
    setWebdriver(true);
    mount();
    offerInstall();
    await settle();
    expect(nudge()).toBeNull();
  });

  it("never shows to crawlers", async () => {
    setUA("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
    mount();
    offerInstall();
    await settle();
    expect(nudge()).toBeNull();
  });

  it("shows to automation that opted in (npm run shots -- --install)", async () => {
    setWebdriver(true);
    localStorage.setItem(INSTALL_DEMO_KEY, "1");
    mount();
    offerInstall();
    await settle();
    expect(nudge()).not.toBeNull();
  });

  it("shows nothing when the browser makes no install offer (desktop Firefox, Safari)", async () => {
    mount();
    await settle(10_000);
    expect(nudge()).toBeNull();
    expect(firstRunHolder()).toBeNull();
  });

  it("iOS Safari gets the Share, then Add to Home Screen hint, under the same rules", async () => {
    setUA(IPHONE_SAFARI);
    mount();
    await settle();
    expect(nudge()?.getAttribute("data-install-nudge")).toBe("ios");
    expect(nudge()?.textContent).toMatch(/Share, then Add to Home Screen/);
    reload();
    mount(); // same day
    await settle();
    expect(nudge()).toBeNull();
    reload();
    vi.setSystemTime(Date.now() + DAY);
    mount();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(readInstall().dismissed).toBeTruthy(); // Safari can't say it was added: any answer ends it
    reload();
    vi.setSystemTime(Date.now() + DAY);
    mount();
    await settle();
    expect(nudge()).toBeNull();
  });

  it("other iOS browsers get nothing", async () => {
    setUA(IPHONE_CHROME);
    mount();
    await settle();
    expect(nudge()).toBeNull();
    expect(isIosSafari({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", maxTouchPoints: 5 })).toBe(true); // iPadOS
    expect(isIosSafari({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", maxTouchPoints: 0 })).toBe(false); // a Mac
  });
});
