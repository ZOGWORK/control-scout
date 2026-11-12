// @vitest-environment jsdom
// /events/:season/:code/highlights: the same card Search draws for "<event> highlights", under a header naming the
// page, with the way back to the event's page; the route and the top bar's page name are its own.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { pageModule, pageTitle } from "../shared/routes";
import type { StatAnswer } from "../shared/searchStat";
import EventHighlightsPage from "./EventHighlightsPage";

const stat: StatAnswer = {
  family: "superlative", intent: "scope-highlights", title: "Highlights at North Meet 3, 2025–26", scope: ["2025–26", "Nov 8, 2025", "Edison, NJ", "Official events"],
  headline: { value: "110 points", label: "Best score without penalties: Q1 at North Meet 3", sub: "120 with penalties · Red won 120–80", href: "/events/2025/USNJNOM3?match=qual:0:1" },
  blocks: [{ kind: "matches", title: "1 standout match", rows: [{
    label: "Q1", href: "/events/2025/USNJNOM3?match=qual:0:1", event: { label: "North Meet 3", href: "/events/2025/USNJNOM3" }, season: "2025–26",
    date: "2025-11-08", alliance: "red", own: 120, opp: 80, ownNp: 110, result: "W", note: "Best score",
  }] }],
  definition: "The standout matches at North Meet 3 in 2025–26.", source: "From 2 played matches at North Meet 3 in 2025–26",
};
const asked: (string | null)[] = [];
const answer = { event: { season: 2025, code: "USNJNOM3", name: "North Meet 3" }, stat };
let failure: { status: number; offline: boolean } | undefined;
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => { asked.push(path); return { data: path && !failure ? answer : undefined, error: failure, loading: false, reload: () => {} }; },
}));
const titles: string[] = [];
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: (t: string) => { titles.push(t); } }));

const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/events/:season/:code/highlights" element={<EventHighlightsPage />} /></Routes></MemoryRouter>);
afterEach(() => { cleanup(); asked.length = 0; titles.length = 0; });

describe("event highlights page", () => {
  it("draws Search's highlights card under its own heading, and links back to the event page", () => {
    open("/events/2025/USNJNOM3/highlights");
    expect(asked).toContain("/api/events/2025/USNJNOM3/highlights");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("North Meet 3 highlights");
    expect(screen.getByText("110 points")).toBeTruthy();
    expect(screen.getAllByText("Best score").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/events/2025/USNJNOM3")).toBe(true);
    expect(titles.at(-1)).toBe("North Meet 3 highlights, 2025–26");
  });

  it("a padded season or lowercase code asks with the address's own spelling (as the first HTML primes it)", () => {
    open("/events/02025/usnjnom3/highlights");
    expect(asked).toContain("/api/events/02025/usnjnom3/highlights");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("North Meet 3 highlights");
  });

  it("asks for nothing at an address that names no event", () => {
    open("/events/abc/USNJNOM3/highlights");
    expect(asked.every((p) => p == null)).toBe(true);
    expect(screen.getByText("No such event")).toBeTruthy();
  });

  it("an event with no highlights page: says so plainly, with the way to its event page", () => {
    failure = { status: 404, offline: false };
    open("/events/2025/usnjsat/highlights");
    expect(screen.getByText("No highlights yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Event page" }).getAttribute("href")).toBe("/events/2025/USNJSAT");
    failure = undefined;
  });

  it("is its own route and top-bar name; any other suffix is still not found", () => {
    expect(pageModule("/events/2025/USNJNOM3/highlights")).toBe("EventHighlightsPage");
    expect(pageModule("/Events/2025/usnjnom3/Highlights/")).toBe("EventHighlightsPage");
    expect(pageTitle("/events/2025/USNJNOM3/highlights")).toBe("Event highlights");
    expect(pageModule("/events/2025/USNJNOM3/extra")).toBe("NotFound");
  });
});
