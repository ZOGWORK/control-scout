// @vitest-environment jsdom
// The conflict notice (Task 16): "Your edit was overwritten by <name>", shown per lost edit until dismissed, with a
// field-level diff labelled from the template, and Restore my version queueing a restore.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { applyLiveEntries, localScoutEntries, pendingScoutCounts, saveScoutEntry, setScoutViewer, syncScouting, type ScoutEntry } from "../../lib/scouting";
import { builtinTemplate } from "../../shared/scoutDefaults";
import { ConflictNotices, HistorySheet, restoreBlock } from "./EntryHistory";

const counter = builtinTemplate(2025, "match").fields.find((f) => f.type === "counter")!;
const server = (over: Partial<ScoutEntry> & { updatedAt: number }): ScoutEntry => ({
  uuid: "conflict0002", workspaceId: "w1", season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { [counter.id]: 1 }, notes: "first",
  authorAccountId: 7, authorDisplayName: "Priya", editorAccountId: 7, editorDisplayName: "Priya", ...over,
});
const me = { accountId: 8, role: "member" as const };

beforeEach(() => { localStorage.clear(); setScoutViewer(8); });
afterEach(() => { cleanup(); setScoutViewer(null); });

describe("ConflictNotices", () => {
  it("says who overwrote the edit, once; View diff shows labelled before and after; Restore queues your version", () => {
    render(<ConflictNotices space="w1" me={me} />);
    expect(screen.queryByText(/overwritten/)).toBeNull();
    act(() => {
      applyLiveEntries("w1", [{ entry: server({ updatedAt: 1000 }), seq: 1 }]);
      const mine = saveScoutEntry({ ...localScoutEntries("w1")[0], data: { [counter.id]: 6 }, notes: "mine" });
      applyLiveEntries("w1", [{ entry: server({ updatedAt: mine.updatedAt + 1000, data: { [counter.id]: 2 }, notes: "Priya's" }), seq: 2 }]);
    });
    expect(screen.getByText("Your edit was overwritten by Priya")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View diff" }));
    // Opening it marks the notice seen: the banner is gone, the dialog shows the diff.
    expect(screen.queryAllByRole("status").some((s) => /overwritten/.test(s.textContent ?? ""))).toBe(false);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(counter.label);
    expect(dialog.textContent).toContain("Priya's");
    expect(dialog.textContent).toContain("mine");
    fireEvent.click(screen.getByRole("button", { name: /Restore my version/ }));
    const e = localScoutEntries("w1")[0];
    expect(e).toMatchObject({ notes: "mine", data: { [counter.id]: 6 }, restoredFrom: expect.any(Number) });
    expect(pendingScoutCounts().workspaces.w1).toBe(1);
  });

  it("dismissed stays dismissed when the same version is seen again", () => {
    render(<ConflictNotices space="w1" me={me} />);
    let theirs: ScoutEntry;
    act(() => {
      applyLiveEntries("w1", [{ entry: server({ updatedAt: 1000 }), seq: 1 }]);
      const mine = saveScoutEntry({ ...localScoutEntries("w1")[0], notes: "mine" });
      theirs = server({ updatedAt: mine.updatedAt + 1000, notes: "Priya's" });
      applyLiveEntries("w1", [{ entry: theirs, seq: 2 }]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    act(() => { applyLiveEntries("w1", [{ entry: theirs!, seq: 2 }]); });
    expect(screen.queryByText(/overwritten/)).toBeNull();
  });
});

describe("HistorySheet", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("marks Current by what the entry says, says when a change is still queued, and loads again once it's confirmed", async () => {
    const hist: string[] = [];
    const v1 = { versionNo: 1, updatedAt: 1000, writtenBy: { accountId: 7, name: "Priya" }, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { [counter.id]: 1 }, notes: "first", deleted: false, restored: false, restoredFromVersion: null };
    let versions: typeof v1[] = [v1];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const json = path.includes("/history") ? (hist.push(path), { versions })
        : { results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: true, entry: { ...x, editorAccountId: 8, editorDisplayName: "Marcus" } })) };
      return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    applyLiveEntries("w1", [{ entry: server({ updatedAt: 1000 }), seq: 1 }]);
    const mine = saveScoutEntry({ ...localScoutEntries("w1")[0], notes: "mine" }); // queued on this device
    const sheet = () => <HistorySheet entry={localScoutEntries("w1")[0]} me={me} open onOpenChange={() => {}} />;
    const { rerender } = render(sheet());
    await screen.findByText(/still syncing/);
    expect(screen.queryByText("Current")).toBeNull();
    // Confirmed: the server now has v2; the sheet loads again and v2 is Current.
    versions = [{ ...v1, versionNo: 2, updatedAt: mine.updatedAt, writtenBy: { accountId: 8, name: "Marcus" }, notes: "mine" }, v1];
    await act(async () => { await syncScouting("w1"); });
    rerender(sheet());
    await screen.findByText("Current");
    expect(hist).toHaveLength(2);
    expect(screen.queryByText(/still syncing/)).toBeNull();
    // A save that changed nothing (a newer updatedAt, no new version) leaves v2 Current once it's confirmed.
    act(() => { saveScoutEntry({ ...localScoutEntries("w1")[0] }); });
    await act(async () => { await syncScouting("w1"); });
    rerender(sheet());
    await screen.findByText("Current");
    expect(screen.queryByText(/still syncing/)).toBeNull();
  });
});

describe("restoreBlock", () => {
  it("the loser or an admin; never a deleted entry for a member who isn't its author", () => {
    const live = server({ updatedAt: 1 }), gone = server({ updatedAt: 1, deleted: true });
    expect(restoreBlock(live, null, me)).toBeNull();
    expect(restoreBlock(live, 8, me)).toBeNull();
    expect(restoreBlock(live, 7, me)).toMatch(/wrote a version/);
    expect(restoreBlock(live, 7, { accountId: 9, role: "admin" })).toBeNull();
    expect(restoreBlock(gone, null, me)).toMatch(/deleted/);
    expect(restoreBlock(gone, null, { accountId: 7, role: "member" })).toBeNull();
  });
});
