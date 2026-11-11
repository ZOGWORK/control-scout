// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { EMPTY_STATE, type PersonalState } from "../../shared/personal";
import { resetConsent, setAnalyticsConsent } from "../../lib/consent";
import { claimFirstRun, firstRunHolder, releaseFirstRun, resetFirstRunForTests } from "../../lib/firstRun";
import { coversTour, endTour, predictAction, isAutomated, isTourPage, knowsTheApp, readTour, resetTour, tourKind, TOUR_DEMO_KEY, TOUR_KEY } from "../../lib/tour";
import { ConsentBanner } from "./ConsentBanner";
import { FirstRunTour } from "./FirstRunTour";

const personal = vi.hoisted(() => ({
  current: { state: null as unknown as PersonalState, user: null as unknown, providers: { email: true, google: false } as unknown, sync: "local", syncReady: false },
}));
vi.mock("../../lib/personal", () => ({ usePersonal: () => personal.current }));

const realUA = navigator.userAgent;
const setUA = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
const setWebdriver = (on: boolean) => Object.defineProperty(navigator, "webdriver", { value: on, configurable: true });

// jsdom lays nothing out: give the tour's targets a box.
const realRect = Element.prototype.getBoundingClientRect;
function laidOut(this: Element) {
  const on = this.hasAttribute("data-tour") || this.hasAttribute("data-watch-live");
  const r = on ? { top: 100, left: 100, width: 120, height: 40 } : { top: 0, left: 0, width: 0, height: 0 };
  return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
}

/** The bits of a page the tour points at (a team page's, unless turned off). */
function TeamPage({ team = true, search = true, matches = false, loading = false }: { team?: boolean; search?: boolean; matches?: boolean; loading?: boolean }) {
  return (
    <div>
      {loading && <div className="skeleton" />}
      {search && <button type="button" data-tour="search">Search</button>}
      <button type="button" id="before">Something</button>
      {team && <dl data-tour="rating"><dt>OPR</dt><dd>16</dd><dt>Rating</dt><dd>28.6</dd></dl>}
      {team && <div data-tour="save"><button type="button" data-tour="track">Track</button></div>}
      {matches && <div data-tour="event-matches">Q1</div>}
    </div>
  );
}

let go: (to: string) => void = () => {};
/** Where the app is now (path + query). */
let where = "";
function Nav() { go = useNavigate(); const l = useLocation(); where = l.pathname + l.search; return null; }

type MountOpts = { path?: string; team?: boolean; search?: boolean; matches?: boolean; banner?: boolean };
function mount(opts: MountOpts = {}) { return render(tree(opts)); }
function tree(opts: MountOpts) {
  return (
    <MemoryRouter initialEntries={[opts.path ?? "/teams/18360"]}>
      <Nav />
      <TeamPage team={opts.team} search={opts.search} matches={opts.matches} />
      {opts.banner && <ConsentBanner />}
      <FirstRunTour />
    </MemoryRouter>
  );
}

const card = () => document.querySelector<HTMLElement>("[data-tour-card]");
const stepId = () => card()?.getAttribute("data-tour-step") ?? null;
const pill = () => document.querySelector<HTMLElement>("[data-tour-paused]");
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
  it("a fresh visitor on a team page: a real search, OPR vs Rating, a real Track tap, highlights, then Predict", async () => {
    const view = mount();
    await opened();
    expect(screen.getByRole("dialog", { name: /Step 1 of 4: Ask it a question/ })).toBeTruthy();
    // Step 1 runs a real search: the search page, with the answer, and the card docked out of the way.
    fireEvent.click(screen.getByRole("button", { name: "Ask \u201cwho won decode\u201d" }));
    expect(where).toBe("/search?q=who%20won%20decode");
    await waitFor(() => expect(card()?.hasAttribute("data-tour-docked")).toBe(true));
    expect(stepId()).toBe("search");
    expect(card()!.textContent).toContain("tap a question under the answer");
    // Next: the team page's own step takes the visitor back there.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(where).toBe("/teams/18360");
    await waitFor(() => expect(stepId()).toBe("rating"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(stepId()).toBe("save");
    // Step 3 is the real Track button: tracking the team moves the tour on (and nothing untracks it).
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, tracked: { teams: [18360], events: [] } } };
    view.rerender(tree({}));
    await waitFor(() => expect(stepId()).toBe("highlights"), { timeout: 3000 });
    expect(personal.current.state.tracked.teams).toEqual([18360]);
    expect(readTour()).toMatchObject({ v: 2, status: "paused", step: 3, origin: "/teams/18360" });
    // Step 4: the team's highlights, then Predict with the team picked, which ends the tour.
    fireEvent.click(screen.getByRole("button", { name: "Show highlights" }));
    expect(where).toBe("/search?q=18360%20highlights");
    await waitFor(() => expect(card()?.hasAttribute("data-tour-docked")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Predict a match with 18360" }));
    expect(where).toBe(predictAction("/teams/18360").href);
    expect(card()).toBeNull();
    expect(JSON.parse(localStorage.getItem(TOUR_KEY)!)).toMatchObject({ v: 2, status: "finished", step: 3 });
    // Back on another page in the same visit: not again.
    act(() => go("/"));
    await settle();
    expect(card()).toBeNull();
  });

  it("never shows again after it was finished, across reloads", async () => {
    localStorage.setItem(TOUR_KEY, JSON.stringify({ v: 2, status: "finished", at: "2026-11-10T00:00:00.000Z", step: 3, origin: "/", steps: ["search", "highlights"] }));
    mount();
    await settle();
    expect(card()).toBeNull();
  });

  it("the old build's records: Done and a real Skip still count, a step-0 skip (just navigating away) doesn't", async () => {
    for (const old of [{ v: 1, outcome: "done", at: "", step: 4 }, { v: 1, outcome: "skipped", at: "", step: 2 }]) {
      resetTour();
      localStorage.setItem(TOUR_KEY, JSON.stringify(old));
      const m = mount();
      await settle();
      expect(card()).toBeNull();
      m.unmount();
    }
    resetTour();
    localStorage.setItem(TOUR_KEY, JSON.stringify({ v: 1, outcome: "skipped", at: "", step: 0 }));
    expect(readTour()).toBeNull();
    mount();
    await opened();
  });

  it("never shows again after it was skipped, across reloads", async () => {
    const first = mount();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(card()).toBeNull();
    expect(readTour()).toMatchObject({ status: "skipped", step: 0 });
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
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
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
    localStorage.setItem(TOUR_KEY, JSON.stringify({ v: 2, status: "finished", at: "", step: 3, origin: "/teams/18360", steps: ["search"] }));
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
  it("Events (and every page but team and event pages): search, then highlights; never the team page's steps", async () => {
    mount({ path: "/events" }); // the team page's bits are on screen, but this isn't a team page
    await opened();
    expect(screen.getByRole("dialog", { name: /Step 1 of 2/ })).toBeTruthy();
    key("ArrowRight");
    expect(stepId()).toBe("highlights");
    // A season's highlights (no team named), then Predict.
    fireEvent.click(screen.getByRole("button", { name: "Show highlights" }));
    expect(where).toBe("/search?q=decode%20finals%20match%20highlights");
    await waitFor(() => expect(screen.getByRole("button", { name: "Predict a match" })).toBeTruthy());
  });

  it("an event page: search, then its matches and recordings", async () => {
    mount({ path: "/events/2025/USNJNEM3", team: false, matches: true });
    await opened();
    expect(screen.getByRole("dialog", { name: /Step 1 of 2/ })).toBeTruthy();
    key("ArrowRight");
    expect(stepId()).toBe("watch");
  });

  it("a team page that will never have a part (no rating this season) leaves its step out, without waiting for it", async () => {
    mount({ team: false });
    await opened();
    expect(screen.getByRole("dialog", { name: /Step 1 of 2/ })).toBeTruthy();
  });

  it("a team page's parts that render late (still loading past the wait) are still in its tour", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/teams/18360"]}><Nav /><TeamPage team={false} loading /><FirstRunTour /></MemoryRouter>,
    );
    await settle();
    expect(card()).toBeNull();
    view.rerender(<MemoryRouter initialEntries={["/teams/18360"]}><Nav /><TeamPage /><FirstRunTour /></MemoryRouter>);
    await opened();
    expect(screen.getByRole("dialog", { name: /Step 1 of 4/ })).toBeTruthy();
  });

  it("an event page with nothing of its own yet (no schedule, no recording): search then highlights", async () => {
    mount({ path: "/events/2026/USNJNEM9", team: false });
    await opened();
    expect(screen.getByRole("dialog", { name: /Step 1 of 2/ })).toBeTruthy();
    key("ArrowRight");
    expect(stepId()).toBe("highlights");
  });

  it("doesn't start without a search box to point at, and starts on the next page that has one", async () => {
    const a = mount({ search: false });
    await settle();
    expect(card()).toBeNull();
    expect(readTour()).toBeNull();
    a.unmount();
    mount({ path: "/" });
    await opened();
  });

  it("starts on landing pages only; carries on over search's results too", () => {
    for (const p of ["/settings", "/scout", "/privacy", "/terms", "/owner", "/download", "/search"]) expect(isTourPage(p)).toBe(false);
    for (const p of ["/", "/teams/18360", "/events/2025/USNYQ1", "/events", "/predict", "/teams/"]) expect(isTourPage(p)).toBe(true);
    expect(coversTour("/search")).toBe(true);
    expect(coversTour("/settings")).toBe(false);
    expect([tourKind("/teams/4215"), tourKind("/events/2026/USNJNEM3"), tourKind("/events"), tourKind("/")]).toEqual(["team", "event", "other", "other"]);
  });
});

describe("leaving the page doesn't end it", () => {
  it("search works anywhere: opening Events mid-tour carries on at the same step, never restarting or skipping", async () => {
    mount();
    await opened();
    act(() => go("/events"));
    await waitFor(() => expect(card()).not.toBeNull());
    expect(stepId()).toBe("search");
    expect(screen.getByRole("dialog", { name: /Step 1 of 4/ })).toBeTruthy();
    expect(readTour()).toMatchObject({ status: "paused", step: 0, origin: "/teams/18360" });
  });

  it("a team-page step elsewhere: paused, visibly; picking up goes back to the team at the same step", async () => {
    mount();
    await opened();
    key("ArrowRight");
    expect(stepId()).toBe("rating");
    act(() => go("/settings"));
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(card()).toBeNull();
    expect(pill()!.textContent).toContain("Tour paused");
    expect(readTour()).toMatchObject({ status: "paused", step: 1 });
    // Another landing page without the step: still paused.
    act(() => go("/events"));
    await settle();
    expect(pill()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick up where you left off" }));
    await waitFor(() => expect(card()).not.toBeNull());
    expect(stepId()).toBe("rating");
    expect(pill()).toBeNull();
  });

  it("closing the tab or a reload: next visit resumes at the same step (even after tracking the team in it)", async () => {
    const a = mount();
    await opened();
    key("ArrowRight");
    key("ArrowRight");
    expect(stepId()).toBe("save");
    a.unmount();
    const stored = localStorage.getItem(TOUR_KEY)!;
    resetTour();
    localStorage.setItem(TOUR_KEY, stored);
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, tracked: { teams: [18360], events: [] } } };
    mount();
    await opened();
    expect(stepId()).toBe("save");
    expect(screen.getByRole("dialog", { name: /Step 3 of 4/ })).toBeTruthy();
  });

  it("the owner console shows nothing and gives the first-run slot back (other surfaces may show)", async () => {
    mount();
    await opened();
    key("ArrowRight");
    act(() => go("/owner"));
    await settle();
    expect(card()).toBeNull();
    expect(pill()).toBeNull();
    expect(firstRunHolder()).toBeNull();
    expect(readTour()).toMatchObject({ status: "paused", step: 1 });
    // Leaving the console: the paused note is back.
    act(() => go("/settings"));
    await waitFor(() => expect(pill()).not.toBeNull());
  });

  it("going back for a step keeps the start page's query (a season, a tab)", async () => {
    mount({ path: "/teams/18360?season=2024" });
    await opened();
    expect(readTour()).toMatchObject({ origin: "/teams/18360?season=2024" });
    key("ArrowRight");
    act(() => go("/settings"));
    await waitFor(() => expect(pill()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Pick up where you left off" }));
    await waitFor(() => expect(stepId()).toBe("rating"));
    expect(where).toBe("/teams/18360?season=2024");
  });

  it("a step whose part leaves the page (an event's tab changed by Back/Forward) waits, paused, instead of pointing at nothing", async () => {
    mount({ path: "/events/2025/USNJNEM3", team: false, matches: true });
    await opened();
    key("ArrowRight");
    expect(stepId()).toBe("watch");
    document.querySelector<HTMLElement>('[data-tour="event-matches"]')!.style.display = "none";
    act(() => go("/events/2025/USNJNEM3?tab=rankings"));
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(card()).toBeNull();
    expect(readTour()).toMatchObject({ status: "paused", step: 1 });
  });

  it("a query changed while the tour waited to open: it starts from the view the visitor is on now", async () => {
    mount({ path: "/teams/18360?season=2024" });
    act(() => go("/teams/18360?season=2025"));
    await opened();
    expect(readTour()).toMatchObject({ origin: "/teams/18360?season=2025" });
  });

  it("the paused note's close is an explicit skip", async () => {
    mount();
    await opened();
    key("ArrowRight");
    act(() => go("/settings"));
    await waitFor(() => expect(pill()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    expect(pill()).toBeNull();
    expect(readTour()).toMatchObject({ status: "skipped", step: 1 });
  });

  it("Back to a team-page step from another page goes back to the team page", async () => {
    mount();
    await opened();
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowRight");
    expect(stepId()).toBe("highlights");
    act(() => go("/events"));
    await waitFor(() => expect(card()).not.toBeNull());
    expect(stepId()).toBe("highlights");
    key("ArrowLeft");
    await waitFor(() => expect(stepId()).toBe("save"));
  });
});

describe("keyboard and screen readers", () => {
  it("arrows move, Enter on the card goes on, Esc skips, and focus goes back where it was", async () => {
    mount();
    document.getElementById("before")!.focus();
    await opened();
    expect(document.activeElement?.textContent).toBe("Ask \u201cwho won decode\u201d");
    key("ArrowRight");
    expect(stepId()).toBe("rating");
    key("ArrowRight");
    expect(stepId()).toBe("save");
    key("ArrowLeft");
    expect(stepId()).toBe("rating");
    key("Enter", card()!);
    expect(stepId()).toBe("save");
    key("Escape");
    expect(card()).toBeNull();
    expect(readTour()).toMatchObject({ status: "skipped", step: 2 });
    expect(document.activeElement?.id).toBe("before");
  });

  it("keeps Tab inside the card while focus is there, and labels the dialog", async () => {
    mount();
    await opened();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    const buttons = [...dialog.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Skip the tour", "Skip tour", "Ask \u201cwho won decode\u201d"]);
    buttons[2]!.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("keys typed in a field (search opened with Ctrl+K) stay the field's", async () => {
    mount();
    await opened();
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
      expect(readTour()).toMatchObject({ status: "skipped" });
    } finally { spy.mockRestore(); }
  });
});

describe("real actions, never simulated", () => {
  it("typing their own question counts: step 1 goes on with their answer, not the demo query", async () => {
    mount();
    await opened();
    act(() => go("/search?q=4215%20awards"));
    await waitFor(() => expect(card()?.hasAttribute("data-tour-docked")).toBe(true));
    expect(stepId()).toBe("search");
    // A follow-up question on the answer page: still step 1, still docked.
    act(() => go("/search?q=what%20is%204215%27s%20record"));
    await settle();
    expect(stepId()).toBe("search");
  });

  it("already tracking the team: the save step notices and moves on; Back to it stays put", async () => {
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, tracked: { teams: [18360], events: [] } } };
    localStorage.setItem(TOUR_KEY, JSON.stringify({ v: 2, status: "paused", at: "", step: 1, origin: "/teams/18360", steps: ["search", "rating", "save", "highlights"] }));
    mount();
    await opened();
    expect(stepId()).toBe("rating");
    key("ArrowRight");
    expect(stepId()).toBe("save");
    await waitFor(() => expect(stepId()).toBe("highlights"), { timeout: 3000 });
    key("ArrowLeft");
    expect(stepId()).toBe("save");
    await settle();
    expect(stepId()).toBe("save");
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  });

  it("not tracking yet: the card's button is a quiet Next; the step's action is the page's Track button", async () => {
    mount();
    await opened();
    key("ArrowRight");
    key("ArrowRight");
    expect(stepId()).toBe("save");
    expect(screen.getByRole("button", { name: "Next" }).className).not.toContain("bg-accent");
    // Clicks reach the spotlit part (Track), not the rest of the page.
    const track = screen.getByRole("button", { name: "Track" });
    const other = document.getElementById("before")!;
    const seen: string[] = [];
    track.addEventListener("click", () => seen.push("track"));
    other.addEventListener("click", () => seen.push("other"));
    fireEvent.click(other);
    fireEvent.click(track);
    expect(seen).toEqual(["track"]);
  });

  it("an event streaming live: the step says so, and promises no recording yet", async () => {
    const live = document.createElement("section");
    live.setAttribute("data-watch-live", "");
    document.body.appendChild(live);
    try {
      mount({ path: "/events/2025/USNJNEM3", team: false, matches: true });
      await opened();
      key("ArrowRight");
      expect(stepId()).toBe("watch");
      expect(card()!.textContent).toContain("streaming live");
      live.setAttribute("data-recording", "");
      key("ArrowLeft");
      key("ArrowRight");
      expect(card()!.textContent).toContain("one full video");
    } finally { live.remove(); }
  });

  it("an event page ends with Predict on that event, and says plainly most events have no recording", async () => {
    mount({ path: "/events/2025/USNJNEM3", team: false, matches: true });
    await opened();
    key("ArrowRight");
    expect(stepId()).toBe("watch");
    expect(card()!.textContent).toContain("Most events have no recording yet");
    expect(card()!.textContent).not.toMatch(/clip/i);
    fireEvent.click(screen.getByRole("button", { name: "Predict this event" }));
    expect(where).toBe(predictAction("/events/2025/USNJNEM3").href);
    expect(where).toContain("code=USNJNEM3");
    expect(readTour()).toMatchObject({ status: "finished" });
  });
});
