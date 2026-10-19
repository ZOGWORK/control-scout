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
let failNextNoteSlowly = false;
/** Note posts never answer (a slow server: the page is reloaded while they're on their way). */
let hangNotes = false;
/** Note posts wait until releaseNotes() (then answer as usual). */
let holdNotes = false;
let releaseNotes: () => void = () => undefined;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  posts = []; refuseNext = false; gets = 0; statsDown = false; notesDown = false; failNextNoteSlowly = false; hangNotes = false; holdNotes = false;
  server = {
    workspaceId: "901", season: S, version: 3,
    picks: [pick(101, 1, { note: "Strong auto", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: Date.now() - 120_000 }), pick(102, 2)],
  };
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/scout/workspaces/901/picklist")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        if (hangNotes && body.op === "note") return new Promise<Response>(() => {});
        if (holdNotes && body.op === "note") await new Promise<void>((r) => { releaseNotes = r; });
        if (failNextNoteSlowly && body.op === "note") {
          failNextNoteSlowly = false;
          await new Promise((r) => setTimeout(r, 60));
          return json(503, { error: "Busy" });
        }
        if (notesDown && body.op === "note") return json(503, { error: "Workspace scouting is paused right now." });
        if (refuseNext) { refuseNext = false; return json(409, { error: "That team was removed from the pick list meanwhile.", list: server }); }
        if (body.op === "note") {
          // As the server does: a note sent with a base that a newer note replaced is refused; otherwise it's written.
          const at = server.picks.find((p) => p.team === body.team);
          if (at && body.base !== undefined && at.note !== body.note && (at.noteUpdatedAt ?? null) !== body.base) return json(409, { error: "A teammate changed this note since yours was written, so yours wasn't saved over it.", list: server });
          server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === body.team ? { ...p, note: body.note, noteBy: { accountId: 1, name: "Priya" }, noteUpdatedAt: Date.now() } : p)) };
          return json(200, { changed: true, list: server });
        }
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

function show(me: { accountId: number | null; name: string } = { accountId: 1, name: "Priya" }) {
  return render(
    <MemoryRouter>
      <SharedPicklist workspaceId="901" workspaceName="Gearheads" season={S} live="off" me={me} shortlist={[18360, 101]} />
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
    await waitFor(() => expect(within(input.closest("li")!).getByText(/Not saved yet\. Your text is kept on this device/)).toBeTruthy());
    expect(input.value).toBe("Fast cycles");
    notesDown = false;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(posts.filter((p) => p.op === "note")).toHaveLength(2));
    expect(posts.at(-1)).toEqual({ season: S, op: "note", team: 102, note: "Fast cycles" });
  });

  it("an older note failing after a newer one was written never brings its text back", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    const input = document.querySelector<HTMLInputElement>('input[data-note="102"]')!;
    failNextNoteSlowly = true;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "B" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(posts.filter((p) => p.op === "note").map((p) => p.note)).toEqual(["A", "B"]));
    await new Promise((r) => setTimeout(r, 50));
    expect(within(input.closest("li")!).queryByText(/Not saved/)).toBeNull();
    expect(input.value).not.toBe("A");
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

// PRIVATE-F03 (audit 2026-10-18): a reload while a shared note is on its way used to lose it.
describe("SharedPicklist: a note on its way when the page reloads", () => {
  const noteInput = (team: number) => document.querySelector<HTMLInputElement>(`input[data-note="${team}"]`)!;
  const writeNote = (team: number, text: string) => {
    const input = noteInput(team);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
  };
  const notePosts = () => posts.filter((p) => p.op === "note");
  const drafts = () => { const out: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith("cs-picknote:")) out.push(k); } return out; };
  /** Write a note whose request never answers, then reload (unmount: the request is abandoned). */
  async function writeThenReload(team: number, text: string) {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    hangNotes = true;
    writeNote(team, text);
    await waitFor(() => expect(notePosts()).toHaveLength(1));
    cleanup();
    hangNotes = false;
    posts = [];
  }

  it("is kept on the device, sent again after the reload, and dropped once confirmed", async () => {
    await writeThenReload(102, "Fast cycles");
    expect(drafts()).toEqual(["cs-picknote:1:901:2025:102"]);
    show();
    await waitFor(() => expect(notePosts()).toEqual([{ season: S, op: "note", team: 102, note: "Fast cycles", base: null }]));
    await waitFor(() => expect(drafts()).toEqual([]));
    expect(noteInput(102).value).toBe("Fast cycles");
    expect(server.picks[1].note).toBe("Fast cycles");
    expect(screen.queryByText(/Not saved/)).toBeNull();
  });

  it("never replaces a teammate's newer note: shown as not saved yet, and Retry is the member's choice", async () => {
    await writeThenReload(101, "Old draft");
    const marcusAt = Date.now() + 5;
    server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === 101 ? { ...p, note: "Lift fixed at QF", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: marcusAt } : p)) };
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    const li = noteInput(101).closest("li")!;
    await waitFor(() => expect(within(li).getByText(/Not saved yet: Marcus changed this note to “Lift fixed at QF” after you wrote yours/)).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(notePosts()).toEqual([]); // nothing sent over his note
    expect(server.picks[0].note).toBe("Lift fixed at QF");
    expect(noteInput(101).value).toBe("Old draft"); // the draft is still here
    // Retry: written over his note (the one shown), so a note newer than his would still be kept.
    fireEvent.click(within(li).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(notePosts()).toEqual([{ season: S, op: "note", team: 101, note: "Old draft", base: marcusAt }]));
    await waitFor(() => expect(drafts()).toEqual([]));
    expect(server.picks[0].note).toBe("Old draft");
  });

  it("a kept draft over a teammate's note isn't sent by just focusing and leaving the field", async () => {
    await writeThenReload(101, "Old draft");
    server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === 101 ? { ...p, note: "Lift fixed at QF", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: Date.now() + 5 } : p)) };
    show();
    await waitFor(() => expect(noteInput(101)?.value).toBe("Old draft"));
    fireEvent.focus(noteInput(101));
    fireEvent.blur(noteInput(101));
    await new Promise((r) => setTimeout(r, 30));
    expect(notePosts()).toEqual([]);
    expect(server.picks[0].note).toBe("Lift fixed at QF");
    expect(screen.getByText(/Not saved yet: Marcus changed this note/)).toBeTruthy();
  });

  it("the answer to one tab's note never clears a newer draft another tab of the account kept", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    holdNotes = true;
    writeNote(102, "From this tab");
    await waitFor(() => expect(notePosts()).toHaveLength(1));
    // Meanwhile another tab writes a newer note for the same team (same account, same draft key).
    const other = { note: "From the other tab", base: null, at: Date.now(), wid: "other-tab-1" };
    localStorage.setItem("cs-picknote:1:901:2025:102", JSON.stringify(other));
    releaseNotes();
    await waitFor(() => expect(server.picks[1].note).toBe("From this tab"));
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(localStorage.getItem("cs-picknote:1:901:2025:102")!)).toEqual(other);
  });

  it("Escape on a kept draft keeps the teammate's note and drops the draft", async () => {
    await writeThenReload(101, "Old draft");
    server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === 101 ? { ...p, note: "Lift fixed at QF", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: Date.now() + 5 } : p)) };
    show();
    await waitFor(() => expect(noteInput(101)?.value).toBe("Old draft"));
    fireEvent.focus(noteInput(101));
    fireEvent.keyDown(noteInput(101), { key: "Escape" });
    await waitFor(() => expect(drafts()).toEqual([]));
    expect(noteInput(101).value).toBe("Lift fixed at QF");
    expect(server.picks[0].note).toBe("Lift fixed at QF");
  });

  it("one the server took before the reload (the list says the same) is dropped without sending", async () => {
    await writeThenReload(102, "Fast cycles");
    server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === 102 ? { ...p, note: "Fast cycles", noteBy: { accountId: 1, name: "Priya" }, noteUpdatedAt: Date.now() } : p)) };
    show();
    await waitFor(() => expect(drafts()).toEqual([]));
    expect(notePosts()).toEqual([]);
    expect(screen.queryByText(/Not saved/)).toBeNull();
  });

  it("is never shown to, or sent by, another account on this device", async () => {
    await writeThenReload(102, "Priya's draft");
    show({ accountId: 2, name: "Marcus" });
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    await new Promise((r) => setTimeout(r, 30));
    expect(noteInput(102).value).toBe("");
    expect(screen.queryByText(/Not saved/)).toBeNull();
    expect(notePosts()).toEqual([]);
    expect(drafts()).toEqual(["cs-picknote:1:901:2025:102"]); // still Priya's, for Priya
    cleanup();
    show();
    await waitFor(() => expect(notePosts()).toEqual([{ season: S, op: "note", team: 102, note: "Priya's draft", base: null }]));
  });

  it("text typed in the pause before a save is kept when the page goes away", async () => {
    show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    hangNotes = true;
    const input = noteInput(102);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Mid-pause" } });
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(drafts()).toEqual(["cs-picknote:1:901:2025:102"]);
    expect(JSON.parse(localStorage.getItem("cs-picknote:1:901:2025:102")!)).toMatchObject({ note: "Mid-pause", base: null });
  });
});

describe("SharedPicklist in a read-only space (Task 19)", () => {
  it("a note kept from before a reload is neither sent nor shown while the space is read-only, and stays kept", async () => {
    const kept = { note: "Kept draft", base: null, at: Date.now(), wid: "w-1" };
    localStorage.setItem("cs-picknote:1:901:2025:102", JSON.stringify(kept));
    render(
      <MemoryRouter>
        <SharedPicklist workspaceId="901" workspaceName="Gearheads" season={S} live="off" me={{ accountId: 1, name: "Priya" }} shortlist={[]} readOnly />
      </MemoryRouter>,
    );
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    await new Promise((r) => setTimeout(r, 30));
    expect(posts).toEqual([]);
    expect(screen.queryByText("Kept draft")).toBeNull();
    expect(screen.queryByText(/Not saved/)).toBeNull();
    expect(JSON.parse(localStorage.getItem("cs-picknote:1:901:2025:102")!)).toEqual(kept);
  });

  it("reads (picks, stats, notes) but offers nothing that changes the list, and sends nothing", async () => {
    render(
      <MemoryRouter>
        <SharedPicklist workspaceId="901" workspaceName="Gearheads" season={S} live="off" me={{ accountId: 1, name: "Priya" }} shortlist={[18360, 101]} readOnly />
      </MemoryRouter>,
    );
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    expect(screen.getByText("Strong auto")).toBeTruthy();
    expect(screen.getByText(/The workspace is read-only/)).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Add a team to the pick list" })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy from my shortlist/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reorder/ })).toBeNull();
    expect(screen.queryByLabelText(/Shared note on team/)).toBeNull();
    expect(posts).toEqual([]);
  });
});
