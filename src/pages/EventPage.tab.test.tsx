// @vitest-environment jsdom
// ?tab= on the event page (PUB-F04): a real tab opens, an unknown one (or Odds on a history season) opens the
// default tab with its panel and leaves the address without the bad value, replacing the entry (no extra history).
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import type { EventDetail } from "../shared/api";
import { PersonalProvider } from "../lib/personal";

const detail = (season: number): EventDetail => ({
  event: {
    season, code: "AUBRQ2", name: "Brisbane Qualifier 2", type: "Qualifier", typeLabel: "Qualifier", divisionCode: null, region: null,
    city: "Brisbane", state: "QLD", country: "Australia", venue: null, start: "2025-11-01", end: "2025-11-01", remote: false,
    teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "finished", website: null, livestream: null, timezone: null, source: "first",
  },
  field: [], matches: [], alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null,
});

let current: EventDetail = detail(2025);
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => ({ data: path?.startsWith("/api/events/") ? current : undefined, error: undefined, loading: false, reload: () => {} }),
}));
vi.mock("../lib/meta", async (orig) => ({
  ...(await orig<typeof import("../lib/meta")>()),
  useTitle: () => {}, useMeta: () => null, usePredictable: (s: number) => s >= 2023,
}));
// The tables fetch on their own; this test is about which tab is open.
vi.mock("../components/records/RecordsTable", () => ({ RecordsTable: () => <div>records table</div> }));

let search = "";
let navType = "";
function Probe() { search = useLocation().search; navType = useNavigationType(); return null; }

const { default: EventPage } = await import("./EventPage");
const mount = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <PersonalProvider><Routes><Route path="/events/:season/:code" element={<><EventPage /><Probe /></>} /></Routes></PersonalProvider>
  </MemoryRouter>,
);
const selected = () => screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent);

// Signed out: the account check answers no user.
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: null }), { headers: { "Content-Type": "application/json" } }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); current = detail(2025); });

/** Each heading that's more than one level below the one before it (axe's heading-order). */
const headingSkips = () => {
  const out: string[] = [];
  let prev = 0;
  for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const level = Number(h.tagName[1]);
    if (prev && level > prev + 1) out.push(`h${prev} → ${h.tagName.toLowerCase()} "${h.textContent}"`);
    prev = level;
  }
  return out;
};

describe("event page heading order (V4-A11Y-001)", () => {
  const alliance = (number: number, captain: number, pick1: number) => ({ number, name: null, captain, pick1, pick2: null, backup: null });
  it("Playoffs: the bracket's heading sits under the tab's h2, not straight under the page's h1", () => {
    current = { ...detail(2025), alliances: [alliance(1, 11, 12), alliance(2, 21, 22), alliance(3, 31, 32), alliance(4, 41, 42)] };
    mount("/events/2025/AUBRQ2?tab=playoffs");
    expect(screen.getByRole("heading", { level: 3, name: "Double-elimination bracket" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Playoffs" })).toBeTruthy();
    expect(headingSkips()).toEqual([]);
  });

  it("Awards: Advancement sits under the tab's h2", () => {
    current = { ...detail(2025), awards: [{ type: "INSPIRE", placement: 1, team: 11, name: null }], advancement: { slots: 2, advancesTo: "AUCMP", rows: [{ team: 11, status: "FIRST", declined: false }] } };
    mount("/events/2025/AUBRQ2?tab=awards");
    expect(screen.getByRole("heading", { level: 3, name: /^Advancement/ })).toBeTruthy();
    expect(headingSkips()).toEqual([]);
  });
});

describe("event page ?tab=", () => {
  it("opens a real tab and keeps it in the address", () => {
    mount("/events/2025/AUBRQ2?tab=awards");
    expect(selected()).toEqual(["Awards"]);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(search).toBe("?tab=awards");
  });

  it("opens the default tab for an unknown one and drops it from the address, replacing the entry", async () => {
    mount("/events/2025/AUBRQ2?tab=garbage&team=16321");
    expect(selected()).toEqual(["Matches"]);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    await waitFor(() => expect(search).toBe("?team=16321"));
    expect(navType).toBe("REPLACE");
  });

  it("treats Odds on a history season as unknown", async () => {
    current = detail(2021);
    mount("/events/2021/AUBRQ2?tab=odds");
    expect(selected()).toEqual(["Matches"]);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    await waitFor(() => expect(search).toBe(""));
  });
});
