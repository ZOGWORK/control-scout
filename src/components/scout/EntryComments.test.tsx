// @vitest-environment jsdom
// The comment thread under an open workspace entry: author, time and "edited"; bodies as plain text;
// Edit only on your own, Delete on your own (or anyone's, for an admin); posting; a live comment from
// someone else appearing; nothing for Personal entries or entries not synced yet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ScoutEntry } from "../../lib/scouting";
import type { CommentEvent, EntryComment } from "../../shared/comments";

const h = vi.hoisted(() => ({ role: "member" as "admin" | "member" }));
vi.mock("../../lib/personal", () => ({
  usePersonal: () => ({ user: { id: 1, controlPoint: { accountId: 7, workspaces: [{ id: "41", name: "Gearheads", role: h.role }] } } }),
}));
const { EntryComments } = await import("./EntryComments");
const { announceComment } = await import("../../lib/scoutComments");

const entry = (over: Partial<ScoutEntry> = {}): ScoutEntry => ({
  uuid: "aaaaaaaaaaaa", workspaceId: "41", season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: {}, notes: "",
  updatedAt: 1000, authorAccountId: 8, authorDisplayName: "Marcus", ...over,
});
const c = (id: number, over: Partial<EntryComment> = {}): EntryComment => ({
  id, workspaceId: "41", entryUuid: "aaaaaaaaaaaa", authorAccountId: 7, authorName: "Priya", body: `comment ${id}`, createdAt: Date.now() - 120_000, editedAt: null, ...over,
});
const THREAD = "/api/scout/workspaces/41/entries/aaaaaaaaaaaa/comments";

let thread: EntryComment[] = [];
const posted: unknown[] = [];
beforeEach(() => {
  h.role = "member";
  posted.length = 0;
  thread = [c(1), c(2, { authorAccountId: 9, authorName: "Coach", body: "<b>not bold</b>\nsecond line", editedAt: Date.now() - 60_000 })];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === THREAD) return new Response(JSON.stringify({ comments: thread, entryDeleted: false }), { status: 200 });
    if (method === "POST" && url === THREAD) {
      const body = JSON.parse(String(init!.body)).body;
      posted.push(body);
      const e: CommentEvent = { action: "created", workspaceId: "41", entryUuid: "aaaaaaaaaaaa", commentId: 3, count: 3, comment: c(3, { body, createdAt: Date.now() }) };
      return new Response(JSON.stringify(e), { status: 201 });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const items = () => within(screen.getByRole("list", { name: /comments/i })).getAllByRole("listitem");

describe("EntryComments", () => {
  it("shows each comment with author, relative time and 'edited'; bodies are text, never HTML", async () => {
    const { container } = render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(screen.getByRole("heading", { name: /^comments\s*\(2\)$/i })).toBeTruthy();
    expect(items()[0].textContent).toContain("Priya · 2m ago");
    expect(items()[1].textContent).toMatch(/Coach · 2m ago · edited/);
    expect(items()[1].textContent).toContain("<b>not bold</b>");
    expect(container.querySelector("b")).toBeNull();
  });

  it("a member: Edit and Delete on their own comment only", async () => {
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(within(items()[0]).getByRole("button", { name: "Edit your comment" })).toBeTruthy();
    expect(within(items()[0]).getByRole("button", { name: "Delete your comment" })).toBeTruthy();
    expect(within(items()[1]).queryAllByRole("button")).toHaveLength(0);
  });

  it("an admin can delete anyone's (after confirming), but edit only their own", async () => {
    h.role = "admin";
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(within(items()[1]).queryByRole("button", { name: /edit/i })).toBeNull();
    fireEvent.click(within(items()[1]).getByRole("button", { name: "Delete Coach's comment" }));
    expect(within(items()[1]).getByText("Delete Coach's comment?")).toBeTruthy();
    expect(within(items()[1]).getByRole("button", { name: "Keep" })).toBeTruthy();
  });

  it("posts a comment, clears the composer, and shows it", async () => {
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    const box = screen.getByLabelText("Add a comment");
    const send = screen.getByRole("button", { name: "Comment" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Watch their lift" } });
    await act(async () => { fireEvent.click(send); });
    expect(posted).toEqual(["Watch their lift"]);
    await waitFor(() => expect(items()).toHaveLength(3));
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("a comment from someone else arrives live", async () => {
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    act(() => { announceComment({ action: "created", workspaceId: "41", entryUuid: "aaaaaaaaaaaa", commentId: 5, count: 3, comment: c(5, { authorAccountId: 10, authorName: "Ada", body: "live!" }) }); });
    expect(items()).toHaveLength(3);
    expect(items()[2].textContent).toContain("live!");
  });

  it("Personal entries have no comments; an entry not synced yet asks for a sync first", () => {
    const { container, rerender } = render(<EntryComments entry={entry({ workspaceId: null })} />);
    expect(container.textContent).toBe("");
    rerender(<EntryComments entry={entry({ authorAccountId: 0 })} />);
    expect(screen.getByText(/save and sync this entry/i)).toBeTruthy();
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
  });
});
