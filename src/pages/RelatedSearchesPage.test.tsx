// @vitest-environment jsdom
// The related searches page: each group under its heading, each search a 44 px link to the live search with its
// answer's line; the starting points said so when nothing follows from the search; search itself one tap away.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { RelatedPageView, SearchFollowUp } from "../shared/api";
import { prime } from "../lib/api";
import RelatedSearchesPage from "./RelatedSearchesPage";

afterEach(cleanup);
const item = (q: string, value: string, rest: string): SearchFollowUp => ({ q, family: "team", preview: `${value} · ${rest}`, value, rest, tone: { count: true } });
const view: RelatedPageView = { q: "4215 opr", found: true, groups: [
  { title: "About this team", items: [item("4215 record", "26-6-0", "81% win rate"), item("4215 win rate", "81%", "26 wins out of 32 matches")] },
] };
const draw = (url: string) => render(<MemoryRouter initialEntries={[url]}><RelatedSearchesPage /></MemoryRouter>).container;

describe("related searches page", () => {
  it("lists each group's searches as links with their answers' lines", () => {
    prime("/api/search/related?q=4215+opr", view);
    const c = draw("/related-searches?q=4215+opr");
    expect(c.querySelector("h1")?.textContent).toBe("Related searches: 4215 opr");
    expect([...c.querySelectorAll("[data-group] h2")].map((h) => h.textContent)).toEqual(["About this team"]);
    const links = [...c.querySelectorAll("[data-group] a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/search?q=4215%20record", "/search?q=4215%20win%20rate"]);
    expect(links.every((a) => a.className.includes("min-h-[44px]"))).toBe(true);
    expect(c.querySelector("[data-preview]")?.textContent).toBe("26-6-0 · 81% win rate");
    expect(c.querySelector("[data-starting-points]")).toBeNull();
  });

  it("says when these are the starting points, and always offers search itself", () => {
    prime("/api/search/related?q=qqzx", { ...view, q: "qqzx", found: false });
    const c = draw("/related-searches?q=qqzx");
    expect(c.querySelector("[data-starting-points]")).not.toBeNull();
    expect([...c.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/search")).toBe(true);
  });

  it("titles the page with no search as the popular searches", () => {
    prime("/api/search/related", { q: "", found: false, groups: view.groups });
    expect(draw("/related-searches").querySelector("h1")?.textContent).toBe("Popular FTC searches");
  });
});
