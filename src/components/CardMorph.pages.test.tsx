// @vitest-environment jsdom
// The card morph on the real pages: the search page's cards carry the key on the card and the tap on their title's
// link (which covers the card), so a tap grows the whole card; a team card's number is its title, landing on the team
// page's big number. Outside a MorphScope the same cards stay plain links.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SearchHit } from "../shared/api";
import { EventCard, TeamCard } from "./search/page/ResultCards";
import { MorphScope, eventMorphKey, teamLink, teamMorphKey } from "./CardMorph";
import { resetMorphForTests } from "../lib/cardMorph";

// The element each tap hands the morph (the card that grows), seen through the real launchMorph.
const launched = vi.hoisted(() => ({ cards: [] as HTMLElement[] }));
vi.mock("../lib/cardMorph", async (orig) => {
  const real = await orig<typeof import("../lib/cardMorph")>();
  return { ...real, launchMorph: (card: HTMLElement, key: string, go: () => void) => { launched.cards.push(card); return real.launchMorph(card, key, go); } };
});
// What a tap warms (the page's own request).
const loads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return { ...real, load: (path: string) => { loads.paths.push(path); return Promise.resolve(null); } };
});

const eventHit = { kind: "event", ref: "2025:USCAFFFAQ", title: "California Qualifier", subtitle: "USCAFFFAQ · 2025-11-01 · Fremont, CA", season: 2025 } as unknown as SearchHit;
const teamHit = { kind: "team", ref: "4215", title: "4215 | Trobotix", subtitle: "Mountain View, CA" } as unknown as SearchHit;

beforeEach(() => {
  launched.cards.length = 0;
  loads.paths.length = 0;
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
    expect(launched.cards).toEqual([card]); // the whole card grows, not its title link
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
    expect(launched.cards).toEqual([card]);
    expect(document.querySelector("[data-card-morph]")).not.toBeNull();
    expect(loads.paths).toEqual(["/api/teams/4215"]);
  });

  it("a team link for another season warms that season's profile (the request the page makes)", () => {
    const h = { ...teamHit, linkSeason: 2024 } as unknown as SearchHit;
    render(<MemoryRouter><MorphScope name="search-team"><TeamCard h={h} onOpen={() => {}} /></MorphScope></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "4215 | Trobotix" }));
    expect(loads.paths).toEqual(["/api/teams/4215?season=2024"]);
  });

  it("a team at an event opens the event's page: no team page to land on, so the card stays a plain link", () => {
    const h = { ...teamHit, atEvent: "2025:USNJCMP" } as unknown as SearchHit;
    const onOpen = vi.fn();
    const { container } = render(<MemoryRouter><MorphScope name="search-team"><TeamCard h={h} onOpen={onOpen} /></MorphScope></MemoryRouter>);
    expect(container.querySelector("[data-morph-key]")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "4215 | Trobotix" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(launched.cards).toEqual([]);
    expect(document.querySelector("[data-card-morph]")).toBeNull();
    expect(loads.paths).toEqual([]);
  });

  it("teamLink: only the plain team page, with the season it asks for", () => {
    expect(teamLink("/teams/4215")).toEqual({ team: 4215, season: null });
    expect(teamLink("/teams/4215?season=2024#matches")).toEqual({ team: 4215, season: "2024" });
    expect(teamLink("/events/2025/USNJCMP?team=4215")).toBeNull();
    expect(teamLink("/teams/4215/matches")).toBeNull();
  });

  it("the quick links inside an event card never start a run (they open a tab of the page, a plain link)", () => {
    const { container } = render(<MemoryRouter><MorphScope name="search-event"><EventCard h={eventHit} onOpen={() => {}} /></MorphScope></MemoryRouter>);
    const quick = container.querySelector<HTMLElement>("[data-quick-links] a");
    expect(quick).not.toBeNull(); // a finished event always has its Matches, Rankings, Teams and Playoffs
    fireEvent.click(quick!);
    expect(launched.cards).toEqual([]);
    expect(document.querySelector("[data-card-morph]")).toBeNull();
  });
});
