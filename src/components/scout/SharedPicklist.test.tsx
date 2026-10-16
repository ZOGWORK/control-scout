// @vitest-environment jsdom
// The shared pick list view (Task 11): the Shortlist's rows with inline OPR and world rank, the shared
// note with who wrote it, a change shown at once and sent as a team-naming operation, another member's
// change arriving live, and a refused change (409) answered by a refetch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PickList } from "../../shared/picklist";
import type { ShortlistTeam } from "../../shared/api";
import { announcePicklist, announcePicklistResync } from "../../lib/sharedPicklist";
import { SharedPicklist } from "./SharedPicklist";

const S = 2025;
const team = (n: number, opr: number, rank: number): ShortlistTeam => ({
  team: n, name: `Team ${n} name`, place: "Sydney", opr, oprRank: rank, of: 500, rating: null, ratingSd: null, record: "8-2-0",
  lastEvent: null, nextEvent: null, breakdown: { auto: null, teleop: null, endgame: null, event: null }, events: [],
});
const pick = (n: number, rank: number, over: Partial<PickList["picks"][number]> = {}) => ({
  team: n, rank, addedBy: { accountId: 1, name: "Priya" }, addedAt: Date.now() - 60_000, note: "", noteBy: null, noteUpdatedAt: null, ...over,
});

let server: PickList;
let posts: Record<string, unknown>[] = [];
let refuseNext = false;
let gets = 0;
let statsDown = false;
let notesDown = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  posts = []; refuseNext = false; gets = 0; statsDown = false; notesDown = false;
  server = {
    workspaceId: "901", season: S, version: 3,
    picks: [pick(101, 1, { note: "Strong auto", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: Date.now() - 120_000 }), pick(102, 2)],
  };
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/scout/workspaces/901/picklist")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        if (notesDown && body.op === "note") return json(503, { error: "Workspace scouting is paused right now." });
        if (refuseNext) { refuseNext = false; return json(409, { error: "That team was removed from the pick list meanwhile.", list: server }); }
        return json(200, { changed: true, list: { ...server, version: server.version + 1 } });
      }
      gets++;
      return json(200, { list: server });
    }
    if (path.startsWith("/api/shortlist")) {
      await new Promise((r) => setTimeout(r, 20));
      if (statsDown) return json(500, { error: "Stats are down" });
      const asked = new URLSearchParams(path.split("?")[1]).get("teams")!.split(",").map(Number);
      return json(200, { season: S, teams: [team(101, 80, 3), team(102, 61.5, 40), team(103, 50, 90), team(104, 45, 120)].filter((t) => asked.includes(t.team)) });
    }
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const rows = () => [...document.querySelectorAll("[data-reorder-key]")].map((e) => Number(e.getAttribute("data-reorder-key")));

function show() {
  return render(
    <MemoryRouter>
      <SharedPicklist workspaceId="901" workspaceName="Gearheads" season={S} live="off" me={{ accountId: 1, name: "Priya" }} shortlist={[18360, 101]} />
    </MemoryRouter>,
  );
}

describe("SharedPicklist", () => {
  it("shows each pick with inline OPR and world rank, and the shared note with who wrote it", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    const first = document.querySelector<HTMLElement>('[data-reorder-key="101"]')!;
    expect(within(first).getByText("80")).toBeTruthy();
    expect(within(first).getByText("#3")).toBeTruthy();
    expect(within(first).getByDisplayValue("Strong auto")).toBeTruthy();
    expect(within(first).getByText(/Added by you · note by Marcus · 2m ago/)).toBeTruthy();
    expect(within(document.querySelector<HTMLElement>('[data-reorder-key="102"]')!).getByText("#40")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy from my shortlist \(1\)/ })).toBeTruthy();
  });

  it("a keyboard reorder shows at once and goes up as a move naming the team it lands before", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" });
    await waitFor(() => expect(rows()).toEqual([102, 101]));
    await waitFor(() => expect(posts).toEqual([{ season: S, op: "move", team: 102, beforeTeam: 101 }]));
  });

  it("another member's change arrives live and replaces the list (an older version never does)", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    act(() => announcePicklist({ ...server, version: 5, picks: [pick(102, 1), pick(101, 2), pick(18360, 3, { addedBy: { accountId: 2, name: "Marcus" } })] }));
    await waitFor(() => expect(rows()).toEqual([102, 101]));
    act(() => announcePicklist({ ...server, version: 4 }));
    expect(rows()).toEqual([102, 101]);
    act(() => announcePicklist({ ...server, workspaceId: "other", version: 9, picks: [] }));
    expect(rows()).toEqual([102, 101]);
  });

  it("a team someone else adds doesn't take the rows already shown off screen (a note being typed keeps its field)", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    const input = document.querySelector<HTMLInputElement>('input[data-note="101"]')!;
    input.focus();
    act(() => announcePicklist({ ...server, version: 5, picks: [...server.picks, pick(103, 3)] }));
    expect(document.body.contains(input)).toBe(true);
    await waitFor(() => expect(rows()).toEqual([101, 102, 103]));
    expect(document.body.contains(input)).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("a pick whose stats failed to load says so with a Retry, beside the rows already shown", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    statsDown = true;
    act(() => announcePicklist({ ...server, version: 5, picks: [...server.picks, pick(104, 3)] }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn't load team 104: Stats are down/);
    expect(rows()).toEqual([101, 102]);
    // The picks on screen still reorder; numbers and moves go by the whole list (104 still loading counts).
    act(() => announcePicklist({ ...server, version: 6, picks: [pick(104, 1), ...server.picks.map((p) => ({ ...p, rank: p.rank + 1 }))] }));
    await waitFor(() => expect(within(document.querySelector<HTMLElement>('[data-reorder-key="101"]')!).getByLabelText("Pick 2")).toBeTruthy());
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 101/ }), { key: "Home" });
    await waitFor(() => expect(posts.at(-1)).toEqual({ season: S, op: "move", team: 101, beforeTeam: 104 }));
    statsDown = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(rows()).toContain(104));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the space switcher's manual refresh fetches the list again", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    const before = gets;
    act(() => announcePicklistResync("other"));
    act(() => announcePicklistResync("901"));
    await waitFor(() => expect(gets).toBe(before + 1));
  });

  it("a note the server didn't take keeps its text, marked unsaved, and Enter tries again", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    const input = document.querySelector<HTMLInputElement>('input[data-note="102"]')!;
    notesDown = true;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Fast cycles" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(within(input.closest("li")!).getByText(/Not saved\. Your text is still here/)).toBeTruthy());
    expect(input.value).toBe("Fast cycles");
    notesDown = false;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(posts.filter((p) => p.op === "note")).toHaveLength(2));
    expect(posts.at(-1)).toEqual({ season: S, op: "note", team: 102, note: "Fast cycles" });
  });

  it("a refused change (409) is dropped and the list fetched again", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    const before = gets;
    refuseNext = true;
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-reorder-key="102"]')!).getByRole("button", { name: "Remove 102" }));
    await waitFor(() => expect(posts).toEqual([{ season: S, op: "remove", team: 102 }]));
    await waitFor(() => expect(gets).toBeGreaterThan(before));
    await waitFor(() => expect(rows()).toEqual([101, 102]));
  });
});
