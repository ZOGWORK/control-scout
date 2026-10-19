// @vitest-environment jsdom
// The select-all box in the Team header ("i see the checkboxes but no select all button"): unchecked with
// none of the page ticked, mixed with some, checked with all. It ticks the page from the top up to Compare's
// cap of 4 (and says so next to Compare), clears the page when any of it is ticked, and only ever touches the
// rows on the page: ticks on other pages survive paging. The phone summary cards (matches) have no ticks.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router-dom";
import type { MatchRecordRow, RecordScope } from "../../shared/statCatalog";

// Rows per page, by page number (the server sorts: this order is the table's order).
let pages: Record<number, number[]> = {};
const teamRow = (team: number, eventCode?: string) => (eventCode
  ? { season: 2025, team, eventCode, eventName: `Event ${eventCode}`, eventType: null, eventStart: null, stats: { teamName: `Team ${team}`, totalPointsOpr: 1 } }
  : { season: 2025, team, stats: { teamName: `Team ${team}`, totalPointsOpr: 1 } });
let teamEventRows: ReturnType<typeof teamRow>[] | null = null;
const matchRow: MatchRecordRow = {
  season: 2025, eventCode: "USMNCMP", eventName: "Minnesota State Championship", eventType: null, eventStart: null,
  key: "qual:0:1", level: "qual", label: "Q1", time: null, red: [1, 2], blue: [3, 4], stats: { redTotalPoints: 10, blueTotalPoints: 5, highScore: 10 },
};
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => {
    const m = path?.match(/^\/api\/records\/\d+\/(teams|team-events|matches)\?/);
    if (!m) return { data: undefined, error: undefined, loading: false, reload: () => {} };
    const page = Number(new URL(path!, "http://x").searchParams.get("page") ?? 1) || 1;
    const rows = m[1] === "matches" ? [matchRow] : teamEventRows ?? (pages[page] ?? []).map((t) => teamRow(t));
    const total = Object.values(pages).reduce((a, r) => a + r.length, 0) || rows.length;
    return { data: { rows, total, page, pageSize: Math.max(...Object.values(pages).map((r) => r.length), rows.length) }, error: undefined, loading: false, reload: () => {} };
  },
  apiFetch: () => new Promise(() => {}),
}));

const { RecordsTable } = await import("./RecordsTable");
const { TooltipProvider } = await import("../ui/overlay");

let nav: NavigateFunction;
function Probe() { nav = useNavigate(); return null; }
const mount = (scope: RecordScope = "teamSeason", url = "/teams") => render(
  <MemoryRouter initialEntries={[url]}><TooltipProvider>
    <RecordsTable scope={scope} season={2025} predictable defaultCols={["totalPointsOpr"]} storageKey="sel" noun="teams" selectable />
    <Probe />
  </TooltipProvider></MemoryRouter>,
);
const all = () => screen.getByRole("checkbox", { name: "Select all teams on this page" }) as HTMLInputElement;
const row = (t: number) => screen.getAllByRole("checkbox", { name: `Select ${t} to compare` })[0] as HTMLInputElement;
const compare = () => screen.queryByRole("link", { name: /Compare/ });
const compared = () => new URL(compare()!.getAttribute("href")!, "http://x").searchParams.get("teams");
const note = () => screen.getByRole("status").textContent;
const stateOf = (c: HTMLInputElement) => (c.indeterminate ? "mixed" : c.checked ? "all" : "none");

let phone = false;
beforeEach(() => {
  pages = { 1: [101, 102, 103] };
  teamEventRows = null;
  phone = false;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: phone && query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("records table select-all", () => {
  it("is a labelled checkbox in the Team header, in the tab order", () => {
    mount();
    const box = all();
    expect(box.closest("th")?.textContent).toContain("Team");
    expect(box.tabIndex).toBe(0);
    box.focus();
    expect(document.activeElement).toBe(box);
  });

  it("shows none, mixed and all as the page's rows are ticked", () => {
    mount();
    expect(stateOf(all())).toBe("none");
    expect(all().getAttribute("aria-checked")).toBeNull();
    fireEvent.click(row(102));
    expect(stateOf(all())).toBe("mixed");
    expect(all().getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(row(101));
    fireEvent.click(row(103));
    expect(stateOf(all())).toBe("all");
    expect(all().getAttribute("aria-checked")).toBeNull();
    fireEvent.click(row(102));
    expect(stateOf(all())).toBe("mixed");
  });

  it("ticks every team on the page, then clears them", () => {
    mount();
    fireEvent.click(all());
    expect(stateOf(all())).toBe("all");
    expect([101, 102, 103].every((t) => row(t).checked)).toBe(true);
    expect(compared()).toBe("101,102,103");
    expect(note()).toBe("");
    fireEvent.click(all());
    expect(stateOf(all())).toBe("none");
    expect(compare()).toBeNull();
  });

  it("clears the page from mixed", () => {
    mount();
    fireEvent.click(row(103));
    fireEvent.click(all());
    expect(stateOf(all())).toBe("none");
    expect(row(103).checked).toBe(false);
  });

  it("stops at Compare's cap of 4, in the table's order, and says so next to Compare", () => {
    pages = { 1: [7, 3, 9, 1, 5, 2] };
    mount();
    fireEvent.click(all());
    expect(compared()).toBe("7,3,9,1");
    expect([7, 3, 9, 1].every((t) => row(t).checked)).toBe(true);
    expect(row(5).checked || row(2).checked).toBe(false);
    expect(stateOf(all())).toBe("mixed");
    expect(note()).toBe("Compare takes up to 4 teams; selected the first 4");
    // The note sits in the toolbar with Compare.
    expect(screen.getByRole("status").parentElement).toBe(compare()!.closest("div")!.parentElement);
    // Mixed: a second click clears the page, and the note goes with it.
    fireEvent.click(all());
    expect(stateOf(all())).toBe("none");
    expect(note()).toBe("");
  });

  it("only touches the page: ticks elsewhere survive paging and count towards the cap", () => {
    pages = { 1: [101, 102], 2: [201, 202, 203] };
    mount();
    fireEvent.click(all());
    act(() => nav("/teams?page=2"));
    expect(stateOf(all())).toBe("none");
    expect(compared()).toBe("101,102");
    fireEvent.click(all());
    expect(compared()).toBe("101,102,201,202");
    expect(note()).toBe("Compare takes up to 4 teams; added the first 2 on this page");
    // Clearing page 2 leaves page 1's ticks alone.
    fireEvent.click(all());
    expect(compared()).toBe("101,102");
    act(() => nav("/teams?page=1"));
    expect(stateOf(all())).toBe("all");
  });

  it("adds nothing when the cap is already reached elsewhere, and says how to make room", () => {
    pages = { 1: [1, 2, 3, 4], 2: [5, 6] };
    mount();
    fireEvent.click(all());
    act(() => nav("/teams?page=2"));
    fireEvent.click(all());
    expect(compared()).toBe("1,2,3,4");
    expect(stateOf(all())).toBe("none");
    expect(note()).toBe("Compare takes up to 4 teams; untick one to add more");
    // Ticking or unticking a row by hand clears the note.
    act(() => nav("/teams?page=1"));
    fireEvent.click(row(4));
    expect(note()).toBe("");
  });

  it("counts a team with several rows once (team-events)", () => {
    teamEventRows = [teamRow(101, "A"), teamRow(102, "A"), teamRow(101, "B")];
    mount("teamEvent", "/teams?view=events");
    fireEvent.click(all());
    expect(compared()).toBe("101,102");
    expect(screen.getAllByRole("checkbox", { name: "Select 101 to compare" }).every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(stateOf(all())).toBe("all");
  });

  it("keeps the select-all on a phone's team table; the match summary cards have no ticks to select", () => {
    phone = true;
    mount();
    expect(all()).toBeTruthy();
    cleanup();
    mount("match", "/matches");
    expect(screen.getByRole("button", { name: "Summary" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
