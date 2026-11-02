// @vitest-environment jsdom
// /donate: says plainly that the site stays free, that a donation is not tax-deductible and unlocks
// nothing, and sends people to GitHub Sponsors (SPONSOR_URL) in a new tab. No form, no card fields.
// The footer links here (the server's /support redirect: server/donate.test.ts).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SPONSOR_URL } from "../shared/sponsor";
import { FOOTER_LINKS } from "../components/layout/SiteFooter";

vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));
const { default: DonatePage } = await import("./DonatePage");
const mount = () => render(<MemoryRouter initialEntries={["/donate"]}><DonatePage /></MemoryRouter>);
afterEach(cleanup);

describe("Donate page", () => {
  it("the Sponsor button opens GitHub Sponsors in a new tab", () => {
    mount();
    const a = screen.getByRole("link", { name: /Sponsor on GitHub/ });
    expect(a.getAttribute("href")).toBe(SPONSOR_URL);
    expect(SPONSOR_URL).toMatch(/^https:\/\/github\.com\/sponsors\/[A-Za-z0-9-]+$/);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("says it stays free, isn't tax-deductible, unlocks nothing, and never sees card details", () => {
    const { container } = mount();
    const text = container.textContent ?? "";
    expect(text).toMatch(/free and stays free/);
    expect(text).toMatch(/Not tax-deductible/);
    expect(text).toMatch(/not a nonprofit or a charity/);
    expect(text).toMatch(/unlocks no features/);
    expect(text).toMatch(/never sees, stores or touches your card details/);
    // No amounts or tiers in Scout's own copy, and nothing to fill in.
    expect(text).not.toMatch(/[$€£]\s?\d/);
    expect(container.querySelector("form, input, select, textarea")).toBeNull();
  });

  it("the site footer links to it", () => {
    expect(FOOTER_LINKS).toContainEqual({ to: "/donate", label: "Donate" });
  });

});
