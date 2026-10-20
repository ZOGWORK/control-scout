// @vitest-environment jsdom
// Everyone's assignments on a phone: the team, the full assignee name and the status come first, so two
// members named alike stay distinguishable; the actions take their own row; two scouts on one team stay two
// rows; observed entries and completion stay separate facts; admin-only actions stay admin-only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Assignment } from "../../shared/assignments";
import type { AssignmentsState } from "../../lib/assignments";
import { AssignmentsView } from "./Assignments";

// jsdom has no matchMedia (the admin-only Assign sheet asks whether it's on a phone).
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
afterEach(cleanup);

const MONTGOMERY = "Alexandra Whitfield-Montgomery", MORALES = "Alexandra Whitfield-Morales";
let id = 0;
const assignment = (over: Partial<Assignment>): Assignment => ({
  id: ++id, workspaceId: "w1", season: 2025, eventCode: "TESTQ1", team: 21010, assigneeAccountId: 2, assigneeName: MONTGOMERY,
  createdByAccountId: 1, createdByName: "Sam Rivera", createdAt: 1, status: "open", doneAt: null, doneByAccountId: null, doneByName: null,
  version: 1, progress: 0, ...over,
});
const state = (list: Assignment[]): AssignmentsState => ({ list, loading: false, error: null, reload: vi.fn(), apply: vi.fn() });

function view(list: Assignment[], { isAdmin = true, myAccountId = 1 } = {}) {
  render(
    <MemoryRouter>
      <AssignmentsView space="w1" workspaceName="Riverside" season={2025} defaultEvent="TESTQ1" state={state(list)} myAccountId={myAccountId}
        isAdmin={isAdmin} localEntries={[]} onScout={vi.fn()} />
    </MemoryRouter>,
  );
  return within(screen.getByRole("region", { name: "TESTQ1" })).getAllByTestId("assignment-row");
}

describe("Everyone's assignments rows", () => {
  const list = () => [
    assignment({ assigneeAccountId: 2, assigneeName: MONTGOMERY, progress: 3 }),
    assignment({ assigneeAccountId: 3, assigneeName: MORALES, status: "done", doneAt: 5, doneByAccountId: 3, doneByName: MORALES, progress: 0 }),
  ];

  it("shows each similar long name in full, never truncated, with team and status before the actions", () => {
    const rows = view(list());
    expect(rows).toHaveLength(2); // two scouts on one team are intentional: both rows stay
    for (const [row, name, status] of [[rows[0], MONTGOMERY, "Open"], [rows[1], MORALES, "Done"]] as const) {
      const nameEl = within(row).getByText(name, { exact: true });
      expect(nameEl.className).not.toMatch(/\btruncate\b|line-clamp|text-ellipsis/);
      expect(nameEl.className).toMatch(/overflow-wrap:anywhere/);
      expect(within(row).getByRole("link", { name: "21010" })).toBeTruthy();
      // Identity (team, name, status) is one block, the actions another that follows it.
      const [identity, actions] = Array.from(row.children) as HTMLElement[];
      expect(identity.textContent).toContain("21010");
      expect(identity.textContent).toContain(name);
      expect(identity.textContent).toContain(status);
      expect(within(actions).getAllByRole("button").length).toBeGreaterThan(0);
      expect(identity.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("stacks the actions below on phones and puts them inline from the sm breakpoint", () => {
    const [row] = view(list());
    expect(row.className).toMatch(/\bflex-col\b/);
    expect(row.className).toMatch(/\bsm:flex-row\b/);
  });

  it("names whose row each action acts on, so similar names stay distinct for screen readers too", () => {
    view(list());
    expect(screen.getByRole("button", { name: `Mark team 21010 done for ${MONTGOMERY}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Reopen team 21010 for ${MORALES}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Remove ${MONTGOMERY}'s assignment for team 21010` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Remove ${MORALES}'s assignment for team 21010` })).toBeTruthy();
  });

  it("keeps observed entries and completion as separate facts", () => {
    const rows = view(list());
    expect(rows[0].textContent).toContain("3 entries");
    expect(rows[0].textContent).not.toContain("done by");
    expect(rows[1].textContent).toContain("0 entries · done by " + MORALES);
  });

  it("gives a member only their own Done, and no Reopen or Remove", () => {
    const rows = view(list(), { isAdmin: false, myAccountId: 2 });
    expect(within(rows[0]).getByText("You")).toBeTruthy();
    expect(within(rows[0]).getByRole("button", { name: "Mark team 21010 done for you" })).toBeTruthy();
    expect(within(rows[1]).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reopen/ })).toBeNull();
  });
});
