// @vitest-environment jsdom
// The answer card's supporting detail: read for the season the answer is about, and left out (never left loading)
// when the team page's data can't be read.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchCard } from "../../../shared/api";

const api = vi.hoisted(() => ({ paths: [] as (string | null)[], error: null as Error | null }));
vi.mock("../../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../../lib/api")>()), useApi: (p: string | null) => { api.paths.push(p); return { data: undefined, error: p ? api.error : null, loading: !api.error }; } }));
vi.mock("../../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../../lib/meta")>()), useCurrentSeason: () => 2026 }));
const { FactCard } = await import("./FactCard");
const { statedSeason } = await import("./TeamAnswer");

afterEach(() => { cleanup(); api.paths.length = 0; api.error = null; });
const card: SearchCard = { kind: "info", title: "Where they're from", team: { number: 4215, name: "Hypnotic Robotics" }, facts: [{ label: "Where they're from", values: ["Oradell, NJ, USA"] }], lines: [] };
const draw = (season?: number) => render(<MemoryRouter><FactCard card={card} season={season} /></MemoryRouter>).container;

describe("answer card detail", () => {
  it("reads the latest completed season by default, the asked season when there is one", () => {
    draw();
    expect(api.paths).toContain("/api/teams/4215?season=2025");
    api.paths.length = 0;
    const c = draw(2023);
    expect(api.paths).toContain("/api/teams/4215?season=2023");
    expect(c.querySelector("[data-answer-season]")!.textContent).toBe("2023–24");
    expect(c.querySelector('a[href="/teams/4215?season=2023"]')).toBeTruthy();
  });
  it("shows loading tiles while it loads, and leaves them out when the team page's data can't be read", () => {
    expect(draw().querySelector('[data-season-tiles="loading"]')).toBeTruthy();
    cleanup();
    api.error = new Error("500");
    const c = draw();
    expect(c.querySelector("[data-season-tiles]")).toBeNull();
    // The answer itself still stands.
    expect(c.textContent).toContain("Oradell, NJ, USA");
  });
  it("a card's own season wins (its numbers' season), and its support facts show beside the team page tiles", () => {
    const c = render(<MemoryRouter><FactCard season={2025} card={{ ...card, season: 2024, support: [
      { label: "Region", values: ["New Jersey"] }, { label: "Record, 2024–25", values: ["30-5-0"] },
      { label: "OPR, 2024–25", values: ["90.1"] }, { label: "Reliability, 2024–25", values: ["84 out of 100"] },
    ] } as SearchCard} /></MemoryRouter>).container;
    expect(api.paths).toContain("/api/teams/4215?season=2024");
    expect(c.querySelector('a[href="/teams/4215?season=2024"]')).toBeTruthy();
    // Record and OPR are on the team page tiles already; the rest of the team's card is drawn once.
    expect([...c.querySelectorAll("[data-support] [data-fact]")].map((f) => f.getAttribute("data-fact"))).toEqual(["Region", "Reliability, 2024–25"]);
  });
  it("where a team is from is drawn as a place: the place big, its city, state and country apart", () => {
    const loc = draw().querySelector("[data-location]")!;
    expect(loc.textContent).toContain("Oradell, NJ, USA");
    expect([...loc.querySelectorAll("[data-location-parts] > span")].map((x) => x.textContent)).toEqual(["CityOradell", "StateNJ", "CountryUSA"]);
    // A part missing (no city): the parts aren't guessed at, so they go unnamed.
    cleanup();
    const two = render(<MemoryRouter><FactCard card={{ ...card, facts: [{ label: "Where they're from", values: ["NJ, USA"] }] }} /></MemoryRouter>).container;
    expect([...two.querySelectorAll("[data-location-parts] > span")].map((x) => x.textContent)).toEqual(["NJ", "USA"]);
  });
  it("reads a season only from a real season label", () => {
    expect(statedSeason("Record in 2025–26")).toBe(2025);
    expect(statedSeason(null, "All seasons", "2024-25")).toBe(2024);
    expect(statedSeason("2025–27")).toBeNull();
  });
});
