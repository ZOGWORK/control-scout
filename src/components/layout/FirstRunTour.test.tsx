// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { EMPTY_STATE, type PersonalState } from "../../shared/personal";
import { resetConsent, setAnalyticsConsent } from "../../lib/consent";
import { claimFirstRun, firstRunHolder, releaseFirstRun, resetFirstRunForTests } from "../../lib/firstRun";
import { endTour, isAutomated, isTourPage, knowsTheApp, readTour, resetTour, TOUR_DEMO_KEY, TOUR_KEY } from "../../lib/tour";
import { ConsentBanner } from "./ConsentBanner";
import { FirstRunTour } from "./FirstRunTour";

const personal = vi.hoisted(() => ({
  current: { state: null as unknown as PersonalState, user: null as unknown, providers: { email: true, google: false } as unknown, sync: "local", syncReady: false },
}));
vi.mock("../../lib/personal", () => ({ usePersonal: () => personal.current }));

const realUA = navigator.userAgent;
const setUA = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
const setWebdriver = (on: boolean) => Object.defineProperty(navigator, "webdriver", { value: on, configurable: true });

// jsdom lays nothing out: give the tour's targets (and the nav's Predict link) a box.
const realRect = Element.prototype.getBoundingClientRect;
function laidOut(this: Element) {
  const on = this.hasAttribute("data-tour") || this.matches('nav[aria-label="Main"] a[href="/predict"]');
  const r = on ? { top: 100, left: 100, width: 120, height: 40 } : { top: 0, left: 0, width: 0, height: 0 };
  return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
}

/** A team page's bits the tour points at. */
function TeamPage({ track = true, predict = true, search = true }: { track?: boolean; predict?: boolean; search?: boolean }) {
  return (
    <div>
      <nav aria-label="Main"><a href="/predict">Predict</a></nav>
      {search && <button type="button" data-tour="search">Search</button>}
      <button type="button" id="before">Something</button>
      {track && <button type="button" data-tour="track">Track</button>}
      {predict && <a href="/predict?mode=match" data-tour="predict">Predict a match with 18360</a>}
    </div>
  );
}

let go: (to: string) => void = () => {};
function Nav() { go = useNavigate(); return null; }

function mount(opts: { path?: string; track?: boolean; predict?: boolean; search?: boolean; banner?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[opts.path ?? "/teams/18360"]}>
      <Nav />
      <TeamPage track={opts.track} predict={opts.predict} search={opts.search} />
      {opts.banner && <ConsentBanner />}
      <FirstRunTour />
    </MemoryRouter>,
  );
}

const card = () => document.querySelector<HTMLElement>("[data-tour-card]");
const stepId = () => card()?.getAttribute("data-tour-step") ?? null;
const opened = () => waitFor(() => expect(card()).not.toBeNull(), { timeout: 4000 });
/** Long enough that a tour that was going to open would have. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 1800)));
const key = (k: string, target: Element = document.activeElement ?? document.body) => fireEvent.keyDown(target, { key: k });

beforeEach(() => {
  localStorage.clear();
  resetTour();
  resetFirstRunForTests();
  setAnalyticsConsent(false); // the privacy choice is made (its own tests cover the banner)
  setWebdriver(false);
  setUA(realUA);
  personal.current = { state: EMPTY_STATE, user: null, providers: { email: true, google: false }, sync: "local", syncReady: false };
  Element.prototype.getBoundingClientRect = laidOut;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = realRect;
  setWebdriver(false);
  setUA(realUA);
});

describe("who sees it", () => {
  it("a fresh visitor on a team page sees it once: welcome, search, track, predict", async () => {
    mount();
    await opened();
    expect(screen.getByRole("dialog", { name: /Step 1 of 4: Welcome to Control Scout/ })).toBeTruthy();
    const seen = [stepId()];
    for (let n = 0; n < 3; n++) { fireEvent.click(screen.getByRole("button", { name: n === 0 ? "Show me" : "Next" })); seen.push(stepId()); }
    expect(seen).toEqual(["welcome", "search", "track", "predict"]);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
    expect(JSON.parse(localStorage.getItem(TOUR_KEY)!)).toMatchObject({ v: 1, outcome: "done", step: 4 });
    // Back on another page in the same visit: not again.
    act(() => go("/"));
    await settle();
    expect(card()).toBeNull();
  });

  it("never shows again after it was finished, across reloads", async () => {
    localStorage.setItem(TOUR_KEY, JSON.stringify({ v: 1, outcome: "done", at: "2026-10-16T00:00:00.000Z", step: 4 }));
    mount();
    await settle();
    expect(card()).toBeNull();
  });

  it("never shows again after it was skipped, across reloads", async () => {
    const first = mount();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(card()).toBeNull();
    expect(readTour()).toMatchObject({ outcome: "skipped", step: 1 });
    first.unmount();
    // A reload: only what's stored counts.
    const stored = localStorage.getItem(TOUR_KEY)!;
    resetTour();
    localStorage.setItem(TOUR_KEY, stored);
    mount();
    await settle();
    expect(card()).toBeNull();
  });

  it("waits while the privacy banner asks, then shows once the choice is made (never both at once)", async () => {
    resetConsent();
    mount({ banner: true });
    await waitFor(() => expect(screen.getByRole("region", { name: "Privacy choices" })).toBeTruthy(), { timeout: 4000 });
    await settle();
    expect(card()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    await opened();
    expect(screen.queryByRole("region", { name: "Privacy choices" })).toBeNull();
  });

  it("stays away from automated browsers and crawlers (screenshots, Lighthouse, Googlebot)", async () => {
    setWebdriver(true);
    const a = mount();
    await settle();
    expect(card()).toBeNull();
    a.unmount();
    setWebdriver(false);
    setUA("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
    mount();
    await settle();
    expect(card()).toBeNull();
    expect(readTour()).toBeNull(); // nothing recorded: a real visit later still gets it
  });

  it("shows to an automated browser that opted in (npm run shots -- --tour)", async () => {
    setWebdriver(true);
    localStorage.setItem(TOUR_DEMO_KEY, "1");
    mount();
    await opened();
  });

  it("stays away from people who clearly know the app", async () => {
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, tracked: { teams: [18360], events: [] } } };
    const a = mount();
    await settle();
    expect(card()).toBeNull();
    a.unmount();
    personal.current = { ...personal.current, state: EMPTY_STATE, user: { id: 1, email: "a@b.c", displayName: null, createdAt: "", controlPoint: { member: true, teams: [], url: "", workspaces: [{ id: "w", name: "W", role: "member" }] } } };
    mount();
    await settle();
    expect(card()).toBeNull();
  });

  it("signed in: decides only once the account's data has synced here (a failed sync isn't enough)", async () => {
    const user = { id: 1, email: "a@b.c", displayName: null, createdAt: "", controlPoint: null };
    personal.current = { ...personal.current, user, sync: "error", syncReady: false };
    const a = mount();
    await settle();
    expect(card()).toBeNull();
    a.unmount();
    personal.current = { ...personal.current, user, sync: "synced", syncReady: true };
    mount();
    await opened();
  });

  it("Clear all local data (resetTour) lets it show again without a reload", async () => {
    mount();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    act(() => go("/"));
    await settle();
    expect(card()).toBeNull();
    act(() => resetTour());
    await opened();
  });

  it("finished in another tab: closes here and gives the first-run slot back", async () => {
    mount();
    await opened();
    expect(firstRunHolder()).toBe("tour");
    localStorage.setItem(TOUR_KEY, JSON.stringify({ v: 1, outcome: "done", at: "", step: 4 }));
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: TOUR_KEY })); });
    expect(card()).toBeNull();
    expect(firstRunHolder()).toBeNull();
  });

  it("holds off while a panel or dialog is open (with or without Radix's data-state)", async () => {
    const panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("data-tour", "x"); // laid out by the test's box stub
    document.body.appendChild(panel);
    try {
      mount();
      await settle();
      expect(card()).toBeNull();
    } finally { panel.remove(); }
    await opened();
  });

  it("waits for the account to answer before deciding", async () => {
    personal.current = { ...personal.current, providers: null };
    mount();
    await settle();
    expect(card()).toBeNull();
  });
});

describe("steps adapt to the page", () => {
  it("leaves out Track where there's no Track button, and points Predict at the nav when the page has no predict button", async () => {
    mount({ path: "/events", track: false, predict: false });
    await opened();
    expect(screen.getByRole("dialog", { name: /Step 1 of 3/ })).toBeTruthy();
    key("ArrowRight");
    expect(stepId()).toBe("search");
    key("ArrowRight");
    expect(stepId()).toBe("predict");
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
  });

  it("doesn't start on a page with too little to point at, and starts on the next page that has enough", async () => {
    mount({ path: "/teams/18360", search: false, track: false, predict: false });
    // Only the nav's Predict: one pointing step.
    Element.prototype.getBoundingClientRect = function (this: Element) { return this.matches('nav a[href="/predict"]') ? laidOut.call(this) : realRect.call(this); };
    await settle();
    expect(card()).toBeNull();
    Element.prototype.getBoundingClientRect = laidOut;
    cleanup();
    mount({ path: "/" , track: false });
    await opened();
  });

  it("doesn't start on settings, scouting or legal pages", () => {
    for (const p of ["/settings", "/scout", "/privacy", "/terms", "/owner", "/download"]) expect(isTourPage(p)).toBe(false);
    for (const p of ["/", "/teams/18360", "/events/2025/USNYQ1", "/events", "/predict", "/teams/"]) expect(isTourPage(p)).toBe(true);
  });

  it("ends (as skipped) when the visitor leaves the page it opened on", async () => {
    mount();
    await opened();
    act(() => go("/events"));
    await waitFor(() => expect(card()).toBeNull());
    expect(readTour()).toMatchObject({ outcome: "skipped" });
  });
});

describe("keyboard and screen readers", () => {
  it("arrows move, Enter on the card goes on, Esc skips, and focus goes back where it was", async () => {
    mount();
    document.getElementById("before")!.focus();
    await opened();
    expect(document.activeElement?.textContent).toBe("Show me");
    key("ArrowRight");
    expect(stepId()).toBe("search");
    key("ArrowRight");
    expect(stepId()).toBe("track");
    key("ArrowLeft");
    expect(stepId()).toBe("search");
    key("Enter", card()!);
    expect(stepId()).toBe("track");
    key("Escape");
    expect(card()).toBeNull();
    expect(readTour()).toMatchObject({ outcome: "skipped", step: 3 });
    expect(document.activeElement?.id).toBe("before");
  });

  it("keeps Tab inside the card while focus is there, and labels the dialog", async () => {
    mount();
    await opened();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    const buttons = [...dialog.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Skip the tour", "Skip", "Show me"]);
    buttons[2]!.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("keys typed in a field (search opened with Ctrl+K) stay the field's", async () => {
    mount();
    await opened();
    key("ArrowRight");
    expect(stepId()).toBe("search");
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      input.focus();
      key("ArrowRight", input);
      key("ArrowLeft", input);
      key("Escape", input);
      expect(stepId()).toBe("search");
    } finally { input.remove(); }
  });

  it("an Esc another prompt handles (and stops) doesn't skip the tour", async () => {
    mount();
    await opened();
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    ev.preventDefault();
    document.body.dispatchEvent(ev);
    expect(card()).not.toBeNull();
  });
});

describe("one first-run surface at a time", () => {
  it("waits while another first-run surface is up, holds the slot while open, and gives it back", async () => {
    expect(claimFirstRun("a2hs")).toBe(true);
    mount();
    await settle();
    expect(card()).toBeNull();
    act(() => releaseFirstRun("a2hs"));
    await opened();
    expect(firstRunHolder()).toBe("tour");
    expect(claimFirstRun("a2hs")).toBe(false);
    key("Escape");
    expect(firstRunHolder()).toBeNull();
    expect(claimFirstRun("a2hs")).toBe(true);
  });
});

describe("helpers", () => {
  it("isAutomated: webdriver and bot user agents, not ordinary browsers", () => {
    const ua = (userAgent: string, webdriver = false) => isAutomated({ userAgent, webdriver });
    expect(ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(ua("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")).toBe(false);
    expect(ua("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", true)).toBe(true);
    expect(ua("Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse")).toBe(true);
    expect(ua("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36")).toBe(true);
    expect(ua("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/130.0.0.0 Safari/537.36")).toBe(true);
    expect(ua("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)")).toBe(true);
  });

  it("knowsTheApp: a team, tracked teams or events, a shortlist, or a workspace", () => {
    expect(knowsTheApp(EMPTY_STATE, null)).toBe(false);
    expect(knowsTheApp({ ...EMPTY_STATE, myTeam: 18360 }, null)).toBe(true);
    expect(knowsTheApp({ ...EMPTY_STATE, tracked: { teams: [], events: ["2025:USNYQ1"] } }, null)).toBe(true);
    expect(knowsTheApp({ ...EMPTY_STATE, bookmarks: [1] }, null)).toBe(true);
    expect(knowsTheApp(EMPTY_STATE, { id: 1, email: null, displayName: null, createdAt: "", controlPoint: { member: true, teams: [], url: "", workspaces: [] } })).toBe(false);
  });

  it("storage blocked: an ended tour stays closed for the page's lifetime", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    try {
      endTour("skipped", 2);
      expect(localStorage.getItem(TOUR_KEY)).toBeNull();
      expect(readTour()).toMatchObject({ outcome: "skipped" });
    } finally { spy.mockRestore(); }
  });
});
