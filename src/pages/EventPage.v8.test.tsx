// @vitest-environment jsdom
// The event page in v8 (docs/design/v8-revamp-brief.md, <html data-v8>): the header is the top of the page with the
// name as the page title, the stream link is a plain button so the page keeps at most one primary, live is the red
// dot with its slow ring, tables have a quiet head and no heat colours, mint marks only #1 and "your team", the team
// cards don't lift, and alliance chips are neutral. With v8 off, every branch draws as before.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { EventDetail, FieldRow } from "../shared/api";
import { PersonalProvider } from "../lib/personal";
import { SortTable, type Col } from "../components/SortTable";
import { EventStatusChip, EventTypeChip } from "../components/EventChips";
import { AllianceChip } from "../components/PlayoffBracket";

const row = (team: number, rank: number, opr: number): FieldRow => ({
  team, name: `Team ${team}`, city: "Brisbane", state: "QLD", rank, rp: 2, tb1: null, wins: 3, losses: 1, ties: 0, played: 4,
  opr: { np: opr, auto: null, teleop: null, endgame: null, pen: null }, rating: null,
} as unknown as FieldRow);

const detail = (over: Partial<EventDetail["event"]> = {}): EventDetail => ({
  event: {
    season: 2025, code: "AUBRQ2", name: "Brisbane Qualifier 2", type: "Qualifier", typeLabel: "Qualifier", divisionCode: null, region: null,
    city: "Brisbane", state: "QLD", country: "Australia", venue: null, start: "2025-11-01", end: "2025-11-01", remote: false,
    teams: 2, matchesPlayed: 0, matchesTotal: 0, status: "finished", website: null, livestream: "https://example.test/stream", timezone: null, source: "first",
    ...over,
  },
  field: [row(1111, 1, 80), row(2222, 2, 40)], matches: [], alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null,
});

let current: EventDetail = detail();
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => ({ data: path?.startsWith("/api/events/") && !path.includes("/disagreements") ? current : undefined, error: undefined, loading: false, reload: () => {} }),
}));
vi.mock("../lib/meta", async (orig) => ({
  ...(await orig<typeof import("../lib/meta")>()),
  useTitle: () => {}, useMeta: () => null, usePredictable: (s: number) => s >= 2023,
}));
vi.mock("../lib/liveMode", async (orig) => ({ ...(await orig<typeof import("../lib/liveMode")>()), isLiveMode: () => false, useEventPoll: () => {} }));
vi.mock("../components/records/RecordsTable", async (orig) => ({ ...(await orig<typeof import("../components/records/RecordsTable")>()), RecordsTable: () => <div>records table</div> }));
vi.mock("../components/Advancement", () => ({ AdvancementView: () => <div>advancement</div> }));

const { default: EventPage } = await import("./EventPage");
const mount = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <PersonalProvider><Routes><Route path="/events/:season/:code" element={<EventPage />} /></Routes></PersonalProvider>
  </MemoryRouter>,
);
const v8 = (on: boolean) => { if (on) document.documentElement.setAttribute("data-v8", ""); else document.documentElement.removeAttribute("data-v8"); };

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: null }), { headers: { "Content-Type": "application/json" } })));
  v8(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); current = detail(); v8(false); });

describe("event page in v8", () => {
  it("draws the header as the page's top, not a card, with the name as the page title and no glow", () => {
    mount("/events/2025/AUBRQ2");
    const header = document.querySelector<HTMLElement>("[data-event-header=full]")!;
    expect(header.className).toMatch(/v8:border-0/);
    expect(header.className).toMatch(/v8:bg-transparent/);
    expect(header.querySelector(".blur-3xl")!.className).toMatch(/v8:hidden/);
    expect(screen.getByRole("heading", { level: 1 }).className).toMatch(/v8:text-\[1\.375rem\]/);
  });

  it("makes the stream link a plain button (the page's one primary is elsewhere); v8 off keeps it filled", () => {
    mount("/events/2025/AUBRQ2");
    const link = document.querySelector<HTMLElement>("[data-livestream]")!;
    expect(link.className).not.toMatch(/(^| )bg-accent( |$)/);
    expect(link.className).toMatch(/hover:bg-text-base\/\[0\.06\]/); // the ghost variant
    cleanup(); v8(false);
    mount("/events/2025/AUBRQ2");
    expect(document.querySelector<HTMLElement>("[data-livestream]")!.className).toMatch(/(^| )bg-accent( |$)/);
  });

  it("gives the glance card's odds button the outline look in v8 and the filled one with v8 off", () => {
    current = detail({ status: "upcoming", start: "2099-11-01", end: "2099-11-01" });
    mount("/events/2025/AUBRQ2");
    const odds = () => screen.getByRole("button", { name: /who advances/i });
    expect(odds().className).toMatch(/border-text-base\/25/);
    cleanup(); v8(false);
    mount("/events/2025/AUBRQ2");
    expect(odds().className).toMatch(/(^| )bg-accent( |$)/);
  });

  it("drops the hover lift on the team cards, marks only the #1 rank in mint, and keeps the lift with v8 off", () => {
    mount("/events/2025/AUBRQ2?tab=teams");
    const cards = () => [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/teams/"]')].filter((a) => a.textContent?.includes("Rank"));
    expect(cards()).toHaveLength(2);
    for (const c of cards()) expect(c.className).not.toMatch(/(^| )lift( |$)/);
    const rankOf = (team: number) => cards().find((c) => c.textContent?.includes(String(team)))!.querySelector(".font-display")!;
    expect(rankOf(1111).className).not.toMatch(/v8:text-text-base/); // #1 stays mint
    expect(rankOf(2222).className).toMatch(/v8:text-text-base/);
    cleanup(); v8(false);
    mount("/events/2025/AUBRQ2?tab=teams");
    for (const c of cards()) expect(c.className).toMatch(/(^| )lift( |$)/);
  });

  it("draws status and type chips as quiet outlined pills, live as the red dot with its slow ring (none under reduced motion)", () => {
    render(<><EventStatusChip status="live" /><EventStatusChip status="finished" /><EventTypeChip type="Qualifier" label="Qualifier" /></>);
    const [live, finished] = document.querySelectorAll<HTMLElement>("[data-event-chip=status]");
    expect(live.className).toMatch(/v8:text-live/);
    const ring = live.querySelector<HTMLElement>("[data-live-ring]")!;
    expect(ring.className).toMatch(/v8:animate-\[ping_2s/);
    expect(ring.className).toMatch(/motion-reduce:hidden/);
    expect(ring.className).toMatch(/v8:bg-live/);
    for (const chip of [finished, document.querySelector<HTMLElement>("[data-event-chip=type]")!]) {
      expect(chip.className).toMatch(/v8:bg-transparent/);
      expect(chip.className).toMatch(/v8:text-text-muted/);
    }
  });

  it("keeps alliance chips neutral in v8 (no hue per alliance)", () => {
    render(<AllianceChip alliance={1} />);
    expect(screen.getByText("A1").className).toMatch(/v8:bg-white\/\[0\.06\] v8:text-text-base/);
  });
});

describe("SortTable in v8", () => {
  type R = { team: number; opr: number };
  const rows: R[] = [1, 2, 3, 4, 5].map((i) => ({ team: i, opr: i * 10 }));
  const cols: Col<R>[] = [
    { key: "team", label: "Team", value: (r) => r.team },
    { key: "opr", label: "OPR", value: (r) => r.opr, align: "right", heat: true },
  ];
  const table = () => render(<SortTable rows={rows} cols={cols} rowKey={(r) => r.team} highlight={(r) => r.team === 3} initial={{ key: "opr", dir: "desc" }} />);

  it("has a quiet sentence-case head, 44px rows, no heat colours, and the highlighted row marked in mint at its edge", () => {
    table();
    const th = screen.getAllByRole("columnheader")[0];
    expect(th.className).toMatch(/v8:normal-case/);
    expect(th.className).toMatch(/v8:text-text-faint/);
    const bodyRows = [...document.querySelectorAll("tbody tr")].filter((r) => r.querySelector("td"));
    expect(bodyRows).toHaveLength(5);
    for (const r of bodyRows) expect(r.className).toMatch(/v8:h-11/);
    expect(document.querySelector("tbody td.font-semibold")).toBeNull();
    expect(document.querySelector("[data-highlight]")!.className).toMatch(/v8:shadow-\[inset_2px_0_0_var\(--color-accent\)\]/);
  });

  it("keeps the heat colours with v8 off", () => {
    v8(false);
    table();
    expect(document.querySelector("tbody td.font-semibold")).not.toBeNull();
  });
});
