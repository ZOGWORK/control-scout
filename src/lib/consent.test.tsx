// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CONSENT_KEY, hasAnalyticsConsent, needsConsentChoice, readConsent, resetConsent, setAnalyticsConsent, useConsent } from "./consent";
import { ConsentBanner } from "../components/layout/ConsentBanner";

const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
const setSignal = (gpc: boolean | undefined, dnt: string | null) => {
  Object.defineProperty(navigator, "globalPrivacyControl", { value: gpc, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: dnt, configurable: true });
};

beforeEach(() => { localStorage.clear(); setSignal(undefined, null); });
afterEach(() => { cleanup(); setSignal(undefined, null); });

describe("consent store", () => {
  it("asks on a first visit and grants nothing until asked", () => {
    expect(readConsent()).toBeNull();
    expect(needsConsentChoice()).toBe(true);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("stores a versioned choice: yes grants, no denies, and either stops the asking", () => {
    setAnalyticsConsent(true);
    const stored = JSON.parse(localStorage.getItem(CONSENT_KEY)!);
    expect(stored).toMatchObject({ analytics: true, v: 1 });
    expect(typeof stored.at).toBe("string");
    expect(hasAnalyticsConsent()).toBe(true);
    expect(needsConsentChoice()).toBe(false);
    setAnalyticsConsent(false);
    expect(hasAnalyticsConsent()).toBe(false);
    expect(needsConsentChoice()).toBe(false);
  });

  it("treats Global Privacy Control as no, even over a stored yes, and doesn't ask", () => {
    setAnalyticsConsent(true);
    setSignal(true, null);
    expect(nav.globalPrivacyControl).toBe(true);
    expect(hasAnalyticsConsent()).toBe(false);
    localStorage.clear();
    expect(needsConsentChoice()).toBe(false);
  });

  it("treats Do Not Track = 1 as no", () => {
    setSignal(undefined, "1");
    setAnalyticsConsent(true);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("a newer choice that couldn't be saved still wins: turning a stored yes off works with storage full", () => {
    setAnalyticsConsent(true);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    try {
      setAnalyticsConsent(false);
      expect(hasAnalyticsConsent()).toBe(false);
      expect(needsConsentChoice()).toBe(false);
    } finally { spy.mockRestore(); }
    setAnalyticsConsent(true); // a later successful save takes over again
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it("a choice saved in another tab replaces this tab's unsaved one", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    try { setAnalyticsConsent(true); } finally { spy.mockRestore(); }
    expect(hasAnalyticsConsent()).toBe(true);
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: false, at: "2026-10-15T00:00:00Z", v: 1 }));
    window.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY }));
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("resetConsent forgets the choice and tells mounted hooks", () => {
    setAnalyticsConsent(true);
    function Probe() { const c = useConsent(); return <p>{c.decided ? (c.analytics ? "yes" : "no") : "ask"}</p>; }
    render(<Probe />);
    expect(screen.getByText("yes")).toBeTruthy();
    act(() => resetConsent());
    expect(screen.getByText("ask")).toBeTruthy();
    expect(needsConsentChoice()).toBe(true);
  });

  it("ignores a malformed or unknown-version record", () => {
    localStorage.setItem(CONSENT_KEY, "{not json");
    expect(readConsent()).toBeNull();
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: true, v: 2 }));
    expect(hasAnalyticsConsent()).toBe(false);
    expect(needsConsentChoice()).toBe(true);
  });
});

describe("ConsentBanner", () => {
  const mount = () => render(<MemoryRouter><ConsentBanner /></MemoryRouter>);

  it("appears after load, offers equal Allow / No thanks, links the policy, and hides once answered", async () => {
    mount();
    const region = await screen.findByRole("region", { name: "Privacy choices" }, { timeout: 3000 });
    const allow = screen.getByRole("button", { name: "Allow" });
    const no = screen.getByRole("button", { name: "No thanks" });
    expect(allow.className).toBe(no.className);
    expect(screen.getByRole("link", { name: "Privacy policy" }).getAttribute("href")).toBe("/privacy");
    act(() => { fireEvent.click(allow); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Privacy choices" })).toBeNull());
    expect(region).toBeTruthy();
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it("Esc means No thanks", async () => {
    mount();
    const region = await screen.findByRole("region", { name: "Privacy choices" }, { timeout: 3000 });
    act(() => { fireEvent.keyDown(region, { key: "Escape" }); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Privacy choices" })).toBeNull());
    expect(readConsent()?.analytics).toBe(false);
  });

  it("never shows after a choice, or when the browser sends a privacy signal", async () => {
    setAnalyticsConsent(false);
    const a = mount();
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByRole("region", { name: "Privacy choices" })).toBeNull();
    a.unmount();
    localStorage.clear();
    setSignal(true, null);
    mount();
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByRole("region", { name: "Privacy choices" })).toBeNull();
  });
});
