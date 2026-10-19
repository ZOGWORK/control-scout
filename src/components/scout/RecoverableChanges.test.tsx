// @vitest-environment jsdom
// The recoverable-changes view (audit E4): shown only while the signed-in account has shared work that hasn't
// reached its workspace; each row names its team, workspace and season, with Retry and Discard (keyboard
// operable buttons); it clears itself once everything reconciles, and never lists another account's work.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { claimScope, publishPending } from "../../lib/pendingWork";
import { resetCommentAttempts } from "../../lib/commentAttempts";
import { COMMENT_NOT_ARRIVED } from "../../lib/scoutComments";
import { isScoutQueued, localScoutEntries, saveScoutEntry, syncScouting } from "../../lib/scouting";
import { RecoverableChanges } from "./RecoverableChanges";

vi.mock("../ui/sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined, warning: () => undefined }) }));

const WS = [{ id: "901", name: "Gearheads" }, { id: "902", name: "Robo Owls" }];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const THREAD = "/api/scout/workspaces/901/entries/aaaaaaaaaaaa/comments";

let list: { workspaceId: string; season: number; version: number; picks: { team: number; rank: number; note: string; noteUpdatedAt: number | null; addedBy: unknown; addedAt: number; noteBy: unknown }[] };
let posts: { path: string; body: Record<string, unknown> }[];
let thread: unknown[];
let syncDown: boolean;

beforeEach(() => {
  localStorage.clear();
  resetCommentAttempts();
  posts = []; thread = []; syncDown = false;
  list = { workspaceId: "901", season: 2025, version: 4, picks: [{ team: 102, rank: 1, note: "", noteUpdatedAt: null, addedBy: { accountId: 1, name: "Priya" }, addedAt: 1, noteBy: null }] };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (method === "POST") posts.push({ path, body });
    if (path.startsWith("/api/scout/workspaces/901/picklist")) {
      if (method === "GET") return json(200, { list });
      const at = list.picks.find((p) => p.team === body.team)!;
      if (body.base !== undefined && at.note !== body.note && at.noteUpdatedAt !== body.base) return json(409, { error: "A teammate changed this note since yours was written, so yours wasn't saved over it.", list });
      list = { ...list, version: list.version + 1, picks: list.picks.map((p) => (p.team === body.team ? { ...p, note: body.note, noteUpdatedAt: Date.now() } : p)) };
      return json(200, { changed: true, list });
    }
    if (path === THREAD) {
      if (method === "GET") return json(200, { comments: thread, entryDeleted: false });
      const made = { id: 9, workspaceId: "901", entryUuid: "aaaaaaaaaaaa", authorAccountId: 1, authorName: "Priya", body: body.body, opId: body.opId, createdAt: Date.now(), editedAt: null };
      thread = [...thread, made];
      return json(201, { action: "created", workspaceId: "901", entryUuid: "aaaaaaaaaaaa", commentId: 9, count: thread.length, rev: 10, comment: made });
    }
    if (path.startsWith("/api/me/scout/sync")) {
      if (syncDown) throw new TypeError("Failed to fetch");
      return json(200, { results: body.entries.map((e: { uuid: string }) => ({ uuid: e.uuid, ok: true })) });
    }
    if (path.startsWith("/api/scout/sync")) return json(200, { entries: [], cursor: 0, more: false });
    throw new Error(`unexpected ${method} ${path}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); publishPending("test", []); });

const keepNote = (account: number, space: string, team: number, note: string, base: number | null = null) =>
  localStorage.setItem(`cs-picknote:${account}:${space}:2025:${team}`, JSON.stringify({ note, base, at: Date.now(), wid: `w-${account}-${team}` }));
const view = () => screen.queryByRole("region", { name: /Changes not saved yet/ });
const said = () => document.querySelector("p[aria-live]")!.textContent;

describe("RecoverableChanges", () => {
  it("shows nothing while nothing is waiting", () => {
    render(<RecoverableChanges account={1} workspaces={WS} />);
    expect(view()).toBeNull();
  });

  it("lists a kept note with its team, workspace and season, and only for the account that wrote it", () => {
    keepNote(1, "901", 102, "Fast cycles");
    keepNote(2, "902", 555, "Marcus's private draft");
    const { unmount } = render(<RecoverableChanges account={1} workspaces={WS} />);
    const region = view()!;
    expect(within(region).getByRole("heading").textContent).toBe("Changes not saved yet (1)");
    expect(region.textContent).toContain("Note on 102");
    expect(region.textContent).toContain("Gearheads · 2025–26 season · team 102");
    expect(region.textContent).not.toMatch(/555|Marcus|Robo Owls/);
    unmount();
    // Marcus on the same device sees his own, never Priya's.
    render(<RecoverableChanges account={2} workspaces={WS} />);
    expect(view()!.textContent).toContain("Note on 555");
    expect(view()!.textContent).not.toContain("102");
  });

  it("signed out: nothing at all", () => {
    keepNote(1, "901", 102, "Fast cycles");
    render(<RecoverableChanges account={null} workspaces={WS} />);
    expect(view()).toBeNull();
  });

  it("Retry sends a kept note with its base; once confirmed the view clears itself and says so", async () => {
    keepNote(1, "901", 102, "Fast cycles");
    render(<RecoverableChanges account={1} workspaces={WS} />);
    await waitFor(() => expect(said()).toBe(""));
    fireEvent.click(within(view()!).getByRole("button", { name: "Retry: Note on 102" }));
    await waitFor(() => expect(view()).toBeNull());
    expect(posts.map((p) => p.body)).toEqual([{ season: 2025, op: "note", team: 102, note: "Fast cycles", base: null }]);
    expect(list.picks[0].note).toBe("Fast cycles");
    expect(localStorage.getItem("cs-picknote:1:901:2025:102")).toBeNull();
    await waitFor(() => expect(said()).toBe("All changes are saved."));
  });

  it("never sends a kept note over a teammate's newer one: it stays, and says why", async () => {
    keepNote(1, "901", 102, "My older note", null);
    list = { ...list, picks: list.picks.map((p) => ({ ...p, note: "Marcus's newer note", noteUpdatedAt: Date.now() })) };
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(within(view()!).getByRole("button", { name: "Retry: Note on 102" }));
    await waitFor(() => expect(view()!.textContent).toMatch(/A teammate changed this note after you wrote yours/));
    expect(list.picks[0].note).toBe("Marcus's newer note");
    expect(localStorage.getItem("cs-picknote:1:901:2025:102")).not.toBeNull();
  });

  it("Discard asks first, then lets it go without sending anything", async () => {
    keepNote(1, "901", 102, "Fast cycles");
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(within(view()!).getByRole("button", { name: "Discard: Note on 102" }));
    expect(within(view()!).getByText("Discard this change?")).toBeTruthy();
    fireEvent.click(within(view()!).getByRole("button", { name: "Keep it" }));
    expect(view()!.textContent).toContain("Note on 102");
    fireEvent.click(within(view()!).getByRole("button", { name: "Discard: Note on 102" }));
    fireEvent.click(within(view()!).getByRole("button", { name: /^Discard$/ }));
    await waitFor(() => expect(view()).toBeNull());
    expect(posts).toEqual([]);
    expect(localStorage.getItem("cs-picknote:1:901:2025:102")).toBeNull();
  });

  it("leaves a note to the open pick list that handles it (no Retry offered twice)", () => {
    keepNote(1, "901", 102, "Fast cycles");
    let release = () => {};
    act(() => { release = claimScope("1:901:2025"); });
    render(<RecoverableChanges account={1} workspaces={WS} />);
    expect(view()).toBeNull();
    act(() => release());
    expect(view()).not.toBeNull();
  });

  it("lists what other sources publish, for this account only, with their own Retry and Discard", () => {
    const retry = vi.fn(), discard = vi.fn();
    act(() => publishPending("test", [
      { key: "order:1", account: 1, kind: "order", workspaceId: "902", season: 2025, team: 7, label: "Move 7 in the pick list", status: "attention", message: "Not saved: paused.", retry, discard },
      { key: "order:2", account: 2, kind: "order", workspaceId: "902", season: 2025, team: 8, label: "Move 8 in the pick list", status: "attention", message: "Not saved.", retry, discard },
    ]));
    render(<RecoverableChanges account={1} workspaces={WS} />);
    expect(view()!.textContent).toContain("Move 7 in the pick list");
    expect(view()!.textContent).toContain("Robo Owls · 2025–26 season · team 7");
    expect(view()!.textContent).not.toContain("Move 8");
    fireEvent.click(within(view()!).getByRole("button", { name: "Retry: Move 7 in the pick list" }));
    expect(retry).toHaveBeenCalledOnce();
    act(() => publishPending("test", []));
    expect(view()).toBeNull();
  });
});

describe("RecoverableChanges: comments", () => {
  const keepComment = (account: number, opId: string) => localStorage.setItem(`cs-comment-try:${account}:901:aaaaaaaaaaaa`,
    JSON.stringify({ body: "Watch their lift", opId, at: Date.now(), season: 2025, team: 18360, what: "Comment on 18360 · Match Q1" }));

  it("after a reload, one the thread already has (the answer was lost) is reconciled away: never shown as failed", async () => {
    keepComment(1, "op-abcdefgh1");
    thread = [{ id: 5, workspaceId: "901", entryUuid: "aaaaaaaaaaaa", authorAccountId: 1, authorName: "Priya", body: "Watch their lift", opId: "op-abcdefgh1", createdAt: Date.now(), editedAt: null }];
    render(<RecoverableChanges account={1} workspaces={WS} />);
    await waitFor(() => expect(localStorage.getItem("cs-comment-try:1:901:aaaaaaaaaaaa")).toBeNull());
    expect(view()).toBeNull();
    expect(posts).toEqual([]);
  });

  it("one the thread doesn't have waits for the member; Retry sends the same attempt and the view clears", async () => {
    keepComment(1, "op-abcdefgh2");
    keepComment(2, "op-someone-else");
    render(<RecoverableChanges account={1} workspaces={WS} />);
    await waitFor(() => expect(view()!.textContent).toContain(COMMENT_NOT_ARRIVED));
    expect(view()!.textContent).toContain("Comment on 18360 · Match Q1");
    expect(view()!.querySelectorAll("li")).toHaveLength(1); // account 2's attempt isn't read
    fireEvent.click(within(view()!).getByRole("button", { name: "Retry: Comment on 18360 · Match Q1" }));
    await waitFor(() => expect(view()).toBeNull());
    expect(posts.map((p) => p.body)).toEqual([{ body: "Watch their lift", opId: "op-abcdefgh2" }]);
  });
});

describe("RecoverableChanges: queued entries", () => {
  const base = { season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: {}, notes: "" };

  it("an entry whose push didn't go through is listed; Retry syncs it and the view clears", async () => {
    saveScoutEntry({ uuid: "bbbbbbbbbbbb", ...base, workspaceId: "901" });
    syncDown = true;
    await syncScouting("901").catch(() => undefined);
    render(<RecoverableChanges account={1} workspaces={WS} />);
    expect(view()!.textContent).toContain("Entry 18360 · Match Q1");
    expect(view()!.textContent).toMatch(/Couldn't confirm it reached the workspace/);
    syncDown = false;
    fireEvent.click(within(view()!).getByRole("button", { name: "Retry: Entry 18360 · Match Q1" }));
    await waitFor(() => expect(view()).toBeNull());
    expect(isScoutQueued({ uuid: "bbbbbbbbbbbb", workspaceId: "901" })).toBe(false);
  });

  it("an entry queued but on its way isn't listed (its card says Syncing)", () => {
    saveScoutEntry({ uuid: "cccccccccccc", ...base, workspaceId: "901" });
    render(<RecoverableChanges account={1} workspaces={WS} />);
    expect(view()).toBeNull();
  });

  it("Discard lets a never-synced entry go from the queue and the device", async () => {
    saveScoutEntry({ uuid: "dddddddddddd", ...base, workspaceId: "901" });
    localStorage.setItem("cs-scout-ws-cursor:901", "57");
    syncDown = true;
    await syncScouting("901").catch(() => undefined);
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(within(view()!).getByRole("button", { name: "Discard: Entry 18360 · Match Q1" }));
    fireEvent.click(within(view()!).getByRole("button", { name: /^Discard$/ }));
    await waitFor(() => expect(view()).toBeNull());
    expect(localScoutEntries("901").map((e) => e.uuid)).not.toContain("dddddddddddd");
    // Pulled again from the start: had it reached the server with its answer lost, its copy comes back.
    expect(localStorage.getItem("cs-scout-ws-cursor:901")).toBeNull();
  });

  it("offline: listed calmly as waiting (it goes up by itself)", async () => {
    saveScoutEntry({ uuid: "eeeeeeeeeeee", ...base, workspaceId: "901" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await syncScouting("901").catch(() => undefined);
    render(<RecoverableChanges account={1} workspaces={WS} />);
    expect(view()!.textContent).toContain("Waiting for a connection");
    expect(view()!.className).not.toMatch(/warning/);
    vi.restoreAllMocks();
  });
});
