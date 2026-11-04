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
  it("reads a season only from a real season label", () => {
    expect(statedSeason("Record in 2025–26")).toBe(2025);
    expect(statedSeason(null, "All seasons", "2024-25")).toBe(2024);
    expect(statedSeason("2025–27")).toBeNull();
  });
});
