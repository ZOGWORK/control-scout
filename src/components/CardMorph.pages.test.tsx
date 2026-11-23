// @vitest-environment jsdom
// The card morph on the real pages: the search page's cards carry the key on the card and the tap on their title's
// link (which covers the card), so a tap grows the whole card; a team card's number is its title, landing on the team
// page's big number. Outside a MorphScope the same cards stay plain links.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SearchHit } from "../shared/api";
import { EventCard, TeamCard } from "./search/page/ResultCards";
import { MorphScope, eventMorphKey, teamMorphKey } from "./CardMorph";
import { resetMorphForTests } from "../lib/cardMorph";

const eventHit = { kind: "event", ref: "2025:USCAFFFAQ", title: "California Qualifier", subtitle: "USCAFFFAQ · 2025-11-01 · Fremont, CA", season: 2025 } as unknown as SearchHit;
const teamHit = { kind: "team", ref: "4215", title: "4215 | Trobotix", subtitle: "Mountain View, CA" } as unknown as SearchHit;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 10, top: 100, width: 300, height: 48, right: 310, bottom: 148, x: 10, y: 100, toJSON() {} } as DOMRect);
  (Element.prototype as unknown as { animate: unknown }).animate = function () {
    const a: Record<string, unknown> = { cancel() {}, finish() {}, stop() {}, currentTime: 0 };
    a.finished = new Promise<void>((done) => setTimeout(() => { (a.onfinish as (() => void) | undefined)?.(); done(); }, 0));
    return a;
  };
  const main = document.createElement("main");
  main.id = "main";
  document.body.append(main);
});
afterEach(() => {
  resetMorphForTests();
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

describe("card morph on the search page's cards", () => {
  it("outside a MorphScope the cards carry no key", () => {
    const { container } = render(<MemoryRouter><EventCard h={eventHit} onOpen={() => {}} /><TeamCard h={teamHit} onOpen={() => {}} /></MemoryRouter>);
    expect(container.querySelector("[data-morph-key]")).toBeNull();
  });

  it("an event card is keyed on the card, its title marked, and a tap grows the whole card (the page still records the open)", () => {
    const onOpen = vi.fn();
    const { container } = render(<MemoryRouter><MorphScope name="search-event"><EventCard h={eventHit} onOpen={onOpen} /></MorphScope></MemoryRouter>);
    const card = container.querySelector<HTMLElement>("[data-result='event']")!;
    expect(card.getAttribute("data-morph-key")).toBe(eventMorphKey(2025, "USCAFFFAQ"));
    expect(card.getAttribute("data-morph-slot")).toBe("search-event");
    const link = screen.getByRole("link", { name: /California Qualifier/ });
    expect(link.hasAttribute("data-morph-title")).toBe(true);
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-card-morph]")).not.toBeNull();
  });

  it("a team card's number is its title (it lands on the team page's big number); the text reads as before", () => {
    const onOpen = vi.fn();
    const { container } = render(<MemoryRouter><MorphScope name="search-team"><TeamCard h={teamHit} onOpen={onOpen} /></MorphScope></MemoryRouter>);
    const card = container.querySelector<HTMLElement>("[data-result='team']")!;
    expect(card.getAttribute("data-morph-key")).toBe(teamMorphKey(4215));
    const link = screen.getByRole("link", { name: "4215 | Trobotix" });
    expect(link.querySelector("[data-morph-title]")?.textContent).toBe("4215");
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-card-morph]")).not.toBeNull();
  });

  it("the quick links inside an event card never start a run (they open a tab of the page, a plain link)", () => {
    const { container } = render(<MemoryRouter><MorphScope name="search-event"><EventCard h={eventHit} onOpen={() => {}} /></MorphScope></MemoryRouter>);
    const quick = container.querySelector<HTMLElement>("[data-quick-links] a");
    if (!quick) return; // an event with no quick links for its status
    fireEvent.click(quick);
    expect(document.querySelector("[data-card-morph]")).toBeNull();
  });
});
