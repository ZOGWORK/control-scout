// @vitest-environment jsdom
// The FTC One Search explainer: its route, every example a /search link, and no AI wording.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pageModule, pageTitle } from "../shared/routes";
import { SEARCH_FAMILIES, SEARCH_SHOWCASE, SEARCH_STEPS } from "../components/howitworks/searchDocs";

afterEach(cleanup);
beforeAll(() => {
  class FakeIO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

describe("FTC One Search page route", () => {
  it("routes and titles it, with no hub page above it", () => {
    expect(pageModule("/how-it-works/search")).toBe("SearchDocsPage");
    expect(pageModule("/How-It-Works/Search/")).toBe("SearchDocsPage");
    expect(pageModule("/how-it-works")).toBeNull(); // a redirect to /methodology
    expect(pageModule("/methodology")).toBe("MethodologyPage");
    expect(pageTitle("/how-it-works/search")).toBe("How FTC One Search works");
    expect(pageTitle("/methodology")).toBe("How it works");
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

  it("shows every plain-words example in its group, each a link that runs that exact search", async () => {
    const { default: Docs } = await import("./SearchDocsPage");
    const { container } = render(<MemoryRouter initialEntries={["/how-it-works/search"]}><Docs /></MemoryRouter>);
    const section = container.querySelector("section#ask")!;
    expect(section).not.toBeNull();
    const groups = [...section.querySelectorAll("h3")].map((h) => h.textContent);
    expect(groups).toEqual(SEARCH_SHOWCASE.map((g) => g.title));
    const links = [...section.querySelectorAll("li a")];
    const items = SEARCH_SHOWCASE.flatMap((g) => g.items);
    expect(links).toHaveLength(items.length);
    items.forEach((it, i) => {
      expect(links[i].getAttribute("href"), it.q).toBe(`/search?q=${encodeURIComponent(it.q)}`);
      expect(links[i].textContent, it.q).toContain(it.q);
      expect(links[i].className, it.q).toContain("min-h-11");
    });
    expect(section.querySelector('a[href="/search"]')).not.toBeNull();
  });
});
