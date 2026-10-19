// @vitest-environment jsdom
// Where shared pick list work stands (audit E4): Draft, Saving, Saved and Needs attention on each note and on
// the list's order; a change whose answer was lost is checked against the list before anything is said; a
// teammate's newer note is never replaced by an older draft; order changes that didn't go through are kept
// (with Retry and Discard) instead of dropped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PickList } from "../../shared/picklist";
import type { ShortlistTeam } from "../../shared/api";
import { announcePicklist, NOTE_UNCONFIRMED, resetFailedChanges } from "../../lib/sharedPicklist";
import { allPending, isClaimed, SAVED_SHOW_MS } from "../../lib/pendingWork";
import { SharedPicklist } from "./SharedPicklist";

const S = 2025;
const team = (n: number): ShortlistTeam => ({
  team: n, name: `Team ${n} name`, place: "Sydney", opr: 50, oprRank: 10, of: 500, rating: null, ratingSd: null, record: "8-2-0",
  lastEvent: null, nextEvent: null, breakdown: { auto: null, teleop: null, endgame: null, event: null }, events: [],
});
const pick = (n: number, rank: number, over: Partial<PickList["picks"][number]> = {}) => ({
  team: n, rank, addedBy: { accountId: 1, name: "Priya" }, addedAt: Date.now() - 60_000, note: "", noteBy: null, noteUpdatedAt: null, ...over,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let server: PickList;
let posts: Record<string, unknown>[];
/** The next N posts are applied, then their answer is lost (a dropped connection). */
let loseAnswers = 0;
/** The next N posts are lost before they arrive (never applied, no answer). */
let dropPosts = 0;
/** The list can't be read (the check after a lost answer fails too). */
let getsFail = false;
/** Note posts wait until release() (then answer as usual). */
let hold = false;
/** Every post waits until releaseAll() (then goes on as usual). */
let holdAll = false;
let releaseAll: () => void = () => undefined;
/** The time of each note the server wrote, in order. */
let noteTimes: number[] = [];
let release: () => void = () => undefined;

function applyOnServer(body: Record<string, unknown>): Response {
  if (body.op === "note") {
    const at = server.picks.find((p) => p.team === body.team)!;
    if (body.base !== undefined && at.note !== body.note && (at.noteUpdatedAt ?? null) !== body.base) {
      return json(409, { error: "A teammate changed this note since yours was written, so yours wasn't saved over it.", list: server });
    }
    const t = Math.max(Date.now(), (at.noteUpdatedAt ?? 0) + 1);
    noteTimes.push(t);
    server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === body.team ? { ...p, note: String(body.note), noteBy: { accountId: 1, name: "Priya" }, noteUpdatedAt: t } : p)) };
  } else if (body.op === "move") {
    const teams = server.picks.map((p) => p.team).filter((t) => t !== body.team);
    teams.splice(body.beforeTeam == null ? teams.length : teams.indexOf(body.beforeTeam as number), 0, body.team as number);
    server = { ...server, version: server.version + 1, picks: teams.map((t, i) => ({ ...server.picks.find((p) => p.team === t)!, rank: i + 1 })) };
  }
  return json(200, { changed: true, list: server });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  resetFailedChanges();
  posts = []; noteTimes = []; holdAll = false; loseAnswers = 0; dropPosts = 0; getsFail = false; hold = false;
  server = { workspaceId: "901", season: S, version: 3, picks: [pick(101, 1, { note: "Strong auto", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: Date.now() - 120_000 }), pick(102, 2)] };
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/scout/workspaces/901/picklist")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        if (hold && body.op === "note") await new Promise<void>((r) => { release = r; });
        if (holdAll) await new Promise<void>((r) => { releaseAll = r; });
        if (dropPosts > 0) { dropPosts--; throw new TypeError("Failed to fetch"); }
        const res = applyOnServer(body);
        if (loseAnswers > 0) { loseAnswers--; throw new TypeError("Failed to fetch"); }
        return res;
      }
      if (getsFail) throw new TypeError("Failed to fetch");
      return json(200, { list: server });
    }
    if (path.startsWith("/api/shortlist")) return json(200, { season: S, teams: [team(101), team(102)] });
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const rows = () => [...document.querySelectorAll("[data-reorder-key]")].map((e) => Number(e.getAttribute("data-reorder-key")));
const noteInput = (t: number) => document.querySelector<HTMLInputElement>(`input[data-note="${t}"]`)!;
const row = (t: number) => document.querySelector<HTMLElement>(`[data-reorder-key="${t}"]`)!;
/** The note's state, as its status shows it (null: nothing to say). */
const noteState = (t: number) => row(t).querySelector("[aria-live][data-save-state]")?.getAttribute("data-save-state") ?? null;
/** The list order's state (the status outside the rows). */
const orderState = () => [...document.querySelectorAll("[aria-live][data-save-state]")].find((e) => !e.closest("[data-reorder-key]"))?.getAttribute("data-save-state") ?? null;
const notePosts = () => posts.filter((p) => p.op === "note");

function show(me = { accountId: 1, name: "Priya" }) {
  return render(<MemoryRouter><SharedPicklist workspaceId="901" workspaceName="Gearheads" season={S} live="off" me={me} shortlist={[]} /></MemoryRouter>);
}
async function ready() { show(); await waitFor(() => expect(rows()).toEqual([101, 102])); }

describe("a shared note's state", () => {
  it("goes Draft (typed, in the save pause) → Saving → Saved → quiet, and says each change politely", async () => {
    await ready();
    expect(noteState(102)).toBeNull();
    hold = true;
    fireEvent.focus(noteInput(102));
    fireEvent.change(noteInput(102), { target: { value: "Fast cycles" } });
    expect(noteState(102)).toBe("draft");
    expect(row(102).querySelector("[aria-live]")!.getAttribute("aria-live")).toBe("polite");
    expect(row(102).querySelector("[aria-live]")!.textContent).toBe("Note on 102: Draft");
    fireEvent.keyDown(noteInput(102), { key: "Enter" });
    await waitFor(() => expect(notePosts()).toHaveLength(1));
    expect(noteState(102)).toBe("saving");
    release();
    await waitFor(() => expect(noteState(102)).toBe("saved"));
    expect(row(102).querySelector("[aria-live]")!.textContent).toBe("Note on 102: Saved");
    await waitFor(() => expect(noteState(102)).toBeNull(), { timeout: SAVED_SHOW_MS + 1000 });
  });

  it("Needs attention when it didn't go; Retry takes it back through Saving to Saved", async () => {
    await ready();
    dropPosts = 1; getsFail = true; // lost before it arrived, and the check can't read the list either
    fireEvent.focus(noteInput(102));
    fireEvent.change(noteInput(102), { target: { value: "Fast cycles" } });
    fireEvent.keyDown(noteInput(102), { key: "Enter" });
    await waitFor(() => expect(noteState(102)).toBe("attention"));
    // Unknown outcome: not "failed" or "offline", it couldn't be confirmed.
    expect(within(row(102)).getByText(NOTE_UNCONFIRMED, { exact: false })).toBeTruthy();
    expect(row(102).textContent).not.toMatch(/offline/i);
    getsFail = false;
    fireEvent.click(within(row(102)).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(noteState(102)).toBe("saved"));
    expect(server.picks[1].note).toBe("Fast cycles");
    expect(notePosts()).toHaveLength(2);
    expect(notePosts()[1].base).toBe(notePosts()[0].base); // the retry keeps the note it was written over
  });

  it("an answer lost after the server took it is reconciled from the list: Saved, never a failure or a second send", async () => {
    await ready();
    loseAnswers = 1;
    fireEvent.focus(noteInput(102));
    fireEvent.change(noteInput(102), { target: { value: "Fast cycles" } });
    fireEvent.keyDown(noteInput(102), { key: "Enter" });
    await waitFor(() => expect(noteState(102)).toBe("saved"));
    expect(notePosts()).toHaveLength(1);
    expect(screen.queryByText(/Not saved/)).toBeNull();
    expect(localStorage.getItem("cs-picknote:1:901:2025:102")).toBeNull(); // its kept copy is done with
  });

  it("Discard drops an unsaved note without sending anything, and the saved one shows again", async () => {
    await ready();
    dropPosts = 1; getsFail = true;
    fireEvent.focus(noteInput(101));
    fireEvent.change(noteInput(101), { target: { value: "Mine" } });
    fireEvent.keyDown(noteInput(101), { key: "Enter" });
    await waitFor(() => expect(noteState(101)).toBe("attention"));
    fireEvent.click(within(row(101)).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(noteInput(101).value).toBe("Strong auto"));
    expect(noteState(101)).toBeNull();
    expect(notePosts()).toHaveLength(1);
    expect(localStorage.getItem("cs-picknote:1:901:2025:101")).toBeNull();
  });
});

describe("a teammate's newer note", () => {
  it("Keep theirs, pressed mid-edit of the unsaved note, sends nothing (the edit is let go with it)", async () => {
    await ready();
    fireEvent.focus(noteInput(101));
    fireEvent.change(noteInput(101), { target: { value: "My older take" } });
    server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === 101 ? { ...p, note: "Lift fixed at QF", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: Date.now() + 10 } : p)) };
    act(() => announcePicklist(server));
    fireEvent.keyDown(noteInput(101), { key: "Enter" });
    await waitFor(() => expect(noteState(101)).toBe("attention"));
    // The member edits again, then (within the save pause) chooses Keep theirs: by mouse, and by keyboard focus.
    fireEvent.focus(noteInput(101));
    fireEvent.change(noteInput(101), { target: { value: "My older take, edited" } });
    const keep = within(row(101)).getByRole("button", { name: "Keep theirs" });
    fireEvent.mouseDown(keep);
    fireEvent.blur(noteInput(101), { relatedTarget: keep });
    fireEvent.click(keep);
    await waitFor(() => expect(noteInput(101).value).toBe("Lift fixed at QF"));
    await new Promise((r) => setTimeout(r, 800)); // past the save pause
    expect(notePosts()).toHaveLength(1);
    expect(server.picks[0].note).toBe("Lift fixed at QF");
  });

  it("is never overwritten by an edit begun before it arrived: the note goes up with its base, and the field asks", async () => {
    await ready();
    const before = server.picks[0].noteUpdatedAt;
    fireEvent.focus(noteInput(101));
    fireEvent.change(noteInput(101), { target: { value: "My older take" } });
    // Marcus's note lands (and reaches this device) while this member is still typing.
    server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === 101 ? { ...p, note: "Lift fixed at QF", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: Date.now() + 10 } : p)) };
    act(() => announcePicklist(server));
    fireEvent.keyDown(noteInput(101), { key: "Enter" });
    await waitFor(() => expect(noteState(101)).toBe("attention"));
    expect(notePosts()[0]).toMatchObject({ note: "My older take", base: before });
    expect(server.picks[0].note).toBe("Lift fixed at QF"); // his note stands
    expect(within(row(101)).getByText(/Marcus changed this note/)).toBeTruthy();
    expect(within(row(101)).getByRole("button", { name: "Keep theirs" })).toBeTruthy();
    // Keep theirs: nothing sent, his note shows.
    fireEvent.click(within(row(101)).getByRole("button", { name: "Keep theirs" }));
    await waitFor(() => expect(noteInput(101).value).toBe("Lift fixed at QF"));
    expect(notePosts()).toHaveLength(1);
  });

  it("a note seen before the edit began is simply written over (the member saw it)", async () => {
    await ready();
    server = { ...server, version: server.version + 1, picks: server.picks.map((p) => (p.team === 101 ? { ...p, note: "Lift fixed at QF", noteBy: { accountId: 2, name: "Marcus" }, noteUpdatedAt: Date.now() + 10 } : p)) };
    act(() => announcePicklist(server));
    await waitFor(() => expect(noteInput(101).value).toBe("Lift fixed at QF"));
    fireEvent.focus(noteInput(101));
    fireEvent.change(noteInput(101), { target: { value: "Lift fixed, but slow" } });
    fireEvent.keyDown(noteInput(101), { key: "Enter" });
    await waitFor(() => expect(server.picks[0].note).toBe("Lift fixed, but slow"));
  });

  it("this member's own notes, one written while the last was on its way, never conflict with each other", async () => {
    await ready();
    hold = true;
    fireEvent.focus(noteInput(102));
    fireEvent.change(noteInput(102), { target: { value: "First" } });
    fireEvent.keyDown(noteInput(102), { key: "Enter" });
    await waitFor(() => expect(notePosts()).toHaveLength(1));
    fireEvent.focus(noteInput(102));
    fireEvent.change(noteInput(102), { target: { value: "Second" } });
    fireEvent.keyDown(noteInput(102), { key: "Enter" });
    hold = false;
    release();
    await waitFor(() => expect(server.picks[1].note).toBe("Second"));
    expect(noteState(102)).not.toBe("attention");
    // The second went over the note the first made, not the one both were begun over.
    expect(notePosts()[0].base).toBeNull();
    expect(notePosts()[1].base).toBe(noteTimes[0]);
  });
});

describe("an order change", () => {
  it("shows Saving, then Saved", async () => {
    await ready();
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" });
    await waitFor(() => expect(orderState()).toBe("saved"));
  });

  it("whose answer was lost but the list shows it: Saved, nothing kept", async () => {
    await ready();
    loseAnswers = 1;
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" });
    await waitFor(() => expect(orderState()).toBe("saved"));
    expect(server.picks.map((p) => p.team)).toEqual([102, 101]);
    expect(posts.filter((p) => p.op === "move")).toHaveLength(1);
    expect(allPending()).toEqual([]);
  });

  it("that didn't arrive is kept (Needs attention) for Retry or Discard, never dropped without a word", async () => {
    await ready();
    dropPosts = 1;
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" });
    await waitFor(() => expect(orderState()).toBe("attention"));
    expect(screen.getByText("1 change not saved")).toBeTruthy();
    await waitFor(() => expect(rows()).toEqual([101, 102])); // the list as the workspace has it
    const [item] = allPending();
    expect(item).toMatchObject({ kind: "order", account: 1, workspaceId: "901", season: S, team: 102, label: "Move 102 in the pick list", status: "attention" });
    act(() => item.retry!());
    await waitFor(() => expect(server.picks.map((p) => p.team)).toEqual([102, 101]));
    await waitFor(() => expect(orderState()).toBe("saved"));
    expect(allPending()).toEqual([]);
  });

  it("survives closing the list (switching view, workspace or season), and Retry sends it to its own workspace and season", async () => {
    const view = show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    dropPosts = 1;
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" });
    await waitFor(() => expect(allPending()).toHaveLength(1));
    view.unmount();
    expect(allPending()).toHaveLength(1);
    act(() => allPending()[0].retry!());
    await waitFor(() => expect(allPending()).toEqual([]));
    expect(posts.filter((p) => p.op === "move").at(-1)).toEqual({ season: S, op: "move", team: 102, beforeTeam: 101 });
    expect(server.picks.map((p) => p.team)).toEqual([102, 101]);
  });

  it("a Retry still on its way never lands after a newer change and undoes it: they go one at a time, in order", async () => {
    await ready();
    dropPosts = 1;
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" }); // [102, 101], not sent
    await waitFor(() => expect(allPending()).toHaveLength(1));
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    holdAll = true;
    act(() => allPending()[0].retry!()); // 102 before 101, on its way (held)
    await waitFor(() => expect(posts.filter((p) => p.op === "move")).toHaveLength(2));
    expect(allPending()[0].busy).toBe(true);
    // Meanwhile the member makes a newer change: it waits behind the Retry instead of racing it.
    fireEvent.click(within(row(101)).getByRole("button", { name: "Remove 101" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(posts.at(-1)).toMatchObject({ op: "move", team: 102 });
    holdAll = false;
    releaseAll();
    await waitFor(() => expect(posts.at(-1)).toMatchObject({ op: "remove", team: 101 }));
    releaseAll();
    expect(posts.map((p) => p.op)).toEqual(["move", "move", "remove"]);
  });

  it("discarded while its Retry is on its way: a failed Retry doesn't bring it back", async () => {
    await ready();
    dropPosts = 1;
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" });
    await waitFor(() => expect(allPending()).toHaveLength(1));
    holdAll = true; dropPosts = 1; getsFail = true;
    act(() => allPending()[0].retry!());
    await waitFor(() => expect(allPending()[0]?.busy).toBe(true));
    act(() => allPending()[0].discard!());
    expect(allPending()).toEqual([]);
    holdAll = false;
    releaseAll();
    await new Promise((r) => setTimeout(r, 50));
    expect(allPending()).toEqual([]);
  });

  it("Discard lets a kept change go", async () => {
    await ready();
    dropPosts = 1;
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" });
    await waitFor(() => expect(allPending()).toHaveLength(1));
    act(() => allPending()[0].discard!());
    await waitFor(() => expect(allPending()).toEqual([]));
    expect(orderState()).toBeNull();
    expect(posts.filter((p) => p.op === "move")).toHaveLength(1);
  });
});

describe("kept notes and the recoverable view", () => {
  it("an open list claims its scope (it handles its kept notes); a read-only one doesn't, so the view keeps them listed", async () => {
    const view = show();
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    expect(isClaimed("1:901:2025")).toBe(true);
    view.unmount();
    expect(isClaimed("1:901:2025")).toBe(false);
    render(<MemoryRouter><SharedPicklist workspaceId="901" workspaceName="Gearheads" season={S} live="off" me={{ accountId: 1, name: "Priya" }} shortlist={[]} readOnly /></MemoryRouter>);
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    expect(isClaimed("1:901:2025")).toBe(false);
  });
});

describe("account isolation", () => {
  it("another account's unsaved note is never published for this one", async () => {
    show({ accountId: 2, name: "Marcus" });
    await waitFor(() => expect(rows()).toEqual([101, 102]));
    dropPosts = 1; getsFail = true;
    fireEvent.focus(noteInput(102));
    fireEvent.change(noteInput(102), { target: { value: "Marcus's" } });
    fireEvent.keyDown(noteInput(102), { key: "Enter" });
    await waitFor(() => expect(allPending()).toHaveLength(1));
    expect(allPending().every((x) => x.account === 2)).toBe(true);
  });
});
