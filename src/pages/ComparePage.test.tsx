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

const { default: ComparePage, leaders, teamsOf, baselineMeetings } = await import("./ComparePage");
const { compareBrief } = await import("../lib/compareBrief");
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

describe("teamsOf", () => {
  it("reads ?teams= as plain numbers, each once", () => {
    expect(teamsOf("04215,6980,x,4215,0")).toEqual(["4215", "6980"]);
    expect(teamsOf(null)).toEqual([]);
  });
});

describe("baselineMeetings", () => {
  const match = (key: string, red: number[], blue: number[]) => ({ key, red: { teams: red.map((number) => ({ number })) }, blue: { teams: blue.map((number) => ({ number })) }, relation: "partners" }) as unknown as CompareView["meetings"][number];
  const all = [match("a", [1, 9], [2, 8]), match("b", [2, 3], [7, 8]), match("c", [1, 3], [7, 8])];
  it("keeps the baseline's matches with another compared team, from its side", () => {
    expect(baselineMeetings(all, [1, 2, 3]).map((m) => [m.key, m.relation])).toEqual([["a", "opponents"], ["c", "partners"]]);
    // Moving 2 first: its match with 3 (left out from 1's side) shows, and 1 and 3's doesn't.
    expect(baselineMeetings(all, [2, 1, 3]).map((m) => [m.key, m.relation])).toEqual([["a", "opponents"], ["b", "partners"]]);
  });
});

describe("leaders", () => {
  const m = { better: "high" as const, value: (x: CompareTeam) => x.stats?.opr.np.value ?? null };
  it("marks the top value, every tie, and nothing with fewer than two values", () => {
    expect([...leaders(m, [team(1, 50, 1), team(2, 70, 1), team(3, 70, 1)])]).toEqual([2, 3]);
    expect(leaders(m, [team(1, 50, 1), { ...team(2, 0, 0), stats: null }]).size).toBe(0);
    expect(leaders({ better: null, value: m.value }, [team(1, 50, 1), team(2, 70, 1)]).size).toBe(0);
  });
});

describe("ComparePage", () => {
  it("reorders the teams from a column's grip without asking again, and marks the first as the baseline", async () => {
    const asked: string[] = [];
    const base = fetch;
    vi.stubGlobal("fetch", async (path: string) => { asked.push(path); return base(path); });
    page("/compare?teams=6980,4215");
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

  it("Enter never picks an earlier query's team while the new one is still loading", async () => {
    page();
    const box = screen.getByRole("combobox", { name: "Add a team to compare" });
    fireEvent.change(box, { target: { value: "gear" } });
    await screen.findByRole("option", { name: /4215.*Gearheads/ });
    vi.stubGlobal("fetch", () => new Promise(() => {})); // the next search never answers
    fireEvent.change(box, { target: { value: "bolt" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 50));
    expect(where).toBe("/compare");
  });

  it("a second pick while the first is still being checked keeps both", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", async (path: string) => {
      if (path.startsWith("/api/compare")) return json(view([team(222, 1, 1)]));
      const n = decodeURIComponent(path.split("q=")[1]?.split("&")[0] ?? "");
      if (n === "111") await gate;
      return json({ hits: [{ kind: "team", ref: n, title: `${n} T`, subtitle: "", season: null }] });
    });
    h.state.bookmarks = [111, 222];
    page();
    fireEvent.click(screen.getByRole("button", { name: /^Add 111/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Add 222/ }));
    await waitFor(() => expect(where).toBe("/compare?teams=222"));
    release();
    await waitFor(() => expect(where).toBe("/compare?teams=222%2C111"));
  });

  it("if the comparison fails, the chosen teams can still be removed", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } }));
    page("/compare?teams=1,2,3,4");
    const chosen = within(screen.getByLabelText("Chosen teams"));
    fireEvent.click(chosen.getByRole("button", { name: "Remove 3" }));
    expect(where).toBe("/compare?teams=1%2C2%2C4");
  });

  it("four teams: the search says why it's off", () => {
    page("/compare?teams=1,2,3,4");
    const box = screen.getByRole("combobox", { name: "Add a team to compare" });
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(box.getAttribute("placeholder")).toMatch(/remove one/);
  });

  it("the brief is closed until asked for, opens into ?brief=1 and shows the generator's sentences with their sources", async () => {
    page("/compare?teams=4215,6980");
    const toggle = await screen.findByRole("button", { name: "Show brief" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/^Sample size:/)).toBeNull();
    fireEvent.click(toggle);
    expect(where).toBe("/compare?teams=4215%2C6980&brief=1");
    const hide = screen.getByRole("button", { name: "Hide brief" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    const panel = within(document.getElementById(hide.getAttribute("aria-controls")!)!);
    // Each sentence on the page is exactly the generator's, from the same Compare data.
    const expected = compareBrief(view([team(4215, 100, 8), team(6980, 90, 9)]));
    const items = panel.getAllByRole("listitem");
    expect(items).toHaveLength(expected.length);
    expected.forEach((s, i) => expect(items[i].textContent).toContain(`${s.topic}: ${s.text}`));
    for (const s of expected) for (const x of s.sources) expect(panel.getAllByRole("link", { name: x.label }).some((a) => a.getAttribute("href") === x.href)).toBe(true);
    expect(panel.getByText(/fewer than 5 matches aren't compared/)).toBeTruthy();
    fireEvent.click(hide);
    expect(where).toBe("/compare?teams=4215%2C6980");
  });

  it("Copy brief puts plain text with full source links on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    page("/compare?teams=4215,6980&brief=1");
    fireEvent.click(await screen.findByRole("button", { name: "Copy brief" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toMatch(/^Comparison brief: 4215 and 6980, 2025–26\n\nSample size: In 2025–26, 4215 played 10 matches/);
    expect(text).toContain(`${location.origin}/teams/4215?season=2025`);
    expect(text).not.toMatch(/<[a-z]/);
  });
});
