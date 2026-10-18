// @vitest-environment jsdom
// Compare: the team search stays put and finds teams by name too; the member's own teams are one click away;
// the stats table marks the best of each row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import type { CompareTeam, CompareView } from "../shared/api";

const h = vi.hoisted(() => ({ user: null as AccountUser | null, state: { myTeam: null as number | null, bookmarks: [] as number[], tracked: { teams: [] as number[], events: [] as string[] }, videoLinks: {} } }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: h.user, providers: {}, state: h.state, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025, useTitle: () => {}, usePredictable: () => true }));

const { default: ComparePage, leaders } = await import("./ComparePage");
const { TooltipProvider } = await import("../components/ui/overlay");

const stat = (value: number) => ({ value, rank: 10, of: 100 });
const team = (n: number, opr: number, wins: number): CompareTeam => ({
  team: { number: n, name: `Team ${n} name` } as CompareTeam["team"],
  stats: { opr: { np: stat(opr), auto: stat(10), teleop: stat(opr - 20), endgame: stat(10), pen: -3 }, rating: null, record: { wins, losses: 2, ties: 0, matches: wins + 2, events: 2 }, avg: { np: 1, score: 1, pen: 1 } },
  events: [],
});
const view = (teams: CompareTeam[]): CompareView => ({ season: 2025, teams, meetings: [] });

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  h.user = null; h.state = { myTeam: null, bookmarks: [], tracked: { teams: [], events: [] }, videoLinks: {} }; where = "";
  vi.stubGlobal("fetch", async (path: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path.startsWith("/api/search?q=gear")) return json({ hits: [{ kind: "team", ref: "4215", title: "4215 Gearheads", subtitle: "Oradell, NJ", season: null }, { kind: "event", ref: "2025:X", title: "Gear Cup", subtitle: "", season: 2025 }] });
    if (path.startsWith("/api/search?q=")) { const n = decodeURIComponent(path.split("q=")[1].split("&")[0]); return json({ hits: [{ kind: "team", ref: n, title: `${n} Team ${n} name`, subtitle: "", season: null }] }); }
    if (path.startsWith("/api/compare")) return json(view([team(4215, 100, 8), team(6980, 90, 9)]));
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = (url = "/compare") => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><ComparePage /><Where /></MemoryRouter></TooltipProvider>);

describe("leaders", () => {
  const m = { better: "high" as const, value: (x: CompareTeam) => x.stats?.opr.np.value ?? null };
  it("marks the top value, every tie, and nothing with fewer than two values", () => {
    expect([...leaders(m, [team(1, 50, 1), team(2, 70, 1), team(3, 70, 1)])]).toEqual([2, 3]);
    expect(leaders(m, [team(1, 50, 1), { ...team(2, 0, 0), stats: null }]).size).toBe(0);
    expect(leaders({ better: null, value: m.value }, [team(1, 50, 1), team(2, 70, 1)]).size).toBe(0);
  });
});

describe("ComparePage", () => {
  it("finds a team by name in the page's own search and adds it", async () => {
    page();
    const box = screen.getByRole("combobox", { name: "Add a team to compare" });
    fireEvent.change(box, { target: { value: "gear" } });
    const option = await screen.findByRole("option", { name: /4215.*Gearheads/ });
    expect(screen.queryByRole("option", { name: /Gear Cup/ })).toBeNull();
    fireEvent.mouseDown(option);
    await waitFor(() => expect(where).toBe("/compare?teams=4215"));
  });

  it("Enter on a typed number adds it", async () => {
    page();
    const box = screen.getByRole("combobox", { name: "Add a team to compare" });
    fireEvent.change(box, { target: { value: "6980" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(where).toBe("/compare?teams=6980"));
  });

  it("offers the member's own teams, one click or all at once", async () => {
    h.user = { id: 1, email: "a@scout.test", displayName: "A", createdAt: "", controlPoint: { accountId: 9, member: true, url: "",
      teams: [{ teamNumber: 4215, name: "W1" }, { teamNumber: 6980, name: "W2" }], workspaces: [{ id: "1", name: "W1", role: "admin" }, { id: "2", name: "W2", role: "member" }] } };
    h.state.bookmarks = [12345];
    page();
    expect(screen.getByText("Start with your teams")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Add 12345/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Compare your 2 teams/ }));
    await waitFor(() => expect(where).toBe("/compare?teams=4215%2C6980"));
  });

  it("the search keeps its place once teams are chosen, the table marks the best, and removing works", async () => {
    page("/compare?teams=4215,6980");
    const table = within(await screen.findByRole("table"));
    expect(screen.getByRole("combobox", { name: "Add a team to compare" })).toBeTruthy();
    expect(screen.getByText("2 of 4 teams")).toBeTruthy();
    const opr = table.getByRole("row", { name: /^OPR/ });
    expect(within(opr).getAllByRole("cell")[0].textContent).toContain("(best)");
    expect(within(opr).getAllByRole("cell")[1].textContent).not.toContain("(best)");
    fireEvent.click(table.getByRole("button", { name: "Remove 4215" }));
    expect(where).toBe("/compare?teams=6980");
  });

  it("four teams: the search says why it's off", () => {
    page("/compare?teams=1,2,3,4");
    const box = screen.getByRole("combobox", { name: "Add a team to compare" });
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(box.getAttribute("placeholder")).toMatch(/remove one/);
  });
});
