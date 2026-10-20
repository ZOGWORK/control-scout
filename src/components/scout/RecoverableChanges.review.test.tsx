// @vitest-environment jsdom
// "Show change" in the recoverable view: it reveals the member's unsent wording next to what's shared now, with the
// differences marked for sight and for screen readers, and only ever reads (nothing is sent until Retry). A
// destination that's gone or out of reach says so; text is plain (never markup), whatever its script; and another
// account's retained work on the same device is never shown, opened or read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { publishPending } from "../../lib/pendingWork";
import { resetCommentAttempts, sendComment } from "../../lib/commentAttempts";
import { CommentWriteError } from "../../lib/scoutComments";
import { announcePicklist } from "../../lib/sharedPicklist";
import { announceComment } from "../../lib/scoutComments";
import { RecoverableChanges } from "./RecoverableChanges";
import { describeDiff } from "./ChangeReview";
import { wordDiff } from "../../lib/wordDiff";

vi.mock("../ui/sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined, warning: () => undefined }) }));

const WS = [{ id: "901", name: "Gearheads" }, { id: "902", name: "Robo Owls" }];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const THREAD = "/api/scout/workspaces/901/entries/aaaaaaaaaaaa/comments";
const pick = (team: number, note: string, noteUpdatedAt: number | null = null) =>
  ({ team, rank: 1, note, noteUpdatedAt, addedBy: { accountId: 1, name: "Priya" }, addedAt: 1, noteBy: null });

let picks: ReturnType<typeof pick>[];
let picklistStatus: number;
let listVersion: number;
let thread: unknown[];
let entryDeleted: boolean;
let calls: { method: string; path: string }[];

beforeEach(() => {
  localStorage.clear();
  resetCommentAttempts();
  picks = [pick(102, "Fast cycles in auto", 50)];
  picklistStatus = 200; listVersion = 4; thread = []; entryDeleted = false; calls = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, path });
    if (method !== "GET") throw new Error(`unexpected ${method} ${path}`);
    if (path.startsWith("/api/scout/workspaces/901/picklist")) {
      if (picklistStatus !== 200) return json(picklistStatus, { error: "You're not a member of this workspace in Control Point." });
      return json(200, { list: { workspaceId: "901", season: 2025, version: listVersion, picks } });
    }
    if (path === THREAD) return json(200, { comments: thread, entryDeleted });
    throw new Error(`unexpected ${method} ${path}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); publishPending("test", []); });

const keepNote = (account: number, space: string, team: number, note: string, base: number | null = 50) =>
  localStorage.setItem(`cs-picknote:${account}:${space}:2025:${team}`, JSON.stringify({ note, base, at: Date.now(), wid: `w-${account}-${team}` }));
const showButton = (label = /Note on 102/) => screen.getByRole("button", { name: new RegExp(`Show change: ${label.source}`) });
const comparison = () => screen.findByRole("group", { name: "Your change compared with what's shared now" });
const writes = () => calls.filter((c) => c.method !== "GET");

describe("Show change", () => {
  it("opens and closes with aria-expanded, reads what's shared now, and sends nothing", async () => {
    keepNote(1, "901", 102, "Slow cycles in auto, great climb");
    render(<RecoverableChanges account={1} workspaces={WS} />);
    expect(calls).toEqual([]); // nothing read until asked
    const btn = showButton();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const group = await comparison();
    expect(btn.getAttribute("aria-controls")).toBe(group.id);
    // Side by side: the member's text and the shared one, each labelled.
    const yours = within(group).getByRole("region", { name: "Your note (not saved)" });
    const shared = within(group).getByRole("region", { name: "Shared now" });
    const plain = (el: Element) => el.textContent!.replace(/(added|removed): | \(end (added|removed)\)/g, "");
    expect(plain(yours)).toBe("Slow cycles in auto, great climb");
    expect(plain(shared)).toBe("Fast cycles in auto");
    // Marked by element and by words a screen reader reads, not by colour alone.
    expect([...yours.querySelectorAll("ins")].map((x) => x.textContent)).toEqual(["added: Slow (end added)", "added: , great climb (end added)"]);
    expect([...shared.querySelectorAll("del")].map((x) => x.textContent)).toEqual(["removed: Fast (end removed)"]);
    const desc = document.getElementById(group.getAttribute("aria-describedby")!)!;
    expect(desc.textContent).toBe("Compared with what's shared now: 3 words added, 1 word removed.");
    expect(calls).toEqual([{ method: "GET", path: "/api/scout/workspaces/901/picklist?season=2025" }]);
    // Retry and Discard are right below it, still the only way anything goes.
    expect(within(screen.getByRole("group", { name: "Note on 102: actions" })).getByRole("button", { name: "Retry: Note on 102" })).toBeTruthy();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: /compared with/ })).toBeNull();
    expect(writes()).toEqual([]);
    expect(localStorage.getItem("cs-picknote:1:901:2025:102")).not.toBeNull(); // still kept
  });

  it("works from the keyboard (a real button: Enter and Space)", async () => {
    keepNote(1, "901", 102, "Slow cycles in auto");
    render(<RecoverableChanges account={1} workspaces={WS} />);
    const btn = showButton();
    expect(btn.tagName).toBe("BUTTON");
    btn.focus();
    fireEvent.click(btn); // a button's Enter/Space activate it as a click
    await comparison();
    expect(document.activeElement).toBe(btn);
    // The long text boxes scroll from the keyboard too.
    for (const r of within(await comparison()).getAllByRole("region")) expect(r.getAttribute("tabindex")).toBe("0");
  });

  it("says when a teammate changed the note after it was written", async () => {
    keepNote(1, "901", 102, "Slow cycles", 10);
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    const group = await comparison();
    expect(group.textContent).toContain("A teammate changed this note after you wrote yours.");
  });

  it("says plainly when the team is gone from the pick list", async () => {
    keepNote(1, "901", 102, "Slow cycles");
    picks = [pick(555, "")];
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    expect(await screen.findByText("Team 102 is no longer on the pick list, so this note has nowhere to go.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your note (not saved)" }).textContent).toBe("Slow cycles");
    expect(writes()).toEqual([]);
  });

  it("says plainly when access to the workspace was revoked", async () => {
    keepNote(1, "901", 102, "Slow cycles");
    picklistStatus = 403;
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    expect(await screen.findByText(/You're no longer a member of this workspace/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Shared now" })).toBeNull();
  });

  it("doesn't read anything from a workspace this account isn't in any more", async () => {
    keepNote(1, "903", 102, "Slow cycles");
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    expect(await screen.findByText(/You're no longer a member of this workspace/)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("offers to check again when the workspace can't be reached", async () => {
    keepNote(1, "901", 102, "Slow cycles");
    picklistStatus = 502;
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    const again = await screen.findByRole("button", { name: "Check again" });
    picklistStatus = 200;
    fireEvent.click(again);
    await comparison();
    expect(writes()).toEqual([]);
  });

  it("shows emoji, right-to-left text, combining marks and markup as plain text", async () => {
    const text = "🏳️‍🌈 مرحبا بكم café ‮evil <img src=x onerror=\"window.pwned=1\"> <b>bold</b>";
    keepNote(1, "901", 102, text);
    picks = [pick(102, "🏳️‍🌈 مرحبا café", 50)];
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    const group = await comparison();
    const yours = within(group).getByRole("region", { name: "Your note (not saved)" });
    expect(yours.querySelector("img, b")).toBeNull();
    expect((window as { pwned?: number }).pwned).toBeUndefined();
    expect(yours.textContent!.replace(/added: | \(end added\)/g, "")).toBe(text);
    // Its own direction, isolated from the page around it.
    expect(yours.querySelector("p")!.getAttribute("dir")).toBe("auto");
    expect([...yours.querySelectorAll("ins")].map((x) => x.textContent!.replace(/added: | \(end added\)/g, ""))).toEqual([`بكم café ‮evil <img src=x onerror="window.pwned=1"> <b>bold</b>`]);
    expect([...within(group).getByRole("region", { name: "Shared now" }).querySelectorAll("del")].map((x) => x.textContent)).toEqual(["removed: café (end removed)"]);
  });

  it("shows a comment that didn't go as new text, and says when its entry was deleted", async () => {
    await sendComment({ account: 1, space: "901", uuid: "aaaaaaaaaaaa", team: 18360, what: "Comment on 18360 · Match Q1" }, "Watch their lift", "op-review-0001",
      async () => { throw new CommentWriteError("Couldn't post your comment.", false); });
    thread = [{ id: 3, workspaceId: "901", entryUuid: "aaaaaaaaaaaa", authorAccountId: 2, authorName: "Marcus", body: "Agreed", createdAt: 1, editedAt: null }];
    const { unmount } = render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton(/Comment on 18360 · Match Q1/));
    const group = await comparison();
    // Not found isn't called "never posted" (a deleted one isn't listed either): Retry checks first.
    expect(group.textContent).toContain("It isn't in the thread as this device sees it. Retry checks with the workspace first and never posts it twice.");
    expect(within(group).getByRole("region", { name: "Your comment (not sent)" }).textContent).toBe("added: Watch their lift (end added)");
    expect(calls).toEqual([{ method: "GET", path: THREAD }]);
    unmount();
    entryDeleted = true;
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton(/Comment on 18360 · Match Q1/));
    expect(await screen.findByText("The entry this comment is on was deleted, so it has nowhere to go.")).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it("never shows, opens or reads another account's retained change on the same device", async () => {
    keepNote(1, "901", 102, "Priya's note");
    keepNote(2, "901", 102, "Marcus's secret wording");
    keepNote(2, "902", 777, "Marcus's other secret");
    publishPending("test", [{ key: "comment:2:901:bbbbbbbbbbbb", account: 2, kind: "comment", workspaceId: "901", season: 2025, team: 18360,
      label: "Comment on 18360", status: "attention", message: "Not posted.", text: "Marcus's secret comment", entry: "bbbbbbbbbbbb", opId: "op-marcus-0001" }]);
    render(<RecoverableChanges account={1} workspaces={WS} />);
    const region = screen.getByRole("region", { name: /Changes not saved yet/ });
    expect(within(region).getAllByRole("button", { name: /^Show change/ }).map((b) => b.getAttribute("aria-label"))).toEqual(["Show change: Note on 102"]);
    fireEvent.click(showButton());
    await comparison();
    expect(document.body.textContent).not.toMatch(/Marcus|777|Robo Owls|bbbbbbbbbbbb/);
    expect(calls.every((c) => c.path === "/api/scout/workspaces/901/picklist?season=2025")).toBe(true);
    cleanup();
    // And the other way round: Marcus sees only his own.
    render(<RecoverableChanges account={2} workspaces={WS} />);
    expect(screen.getAllByRole("button", { name: /^Show change/ }).map((b) => b.getAttribute("aria-label")).sort())
      .toEqual(["Show change: Comment on 18360", "Show change: Note on 102", "Show change: Note on 777"]);
    fireEvent.click(showButton(/Note on 102/));
    await comparison();
    expect(document.body.textContent).not.toContain("Priya's note");
    await waitFor(() => expect(screen.getByRole("region", { name: "Your note (not saved)" }).textContent).toContain("Marcus's secret wording"));
  });

  it("keeps what's shared now current while open: the stream's pick list, a thread change, and Read again", async () => {
    keepNote(1, "901", 102, "Slow cycles in auto");
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    await comparison();
    const shared = () => screen.getByRole("region", { name: "Shared now" }).textContent;
    expect(shared()).toContain("Fast");
    // A teammate's newer note arrives on the stream: shown at once, no request.
    const before = calls.length;
    act(() => announcePicklist({ workspaceId: "901", season: 2025, version: 9, picks: [pick(102, "Fast cycles, parks every match", 60)] }));
    expect(shared()).toContain("parks every match");
    expect(screen.getByRole("group", { name: /compared with/ }).textContent).toContain("A teammate changed this note after you wrote yours.");
    // Another workspace's or season's list changes nothing.
    act(() => announcePicklist({ workspaceId: "902", season: 2025, version: 1, picks: [pick(102, "Other space", 1)] }));
    act(() => announcePicklist({ workspaceId: "901", season: 2024, version: 1, picks: [pick(102, "Other season", 1)] }));
    expect(shared()).toContain("parks every match");
    expect(calls.length).toBe(before);
    // Read again reads (only reads) once more.
    picks = [pick(102, "Read fresh", 70)]; listVersion = 10;
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    await waitFor(() => expect(shared()).toContain("Read fresh"));
    expect(writes()).toEqual([]);
  });

  it("never lets a slower read replace a newer note heard on the stream", async () => {
    keepNote(1, "901", 102, "Slow cycles in auto");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const real = fetch as unknown as (p: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (p: string, i?: RequestInit) => { await gate; return real(p, i); }));
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    // The stream brings version 9 while the read (of version 4) is still on its way.
    act(() => announcePicklist({ workspaceId: "901", season: 2025, version: 9, picks: [pick(102, "Newest note", 90)] }));
    const shared = () => screen.getByRole("region", { name: "Shared now" }).textContent;
    expect(shared()).toContain("Newest note");
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(calls.length).toBe(1); // the read came back...
    expect(shared()).toContain("Newest note"); // ...and was older, so it was dropped
  });

  it("reads a comment's thread again when it changes on the stream", async () => {
    await sendComment({ account: 1, space: "901", uuid: "aaaaaaaaaaaa", team: 18360, what: "Comment on 18360" }, "Watch their lift", "op-review-0002",
      async () => { throw new CommentWriteError("Couldn't post your comment.", true); });
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton(/Comment on 18360/));
    await comparison();
    const made = { id: 4, workspaceId: "901", entryUuid: "aaaaaaaaaaaa", authorAccountId: 1, authorName: "Priya", body: "Watch their lift", opId: "op-review-0002", createdAt: 2, editedAt: null };
    thread = [made];
    // Edited by its author elsewhere: still the member's own attempt here, so it's checked again.
    act(() => announceComment({ action: "edited", workspaceId: "901", entryUuid: "aaaaaaaaaaaa", commentId: 4, count: 1, rev: 3, comment: made } as never));
    await waitFor(() => expect(calls.filter((c) => c.path === THREAD).length).toBe(2));
    expect(writes()).toEqual([]);
  });
});

describe("text direction", () => {
  it("leaves the direction to the text (direction marks included), never to the hidden markers", async () => {
    keepNote(1, "901", 102, "سريع جدا في البداية");
    picks = [pick(102, "‏18360: بطيء جدا في البداية", 50)];
    render(<RecoverableChanges account={1} workspaces={WS} />);
    fireEvent.click(showButton());
    const group = await comparison();
    for (const name of ["Your note (not saved)", "Shared now"]) {
      const p = within(group).getByRole("region", { name }).querySelector("p")!;
      expect(p.getAttribute("dir")).toBe("auto");
      expect(p.firstElementChild!.tagName).toMatch(/INS|DEL/); // starts with a change...
      // ...whose English markers carry their own dir, so the browser's auto direction skips them.
      const markers = [...p.querySelectorAll(".sr-only")];
      expect(markers.length).toBeGreaterThan(0);
      for (const m of markers) expect(m.getAttribute("dir")).toBe("ltr");
    }
    expect(within(group).getByRole("region", { name: "Shared now" }).textContent).toContain("‏18360:");
  });
});

describe("describeDiff", () => {
  const say = (shared: string, yours: string) => describeDiff(wordDiff(shared, yours), shared, yours);
  it("never calls a punctuation or spacing change the same", () => {
    expect(say("Ready?", "Ready!")).toBe("Only punctuation or spacing differs from what's shared now.");
    expect(say("Ready", "Ready")).toBe("Your text is the same as what's shared now.");
    expect(say("", "!!")).toBe("Nothing is shared there now; yours adds only punctuation or spacing.");
    expect(say("Ready", "")).toBe("Your text is empty: it would clear what's shared now.");
    expect(say("", "Fast auto")).toBe("Nothing is shared there now; all 2 words of yours would be added.");
  });
});
