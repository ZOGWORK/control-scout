// @vitest-environment jsdom
// The privacy question docked in the page (/search puts it under the answer): while a dock is on screen the floating
// banner and the server's copy of it give way, so nothing covers the answer; answering it in the dock stores the
// choice as the banner would, and with no dock the floating banner is back.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { bootConsent } from "../../../server/bootShell";
import { BOOT_CONSENT_ID } from "../../shared/boot";
import { readConsent } from "../../lib/consent";
import { ConsentBanner, ConsentDock } from "./ConsentBanner";

function boot() {
  const host = document.createElement("div");
  host.innerHTML = bootConsent();
  host.querySelector("script")!.remove();
  while (host.firstChild) document.body.appendChild(host.firstChild);
}

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ""; });
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

const page = (dock: boolean) => (
  <MemoryRouter>
    <main><h1>Answer</h1>{dock && <ConsentDock />}</main>
    <ConsentBanner />
  </MemoryRouter>
);

describe("privacy question docked under the answer", () => {
  it("shows once, in the page: the floating banner and the server's copy give way", () => {
    boot();
    render(page(true));
    const regions = screen.getAllByRole("region", { name: "Privacy choices" });
    expect(regions).toHaveLength(1);
    expect(regions[0].hasAttribute("data-consent-dock")).toBe(true);
    expect(document.getElementById(BOOT_CONSENT_ID)).toBeNull();
  });

  it("stores the choice made in the dock, and then shows nothing", () => {
    render(page(true));
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(readConsent()?.analytics).toBe(false);
    expect(screen.queryByRole("region", { name: "Privacy choices" })).toBeNull();
  });

  it("with the dock gone (another page), the floating banner is back", async () => {
    const { rerender } = render(page(true));
    rerender(page(false));
    await act(async () => {});
    // Without the server's copy it comes once the page is idle (afterFirstPaint).
    const regions = await screen.findAllByRole("region", { name: "Privacy choices" }, { timeout: 3000 });
    expect(regions).toHaveLength(1);
    expect(regions[0].hasAttribute("data-consent-dock")).toBe(false);
  });
});
