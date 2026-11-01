// @vitest-environment jsdom
// Beside the pick list: this member's open assignments with Scout, the latest activity, and links to the full views.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Assignment } from "../../../shared/assignments";
import type { ActivityState } from "../../../lib/scoutActivity";
import { PlanningRail } from "./PlanningRail";

afterEach(cleanup);

const asg = (id: number, team: number) => ({ id, team, eventCode: "USTST1", status: "open" }) as unknown as Assignment;
const activity = (items: unknown[] = []) => ({ items, loading: false, error: null, more: false, loadingOlder: false, loadOlder: () => {}, reload: () => {} }) as unknown as ActivityState;

describe("PlanningRail", () => {
  it("lists the member's open assignments with Scout, up to five, and links to all of them", () => {
    const onScout = vi.fn(), onView = vi.fn();
    render(<PlanningRail mine={[1, 2, 3, 4, 5, 6].map((i) => asg(i, 100 + i))} onScout={onScout} readOnly={false} activity={activity()} onOpenEntry={() => {}} alliancesOn={false} onView={onView} />);
    const card = screen.getByRole("region", { name: "Your assignments" });
    expect(within(card).getAllByRole("button", { name: /^Scout / })).toHaveLength(5);
    expect(card.textContent).toContain("and 1 more");
    fireEvent.click(within(card).getByRole("button", { name: "Scout 101 at USTST1" }));
    expect(onScout).toHaveBeenCalledWith(101, "USTST1");
    fireEvent.click(within(card).getByRole("button", { name: /All assignments/ }));
    expect(onView).toHaveBeenCalledWith("assignments");
    // No scouting alliance card unless it's on.
    expect(screen.queryByRole("region", { name: "Scouting alliance" })).toBeNull();
  });

  it("read-only: assignments show without Scout; no activity yet says so", () => {
    render(<PlanningRail mine={[asg(1, 101)]} onScout={() => {}} readOnly activity={activity()} onOpenEntry={() => {}} alliancesOn onView={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Scout / })).toBeNull();
    expect(screen.getByRole("region", { name: "Latest activity" }).textContent).toContain("Nothing yet");
    expect(screen.getByRole("region", { name: "Scouting alliance" })).toBeTruthy();
  });

  it("a failed activity load says so, with Retry, instead of Nothing yet", () => {
    const reload = vi.fn();
    const failed = { ...activity(), error: { message: "Offline." }, reload } as unknown as ActivityState;
    render(<PlanningRail mine={[]} onScout={() => {}} readOnly={false} activity={failed} onOpenEntry={() => {}} alliancesOn={false} onView={() => {}} />);
    const card = screen.getByRole("region", { name: "Latest activity" });
    expect(within(card).getByRole("alert").textContent).toContain("Couldn't load the activity");
    expect(card.textContent).not.toContain("Nothing yet");
    fireEvent.click(within(card).getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
