// @vitest-environment jsdom
// Schedule difficulty in the Rankings table's Schedule cell and on the team page: every figure comes with its plain
// line, mid-event the matches still to play lead, and the owner's toggle off hides it.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { TeamEventRow } from "../shared/api";
import { scheduleDifficulty } from "../shared/scheduleDifficulty";
import { schedulePlaces, ScheduleValue, TeamScheduleSection } from "./ScheduleDifficulty";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";

afterEach(() => { cleanup(); resetFlags(); });

const rating = new Map([[1, 60], [2, 60], [3, 20], [4, 20], [5, 20], [6, 20], [7, 20], [8, 20]]);
const quals = [
  { red: [3, 4], blue: [1, 2], played: true }, { red: [5, 6], blue: [7, 8], played: true },
  { red: [3, 1], blue: [5, 7], played: false }, { red: [4, 8], blue: [2, 6], played: false },
];

describe("ScheduleValue (the Rankings table's Schedule cell)", () => {
  it("shows the signed points, and a tap gives the plain line and the place in the field", () => {
    const t4 = scheduleDifficulty(rating, quals)!.teams.find((t) => t.team === 4)!.full!;
    render(<ScheduleValue stat="scheduleDifficulty" v={t4.difficulty} opponents={t4.opponents} partners={t4.partners} rank={t4} />);
    const cell = screen.getByRole("button");
    expect(cell.textContent).toMatch(/^\+\d+\.\d$/);
    expect(cell.getAttribute("aria-label")).toMatch(/Opponents average \+\d+ over the field's, partners −\d+/);
    fireEvent.click(cell);
    expect(screen.getByText("Hardest of 8")).toBeTruthy();
  });

  it("says nothing it doesn't have: a dash with no value, a plain number without the opponents and partners", () => {
    const { container } = render(<><ScheduleValue stat="scheduleDifficulty" v={null} /><ScheduleValue stat="scheduleLeft" v={-2.04} /></>);
    expect(container.textContent).toBe("—−2.0");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("schedulePlaces (the records table's place in the field)", () => {
  it("comes from the event's own figures: the whole field, not just the rows a table holds", () => {
    const sd = scheduleDifficulty(rating, quals)!;
    const p = schedulePlaces(sd);
    expect(p.size).toBe(8);
    expect(p.get(4)).toMatchObject({ rank: 1, of: 8 });
    expect(schedulePlaces(null).size).toBe(0);
  });
});

describe("TeamScheduleSection", () => {
  const sd = scheduleDifficulty(rating, quals)!;
  const t4 = sd.teams.find((t) => t.team === 4)!;
  const ev = { season: 2025, code: "USNJQ1", name: "New Jersey Qualifier 1" } as TeamEventRow;
  const section = () => <MemoryRouter><TeamScheduleSection team={4} schedule={[{ ...t4, code: "USNJQ1", scheduled: 4, played: 2 }]} events={[ev]} /></MemoryRouter>;

  it("says where the team's draw sits at each event, in a plain line", () => {
    render(section());
    const row = document.querySelector("[data-team-schedule-row]")!;
    expect(row.textContent).toMatch(/New Jersey Qualifier 1/);
    expect(row.textContent).toMatch(/Its opponents average .* over the field's, its partners/);
    // Mid-event: what's left leads, and the full schedule is said too.
    expect(row.textContent).toMatch(/1 still to play/);
    expect(row.textContent).toMatch(/Full schedule: hardest of 8/);
  });

  it("is hidden while the owner's scheduleDifficulty toggle is off", () => {
    resetFlags({ ...DEFAULT_FLAGS, scheduleDifficulty: false }, true);
    const { container } = render(section());
    expect(container.innerHTML).toBe("");
  });
});
