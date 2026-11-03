// @vitest-environment jsdom
// The How it works hub: a section opens in place (no navigation) and only its link leads to the subpage; the
// FTC One Search subpage lists every example as a /search link and names itself without AI wording.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pageModule, pageTitle } from "../shared/routes";
import { SEARCH_FAMILIES, SEARCH_STEPS } from "../components/howitworks/searchDocs";

afterEach(cleanup);
beforeAll(() => {
  class FakeIO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

describe("How it works hub", () => {
  it("opens a section in place, and links to its full page", async () => {
    const { default: Hub } = await import("./HowItWorksPage");
    const { getByRole } = render(<MemoryRouter initialEntries={["/how-it-works"]}><Hub /></MemoryRouter>);
    const btn = getByRole("button", { name: /FTC One Search/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(panel.querySelector("[inert]")).not.toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(panel.querySelector("[inert]")).toBeNull();
    expect(panel.querySelector("a")!.getAttribute("href")).toBe("/how-it-works/search");
    // Exactly two sections, the prediction one linking to /methodology.
    const pred = getByRole("button", { name: /Predictions/ });
    expect(document.getElementById(pred.getAttribute("aria-controls")!)!.querySelector("a")!.getAttribute("href")).toBe("/methodology");
    expect(document.querySelectorAll("section[id] > h2 > button[aria-expanded]").length).toBe(2);
  });

  it("routes and titles the hub and its search page", () => {
    expect(pageModule("/how-it-works")).toBe("HowItWorksPage");
    expect(pageModule("/How-It-Works/")).toBe("HowItWorksPage");
    expect(pageModule("/how-it-works/search")).toBe("SearchDocsPage");
    expect(pageModule("/how-it-works/nope")).toBe("NotFound");
    expect(pageTitle("/how-it-works")).toBe("How it works");
    expect(pageTitle("/how-it-works/search")).toBe("How FTC One Search works");
  });
});

describe("FTC One Search page", () => {
  it("links every example to its search and never calls the search AI", async () => {
    const { default: Docs } = await import("./SearchDocsPage");
    const { container } = render(<MemoryRouter initialEntries={["/how-it-works/search"]}><Docs /></MemoryRouter>);
    const hrefs = new Set([...container.querySelectorAll("a")].map((a) => a.getAttribute("href")));
    for (const f of SEARCH_FAMILIES) expect(hrefs.has(`/search?q=${encodeURIComponent(f.q)}`), f.q).toBe(true);
    expect(container.querySelectorAll("#steps button[aria-expanded]").length).toBe(SEARCH_STEPS.length);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Immersive Search|Smart Search|Ask Scout|AI-powered/i);
    expect(text).toMatch(/No AI decides what you meant/);
  });
});
