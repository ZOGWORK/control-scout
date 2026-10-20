// @vitest-environment jsdom
// Task-first event panels: opened on a panel (?tab=), the event page shows a slim bar (name, status, dates)
// with the summary behind an "Event details" disclosure; a plain event address keeps the full header.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import type { EventDetail } from "../shared/api";
import { PersonalProvider } from "../lib/personal";
import { EVENT_TABS } from "../lib/eventTab";

const detail = (): EventDetail => ({
  event: {
    season: 2025, code: "AUBRQ2", name: "Brisbane Qualifier 2", type: "Qualifier", typeLabel: "Qualifier", divisionCode: null, region: null,
    city: "Brisbane", state: "QLD", country: "Australia", venue: null, start: "2025-11-01", end: "2025-11-01", remote: false,
    teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "finished", website: null, livestream: null, timezone: null, source: "first",
  },
  field: [], matches: [], alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null,
});

let current: EventDetail = detail();
let liveMode = false;
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => ({ data: path?.startsWith("/api/events/") ? current : undefined, error: undefined, loading: false, reload: () => {} }),
}));
vi.mock("../lib/meta", async (orig) => ({
  ...(await orig<typeof import("../lib/meta")>()),
  useTitle: () => {}, useMeta: () => null, usePredictable: (s: number) => s >= 2023,
}));
vi.mock("../lib/liveMode", async (orig) => ({
  ...(await orig<typeof import("../lib/liveMode")>()),
  isLiveMode: () => liveMode, useEventPoll: () => {},
}));
// The live panel's own behaviour has its tests (LivePanel.test.tsx); here it only has to be there.
vi.mock("../components/LivePanel", () => ({
  LivePanel: () => <section data-live-panel>Live now</section>,
  LiveCountdownChip: () => null,
  useLiveTarget: () => ({ teams: new Map(), mine: null, next: null }),
}));
// The tables fetch on their own; these tests are about the header.
vi.mock("../components/records/RecordsTable", () => ({ RecordsTable: () => <div>records table</div> }));
vi.mock("../components/Advancement", () => ({ AdvancementView: () => <div>advancement</div> }));

let nav: NavigateFunction = () => {};
function Nav() { nav = useNavigate(); return null; }

const { default: EventPage } = await import("./EventPage");
const mount = (entries: string[], index = entries.length - 1) => render(
  <MemoryRouter initialEntries={entries} initialIndex={index}>
    <PersonalProvider><Routes><Route path="/events/:season/:code" element={<><EventPage /><Nav /></>} /></Routes></PersonalProvider>
  </MemoryRouter>,
);
const header = () => document.querySelector<HTMLElement>("[data-event-header]")?.dataset.eventHeader;
const toggle = () => screen.queryByRole("button", { name: /event details/i });
const glance = () => screen.queryByText(/at a glance/i);
const selected = () => screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent);

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: null }), { headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); current = detail(); liveMode = false; });

describe("event page header: slim on a deep-linked panel", () => {
  it("keeps the full header on a plain event address", () => {
    mount(["/events/2025/AUBRQ2"]);
    expect(header()).toBe("full");
    expect(toggle()).toBeNull();
    expect(glance()).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Brisbane Qualifier 2");
  });

  it("shows the slim bar (name, status, dates) with the summary collapsed behind Event details", () => {
    mount(["/events/2025/AUBRQ2?tab=teams"]);
    expect(header()).toBe("slim");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Brisbane Qualifier 2");
    expect(screen.getByText("Finished")).toBeTruthy();
    const b = toggle()!;
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-controls")).toBe("event-details");
    const region = document.getElementById("event-details")!;
    expect(region.hidden).toBe(true);
    expect(glance()).toBeNull();
    expect(selected()).toEqual([expect.stringContaining("Teams")]);
  });

  it("opens and closes the details, and remembers the choice for the session", () => {
    mount(["/events/2025/AUBRQ2?tab=rankings"]);
    fireEvent.click(toggle()!);
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("event-details")!.hidden).toBe(false);
    expect(glance()).not.toBeNull();
    expect(screen.getByText(/Source: FIRST Events API/)).toBeTruthy();
    expect(sessionStorage.getItem("cs-event-details")).toBe("1");
    fireEvent.click(toggle()!);
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
    expect(glance()).toBeNull();
    expect(sessionStorage.getItem("cs-event-details")).toBe("0");
  });

  it("starts expanded when the details were opened earlier this session", () => {
    sessionStorage.setItem("cs-event-details", "1");
    mount(["/events/2025/AUBRQ2?tab=odds"]);
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    expect(glance()).not.toBeNull();
  });

  it.each(EVENT_TABS)("opens ?tab=%s with the slim bar and its panel", (tab) => {
    mount([`/events/2025/AUBRQ2?tab=${tab}`]);
    expect(header()).toBe("slim");
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(selected()).toHaveLength(1);
    expect(selected()[0]!.toLowerCase()).toContain(tab);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("keeps the full header for an unknown ?tab=", () => {
    mount(["/events/2025/AUBRQ2?tab=garbage"]);
    expect(header()).toBe("full");
  });

  it("keeps the full header when a tab is picked on the plain page (the address is replaced)", () => {
    mount(["/events/2025/AUBRQ2"]);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rankings" }));
    expect(selected()).toEqual(["Rankings"]);
    expect(header()).toBe("full");
  });

  it("follows Back and Forward: each entry keeps its own tab and header", () => {
    mount(["/events/2025/AUBRQ2", "/events/2025/AUBRQ2?tab=playoffs"]);
    expect(header()).toBe("slim");
    expect(selected()).toEqual(["Playoffs"]);
    act(() => nav(-1));
    expect(header()).toBe("full");
    expect(selected()).toEqual(["Matches"]);
    act(() => nav(1));
    expect(header()).toBe("slim");
    expect(selected()).toEqual(["Playoffs"]);
  });

  it("still shows the live panel in the slim bar while the event is live", () => {
    liveMode = true;
    current = { ...detail(), event: { ...detail().event, status: "live" } };
    mount(["/events/2025/AUBRQ2?tab=rankings"]);
    expect(header()).toBe("slim");
    const panel = document.querySelector("[data-live-panel]")!;
    expect(panel).not.toBeNull();
    expect(document.getElementById("event-details")!.contains(panel)).toBe(false);
  });
});
