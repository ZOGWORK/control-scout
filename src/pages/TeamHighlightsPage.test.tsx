// @vitest-environment jsdom
// /teams/:number/highlights: the same card Search draws for "<number> highlights", under a header naming the page,
// with the way back to the team's page; the route and the top bar's page name are its own.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { pageModule, pageTitle } from "../shared/routes";
import type { StatAnswer } from "../shared/searchStat";
import TeamHighlightsPage from "./TeamHighlightsPage";

const stat: StatAnswer = {
  family: "superlative", intent: "team-highlights", title: "Highlights, 2025–26", team: { number: 4215, name: "Hypnotic Robotics" }, scope: ["2025–26"],
  headline: { value: "237 points", label: "Best score without penalties: M2 at New Jersey Championship", sub: "262 with penalties · Won 262–135", href: "/events/2025/USNJCMP?match=playoff:2:1" },
  blocks: [{ kind: "matches", title: "1 standout match", rows: [{
    label: "M2", href: "/events/2025/USNJCMP?match=playoff:2:1", event: { label: "New Jersey Championship", href: "/events/2025/USNJCMP?team=4215" }, season: "2025–26",
    date: "2026-03-15", alliance: "red", own: 262, opp: 135, ownNp: 237, result: "W", note: "Best score",
  }] }],
  definition: "The team's standout matches of 2025–26.", source: "From 32 matches in 2025–26",
};
const asked: (string | null)[] = [];
let answer: { team: { number: number; name: string | null }; stat: StatAnswer } | undefined = { team: { number: 4215, name: "Hypnotic Robotics" }, stat };
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => { asked.push(path); return { data: path ? answer : undefined, error: undefined, loading: false, reload: () => {} }; },
}));
const titles: string[] = [];
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: (t: string) => { titles.push(t); } }));

const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/teams/:number/highlights" element={<TeamHighlightsPage />} /></Routes></MemoryRouter>);
afterEach(() => { cleanup(); asked.length = 0; titles.length = 0; });

describe("team highlights page", () => {
  it("draws Search's highlights card under its own heading, and links back to the team page", () => {
    open("/teams/4215/highlights");
    expect(asked).toContain("/api/teams/4215/highlights");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("4215 Hypnotic Robotics highlights");
    expect(screen.getByText("237 points")).toBeTruthy();
    expect(screen.getAllByText("Best score").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/teams/4215")).toBe(true);
    expect(titles.at(-1)).toBe("4215 Hypnotic Robotics highlights, 2025–26");
  });

  it("asks for nothing at an address that names no team", () => {
    answer = undefined;
    open("/teams/abc/highlights");
    expect(asked.every((p) => p == null)).toBe(true);
    expect(screen.getByText("No such team")).toBeTruthy();
    answer = { team: { number: 4215, name: "Hypnotic Robotics" }, stat };
  });

  it("is its own route and top-bar name; any other suffix is still not found", () => {
    expect(pageModule("/teams/4215/highlights")).toBe("TeamHighlightsPage");
    expect(pageModule("/Teams/4215/Highlights/")).toBe("TeamHighlightsPage");
    expect(pageTitle("/teams/4215/highlights")).toBe("Team highlights");
    expect(pageModule("/teams/4215/extra")).toBe("NotFound");
    expect(pageTitle("/teams/4215/extra")).toBe("Not found");
  });
});
