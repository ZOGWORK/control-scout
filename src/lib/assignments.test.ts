// @vitest-environment jsdom
// Assignments on the device (Task 10): live notices applied to the list, the badge wording, progress
// (the server's count or this device's, whichever knows more), the stream's `event: assignment`, and the
// words the feed and the inbox use.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { announceAssignments, applyNotice, assignedLabel, assignmentProgress, SCOUT_ASSIGNMENT, useAssignments } from "./assignments";
import { followWorkspace, type LiveMode } from "./scoutLive";
import { describeActivity, type ActivityItem } from "./scoutActivity";
import { inboxLink, inboxText } from "../shared/inbox";
import type { Assignment, AssignmentNotice } from "../shared/assignments";
import type { ScoutEntry } from "./scouting";

const a = (id: number, team: number, assignee = 7, over: Partial<Assignment> = {}): Assignment => ({
  id, workspaceId: "41", season: 2025, eventCode: "USTST1", team, assigneeAccountId: assignee, assigneeName: assignee === 7 ? "Priya" : "Sam",
  createdByAccountId: 1, createdByName: "Coach", createdAt: 0, status: "open", doneAt: null, doneByAccountId: null, doneByName: null, progress: 0, ...over,
});
const e = (team: number, over: Partial<ScoutEntry> = {}): ScoutEntry => ({
  uuid: `u${team}${Math.random()}`, workspaceId: "41", season: 2025, team, eventCode: "ustst1", matchLabel: "Q1", kind: "match", data: {}, notes: "", updatedAt: 1, authorAccountId: 7, authorDisplayName: "Priya", ...over,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("assignments on the device", () => {
  it("applies live notices: created and updated replace by id (this season only), deleted removes", () => {
    let list = [a(1, 1234), a(2, 5678)];
    list = applyNotice(list, { action: "updated", assignments: [a(1, 1234, 7, { status: "done" })] }, 2025);
    list = applyNotice(list, { action: "created", assignments: [a(3, 9999), a(4, 1111, 7, { season: 2024 })] }, 2025);
    list = applyNotice(list, { action: "deleted", assignments: [a(2, 5678)] }, 2025);
    expect(list.map((x) => [x.id, x.status])).toEqual([[1, "done"], [3, "open"]]);
  });

  it("badge wording: you first, then names", () => {
    expect(assignedLabel([], 7)).toBeNull();
    expect(assignedLabel([a(1, 1, 8)], 7)).toBe("Assigned to Sam");
    expect(assignedLabel([a(1, 1, 8), a(2, 1, 7)], 7)).toBe("Assigned to you and Sam");
    expect(assignedLabel([a(1, 1, 8), a(2, 1, 7), a(3, 1, 9, { assigneeName: "Lee" })], 7)).toBe("Assigned to you +2");
  });

  it("progress: the assignee's live entries for that team and event; this device's unsynced ones count for the signed-in scout", () => {
    const local = [e(1234), e(1234, { authorAccountId: 0 }), e(1234, { deleted: true }), e(1234, { eventCode: "OTHER" }), e(1234, { authorAccountId: 8 }), e(5678)];
    expect(assignmentProgress(a(1, 1234), local, 7)).toBe(2);
    expect(assignmentProgress(a(1, 1234), local, 8)).toBe(1); // someone else's view: only Priya's synced one
    expect(assignmentProgress(a(1, 1234, 7, { progress: 5 }), local, 7)).toBe(5);
  });

  it("the stream's `event: assignment` is announced for its workspace (malformed ones dropped)", () => {
    const heard: { space: string; notice: AssignmentNotice }[] = [];
    const on = (ev: Event) => heard.push((ev as CustomEvent).detail);
    window.addEventListener(SCOUT_ASSIGNMENT, on);
    class FakeES {
      static last: FakeES;
      listeners = new Map<string, ((m: MessageEvent) => void)[]>();
      onerror: (() => void) | null = null;
      constructor() { FakeES.last = this; }
      addEventListener(t: string, fn: (m: MessageEvent) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]); }
      close() {}
      emit(t: string, data: unknown) { for (const fn of this.listeners.get(t) ?? []) fn(new MessageEvent(t, { data: typeof data === "string" ? data : JSON.stringify(data) })); }
    }
    const stop = followWorkspace("41", () => {}, { EventSource: FakeES as unknown as typeof EventSource, pull: async () => undefined });
    FakeES.last.emit("assignment", { action: "created", assignments: [a(1, 1234)] });
    FakeES.last.emit("assignment", { action: "nope", assignments: [] });
    FakeES.last.emit("assignment", "{bad json");
    stop();
    window.removeEventListener(SCOUT_ASSIGNMENT, on);
    expect(heard.map((h) => [h.space, h.notice.action, h.notice.assignments[0].team])).toEqual([["41", "created", 1234]]);
  });

  it("useAssignments: a reply read before a live change doesn't undo it; an older reply never replaces a newer one", async () => {
    localStorage.clear();
    const replies: ((list: Assignment[]) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { replies.push((list) => resolve(new Response(JSON.stringify({ assignments: list }), { status: 200 }))); })));
    const { result, rerender } = renderHook(({ live }: { live: LiveMode }) => useAssignments("41", 2025, live), { initialProps: { live: "connecting" as LiveMode } });
    await waitFor(() => expect(replies).toHaveLength(1));
    // While the first request is out, the stream marks 1234 done; the reply (read before that) says open.
    act(() => announceAssignments("41", { action: "updated", assignments: [a(1, 1234, 7, { status: "done" })] }));
    await act(async () => { replies[0]([a(1, 1234), a(2, 5678)]); });
    expect(result.current.list.map((x) => [x.team, x.status])).toEqual([[1234, "done"], [5678, "open"]]);
    // Two requests out: the second's reply lands first; the first's, older, is dropped.
    rerender({ live: "live" });
    await waitFor(() => expect(replies).toHaveLength(2));
    act(() => result.current.reload());
    await waitFor(() => expect(replies).toHaveLength(3));
    await act(async () => { replies[2]([a(1, 1234, 7, { status: "done" })]); });
    await act(async () => { replies[1]([a(1, 1234), a(2, 5678), a(3, 9999)]); });
    expect(result.current.list.map((x) => x.team)).toEqual([1234]);
  });

  it("useAssignments: a first load that failed is fetched again when the stream comes up", async () => {
    localStorage.clear();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++calls === 1 ? new Response(JSON.stringify({ error: "down" }), { status: 500 }) : new Response(JSON.stringify({ assignments: [a(1, 1234)] }), { status: 200 }))));
    const { result, rerender } = renderHook(({ live }: { live: LiveMode }) => useAssignments("41", 2025, live), { initialProps: { live: "connecting" as LiveMode } });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    rerender({ live: "live" });
    await waitFor(() => expect(result.current.list.map((x) => x.team)).toEqual([1234]));
  });

  it("feed and inbox words", () => {
    const item = (type: string, details: Record<string, unknown>): ActivityItem => ({ id: 1, workspaceId: "41", at: 0, actor: { accountId: 1, name: "Coach" }, type, subject: "assignment:1", details });
    const d = { assigneeAccountId: 7, assigneeName: "Priya", team: 1234, season: 2025, eventCode: "USTST1" };
    expect(describeActivity(item("assignment.created", { ...d, teams: [1234, 5678] }))).toEqual({ verb: "assigned", subject: "teams 1234 and 5678 to Priya", note: "USTST1 · 2025" });
    expect(describeActivity(item("assignment.completed", d))).toEqual({ verb: "marked done", subject: "Priya's team 1234", note: "USTST1 · 2025" });
    expect(describeActivity(item("assignment.reopened", d)).verb).toBe("reopened");
    expect(describeActivity(item("assignment.deleted", d)).subject).toBe("Priya's assignment for team 1234");
    expect(inboxText("assignment.created", { ...d, teams: [1, 2, 3, 4, 5] }, "Coach", "Gearheads").title).toBe("Coach assigned you to scout teams 1, 2 and 3 more");
    expect(inboxText("assignment.completed", d, "Coach", "Gearheads")).toEqual({ title: "Coach marked your assignment done", body: "team 1234 · USTST1" });
    expect(inboxLink("41", "assignment.created", d)).toBe("/scout?space=41&season=2025&view=assignments");
    expect(inboxLink("41", "assignment.deleted", d)).toBe("/scout?space=41&view=activity");
  });
});
