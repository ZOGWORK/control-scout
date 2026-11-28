// @vitest-environment jsdom
// Compare in v8 (docs/design/v8-revamp-brief.md, <html data-v8>), rebuilt around "which of these teams is better, and
// at what?": the answer first, each team's count of stats led and which ones, the team ahead on most in the accent;
// then the table, the winner of each row in white on a faint fill and the rest grey, drawn without Motion.
// With v8 off the page is drawn as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { CompareTeam, CompareView } from "../shared/api";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, bookmarks: [], tracked: { teams: [], events: [] }, videoLinks: {} }, syncReady: false }) }));
// The charts are their own deferred chunk (src/components/charts/defer.ts): this page test is about the table and the
// verdict, and importing recharts here would spend the next test's debounce loading a chart nothing asserts.
vi.mock("../components/charts/CompareCharts", () => ({ CompareCharts: () => null }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025, useTitle: () => {}, usePredictable: () => true }));

const { default: ComparePage, verdict } = await import("./ComparePage");
const { TooltipProvider } = await import("../components/ui/overlay");
const { invalidate } = await import("../lib/api");

const stat = (value: number) => ({ value, rank: 10, of: 100 });
const team = (n: number, opr: number, wins: number): CompareTeam => ({
  team: { number: n, name: `Team ${n} name` } as CompareTeam["team"],
  stats: { opr: { np: stat(opr), auto: stat(10), teleop: stat(opr - 20), endgame: stat(10), pen: -3 }, rating: null, record: { wins, losses: 2, ties: 0, matches: wins + 2, events: 2 }, avg: { np: 1, score: 1, pen: 1 } },
  events: [], awards: [],
});
const teams = [team(4215, 100, 8), team(6980, 90, 9)];
const view = (): CompareView => ({ season: 2025, teams, meetings: [] });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async (path: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path.startsWith("/api/compare")) return json(view());
    return json({ hits: [] });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

const page = (url = "/compare?teams=4215,6980") => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><ComparePage /></MemoryRouter></TooltipProvider>);
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The address the page has written to, as the user would see it. */
let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
const at = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><ComparePage /><Where /></MemoryRouter></TooltipProvider>);

describe("verdict", () => {
  it("counts the rows each team leads (ties lead for both), over the rows that have a leader", () => {
    const v = verdict(teams);
    expect(v.rows).toBe(6);
    expect(v.teams).toEqual([
      { team: 4215, leads: ["OPR", "Auto", "TeleOp", "Endgame", "Avg score"] },
      { team: 6980, leads: ["Auto", "Endgame", "Record", "Avg score"] },
    ]);
  });
});

describe("Compare, v8 on", () => {
  beforeEach(() => { document.documentElement.setAttribute("data-v8", ""); });

  it("puts the answer first: who's ahead, then the table", async () => {
    page();
    const card = await waitFor(() => { const e = document.querySelector("[data-verdict]"); if (!e) throw new Error("not yet"); return e; });
    expect(document.querySelector("[data-compare-v8]")).not.toBeNull();
    expect(card.querySelector("[data-verdict-line]")!.textContent).toBe("4215 leads on 5 of 6 stats.");
    const counts = [...card.querySelectorAll("[data-verdict-count]")];
    expect(counts.map((c) => c.textContent)).toEqual(["5", "4"]);
    expect(counts[0].className).toContain("text-accent");
    expect(counts[1].className).not.toContain("text-accent");
    expect(follows(card, document.querySelector("[data-stats-table]")!)).toBe(true);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("text-[1.375rem]");
  });

  it("marks each row's winner (bold, in its category colour: OPR purple) and greys the rest", async () => {
    page();
    await waitFor(() => expect(document.querySelector("[data-stats-table] tbody")).not.toBeNull());
    const opr = screen.getByRole("rowheader", { name: "OPR" }).parentElement!;
    const [a, b] = [...opr.querySelectorAll("td")];
    expect(a.hasAttribute("data-lead")).toBe(true);
    expect(a.querySelector("span")!.className).toContain("v8:text-violet-300");
    expect(opr.querySelector("th")!.className).toContain("v8:text-violet-300");
    // A row with no category (Record) keeps the winner white.
    const rec = screen.getByRole("rowheader", { name: "Record" }).parentElement!;
    expect(rec.querySelector("td[data-lead] span")?.className ?? "v8:text-text-base").toContain("v8:text-text-base");
    expect(b.hasAttribute("data-lead")).toBe(false);
    expect(b.querySelector("span")!.className).toContain("v8:text-text-muted");
  });
});

describe("Compare rows, v8 on", () => {
  beforeEach(() => { document.documentElement.setAttribute("data-v8", ""); where = ""; invalidate("/api/"); });

  it("reorders the teams from a column's grip without asking again, and marks the first as the baseline", async () => {
    const asked: string[] = [];
    const base = fetch;
    vi.stubGlobal("fetch", async (path: string) => { asked.push(path); return base(path); });
    at("/compare?teams=6980,4215");
    const grip = await screen.findByRole("button", { name: /^Reorder 6980, first of 2/ });
    const heads = () => screen.getAllByRole("columnheader").slice(1).map((th) => th.textContent);
    expect(heads()[0]).toMatch(/6980.*Baseline/);
    fireEvent.keyDown(grip, { key: "ArrowRight" });
    expect(where).toBe("/compare?teams=4215%2C6980");
    await waitFor(() => expect(heads()[0]).toMatch(/4215.*Baseline/));
    expect(heads()[1]).not.toMatch(/Baseline/);
    // One request: the order is the page's, not the server's.
    expect(asked.filter((p) => p.startsWith("/api/compare"))).toHaveLength(1);
  });

  it("finds a team by name in the page's own search and adds it, ignoring events", async () => {
    vi.stubGlobal("fetch", async (path: string) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      if (path.startsWith("/api/search")) return json({ hits: [{ kind: "team", ref: "4215", title: "4215 Gearheads", subtitle: "Oradell, NJ", season: null }, { kind: "event", ref: "2025:X", title: "Gear Cup", subtitle: "", season: 2025 }] });
      if (path.startsWith("/api/compare")) return json(view());
      return json({ hits: [] });
    });
    at("/compare");
    const box = screen.getByRole("combobox", { name: "Add a team to compare" });
    fireEvent.change(box, { target: { value: "gear" } });
    const option = await screen.findByRole("option", { name: /4215.*Gearheads/ });
    expect(screen.queryByRole("option", { name: /Gear Cup/ })).toBeNull();
    fireEvent.mouseDown(option);
    await waitFor(() => expect(where).toBe("/compare?teams=4215"));
  });

  it("Enter adds the team the server finds for the typed number", async () => {
    vi.stubGlobal("fetch", async (path: string) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      if (path.startsWith("/api/search")) return json({ hits: [{ kind: "team", ref: "6980", title: "6980 Team 6980 name", subtitle: "", season: null }] });
      if (path.startsWith("/api/compare")) return json(view());
      return json({ hits: [] });
    });
    at("/compare");
    const box = screen.getByRole("combobox", { name: "Add a team to compare" });
    fireEvent.change(box, { target: { value: "6980" } });
    await screen.findByRole("option", { name: /6980/ });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(where).toBe("/compare?teams=6980"));
  });

  it("the search keeps its place once teams are chosen, the table marks the best, and removing works", async () => {
    at("/compare?teams=4215,6980");
    const table = within(await screen.findByRole("table"));
    expect(screen.getByRole("combobox", { name: "Add a team to compare" })).toBeTruthy();
    expect(screen.getByText("2 of 4 teams")).toBeTruthy();
    const opr = table.getByRole("rowheader", { name: "OPR" }).parentElement!;
    const [a, b] = [...opr.querySelectorAll("td")];
    expect(a.hasAttribute("data-lead")).toBe(true);
    expect(b.hasAttribute("data-lead")).toBe(false);
    fireEvent.click(table.getByRole("button", { name: "Remove 4215" }));
    expect(where).toBe("/compare?teams=6980");
  });

  it("four teams: the search says why it's off", async () => {
    at("/compare?teams=1,2,3,4");
    const box = screen.getByRole("combobox", { name: "Add a team to compare" });
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(box.getAttribute("placeholder")).toMatch(/remove one/);
  });
});
