// @vitest-environment jsdom
// The privacy banner in the first HTML (server/bootShell.ts bootConsent): shown with the first paint when no
// choice is stored, removed before the first paint when one is (or the browser sends GPC / DNT), working
// before the app loads, and taken over in place by the app's ConsentBanner.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { bootConsent } from "../../../server/bootShell";
import { BOOT_CONSENT_ID } from "../../shared/boot";
import { CONSENT_KEY, readConsent } from "../../lib/consent";
import { ConsentBanner } from "./ConsentBanner";

const setSignal = (gpc: boolean | undefined, dnt: string | null) => {
  Object.defineProperty(navigator, "globalPrivacyControl", { value: gpc, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: dnt, configurable: true });
};

/** Put the first HTML's banner in the page and run its inline script, as the parser would right after it. */
function boot() {
  const host = document.createElement("div");
  host.innerHTML = bootConsent();
  const script = host.querySelector("script")!;
  script.remove();
  while (host.firstChild) document.body.appendChild(host.firstChild);
  (0, eval)(script.textContent!);
  return document.getElementById(BOOT_CONSENT_ID);
}

beforeEach(() => { localStorage.clear(); setSignal(undefined, null); document.body.innerHTML = ""; });
afterEach(() => { cleanup(); setSignal(undefined, null); document.body.innerHTML = ""; });

describe("privacy banner in the first HTML", () => {
  it("runs its check straight after the banner, before anything else can paint", () => {
    expect(bootConsent()).toMatch(new RegExp(`^<section id="${BOOT_CONSENT_ID}"[\\s\\S]*</section><script>[\\s\\S]*</script>$`));
  });

  it("shows on a first visit, labelled like the app's banner, with both choices and the policy link", () => {
    const b = boot()!;
    expect(b).not.toBeNull();
    expect(b.getAttribute("role")).toBe("region");
    expect(b.getAttribute("aria-label")).toBe("Privacy choices");
    expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent).toContain("anonymous page views");
    expect([...b.querySelectorAll("button")].map((x) => x.textContent)).toEqual(["No thanks", "Allow"]);
    expect(b.querySelector("a")?.getAttribute("href")).toBe("/privacy");
    expect(b.hasAttribute("data-nosnippet")).toBe(true);
  });

  it("is gone before the first paint when a choice is stored (no flash for returning visitors)", () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: false, at: "2026-10-17T00:00:00Z", v: 1 }));
    expect(boot()).toBeNull();
  });

  it("is gone when the browser sends Global Privacy Control or Do Not Track", () => {
    setSignal(true, null);
    expect(boot()).toBeNull();
    setSignal(undefined, "1");
    expect(boot()).toBeNull();
  });

  it("still asks over a malformed or unknown-version record, as the app does", () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: true, v: 2 }));
    expect(boot()).not.toBeNull();
  });

  it("works before the app loads: Allow stores yes the app's way and tells the app", () => {
    const b = boot()!;
    let told = 0;
    window.addEventListener("cs-consent-change", () => told++, { once: true });
    fireEvent.click(b.querySelectorAll("button")[1]);
    expect(readConsent()?.analytics).toBe(true);
    expect(document.getElementById(BOOT_CONSENT_ID)).toBeNull();
    expect(told).toBe(1);
  });

  it("Esc means No thanks", () => {
    const b = boot()!;
    fireEvent.keyDown(b.querySelector("button")!, { key: "Escape" });
    expect(readConsent()?.analytics).toBe(false);
    expect(document.getElementById(BOOT_CONSENT_ID)).toBeNull();
  });

  it("the app's banner takes over in place: at once (no idle wait), one banner, keyboard focus kept", () => {
    const b = boot()!;
    b.querySelectorAll("button")[1].focus();
    render(<MemoryRouter><ConsentBanner /></MemoryRouter>);
    // Synchronously after the first render: no wait for load or idle time.
    expect(document.getElementById(BOOT_CONSENT_ID)).toBeNull();
    expect(screen.getAllByRole("region", { name: "Privacy choices" })).toHaveLength(1);
    expect(document.activeElement?.textContent).toBe("Allow");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "No thanks" })); });
    expect(readConsent()?.analytics).toBe(false);
  });

  it("answered in the static banner before the app loaded: the app's banner never shows", async () => {
    const b = boot()!;
    fireEvent.click(b.querySelectorAll("button")[0]);
    render(<MemoryRouter><ConsentBanner /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByRole("region", { name: "Privacy choices" })).toBeNull();
  });
});
