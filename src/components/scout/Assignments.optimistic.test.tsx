// @vitest-environment jsdom
// Done on an assignment shows at once, before the server answers (slow venue wifi), takes the server's copy when it
// comes, and goes back with a "Didn't save" message when the server refuses it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useCallback, useMemo, useState } from "react";
import type { Assignment, AssignmentNotice } from "../../shared/assignments";

type Answer = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const h = vi.hoisted(() => ({ answer: null as null | Answer, answers: [] as Answer[], live: null as null | ((n: AssignmentNotice) => void) }));
vi.mock("../../lib/assignments", async (orig) => ({
  ...(await orig<typeof import("../../lib/assignments")>()),
  setAssignmentStatus: () => new Promise((resolve, reject) => { h.answer = { resolve, reject }; h.answers.push(h.answer); }),
}));
vi.mock("../ui/sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(() => "said"), error: vi.fn(), dismiss: vi.fn() }) }));
const { applyNotice } = await import("../../lib/assignments");
const { ApiError } = await import("../../lib/api");
const { resetOptimistic } = await import("../../lib/optimistic");
const { toast } = await import("../ui/sonner");
const { AssignmentsView } = await import("./Assignments");

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
afterEach(() => { cleanup(); resetOptimistic(); h.answer = null; h.answers = []; h.live = null; vi.mocked(toast.error).mockClear(); });

const MINE: Assignment = {
  id: 7, workspaceId: "w1", season: 2025, eventCode: "TESTQ1", team: 18360, assigneeAccountId: 1, assigneeName: "Priya",
  createdByAccountId: 9, createdByName: "Sam Rivera", createdAt: 1, status: "open", doneAt: null, doneByAccountId: null, doneByName: null,
  version: 1, progress: 2,
};

function Live({ isAdmin = false }: { isAdmin?: boolean }) {
  const [list, setList] = useState([MINE]);
  const apply = useCallback((n: AssignmentNotice) => setList((cur) => applyNotice(cur, n, 2025)), []);
  h.live = apply; // the workspace stream's notices land here too
  const state = useMemo(() => ({ list, loading: false, error: null, reload: vi.fn(), apply }), [list, apply]);
  return <AssignmentsView space="w1" workspaceName="Riverside" season={2025} defaultEvent="TESTQ1" state={state} myAccountId={1} isAdmin={isAdmin} localEntries={[]} onScout={vi.fn()} />;
}

const row = () => within(screen.getByRole("region", { name: "TESTQ1" })).getByTestId("assignment-row");
async function tapDone(isAdmin = false) {
  render(<MemoryRouter><Live isAdmin={isAdmin} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Mark team 18360 done for you" }));
  expect(within(row()).getByText("Done")).toBeTruthy(); // on screen in the same tick, before the request even goes
  await act(async () => {}); // the request goes (it waits for nothing else on this assignment)
}

describe("Assignments Done, optimistic", () => {
  it("shows done before the answer, and keeps the server's copy", async () => {
    await tapDone();
    expect(within(row()).getByText("Done")).toBeTruthy(); // no answer yet
    expect(h.answer).not.toBeNull();
    await act(async () => { h.answer!.resolve({ assignment: { ...MINE, status: "done", doneAt: 5, doneByAccountId: 1, doneByName: "Priya", version: 2 }, changed: true }); });
    expect(within(row()).getByText("Done")).toBeTruthy();
    expect(row().textContent).toContain("done by you");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("rolls back and says it didn't save when the server refuses", async () => {
    await tapDone();
    expect(within(row()).getByText("Done")).toBeTruthy();
    await act(async () => { h.answer!.reject(new ApiError(500, "Server error")); });
    expect(within(row()).getByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark team 18360 done for you" })).toBeTruthy();
    expect(toast.dismiss).toHaveBeenCalledWith("said");
    expect(toast.error).toHaveBeenCalledWith("Didn't save: team 18360 marked done. Server error. It's back as it was.");
  });

  it("a live notice of the older tap's answer never flips a newer tap back while it's on its way", async () => {
    await tapDone(true);
    fireEvent.click(screen.getByRole("button", { name: "Reopen team 18360 for you" }));
    expect(within(row()).getByText("Open")).toBeTruthy();
    // Done saved: the stream brings its copy (version 2) before Reopen is even sent.
    const doneCopy = { ...MINE, status: "done" as const, doneAt: 5, doneByAccountId: 1, doneByName: "Priya", version: 2 };
    await act(async () => { h.live!({ action: "updated", assignments: [doneCopy] }); });
    expect(within(row()).getByText("Open")).toBeTruthy();
    await act(async () => { h.answers[0].resolve({ assignment: doneCopy, changed: true }); });
    expect(within(row()).getByText("Open")).toBeTruthy();
    expect(h.answers).toHaveLength(2); // Reopen went once Done was answered
    await act(async () => { h.answers[1].resolve({ assignment: { ...MINE, version: 3 }, changed: true }); });
    expect(within(row()).getByText("Open")).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
