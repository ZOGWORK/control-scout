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
const { resetCommentAttempts } = await import("../../lib/commentAttempts");

const entry = (over: Partial<ScoutEntry> = {}): ScoutEntry => ({
  uuid: "aaaaaaaaaaaa", workspaceId: "41", season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: {}, notes: "",
  updatedAt: 1000, authorAccountId: 8, authorDisplayName: "Marcus", ...over,
});
const c = (id: number, over: Partial<EntryComment> = {}): EntryComment => ({
  id, workspaceId: "41", entryUuid: "aaaaaaaaaaaa", authorAccountId: 7, authorName: "Priya", body: `comment ${id}`, createdAt: Date.now() - 150_000, editedAt: null, ...over,
});
const THREAD = "/api/scout/workspaces/41/entries/aaaaaaaaaaaa/comments";

let thread: EntryComment[] = [];
const posted: unknown[] = [];
beforeEach(() => {
  h.role = "member";
  localStorage.clear();
  resetCommentAttempts();
  posted.length = 0;
  thread = [c(1), c(2, { authorAccountId: 9, authorName: "Coach", body: "<b>not bold</b>\nsecond line", editedAt: Date.now() - 60_000 })];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === THREAD) return new Response(JSON.stringify({ comments: thread, entryDeleted: false }), { status: 200 });
    if (method === "POST" && url === THREAD) {
      const body = JSON.parse(String(init!.body)).body;
      posted.push(body);
      const e: CommentEvent = { action: "created", workspaceId: "41", entryUuid: "aaaaaaaaaaaa", commentId: 3, count: 3, rev: 100, comment: c(3, { body, createdAt: Date.now() }) };
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
    act(() => { announceComment({ action: "created", workspaceId: "41", entryUuid: "aaaaaaaaaaaa", commentId: 5, count: 3, rev: 200, comment: c(5, { authorAccountId: 10, authorName: "Ada", body: "live!" }) }); });
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

describe("EntryComments: the composer", () => {
  it("counts characters like the server (an emoji is one), and refuses over the limit", async () => {
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    const box = screen.getByLabelText("Add a comment");
    fireEvent.change(box, { target: { value: "\u{1F642}".repeat(1990) } });
    expect(screen.getByText("10 characters left")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Comment" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(box, { target: { value: "\u{1F642}".repeat(2003) } });
    expect(screen.getByText("3 over the 2,000-character limit")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Comment" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("words typed while a comment is sending stay in the box", async () => {
    let finish: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return new Promise<Response>((r) => { finish = r; });
      return new Response(JSON.stringify({ comments: thread, entryDeleted: false }), { status: 200 });
    }));
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    const box = screen.getByLabelText("Add a comment") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    fireEvent.change(box, { target: { value: "first and more" } });
    const e: CommentEvent = { action: "created", workspaceId: "41", entryUuid: "aaaaaaaaaaaa", commentId: 7, count: 3, rev: 300, comment: c(7, { body: "first" }) };
    await act(async () => { finish(new Response(JSON.stringify(e), { status: 201 })); });
    await waitFor(() => expect(items()).toHaveLength(3));
    expect(box.value).toBe("first and more");
  });
});

// PRIVATE-F05 (audit 2026-10-18): the server took a post but its answer was lost.
describe("EntryComments: a post whose answer is lost", () => {
  /** A stand-in server that dedupes on opId, as server/scout/comments.ts does. `lose`: drop the answer to the next N posts (after taking them); `getFails`: the thread can't be read. */
  function lossyServer() {
    const st = { lose: 0, getFails: false, posts: [] as { body: string; opId: string }[] };
    const byOp = new Map<string, EntryComment>();
    let next = 3;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === THREAD) {
        if (st.getFails) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ comments: thread, entryDeleted: false }), { status: 200 });
      }
      if (method === "POST" && url === THREAD) {
        const { body, opId } = JSON.parse(String(init!.body));
        st.posts.push({ body, opId });
        let made = byOp.get(opId);
        const repeat = !!made;
        if (!made) { made = c(next++, { body, opId, createdAt: Date.now() }); byOp.set(opId, made); thread = [...thread, made]; }
        if (st.lose > 0) { st.lose--; throw new TypeError("Failed to fetch"); } // taken, answer lost
        const e: CommentEvent = { action: "created", workspaceId: "41", entryUuid: "aaaaaaaaaaaa", commentId: made.id, count: thread.length, rev: repeat ? 0 : 200 + made.id, comment: made };
        return new Response(JSON.stringify(e), { status: repeat ? 200 : 201 });
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }));
    return st;
  }
  const type = (text: string) => fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: text } });
  const box = () => screen.getByLabelText("Add a comment") as HTMLTextAreaElement;

  it("finds its comment in the thread: posted once, the composer clears, no error", async () => {
    const st = lossyServer();
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    st.lose = 1;
    type("Watch their lift");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(items()).toHaveLength(3));
    await waitFor(() => expect(box().value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(st.posts).toHaveLength(1);
  });

  it("can't tell: says it couldn't confirm (not offline), and Retry sends the same attempt, never a second comment", async () => {
    const st = lossyServer();
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    st.lose = 1; st.getFails = true;
    type("Watch their lift");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't confirm/i);
    expect(alert.textContent).not.toMatch(/offline/i);
    expect(box().value).toBe("Watch their lift"); // kept
    st.getFails = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(box().value).toBe(""));
    expect(st.posts).toHaveLength(2);
    expect(st.posts[1].opId).toBe(st.posts[0].opId);
    expect(st.posts[0].opId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(thread.filter((x) => x.body === "Watch their lift")).toHaveLength(1);
    await waitFor(() => expect(items()).toHaveLength(3));
  });

  it("the same words posted again on purpose (after a success) are a new attempt: a new id", async () => {
    const st = lossyServer();
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    for (let i = 0; i < 2; i++) {
      type("+1");
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));
      await waitFor(() => expect(box().value).toBe(""));
    }
    expect(st.posts).toHaveLength(2);
    expect(st.posts[0].opId).not.toBe(st.posts[1].opId);
    await waitFor(() => expect(items()).toHaveLength(4));
  });

  it("an unconfirmed post that streams in afterwards clears the composer", async () => {
    const st = lossyServer();
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    st.lose = 1; st.getFails = true;
    type("late but there");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByRole("alert");
    const made = thread.at(-1)!;
    act(() => { announceComment({ action: "created", workspaceId: "41", entryUuid: "aaaaaaaaaaaa", commentId: made.id, count: thread.length, rev: 500, comment: made }); });
    await waitFor(() => expect(box().value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(st.posts).toHaveLength(1);
  });

  // E4: the composer's state, and an attempt kept until the workspace confirms it.
  const status = () => document.querySelector("[aria-live][data-save-state]")?.getAttribute("data-save-state") ?? null;

  it("goes Draft → Posting → Posted, said politely", async () => {
    lossyServer();
    let release: () => void = () => undefined;
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") await new Promise<void>((r) => { release = r; });
      return real(url, init);
    }));
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(status()).toBeNull();
    type("Watch their lift");
    expect(status()).toBe("draft");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(status()).toBe("saving"));
    expect(document.querySelector("[aria-live][data-save-state]")!.textContent).toBe("Your comment: Posting…");
    release();
    await waitFor(() => expect(status()).toBe("saved"));
    expect(document.querySelector("[aria-live][data-save-state]")!.textContent).toBe("Your comment: Posted");
    expect(box().value).toBe("");
  });

  it("Needs attention when unconfirmed; Discard lets it go and forgets it", async () => {
    const st = lossyServer();
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    st.lose = 1; st.getFails = true;
    type("Watch their lift");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    const alert = await screen.findByRole("alert");
    expect(status()).toBe("attention");
    expect(localStorage.getItem("cs-comment-try:7:41:aaaaaaaaaaaa")).not.toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Discard" }));
    expect(box().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(localStorage.getItem("cs-comment-try:7:41:aaaaaaaaaaaa")).toBeNull();
    expect(st.posts).toHaveLength(1);
  });

  it("an unconfirmed comment survives closing the entry: it comes back with its message, and Retry is the same attempt", async () => {
    const st = lossyServer();
    const view = render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    st.lose = 1; st.getFails = true;
    type("Watch their lift");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByRole("alert");
    view.unmount();
    st.getFails = false;
    render(<EntryComments entry={entry()} />);
    expect(box().value).toBe("Watch their lift");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(box().value).toBe(""));
    expect(st.posts.map((p) => p.opId)).toEqual([st.posts[0].opId, st.posts[0].opId]);
    expect(thread.filter((x) => x.body === "Watch their lift")).toHaveLength(1);
  });

  it("another account's kept attempt on this device is never shown or sent", async () => {
    const st = lossyServer();
    localStorage.setItem("cs-comment-try:8:41:aaaaaaaaaaaa", JSON.stringify({ body: "Someone else's words", opId: "op-other-acct", at: Date.now() }));
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(box().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(st.posts).toEqual([]);
    expect(localStorage.getItem("cs-comment-try:8:41:aaaaaaaaaaaa")).not.toBeNull(); // still theirs, for them
  });

  it("while one is on its way, editing the text never lets a second send start", async () => {
    lossyServer();
    let release: () => void = () => undefined;
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") await new Promise<void>((r) => { release = r; });
      return real(url, init);
    }));
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    type("First");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(status()).toBe("saving"));
    type("Second");
    expect((screen.getByRole("button", { name: "Comment" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    release();
    await waitFor(() => expect(items()).toHaveLength(3));
    expect(box().value).toBe("Second"); // typed meanwhile, kept, not sent
  });

  it("on a fresh page, a kept attempt the thread doesn't have comes back into the field with Retry and Discard", async () => {
    const st = lossyServer();
    localStorage.setItem("cs-comment-try:7:41:aaaaaaaaaaaa", JSON.stringify({ body: "Kept before the reload", opId: "op-kept-000001", at: Date.now() }));
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(box().value).toBe("Kept before the reload"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/didn't reach the workspace/);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(box().value).toBe(""));
    expect(st.posts).toEqual([{ body: "Kept before the reload", opId: "op-kept-000001" }]);
  });

  it("another tab discarding a kept attempt removes it here too", async () => {
    const st = lossyServer();
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    st.lose = 1; st.getFails = true;
    type("Watch their lift");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByRole("alert");
    const k = "cs-comment-try:7:41:aaaaaaaaaaaa";
    act(() => { localStorage.removeItem(k); window.dispatchEvent(new StorageEvent("storage", { key: k, newValue: null })); });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("another tab replacing a kept attempt brings the newer one into this field", async () => {
    const st = lossyServer();
    render(<EntryComments entry={entry()} />);
    await waitFor(() => expect(items()).toHaveLength(2));
    st.lose = 1; st.getFails = true;
    type("Older words");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByRole("alert");
    const k = "cs-comment-try:7:41:aaaaaaaaaaaa";
    const v = JSON.stringify({ body: "Newer words from the other tab", opId: "op-other-tab-01", at: Date.now() });
    act(() => { localStorage.setItem(k, v); window.dispatchEvent(new StorageEvent("storage", { key: k, newValue: v })); });
    await waitFor(() => expect(box().value).toBe("Newer words from the other tab"));
    st.getFails = false;
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(box().value).toBe(""));
    expect(st.posts.at(-1)).toEqual({ body: "Newer words from the other tab", opId: "op-other-tab-01" });
  });
});
