// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { EMPTY_STATE, type PersonalState } from "../../shared/personal";
import { DEFAULT_FLAGS } from "../../shared/flags";
import { resetConsent, setAnalyticsConsent } from "../../lib/consent";
import { resetFirstRunForTests } from "../../lib/firstRun";
import { resetFlags } from "../../lib/flags";
import { readTour, resetTour, TOUR_DEMO_KEY } from "../../lib/tour";
import { resetWelcome, welcomeSeen, WELCOME_EXAMPLES, WELCOME_KEY } from "../../lib/welcome";
import { WelcomeCard } from "./WelcomeCard";

const personal = vi.hoisted(() => ({
  current: { state: null as unknown as PersonalState, user: null as unknown, providers: { email: true, google: false } as unknown, sync: "local", syncReady: false },
}));
vi.mock("../../lib/personal", () => ({ usePersonal: () => personal.current }));

let go: (to: string) => void = () => {};
let where = "";
function Nav() { go = useNavigate(); const l = useLocation(); where = l.pathname + l.search; return null; }
const mount = (path = "/") => render(<MemoryRouter initialEntries={[path]}><Nav /><WelcomeCard /></MemoryRouter>);
const welcome = () => document.querySelector<HTMLElement>("[data-welcome]");
const opened = () => waitFor(() => expect(welcome()).not.toBeNull(), { timeout: 3000 });
const settle = () => act(() => new Promise((r) => setTimeout(r, 1500)));
const setWebdriver = (on: boolean) => Object.defineProperty(navigator, "webdriver", { value: on, configurable: true });

beforeEach(() => {
  localStorage.clear();
  resetWelcome();
  resetTour();
  resetFirstRunForTests();
  resetFlags({ ...DEFAULT_FLAGS }, true);
  setAnalyticsConsent(false);
  setWebdriver(false);
  personal.current = { state: EMPTY_STATE, user: null, providers: { email: true, google: false }, sync: "local", syncReady: false };
});
afterEach(() => { cleanup(); resetConsent(); setWebdriver(false); });

describe("the welcome card", () => {
  it("greets a first-time visitor with live example searches, and no tour while the owner's switch is off", async () => {
    mount();
    await opened();
    expect(screen.getByRole("dialog", { name: "Welcome to Control Scout" })).toBeTruthy();
    expect(welcome()!.textContent).toContain("Search any team, event or match.");
    expect([...document.querySelectorAll("[data-welcome-example]")].map((b) => b.textContent!.trim())).toEqual([...WELCOME_EXAMPLES]);
    expect(screen.queryByRole("button", { name: "Take the tour" })).toBeNull();
  });

  it("an example runs its search and closes for good", async () => {
    mount();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "worlds highlights decode" }));
    expect(where).toBe("/search?q=worlds%20highlights%20decode");
    expect(welcome()).toBeNull();
    expect(welcomeSeen()).toBe(true);
    expect(localStorage.getItem(WELCOME_KEY)).not.toBeNull();
  });

  it("is shown once: closed with X it never comes back, even on a fresh page load", async () => {
    const a = mount();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(welcome()).toBeNull();
    a.unmount();
    mount("/events");
    await settle();
    expect(welcome()).toBeNull();
  });

  it("closes on Esc, but not on Esc while typing in a field", async () => {
    mount();
    await opened();
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      fireEvent.keyDown(input, { key: "Escape" });
      expect(welcome()).not.toBeNull();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(welcome()).toBeNull();
      expect(welcomeSeen()).toBe(true);
    } finally { input.remove(); }
  });

  it("closes on any search the visitor runs", async () => {
    mount();
    await opened();
    act(() => go("/search?q=ultraviolet"));
    await waitFor(() => expect(welcome()).toBeNull());
    expect(welcomeSeen()).toBe(true);
  });

  it("with the owner's switch on, offers Take the tour, which starts it", async () => {
    resetFlags({ ...DEFAULT_FLAGS, onboardingTour: true }, true);
    mount("/events");
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(welcome()).toBeNull();
    expect(readTour()).toMatchObject({ status: "paused", step: 0 });
    expect(where).toBe("/events");
  });

  it("stays away from people who use the app already, automated browsers, and pages nobody lands on first", async () => {
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, tracked: { teams: [6980], events: [] } } };
    const a = mount();
    await settle();
    expect(welcome()).toBeNull();
    a.unmount();
    personal.current = { ...personal.current, state: EMPTY_STATE };
    setWebdriver(true);
    const b = mount();
    await settle();
    expect(welcome()).toBeNull();
    b.unmount();
    setWebdriver(false);
    const c = mount("/settings");
    await settle();
    expect(welcome()).toBeNull();
    c.unmount();
    // Screenshots opt in.
    setWebdriver(true);
    localStorage.setItem(TOUR_DEMO_KEY, "1");
    mount();
    await opened();
  });

  it("Clear all local data (resetWelcome) brings it back without a reload", async () => {
    mount();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(welcome()).toBeNull();
    act(() => resetWelcome());
    await opened();
  });

  it("signed in: waits for this device's first sync before deciding (no flash for someone who uses the app)", async () => {
    const user = { id: 1, email: "a@b.c", displayName: null, createdAt: "", controlPoint: null };
    personal.current = { ...personal.current, user, sync: "syncing", syncReady: false } as typeof personal.current;
    const a = mount();
    await settle();
    expect(welcome()).toBeNull();
    a.unmount();
    personal.current = { ...personal.current, user, sync: "synced", syncReady: true } as typeof personal.current;
    mount();
    await opened();
  });

  it("waits for the privacy choice and the account", async () => {
    resetConsent();
    const a = mount();
    await settle();
    expect(welcome()).toBeNull();
    a.unmount();
    setAnalyticsConsent(false);
    personal.current = { ...personal.current, providers: null };
    mount();
    await settle();
    expect(welcome()).toBeNull();
  });

  it("blocked storage: still shown once for this page's lifetime, never an error", async () => {
    const realGet = Storage.prototype.getItem, realSet = Storage.prototype.setItem;
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) { if (k === WELCOME_KEY) throw new Error("blocked"); return realGet.call(this, k); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) { if (k === WELCOME_KEY) throw new Error("blocked"); realSet.call(this, k, v); });
    try {
      const a = mount();
      await opened();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      a.unmount();
      mount();
      await settle();
      expect(welcome()).toBeNull();
    } finally { get.mockRestore(); set.mockRestore(); }
  });
});
