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
