// @vitest-environment jsdom
// A team or event page's first paint is the page itself (server/firstPaint.ts): the server draws it with the real
// component from the answers the HTML also carries, and the app's first render, started from those answers
// (src/lib/pageData.ts), draws the same page. So a cold load never shows partial text, a loading block, or sections
// popping in.
import { useLayoutEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import teamFixture from "./team.fixture.json";
import eventFixture from "./event.fixture.json";
import { renderAppPage } from "./page";
import { PAGE_DATA_ID } from "../shared/boot";

const TEAM = teamFixture as Record<string, unknown>;
const EVENT = eventFixture as Record<string, unknown>;
const words = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const asDom = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d; };

// Charts measure the DOM, which neither render has: both leave the chart's box empty.
vi.mock("recharts", async (orig) => ({ ...(await orig<typeof import("recharts")>()), ResponsiveContainer: () => null }));

beforeAll(() => {
  // No request may leave: everything the first render needs came with the page.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in this test"))));
});
afterEach(() => { cleanup(); document.getElementById(PAGE_DATA_ID)?.remove(); document.getElementById("app")?.remove(); });

/** The app's first commit for `url`, started from `data` in the page's data block, as text. */
async function appFirstRender(url: string, data: Record<string, unknown>) {
  const block = document.createElement("script");
  block.type = "application/json";
  block.id = PAGE_DATA_ID;
  block.textContent = JSON.stringify(data);
  document.body.append(block);
  const { readPageData } = await import("../lib/pageData");
  expect(readPageData(document).sort()).toEqual(Object.keys(data).sort());
  const { default: TeamPage } = await import("../pages/TeamPage");
  const { default: EventPage } = await import("../pages/EventPage");
  const { StaticPersonalProvider } = await import("../lib/personal");
  const { MetaProvider } = await import("../lib/meta");
  const { TooltipProvider } = await import("../components/ui/overlay");
  const { MotionReady } = await import("../lib/motionSupport");
  // What the first commit shows, before any effect (a page waiting a frame for its lower half would show here).
  let first = "";
  function Snapshot() { useLayoutEffect(() => { if (!first) first = words(document.getElementById("app")!); }); return null; }
  const host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  await act(async () => {
    render(
      <MotionReady.Provider value={false}><StaticPersonalProvider><MetaProvider><TooltipProvider>
        <MemoryRouter initialEntries={[url]}><Routes>
          <Route path="/teams/:number" element={<><TeamPage /><Snapshot /></>} />
          <Route path="/events/:season/:code" element={<><EventPage /><Snapshot /></>} />
        </Routes></MemoryRouter>
      </TooltipProvider></MetaProvider></StaticPersonalProvider></MotionReady.Provider>,
      { container: host },
    );
  });
  return { first, host };
}

describe("team page first paint (server)", () => {
  const html = renderAppPage("/teams/4215", TEAM);
  const page = asDom(html);

  it("is the whole page: header, record, rank, OPR, events and matches, as text", () => {
    expect(words(page.querySelector("h1")!)).toBe("4215 Hypnotic Robotics");
    const text = words(page);
    for (const t of ["At a glance", "Top 8%", "26-6-0", "Offensive power rating", "101.6", "Season Road Map", "Matches"]) expect(text, t).toContain(t);
    // The events, as links to their pages.
    const events = page.querySelector("#events")!;
    for (const e of (TEAM["/api/teams/4215"] as { events: { name: string; code: string }[] }).events) {
      expect(words(events), e.name).toContain(e.name);
      expect(events.querySelector(`a[href*="/${e.code}"]`), e.code).not.toBeNull();
    }
    // The matches are drawn, not a placeholder.
    const matches = page.querySelector("#matches")!;
    expect(matches.querySelector(".skeleton")).toBeNull();
    expect(matches.querySelectorAll("[data-match]").length).toBeGreaterThan(0);
  });

  it("has no loading state and nothing hidden for an entrance animation", () => {
    expect(page.querySelector('[role="status"][aria-label="Loading"]')).toBeNull();
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
    expect(html).not.toMatch(/translateY\((?!0)/);
  });

  it("leaves the cache as it found it (each render primes only for itself)", async () => {
    const { peek } = await import("../lib/api");
    for (const p of Object.keys(TEAM)) expect(peek(p), p).toBeUndefined();
  });
});

describe("event page first paint (server)", () => {
  const html = renderAppPage("/events/2025/USNJNOM3", EVENT);
  const page = asDom(html);

  it("is the whole page: the event's name, its teams and matches, with no placeholder", () => {
    expect(words(page.querySelector("h1")!)).toContain("P1-4 PM Northern League Meet");
    expect(page.querySelector(".skeleton")).toBeNull();
    expect(page.querySelector('[role="status"][aria-label="Loading"]')).toBeNull();
    const d = EVENT["/api/events/2025/USNJNOM3"] as { field: { team: number }[] };
    expect(page.querySelector(`a[href^="/teams/${d.field[0].team}"]`)).not.toBeNull();
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });
});

describe("first render (app), from the page's data", () => {
  it("team: draws the same page as the server's first paint at once: same words, no loading state, no request", async () => {
    const server = words(asDom(renderAppPage("/teams/4215", TEAM)));
    const { fromFirstPaint } = await import("../lib/pageData");
    const { first, host } = await appFirstRender("/teams/4215", TEAM);
    expect(fromFirstPaint("/api/teams/4215")).toBe(true);
    expect(first).toBe(server);
    expect(host.querySelector('[role="status"][aria-label="Loading"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("event: draws the same page as the server's first paint at once: same words, no loading state, no request", async () => {
    const server = words(asDom(renderAppPage("/events/2025/USNJNOM3", EVENT)));
    const { first, host } = await appFirstRender("/events/2025/USNJNOM3", EVENT);
    expect(first).toBe(server);
    expect(host.querySelector(".skeleton")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
