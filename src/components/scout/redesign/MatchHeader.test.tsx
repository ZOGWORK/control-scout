// @vitest-environment jsdom
// The match header steps through the schedule (arrows, swipe, chips) and stops at the ends; chips read their
// progress (done, partly scouted, skipped, upcoming, current); the watched teams are picked out; the schedule
// states say what's missing and offer the way on.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchProgress, ScheduleMatch, Watching } from "../../../shared/scoutMatch";
import { chipState, clockTime, MatchHeader, ScheduleState } from "./MatchHeader";

const match = (n: number, time: string | null = `2025-11-08T${String(9 + Math.floor(n / 6)).padStart(2, "0")}:${String((n * 7) % 60).padStart(2, "0")}:00`): ScheduleMatch => ({
  key: `q${n}`, label: `Q${n}`, level: "qual", time, startsAt: null, played: false,
  red: [1000 + n, 2000 + n], blue: [3000 + n, 4000 + n],
});
const SCHEDULE = Array.from({ length: 10 }, (_, i) => match(i + 1));
const RED: Watching = { kind: "alliance", side: "red" };

function setup(over: Partial<{ index: number; nextIndex: number; watching: Watching; progress: MatchProgress[] }> = {}) {
  const onIndex = vi.fn();
  const progress = over.progress ?? ["done", "done", "todo", "partial", "todo", "todo", "todo", "todo", "todo", "todo"];
  render(<MatchHeader schedule={SCHEDULE} index={over.index ?? 4} nextIndex={over.nextIndex ?? 4} watching={over.watching ?? RED}
    progress={(i) => progress[i]} onIndex={onIndex} />);
  return onIndex;
}
afterEach(cleanup);

describe("MatchHeader", () => {
  it("steps with the arrows and names where they go", () => {
    const onIndex = setup({ index: 4 });
    expect(screen.getByRole("heading", { name: "Q5" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next match, Q6" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous match, Q4" }));
    expect(onIndex.mock.calls).toEqual([[5], [3]]);
  });

  it("disables the arrow at each end", () => {
    setup({ index: 0 });
    expect((screen.getByRole("button", { name: "Previous match" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const onIndex = setup({ index: 9 });
    const next = screen.getByRole("button", { name: "Next match" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(next);
    expect(onIndex).not.toHaveBeenCalled();
  });

  it("steps on a sideways swipe, not a scroll or a short drag", () => {
    const onIndex = setup({ index: 4 });
    const bar = screen.getByRole("heading", { name: "Q5" }).parentElement!.parentElement!;
    const swipe = (dx: number, dy = 0) => {
      fireEvent.pointerDown(bar, { clientX: 200, clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(bar, { clientX: 200 + dx, clientY: 100 + dy, pointerId: 1 });
    };
    swipe(-80);
    swipe(80);
    swipe(-20);
    swipe(-60, 90);
    expect(onIndex.mock.calls).toEqual([[5], [3]]);
  });

  it("shows the status: next up with its time, saved, or the time", () => {
    setup({ index: 4, nextIndex: 4 });
    expect(screen.getByText(/Next up/).parentElement!.textContent).toBe(`Next up · ~${clockTime(SCHEDULE[4].time)}`);
    cleanup();
    setup({ index: 0, nextIndex: 4 });
    expect(screen.getByText(/Saved/).parentElement!.textContent).toBe("Saved · tap to edit");
    cleanup();
    setup({ index: 6, nextIndex: 4 });
    expect(screen.getByText(`~${clockTime(SCHEDULE[6].time)}`)).toBeTruthy();
  });

  it("colours each chip by progress and marks the current one", () => {
    const onIndex = setup({ index: 4, nextIndex: 4 });
    const strip = screen.getByRole("list", { name: "Matches" });
    const chips = within(strip).getAllByRole("button");
    expect(chips.map((c) => c.dataset.state)).toEqual(["done", "done", "skipped", "partial", "current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(within(strip).getByRole("button", { name: "Q3, skipped" })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: "Q4, partly scouted" })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: "Q1, done" })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: "Q5, current" }).getAttribute("aria-current")).toBe("true");
    expect(strip.querySelectorAll("[aria-current]")).toHaveLength(1);
    fireEvent.click(within(strip).getByRole("button", { name: "Q8" }));
    expect(onIndex).toHaveBeenCalledWith(7);
  });

  it("picks out the watched teams and dims the others", () => {
    setup({ index: 0, watching: { kind: "slot", slot: "blue2" } });
    const teams = screen.getByRole("group", { name: "Teams in Q1" });
    const watched = [...teams.querySelectorAll("[data-watched]")].map((e) => e.textContent);
    expect(watched).toEqual(["4001Blue 2, watching"]);
    expect(within(teams).getByText("1001").className).toMatch(/text-text-muted/);
    cleanup();
    setup({ index: 0, watching: { kind: "all" } });
    expect(screen.getByRole("group", { name: "Teams in Q1" }).querySelectorAll("[data-watched]")).toHaveLength(4);
  });
});

describe("chipState and clockTime", () => {
  it("skipped means not scouted before the next match; the current chip wins", () => {
    expect(chipState(2, 5, "todo", 4)).toBe("skipped");
    expect(chipState(6, 5, "todo", 4)).toBe("upcoming");
    expect(chipState(5, 5, "done", 4)).toBe("current");
    expect(chipState(1, 5, "todo", -1)).toBe("upcoming");
  });
  it("reads the event-local clock as h:mm", () => {
    expect(clockTime("2025-11-08T10:42:00")).toBe("10:42");
    expect(clockTime("2025-11-08T13:05:00")).toBe("1:05");
    expect(clockTime("2025-11-08T00:30:00")).toBe("12:30");
    expect(clockTime(null)).toBeNull();
  });
});

describe("ScheduleState", () => {
  afterEach(cleanup);
  it("loading", () => {
    render(<ScheduleState status="loading" />);
    expect(screen.getByRole("status", { name: "Loading the schedule" })).toBeTruthy();
  });
  it("none offers typing the match in", () => {
    const onManual = vi.fn();
    render(<ScheduleState status="none" onManual={onManual} />);
    expect(screen.getByText("FIRST hasn't published this event's schedule yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Type the match in" }));
    expect(onManual).toHaveBeenCalled();
  });
  it("error offers a retry", () => {
    const onRetry = vi.fn();
    render(<ScheduleState status="error" error="offline" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't load the schedule/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("notes a schedule from this phone, and says nothing when fresh", () => {
    render(<ScheduleState status="ready" fromDevice />);
    expect(screen.getByText("Showing the schedule saved on this phone")).toBeTruthy();
    cleanup();
    const { container } = render(<ScheduleState status="ready" />);
    expect(container.innerHTML).toBe("");
  });
});
