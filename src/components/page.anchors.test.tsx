// @vitest-environment jsdom
// Search's deep links land on a section by its anchor (src/shared/search.ts TOPIC_SECTION): a link to a closed
// section opens it, and a section's other anchors (#ranking and #history on the season road map) do the same.
// /search's "noindex, follow" stays on /search only (src/lib/meta.tsx SearchRobotsSync).
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Section } from "./page";
import { SearchRobotsSync } from "../lib/meta";

afterEach(() => { cleanup(); document.head.querySelectorAll("meta[data-search]").forEach((m) => m.remove()); });

const folded = (entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Section collapsible id="events" also={["ranking", "history"]} title="Season road map"><p>Inside</p></Section>
    <Section collapsible id="schedule-difficulty" title="Schedule difficulty"><p>Hard</p></Section>
  </MemoryRouter>,
);
const isOpen = (name: string) => screen.getByRole("button", { name: new RegExp(name) }).getAttribute("aria-expanded") === "true";

describe("anchors open their section", () => {
  it("a closed section's own anchor opens it, and only it", () => {
    folded("/teams/4215#schedule-difficulty");
    expect(isOpen("Schedule difficulty")).toBe(true);
    expect(screen.getByText("Hard")).toBeTruthy();
    expect(isOpen("Season road map")).toBe(false);
  });
  it("its other anchors open it too, each a real element to scroll to", () => {
    for (const a of ["ranking", "history", "events"]) {
      const { container } = folded(`/teams/4215#${a}`);
      expect(isOpen("Season road map"), a).toBe(true);
      expect(container.querySelector(`#${a}`), a).toBeTruthy();
      cleanup();
    }
  });
  it("no anchor: closed", () => {
    folded("/teams/4215");
    expect(isOpen("Season road map")).toBe(false);
    expect(isOpen("Schedule difficulty")).toBe(false);
  });
});

describe("/search's noindex, follow", () => {
  it("is there on /search, and goes when the app moves to a result", () => {
    let go: (p: string) => void = () => {};
    function Nav() { go = useNavigate(); return null; }
    render(<MemoryRouter initialEntries={["/search?q=4215"]}><SearchRobotsSync /><Nav /></MemoryRouter>);
    expect(document.head.querySelector('meta[name="robots"][data-search]')?.getAttribute("content")).toBe("noindex, follow");
    act(() => go("/teams/4215"));
    expect(document.head.querySelector('meta[name="robots"][data-search]')).toBeNull();
    act(() => go("/search?q=bad"));
    expect(document.head.querySelectorAll('meta[name="robots"][data-search]')).toHaveLength(1);
  });
});
