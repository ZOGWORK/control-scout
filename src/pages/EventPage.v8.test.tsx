// @vitest-environment jsdom
// The event page in v8 (docs/design/v8-revamp-brief.md, <html data-v8>): the header is the top of the page with the
// name as the page title, the stream link is a plain button so the page keeps at most one primary, live is the red
// dot with its slow ring, tables have a quiet head and no heat colours, the podium ranks are gold, silver and bronze, awards gold, OPR purple, "your team" slate blue, the team
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
// The phone's sticky bar shows once the header's end has scrolled away: here, only whether it got that anchor.
vi.mock("../components/StickyActions", () => ({ StickyActions: ({ after, children }: { after: HTMLElement | null; children: unknown }) => <div data-sticky-after={after ? "set" : "null"}>{children as never}</div> }));

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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); current = detail(); v8(false); localStorage.clear(); });

describe("event page in v8", () => {
  const selected = () => screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.textContent);
  const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, "").trim());

  it("draws a compact header (one status badge, name, date and place, Track and More) and no glance card", () => {
    mount("/events/2025/AUBRQ2");
    expect(document.querySelector("[data-event-header=v8]")).not.toBeNull();
    expect(document.querySelectorAll("[data-event-chip]")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Brisbane Qualifier 2");
    expect(screen.getByRole("button", { name: /more/i }).hasAttribute("data-more-actions")).toBe(true);
    expect(screen.getByRole("button", { name: /track event/i })).toBeTruthy();
    expect(screen.queryByText(/at a glance/i)).toBeNull();
    expect((document.getElementById("event-details") as HTMLDetailsElement).open).toBe(false);
  });

  it("opens a finished event on Rankings with its tabs in the finished order, and leads with winners, awards and standings", () => {
    current = { ...detail(), awards: [
      { type: 1, placement: 1, team: 2222, name: "Connect Award" },
      { type: 2, placement: 1, team: 1111, name: "Winning Alliance - Captain" },
      { type: 3, placement: 1, team: 2222, name: "Inspire Award" },
    ] } as unknown as EventDetail;
    mount("/events/2025/AUBRQ2");
    expect(selected()).toEqual([expect.stringContaining("Rankings")]);
    expect(tabNames().slice(0, 3)).toEqual(["Rankings", "Playoffs", "Awards"]);
    expect(document.querySelector("[data-event-focus=finished]")).not.toBeNull();
    const awards = [...document.querySelectorAll("[data-focus-awards] li")].map((li) => li.textContent);
    expect(awards[0]).toMatch(/^Inspire Award/); // Inspire first
    expect(awards.some((a) => /alliance/i.test(a ?? ""))).toBe(false); // the Winners card has those
    const top = [...document.querySelectorAll("[data-top-standings] li")];
    expect(top.map((li) => li.getAttribute("data-team"))).toEqual(["1111", "2222"]);
    // The podium in gold, silver and bronze (lib/v8colour.ts); awards in gold.
    expect(top[0].querySelector(String.raw`.v8\:text-yellow-400`)?.textContent).toBe("1");
    expect(top[1].querySelector(String.raw`.v8\:text-slate-300`)?.textContent).toBe("2");
    expect(document.querySelector("[data-focus-awards] li span")!.className).toMatch(/v8:text-yellow-400/);
  });

  it("marks your team in mint wherever the first screen lists it", () => {
    localStorage.setItem("cs-personal:myTeam", JSON.stringify({ value: 2222, updatedAt: 1 }));
    mount("/events/2025/AUBRQ2");
    const row = document.querySelector('[data-top-standings] li[data-team="2222"]')!;
    expect(row.querySelector("[data-yours]")).not.toBeNull();
    expect(row.className).toMatch(/inset_2px_0_0_var\(--color-accent\)/);
    expect(document.querySelector('[data-top-standings] li[data-team="1111"] [data-yours]')).toBeNull();
    localStorage.clear();
  });

  it("draws team numbers in the slate blue (yours stay white) and award names as plain text, never raw HTML", () => {
    localStorage.setItem("cs-personal:myTeam", JSON.stringify({ value: 2222, updatedAt: 1 }));
    current = { ...detail(), awards: [{ type: "Winner", placement: 1, team: 1111, name: "<i>FIRST</i>&reg; Leadership Award Finalists" }] } as unknown as EventDetail;
    mount("/events/2025/AUBRQ2");
    const no = (team: number) => document.querySelector(`[data-top-standings] li[data-team="${team}"] a > span, [data-top-standings] li[data-team="${team}"] span > span.font-mono`)!;
    expect(no(1111).textContent).toBe("1111");
    expect(no(1111).className).toMatch(/\btext-accent\b/);
    expect(no(2222).className).toMatch(/\btext-text-base\b/);
    expect(no(2222).className).not.toMatch(/\btext-accent\b/);
    const award = document.querySelector("[data-focus-awards] li")!.textContent!;
    expect(award).toMatch(/^FIRST® Leadership Award Finalists/);
    expect(award).not.toMatch(/<i>|&reg;/);
    localStorage.clear();
  });

  it("opens an upcoming event on Teams with who's coming first", () => {
    current = detail({ status: "upcoming", start: "2099-11-01", end: "2099-11-01" });
    mount("/events/2025/AUBRQ2");
    expect(selected()).toEqual([expect.stringContaining("Teams")]);
    expect(tabNames().slice(0, 2)).toEqual(["Teams", "Odds"]);
    expect(document.querySelector("[data-event-focus=upcoming]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: /who's coming/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /your teams here/i })).toBeTruthy();
  });

  it("opens a live event on Matches, with the stream as the one primary; a finished event's stream is outlined", () => {
    current = detail({ status: "live" });
    mount("/events/2025/AUBRQ2");
    expect(selected()).toEqual([expect.stringContaining("Matches")]);
    expect(document.querySelector("[data-event-focus=live]")).not.toBeNull();
    expect(document.querySelector<HTMLElement>("[data-livestream]")!.className).toMatch(/v8:bg-ink\/10/); // the primary
    cleanup(); current = detail();
    mount("/events/2025/AUBRQ2");
    expect(document.querySelector<HTMLElement>("[data-livestream]")!.className).toMatch(/border-text-base\/25/); // outline
  });

  it("gives the phone's sticky action bar the header's end to watch (live and upcoming)", () => {
    for (const over of [{ status: "live" as const }, { status: "upcoming" as const, start: "2099-11-01", end: "2099-11-01" }]) {
      current = detail(over);
      mount("/events/2025/AUBRQ2");
      expect(document.querySelector("[data-sticky-after]")?.getAttribute("data-sticky-after")).toBe("set");
      cleanup();
    }
  });

  it("keeps a ?tab= link's tab", () => {
    mount("/events/2025/AUBRQ2?tab=awards");
    expect(selected()).toEqual([expect.stringContaining("Awards")]);
  });

  it("leaves the page as it was with v8 off: the full header, the glance card, the old tab order and default", () => {
    v8(false);
    mount("/events/2025/AUBRQ2");
    expect(document.querySelector("[data-event-header=full]")).not.toBeNull();
    expect(screen.queryByText(/at a glance/i)).not.toBeNull();
    expect(document.querySelector("[data-event-focus]")).toBeNull();
    expect(tabNames()[0]).toBe("Matches");
    expect(selected()).toEqual([expect.stringContaining("Matches")]);
    expect(document.querySelector<HTMLElement>("[data-livestream]")!.className).toMatch(/(^| )bg-accent( |$)/);
  });

  it("drops the hover lift on the team cards, marks the podium ranks gold, silver and bronze, and keeps the lift with v8 off", () => {
    mount("/events/2025/AUBRQ2?tab=teams");
    const cards = () => [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/teams/"]')].filter((a) => a.textContent?.includes("Rank"));
    expect(cards()).toHaveLength(2);
    for (const c of cards()) expect(c.className).not.toMatch(/(^| )lift( |$)/);
    const rankOf = (team: number) => cards().find((c) => c.textContent?.includes(String(team)))!.querySelector(".font-display")!;
    expect(rankOf(1111).className).toMatch(/v8:text-yellow-400/); // #1 gold
    expect(rankOf(2222).className).toMatch(/v8:text-slate-300/); // #2 silver
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
    expect(screen.getByText("A1").className).toMatch(/v8:bg-ink\/\[0\.06\] v8:text-text-base/);
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
