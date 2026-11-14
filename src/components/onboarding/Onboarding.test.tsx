// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { EMPTY_STATE, type PersonalState } from "../../shared/personal";
import { resetConsent, setAnalyticsConsent } from "../../lib/consent";
import { claimFirstRun, firstRunHolder, releaseFirstRun, resetFirstRunForTests } from "../../lib/firstRun";
import { endOnboarding, ONBOARDING_DEMO_KEY, ONBOARDING_KEY, openOnboarding, readOnboarding, resetOnboarding, startsOn, usesTheApp } from "../../lib/onboarding";
import { Onboarding, ONBOARDING_DELAY_MS } from "./Onboarding";

type P = { state: PersonalState; user: unknown; providers: unknown; sync: string; syncReady: boolean; set: (k: string, v: unknown) => boolean };
const personal = vi.hoisted(() => ({ current: null as unknown as P }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => personal.current }));
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiFetch: (...a: unknown[]) => api.fetch(...a) }));

const setWebdriver = (on: boolean) => Object.defineProperty(navigator, "webdriver", { value: on, configurable: true });

let go: (to: string) => void = () => {};
function Nav() { go = useNavigate(); return null; }

function mount(path = "/") {
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  return render(<MemoryRouter initialEntries={[path]}><Nav /><Onboarding /></MemoryRouter>, { container: root });
}
const dialog = () => document.querySelector<HTMLElement>("[data-onboarding]");
const step = () => Number(dialog()?.getAttribute("data-onboarding-step") ?? 0);
const skip = () => document.querySelector<HTMLButtonElement>("[data-onboarding-skip]")!;
const next = () => document.querySelector<HTMLButtonElement>("[data-onboarding-next]")!;
/** Long enough for it to open if it's going to (idle, then the delay). */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(ONBOARDING_DELAY_MS + 2500); });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  resetOnboarding();
  resetFirstRunForTests();
  setAnalyticsConsent(false); // the privacy choice is made
  setWebdriver(false);
  personal.current = { state: EMPTY_STATE, user: null, providers: { email: true }, sync: "local", syncReady: false, set: vi.fn(() => true) };
  api.fetch.mockReset();
  api.fetch.mockResolvedValue({ hits: [{ kind: "team", ref: "4215", title: "4215 | Hypnotic Robotics", subtitle: "River Dell · Oradell, NJ, USA" }] });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("who gets it", () => {
  it("a first-time visitor on Home gets it, on step 1, with the first-run slot", async () => {
    mount("/");
    await settle();
    expect(dialog()).not.toBeNull();
    expect(step()).toBe(1);
    expect(screen.getByRole("dialog", { name: /Welcome to Control Scout/ })).toBeTruthy();
    expect(readOnboarding()).toMatchObject({ status: "open", step: 0 });
    expect(firstRunHolder()).toBe("onboarding");
  });

  it("only on Home: a first visit to a team, event or other page isn't interrupted", async () => {
    for (const p of ["/teams/4215", "/events/2025/USNJQ1", "/predict", "/settings", "/search"]) {
      expect(startsOn(p)).toBe(false);
      const v = mount(p);
      await settle();
      expect(dialog()).toBeNull();
      v.unmount();
    }
    expect(startsOn("/")).toBe(true);
    expect(readOnboarding()).toBeNull(); // still a new visitor: Home will get it
  });

  it("waits for the privacy choice", async () => {
    resetConsent();
    mount("/");
    await settle();
    expect(dialog()).toBeNull();
    act(() => setAnalyticsConsent(false));
    await settle();
    expect(dialog()).not.toBeNull();
  });

  it("never to someone who already uses the app", async () => {
    expect(usesTheApp(EMPTY_STATE, null)).toBe(false);
    for (const state of [
      { ...EMPTY_STATE, myTeam: 4215 },
      { ...EMPTY_STATE, tracked: { teams: [7149], events: [] } },
      { ...EMPTY_STATE, tracked: { teams: [], events: ["2025:USNJQ1"] } },
      { ...EMPTY_STATE, bookmarks: [4215] },
    ] as PersonalState[]) {
      expect(usesTheApp(state, null)).toBe(true);
      personal.current = { ...personal.current, state };
      const v = mount("/");
      await settle();
      expect(dialog()).toBeNull();
      v.unmount();
    }
    expect(usesTheApp(EMPTY_STATE, { controlPoint: { workspaces: [{ id: 1 }] } } as never)).toBe(true);
  });

  it("signed in, waits for the first sync to work before deciding", async () => {
    personal.current = { ...personal.current, user: { id: 1 }, sync: "syncing", syncReady: false };
    const v = mount("/");
    await settle();
    expect(dialog()).toBeNull();
    v.unmount();
    personal.current = { ...personal.current, sync: "synced", syncReady: true };
    mount("/");
    await settle();
    expect(dialog()).not.toBeNull();
  });

  it("never to crawlers or automated browsers, unless they opt in", async () => {
    setWebdriver(true);
    const v = mount("/");
    await settle();
    expect(dialog()).toBeNull();
    expect(readOnboarding()).toBeNull();
    v.unmount();
    localStorage.setItem(ONBOARDING_DEMO_KEY, "1");
    mount("/");
    await settle();
    expect(dialog()).not.toBeNull();
  });

  it("waits while another first-run surface has the slot", async () => {
    claimFirstRun("install");
    mount("/");
    await settle();
    expect(dialog()).toBeNull();
    act(() => releaseFirstRun("install"));
    await settle();
    expect(dialog()).not.toBeNull();
  });

  it("finished or skipped: never again on its own", async () => {
    for (const status of ["finished", "skipped"] as const) {
      resetOnboarding();
      openOnboarding();
      endOnboarding(status);
      const v = mount("/");
      await settle();
      expect(dialog()).toBeNull();
      v.unmount();
    }
  });

  it("a reload while it's open brings it back on the same step, on any page", async () => {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: "open", step: 2, at: "x" }));
    mount("/teams/4215");
    await settle();
    expect(step()).toBe(3);
  });
});

describe("locked: only Skip gets out", () => {
  async function openAt(n: number) {
    mount("/");
    await settle();
    for (let i = 1; i < n; i++) { fireEvent.click(next()); await act(async () => { await vi.advanceTimersByTimeAsync(50); }); }
    expect(step()).toBe(n);
  }
  const stillOpen = (n: number) => { expect(dialog()).not.toBeNull(); expect(step()).toBe(n); expect(readOnboarding()?.status).toBe("open"); };

  for (const n of [1, 2, 3, 4]) {
    it(`step ${n}: Escape, the backdrop, outside clicks and taps, focus leaving and shortcuts don't close it`, async () => {
      await openAt(n);
      const content = dialog()!;
      // Escape, on the dialog and on the page.
      fireEvent.keyDown(content, { key: "Escape" });
      fireEvent.keyDown(document.body, { key: "Escape" });
      fireEvent.keyDown(window, { key: "Escape" });
      stillOpen(n);
      // The backdrop and the page behind: pointer, mouse, touch and click.
      const backdrop = document.querySelector<HTMLElement>("[data-onboarding-backdrop]")!;
      for (const target of [backdrop, document.body, document.getElementById("root")!]) {
        fireEvent.pointerDown(target); fireEvent.mouseDown(target); fireEvent.touchStart(target, { touches: [{ clientX: 5, clientY: 5 }], changedTouches: [{ clientX: 5, clientY: 5 }] }); fireEvent.pointerUp(target); fireEvent.click(target);
      }
      stillOpen(n);
      // Focus moving out.
      const outside = document.createElement("button");
      document.body.append(outside);
      act(() => outside.focus());
      fireEvent.focusIn(outside);
      stillOpen(n);
      // The page's shortcuts never reach the page.
      const seen = vi.fn();
      document.addEventListener("keydown", seen);
      fireEvent.keyDown(content, { key: "k", ctrlKey: true });
      fireEvent.keyDown(content, { key: "k", metaKey: true });
      fireEvent.keyDown(content, { key: "/" });
      fireEvent.keyDown(content, { key: "Escape" });
      document.removeEventListener("keydown", seen);
      expect(seen).not.toHaveBeenCalled();
      stillOpen(n);
    });
  }

  it("a route change doesn't close it", async () => {
    await openAt(2);
    act(() => go("/teams/4215"));
    await settle();
    stillOpen(2);
    act(() => go("/events"));
    await settle();
    stillOpen(2);
  });

  it("the page behind is inert while it shows, and not after", async () => {
    await openAt(1);
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
    fireEvent.click(skip());
    await settle();
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(false);
  });

  it("has no close button: Skip is its only way out, in the header on every step", async () => {
    await openAt(1);
    for (let n = 1; n <= 4; n++) {
      const buttons = [...dialog()!.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? b.getAttribute("aria-label"));
      expect(buttons.some((b) => /close|×|dismiss/i.test(b ?? ""))).toBe(false);
      expect(skip()).toBeTruthy();
      expect(skip().textContent).toBe("Skip");
      // The same place: the first row of the dialog, before the step itself.
      const header = dialog()!.firstElementChild!;
      expect(header.contains(skip())).toBe(true);
      if (n < 4) { fireEvent.click(next()); await act(async () => { await vi.advanceTimersByTimeAsync(50); }); }
    }
  });

  it("Skip on step 1 ends it for good: gone, recorded, not back on the next load", async () => {
    const v = mount("/");
    await settle();
    fireEvent.click(skip());
    await settle();
    expect(dialog()).toBeNull();
    expect(readOnboarding()).toMatchObject({ status: "skipped", step: 0 });
    expect(firstRunHolder()).toBeNull();
    v.unmount();
    resetFirstRunForTests();
    mount("/");
    await settle();
    expect(dialog()).toBeNull();
  });

  it("Skip from another tab closes it here too", async () => {
    await openAt(2);
    act(() => {
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: "skipped", step: 1, at: "y" }));
      window.dispatchEvent(new StorageEvent("storage", { key: ONBOARDING_KEY }));
    });
    await settle();
    expect(dialog()).toBeNull();
  });
});

describe("the steps", () => {
  it("all the way through with a team: saves it as My team, then ends cleanly", async () => {
    const set = vi.fn(() => true);
    personal.current = { ...personal.current, set };
    mount("/");
    await settle();
    fireEvent.click(next()); // → 2
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const input = dialog()!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "hypno" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await waitFor(() => expect(dialog()!.querySelector('[data-onboarding-team-option="4215"]')).not.toBeNull());
    expect(api.fetch.mock.calls[0]![0]).toContain("/api/search?q=hypno&kinds=team");
    fireEvent.click(dialog()!.querySelector('[data-onboarding-team-option="4215"]')!);
    expect(next().textContent).toContain("Save 4215");
    fireEvent.click(next()); // → 3
    expect(set).toHaveBeenCalledWith("myTeam", 4215);
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, myTeam: 4215 } };
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.click(next()); // → 4 (re-render with the saved team)
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(step()).toBe(4);
    fireEvent.click(next()); // finish
    await settle();
    expect(dialog()).toBeNull();
    expect(readOnboarding()).toMatchObject({ status: "finished" });
  });

  it("step 3 shows examples about the team picked, and plain ones without", async () => {
    personal.current = { ...personal.current, state: { ...EMPTY_STATE } };
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: "open", step: 2, at: "x" }));
    const v = mount("/");
    await settle();
    expect(dialog()!.textContent).toContain("Who won Worlds");
    v.unmount();
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, myTeam: 4215 } };
    mount("/");
    await settle();
    expect(dialog()!.textContent).toContain("4215 next match");
    // Shown, not run: nothing in the list is a button or a link that could leave the dialog.
    expect(dialog()!.querySelectorAll('[aria-label="Example searches"] button, [aria-label="Example searches"] a').length).toBe(0);
  });

  it("\"I'm not on a team\" moves on without saving one, and never clears a team the person already had", async () => {
    const set = vi.fn(() => true);
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, myTeam: 7149 }, set };
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: "open", step: 1, at: "x" })); // a replay from Settings
    mount("/");
    await settle();
    fireEvent.click(dialog()!.querySelector("[data-onboarding-no-team]")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(step()).toBe(3);
    expect(set).not.toHaveBeenCalled();
  });

  it("after a reload, \"I'm not on a team\" still takes back the team this onboarding saved", async () => {
    const set = vi.fn(() => true);
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, myTeam: 4215 }, set };
    // Saved in step 2 earlier, then a reload and Back to step 2.
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: "open", step: 1, team: 4215, at: "x" }));
    mount("/");
    await settle();
    fireEvent.click(dialog()!.querySelector("[data-onboarding-no-team]")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(set).toHaveBeenCalledWith("myTeam", null);
    expect(readOnboarding()).toMatchObject({ step: 2, team: null });
  });

  it("Change on a team already saved opens the search, and keeps that team until another is picked", async () => {
    const set = vi.fn(() => true);
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, myTeam: 7149 }, set };
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: "open", step: 1, at: "x" }));
    mount("/");
    await settle();
    expect(dialog()!.querySelector('[data-onboarding-team="7149"]')).not.toBeNull();
    fireEvent.click(dialog()!.querySelector("[data-onboarding-change]")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(dialog()!.querySelector("input")).not.toBeNull();
    expect(set).not.toHaveBeenCalled();
    fireEvent.click(next()); // nothing new picked: moves on, the saved team stays
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(step()).toBe(3);
    expect(set).not.toHaveBeenCalled();
  });

  it("Enter picks only a result for exactly what's typed: never an older query's, never moves on while searching", async () => {
    let answer: (v: unknown) => void = () => {};
    api.fetch.mockImplementation(() => new Promise((r) => { answer = r; }));
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: "open", step: 1, at: "x" }));
    mount("/");
    await settle();
    const input = dialog()!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "hypno" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { answer({ hits: [{ kind: "team", ref: "4215", title: "4215 | Hypnotic Robotics" }] }); });
    // A new query: the old results are gone at once, and Enter while it searches does nothing.
    fireEvent.change(input, { target: { value: "enforcers" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dialog()!.querySelector('[data-onboarding-team="4215"]')).toBeNull();
    expect(step()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { answer({ hits: [{ kind: "team", ref: "7149", title: "7149 | ENFORCERS" }] }); });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dialog()!.querySelector('[data-onboarding-team="7149"]')).not.toBeNull();
    expect(step()).toBe(2);
  });

  it("Back goes to the step before; there's no Back on step 1", async () => {
    mount("/");
    await settle();
    expect(document.querySelector("[data-onboarding-back]")).toBeNull();
    fireEvent.click(next());
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.click(document.querySelector("[data-onboarding-back]")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(step()).toBe(1);
  });

  it("says where it is to a screen reader on every step", async () => {
    mount("/");
    await settle();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    const d = screen.getByRole("dialog");
    const name = document.getElementById(d.getAttribute("aria-labelledby")!)?.textContent?.replace(/\s+/g, " ").trim();
    expect(name).toBe("Step 1 of 4: Welcome to Control Scout");
  });
});

describe("replay and reset", () => {
  it("Show the welcome again opens it at step 1, even for someone who uses the app", async () => {
    personal.current = { ...personal.current, state: { ...EMPTY_STATE, myTeam: 4215 } };
    openOnboarding();
    endOnboarding("finished");
    mount("/");
    await settle();
    expect(dialog()).toBeNull();
    act(() => { openOnboarding(); });
    await settle();
    expect(step()).toBe(1);
  });

  it("Clear all local data forgets it: a new visitor again", () => {
    openOnboarding();
    endOnboarding("skipped");
    resetOnboarding();
    expect(readOnboarding()).toBeNull();
    expect(localStorage.getItem(ONBOARDING_KEY)).toBeNull();
  });

  it("a stored record it can't read counts as never started", () => {
    localStorage.setItem(ONBOARDING_KEY, "{not json");
    expect(readOnboarding()).toBeNull();
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 9, status: "open" }));
    expect(readOnboarding()).toBeNull();
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 1, status: "open", step: 99 }));
    expect(readOnboarding()?.step).toBe(3);
  });
});
