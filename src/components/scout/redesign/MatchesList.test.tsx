// @vitest-environment jsdom
// The Matches tab: the summary counts, each row's status (a skipped match vs one still to come, the open
// one as Now), the All / To do / Skipped chips, workspace names under rows, and tapping a row.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleMatch, Watching } from "../../../shared/scoutMatch";
import { MatchesList, matchRows, matchSummary } from "./MatchesList";

const m = (n: number, red: number[], blue: number[], time: string | null = null): ScheduleMatch => ({
  key: `qual:1:${n}`, label: `Q${n}`, level: "qual", time, startsAt: null, played: false, red, blue,
});
const SCHEDULE = [
  m(1, [11, 12], [21, 22]),
  m(2, [13, 14], [23, 24]),
  m(3, [15, 16], [25, 26]),
  m(4, [17, 18], [27, 28]),
  m(5, [19, 10], [29, 20], "2025-11-08T10:42:00"),
];
const RED: Watching = { kind: "alliance", side: "red" };
// Q1 done, Q2 skipped, Q3 partly done (one red team), Q4 open now, Q5 still to come.
const SCOUTED = new Map([["Q1", new Set([11, 12])], ["Q3", new Set([15, 25])]]);

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof MatchesList>> = {}) {
  const onOpen = vi.fn();
  render(<MatchesList schedule={SCHEDULE} watching={RED} scouted={SCOUTED} currentIndex={3} nextIndex={3} onOpen={onOpen} {...over} />);
  return { onOpen, rows: () => within(screen.getByRole("list", { name: "Matches" })).getAllByRole("button") };
}

describe("matchRows", () => {
  it("tells a skipped match from one still to come, and the open one is Now", () => {
    expect(matchRows(SCHEDULE, RED, SCOUTED, 3, 3).map((r) => r.status)).toEqual(["done", "skipped", "partial", "now", "upcoming"]);
  });
  it("a done match stays Done when it's the one open", () => {
    expect(matchRows(SCHEDULE, RED, SCOUTED, 0, 3)[0].status).toBe("done");
  });
  it("matches after where scouting picks up are upcoming, not skipped", () => {
    expect(matchRows(SCHEDULE, RED, new Map(), -1, 0).every((r) => r.status === "upcoming")).toBe(true);
  });
  it("counts done, skipped, and every team entry in the schedule", () => {
    expect(matchSummary(matchRows(SCHEDULE, RED, SCOUTED, 3, 3))).toEqual({ done: 1, entries: 4, skipped: 1 });
  });
});

describe("MatchesList", () => {
  it("shows the summary", () => {
    setup();
    const tile = (label: string) => screen.getByText(label, { selector: "p" }).parentElement!.textContent;
    expect(tile("Matches done")).toBe("Matches done1");
    expect(tile("Team entries")).toBe("Team entries4");
    expect(tile("Skipped")).toBe("Skipped1");
  });

  it("names every row in full with its status", () => {
    const { rows } = setup();
    expect(rows().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Q1, red 11 and 12, blue 21 and 22, done",
      "Q2, red 13 and 14, blue 23 and 24, skipped",
      "Q3, red 15 and 16, blue 25 and 26, partly done",
      "Q4, red 17 and 18, blue 27 and 28, now",
      expect.stringMatching(/^Q5, red 19 and 10, blue 29 and 20, about 10:42/),
    ]);
    expect(rows()[3].getAttribute("aria-current")).toBe("true");
    expect(rows()[4].textContent).toMatch(/~10:42/);
  });

  it("marks the watched teams, and none when watching all four", () => {
    const { rows } = setup();
    expect(within(rows()[0]).getByText("11").dataset.watched).toBe("true");
    expect(within(rows()[0]).getByText("21").dataset.watched).toBeUndefined();
    cleanup();
    const all = setup({ watching: { kind: "all" } });
    expect(all.rows()[0].querySelector("[data-watched]")).toBeNull();
  });

  it("filters to To do and Skipped", () => {
    const { rows } = setup();
    fireEvent.click(screen.getByRole("radio", { name: /To do/ }));
    expect(rows().map((b) => b.textContent?.slice(0, 2))).toEqual(["Q2", "Q3", "Q4", "Q5"]);
    fireEvent.click(screen.getByRole("radio", { name: /Skipped/ }));
    expect(rows().map((b) => b.textContent?.slice(0, 2))).toEqual(["Q2"]);
    fireEvent.click(screen.getByRole("radio", { name: /All/ }));
    expect(rows()).toHaveLength(5);
  });

  it("says so when a filter leaves nothing", () => {
    setup({ scouted: new Map(), currentIndex: 0, nextIndex: 0 });
    fireEvent.click(screen.getByRole("radio", { name: /Skipped/ }));
    expect(screen.getByText("No skipped matches.")).toBeTruthy();
  });

  it("opens the tapped match", () => {
    const { onOpen, rows } = setup();
    fireEvent.click(screen.getByRole("radio", { name: /Skipped/ }));
    fireEvent.click(rows()[0]);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("jumps to the open match, back to All when a chip hides it", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { rows } = setup();
    fireEvent.click(screen.getByRole("radio", { name: /Skipped/ }));
    fireEvent.click(screen.getByRole("button", { name: /Jump to Q4/ }));
    expect(rows()).toHaveLength(5);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole("button", { name: /^Q4,/ }).parentElement);
  });

  it("shows who has the other teams only when given", () => {
    const { rows } = setup();
    expect(rows()[0].textContent).not.toMatch(/Priya/);
    cleanup();
    const others = new Map([["Q1", [{ side: "blue" as const, name: "Priya", done: true }]], ["Q5", [{ side: "blue2" as const, name: "Jo", done: false }]]]);
    const again = setup({ others });
    expect(again.rows()[0].textContent).toMatch(/Blue: Priya ✓/);
    expect(again.rows()[0].getAttribute("aria-label")).toMatch(/Blue: Priya, done$/);
    expect(again.rows()[4].textContent).toMatch(/Blue 2: Jo · assigned/);
  });

  it("says when there's no schedule", () => {
    setup({ schedule: [], currentIndex: -1, nextIndex: -1 });
    expect(screen.getByText("No matches in the schedule yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Jump/ })).toBeNull();
  });
});
