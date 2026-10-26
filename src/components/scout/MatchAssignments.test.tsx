// @vitest-environment jsdom
// Match scouting in the Assignments view: every member reads who watches what for which quals; only admins
// get Add, Edit and Remove; the sheet sends the slot and range as typed (quals in any spelling), warns about
// someone already on that slot, and refuses a backwards range before it's sent.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MatchAssignment } from "../../shared/assignments";
import type { MatchAssignmentsState } from "../../lib/slotAssignments";

vi.mock("../../lib/assignments", async (orig) => ({
  ...(await orig<typeof import("../../lib/assignments")>()),
  fetchAssignOptions: vi.fn(async () => ({ members: [{ accountId: 1, name: "Coach", role: "admin" }, { accountId: 2, name: "Priya", role: "member" }, { accountId: 3, name: "Marcus", role: "member" }], teams: [] })),
}));
vi.mock("../../lib/slotAssignments", async (orig) => ({
  ...(await orig<typeof import("../../lib/slotAssignments")>()),
  createMatchAssignment: vi.fn(async (_s: string, body: Record<string, unknown>) => ({ matchAssignment: { ...row({ assigneeAccountId: body.assigneeAccountId as number }), ...body }, overlaps: [] })),
  deleteMatchAssignment: vi.fn(async (_s: string, id: number) => ({ deleted: id })),
}));
vi.mock("./EventPicker", () => ({
  EventPicker: ({ id, code, onChange }: { id: string; code: string; onChange: (c: string) => void }) => <input id={id} value={code} onChange={(e) => onChange(e.target.value)} />,
}));

import { createMatchAssignment, deleteMatchAssignment } from "../../lib/slotAssignments";
import { MatchAssignmentsSection } from "./MatchAssignments";

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
// Radix's toggle group and sheet want these in jsdom.
window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
afterEach(() => { cleanup(); vi.clearAllMocks(); });

let id = 0;
function row(over: Partial<MatchAssignment>): MatchAssignment {
  return {
    id: ++id, workspaceId: "w1", season: 2025, eventCode: "USNJQ1", watching: { kind: "slot", slot: "red1" }, fromMatch: "Q1", toMatch: "Q30",
    assigneeAccountId: 2, assigneeName: "Priya", createdByAccountId: 1, createdByName: "Coach", createdAt: 1, updatedAt: 1, version: 1, ...over,
  };
}
const state = (list: MatchAssignment[]): MatchAssignmentsState => ({ list, loading: false, error: null, reload: vi.fn(), apply: vi.fn() });

function view(list: MatchAssignment[], { isAdmin = true, myAccountId = 1, readOnly = false } = {}) {
  const s = state(list);
  render(<MemoryRouter><MatchAssignmentsSection space="w1" season={2025} defaultEvent="USNJQ1" state={s} myAccountId={myAccountId} isAdmin={isAdmin} readOnly={readOnly} /></MemoryRouter>);
  return s;
}

describe("Match scouting list", () => {
  const list = () => [
    row({ assigneeAccountId: 3, assigneeName: "Marcus", watching: { kind: "alliance", side: "blue" }, fromMatch: "Q15", toMatch: "Q40" }),
    row({}),
    row({ assigneeAccountId: 1, assigneeName: "Coach", watching: { kind: "all" }, fromMatch: null, toMatch: null, eventCode: "USPAQ2" }),
  ];

  it("reads who, what and which quals, by event in match order, with You for the signed-in member", () => {
    view(list(), { isAdmin: false });
    const nj = within(screen.getByRole("region", { name: "Match scouting at USNJQ1" })).getAllByTestId("match-assignment-row");
    expect(nj.map((r) => r.textContent)).toEqual(["PriyaRed 1Q1–Q30", "MarcusBlue allianceQ15–Q40"]);
    expect(within(screen.getByRole("region", { name: "Match scouting at USPAQ2" })).getByTestId("match-assignment-row").textContent).toBe("YouAll 4 teamsAll quals");
    expect(screen.queryByRole("button")).toBeNull(); // members: no Add, Edit or Remove
  });

  it("admins remove one; a read-only space shows no actions even to an admin", async () => {
    const s = view(list());
    fireEvent.click(screen.getByRole("button", { name: "Remove Priya's Red 1 · Q1–Q30" }));
    await waitFor(() => expect(s.apply).toHaveBeenCalledWith({ action: "deleted", matchAssignments: [expect.objectContaining({ assigneeName: "Priya" })] }));
    expect(deleteMatchAssignment).toHaveBeenCalledWith("w1", expect.any(Number));
    cleanup();
    view(list(), { readOnly: true });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says what to do when there's nothing yet", () => {
    view([]);
    expect(screen.getByText("No match scouting set in 2025")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});

describe("Assign match scouting sheet", () => {
  it("sends the member, the alliance and the range as typed, normalized to quals", async () => {
    const s = view([]);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Marcus" }));
    fireEvent.click(screen.getByRole("radio", { name: "Alliance" }));
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "q40" } });
    expect(screen.getByText("Blue alliance · Q15–Q40")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(createMatchAssignment).toHaveBeenCalledWith("w1", {
      season: 2025, eventCode: "USNJQ1", watching: { kind: "alliance", side: "blue" }, fromMatch: "Q15", toMatch: "Q40", assigneeAccountId: 3,
    }));
    expect(s.apply).toHaveBeenCalledWith(expect.objectContaining({ action: "created" }));
  });

  it("refuses a backwards range and warns when someone already has that slot in those matches", async () => {
    view([row({})]);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Marcus" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10" } });
    expect(screen.getByRole("alert").textContent).toBe("Q30 comes after Q10.");
    expect((screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "" } });
    // Red 1 from Q30 on meets Priya's Red 1, Q1–Q30.
    expect(screen.getByRole("status").textContent).toContain("Priya: Red 1 · Q1–Q30");
    expect((screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
