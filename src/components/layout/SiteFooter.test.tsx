// @vitest-environment jsdom
// The footer names the running release (package.json's version, which the build passes in as __APP_VERSION__;
// tests run without it), and that version opens What's new.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteFooter } from "./SiteFooter";

const footer = (release: string | null) => render(<MemoryRouter><SiteFooter discordInvite={null} release={release} /></MemoryRouter>);

afterEach(cleanup);

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
});
