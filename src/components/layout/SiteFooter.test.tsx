// @vitest-environment jsdom
// The footer names the running release (package.json's version, which the build passes in as __APP_VERSION__;
// tests run without it), and that version opens What's new.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteFooter } from "./SiteFooter";
import { resetFlags } from "../../lib/flags";
import { DEFAULT_FLAGS } from "../../shared/flags";

const footer = (release: string | null) => render(<MemoryRouter><SiteFooter discordInvite={null} release={release} /></MemoryRouter>);

afterEach(() => { cleanup(); resetFlags(); });

describe("SiteFooter", () => {
  it("shows the release, and a click opens What's new", () => {
    const opened = vi.fn();
    window.addEventListener("cs-open-whats-new", opened);
    footer("1.3.8");
    const v = screen.getByRole("button", { name: "What's new in v1.3.8" });
    expect(v.textContent).toBe("v1.3.8");
    fireEvent.click(v);
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener("cs-open-whats-new", opened);
  });

  it("leaves the version out when the build has none", () => {
    footer(null);
    expect(screen.queryByRole("button", { name: /What's new/ })).toBeNull();
    expect(screen.getByText(/Not affiliated with/)).toBeTruthy();
  });

  it("links a page's light version (a full page load), unless the owner switched it off", () => {
    const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><SiteFooter discordInvite={null} release={null} /></MemoryRouter>);
    at("/teams/18360?season=2024");
    expect(screen.getByRole("link", { name: "Light version" }).getAttribute("href")).toBe("/lite/teams/18360?season=2024");
    cleanup();
    at("/predict");
    expect(screen.queryByRole("link", { name: "Light version" })).toBeNull();
    cleanup();
    resetFlags({ ...DEFAULT_FLAGS, venueLightMode: false }, true);
    at("/teams/18360");
    expect(screen.queryByRole("link", { name: "Light version" })).toBeNull();
  });
});
